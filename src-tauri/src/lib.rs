pub mod document;
pub mod mcp;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use document::{Catalog, Command, Editor, EditorSnapshot, PartId, Project};
use mcp::{AgentServer, AgentStatus};
use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const STATE_CHANGED: &str = "state-changed";
const PROJECT_EXTENSION: &str = "asmproj";
const MAX_FILE_NAME_CHARS: usize = 80;
const RESERVED_FILE_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

struct AppState {
    editor: Mutex<Editor>,
    catalog: Catalog,
}

/// Publishes while the lock is held, so events reach the UI in revision order.
fn publish(app: &AppHandle, editor: &Editor) {
    if let Err(error) = app.emit(STATE_CHANGED, editor.snapshot()) {
        eprintln!("falha ao publicar o estado: {error}");
    }
}

/// Goes through a temporary file, so a failure can't leave a half-written file behind.
pub(crate) fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("asm-tmp");
    fs::write(&temporary, bytes).map_err(|error| format!("não foi possível gravar: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("não foi possível gravar: {error}")
    })
}

/// Windows refuses these characters and names. Since agents can pick the name, the result also
/// can't point at another folder.
fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .take(MAX_FILE_NAME_CHARS)
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        return "modelo".to_string();
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed).trim().to_ascii_lowercase();
    if RESERVED_FILE_NAMES.contains(&stem.as_str()) {
        format!("modelo_{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Finds a name not taken yet, so an agent can never overwrite an earlier export.
fn unused_path(folder: &Path, name: &str, extension: &str) -> PathBuf {
    let mut path = folder.join(format!("{name}.{extension}"));
    let mut copy = 2;
    while path.exists() {
        path = folder.join(format!("{name} ({copy}).{extension}"));
        copy += 1;
    }
    path
}

fn ask_save_path(
    window: &WebviewWindow,
    title: &str,
    filter: &str,
    extension: &str,
    file_name: &str,
) -> Option<PathBuf> {
    window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(title)
        .add_filter(filter, &[extension])
        .set_file_name(file_name)
        .blocking_save_file()?
        .into_path()
        .ok()
}

fn current_name(state: &AppState) -> String {
    safe_file_name(&state.editor.lock().expect("editor lock").project().name)
}

#[tauri::command]
fn get_state(state: State<'_, AppState>) -> EditorSnapshot {
    state.editor.lock().expect("editor lock").snapshot()
}

#[tauri::command]
fn apply_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command: Command,
) -> Result<Vec<PartId>, String> {
    let mut editor = state.editor.lock().expect("editor lock");
    let affected = editor.apply(command, &state.catalog)?;
    publish(&app, &editor);
    Ok(affected)
}

#[tauri::command]
fn undo(app: AppHandle, state: State<'_, AppState>) {
    let mut editor = state.editor.lock().expect("editor lock");
    if editor.undo() {
        publish(&app, &editor);
    }
}

#[tauri::command]
fn redo(app: AppHandle, state: State<'_, AppState>) {
    let mut editor = state.editor.lock().expect("editor lock");
    if editor.redo() {
        publish(&app, &editor);
    }
}

#[tauri::command]
fn new_project(app: AppHandle, state: State<'_, AppState>) {
    let mut editor = state.editor.lock().expect("editor lock");
    editor.replace_document(Project::default(), None);
    publish(&app, &editor);
}

/// Returns false when the person cancels the dialog.
#[tauri::command(async)]
fn save_project(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    save_as: bool,
) -> Result<bool, String> {
    let known_path = state
        .editor
        .lock()
        .expect("editor lock")
        .path()
        .map(PathBuf::from);
    let path = match known_path.filter(|_| !save_as) {
        Some(path) => path,
        None => {
            let file_name = format!("{}.{PROJECT_EXTENSION}", current_name(&state));
            let chosen = ask_save_path(
                &window,
                "Salvar projeto",
                "Projeto do Assets Studio Maker",
                PROJECT_EXTENSION,
                &file_name,
            );
            match chosen {
                Some(path) => path,
                None => return Ok(false),
            }
        }
    };

    // The lock is taken only after the dialog, so saving includes any change made meanwhile.
    let mut editor = state.editor.lock().expect("editor lock");
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| editor.project().name.clone());
    let mut project = editor.project().clone();
    project.name.clone_from(&name);
    write_atomically(&path, document::project_to_json(&project)?.as_bytes())?;
    editor.mark_saved(path.to_string_lossy().into_owned(), name);
    publish(&app, &editor);
    Ok(true)
}

/// Returns false when the person cancels the dialog.
#[tauri::command(async)]
fn open_project(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let chosen = window
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Abrir projeto")
        .add_filter("Projeto do Assets Studio Maker", &[PROJECT_EXTENSION])
        .blocking_pick_file();
    let Some(path) = chosen.and_then(|file| file.into_path().ok()) else {
        return Ok(false);
    };

    let json = fs::read_to_string(&path).map_err(|error| format!("não foi possível ler: {error}"))?;
    let project = document::project_from_json(&json, &state.catalog)?;
    let mut editor = state.editor.lock().expect("editor lock");
    editor.replace_document(project, Some(path.to_string_lossy().into_owned()));
    publish(&app, &editor);
    Ok(true)
}

/// Receives the finished file as raw bytes and returns where it was saved, if anywhere.
/// The path always comes from the dialog: the interface can't choose where to write.
#[tauri::command(async)]
fn save_glb(
    window: WebviewWindow,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<Option<String>, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("o arquivo exportado chegou em um formato inesperado".to_string());
    };
    let file_name = format!("{}.glb", current_name(&state));
    let Some(path) = ask_save_path(&window, "Exportar GLB", "Modelo GLB", "glb", &file_name) else {
        return Ok(None);
    };
    write_atomically(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Saves an agent's export. An agent can't choose the folder and can't replace a file.
#[tauri::command(async)]
fn save_agent_glb(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("o arquivo exportado chegou em um formato inesperado".to_string());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let name = safe_file_name(&percent_decode_str(name).decode_utf8_lossy());

    let folder = app
        .path()
        .document_dir()
        .map_err(|error| error.to_string())?
        .join("Assets Studio Maker")
        .join("Exportados");
    fs::create_dir_all(&folder).map_err(|error| format!("não foi possível criar a pasta: {error}"))?;
    let path = unused_path(&folder, &name, "glb");
    write_atomically(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn agent_bridge_ready(agent: State<'_, AgentServer>) -> AgentStatus {
    agent.attach()
}

// Stopping waits for the server thread, so these two stay off the main thread.
#[tauri::command(async)]
fn set_agent_enabled(agent: State<'_, AgentServer>, enabled: bool) -> Result<AgentStatus, String> {
    agent.set_enabled(enabled)
}

#[tauri::command(async)]
fn replace_agent_key(agent: State<'_, AgentServer>) -> Result<AgentStatus, String> {
    agent.replace_key()
}

#[tauri::command]
fn agent_reply(
    agent: State<'_, AgentServer>,
    id: u64,
    result: Option<serde_json::Value>,
    error: Option<String>,
) {
    let answer = match (result, error) {
        (Some(result), _) => Ok(result),
        (None, error) => Err(error.unwrap_or_else(|| "o editor não devolveu resposta".to_string())),
    };
    agent.reply(id, answer);
}

pub fn run() {
    let catalog = Catalog::embedded().expect("catálogo de blocos inválido");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            app.manage(AppState {
                editor: Mutex::new(Editor::default()),
                catalog,
            });
            let settings = app.path().app_config_dir()?.join("agente.json");
            app.manage(AgentServer::new(app.handle().clone(), settings)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            apply_command,
            undo,
            redo,
            new_project,
            save_project,
            open_project,
            save_glb,
            save_agent_glb,
            agent_bridge_ready,
            set_agent_enabled,
            replace_agent_key,
            agent_reply
        ])
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o Assets Studio Maker")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<AgentServer>().shutdown();
            }
        });
}

#[cfg(test)]
#[path = "tests/lib.rs"]
mod tests;

pub mod document;

use std::sync::Mutex;

use document::{Catalog, Command, Editor, EditorSnapshot, PartId};
use tauri::{AppHandle, Emitter, Manager, State};

const STATE_CHANGED: &str = "state-changed";

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

pub fn run() {
    let catalog = Catalog::embedded().expect("catálogo de blocos inválido");

    tauri::Builder::default()
        .setup(move |app| {
            app.manage(AppState {
                editor: Mutex::new(Editor::default()),
                catalog,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_state, apply_command, undo, redo])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o Assets Studio Maker");
}

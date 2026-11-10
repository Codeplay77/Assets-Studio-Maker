//! Local MCP server, so an AI agent can build models inside the running editor.
//!
//! Only the transport lives here. The tools run in the interface, which already holds the
//! catalog, the generators and the 3D view, and they change the project through the same
//! `Editor::apply` as everything else.
//!
//! The server stays off until the person turns it on. It listens on the loopback address only
//! and requires a secret key. Requests carrying an `Origin` header are refused, because that
//! header means a web page is calling, and no web page should reach this server.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tiny_http::{Method, Request, Server, StatusCode};

use crate::write_atomically;

const PORT: u16 = 38917;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_DRAINED_BYTES: u64 = 64 * 1024 * 1024;
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(60);
const KEY_BYTES: usize = 32;
const BIND_ATTEMPTS: u32 = 40;
const BIND_RETRY: Duration = Duration::from_millis(25);
const JSON_HEADER: &str = "Content-Type: application/json\r\n";

const AGENT_CALL: &str = "mcp-call";
const SERVER_NAME: &str = "assets-studio-maker";

/// Newest first. A client asking for anything else gets the newest one.
const PROTOCOL_VERSIONS: [&str; 3] = ["2025-11-25", "2025-06-18", "2025-03-26"];

const INSTRUCTIONS: &str = "\
Assets Studio Maker is a 3D block editor open on the user's screen. Whatever you do appears \
live, and each tool call is one step the user can undo.

Y is up, one unit is one meter, and characters and vehicles face +Z.

You can model anything. create_shape makes new geometry from primitives, revolved profiles, \
lofted cross-sections, tubes, extruded outlines or raw polygons. edit_shape reshapes it as in a \
3D modeling program: pull and inset faces, drill holes, bevel edges, cut one shape with another, \
sculpt with a brush, round, mirror, move vertices with soft falloff, \
and paint faces. Build organic forms by mirroring a half and rounding it. convert_to_shape makes \
any ready-made part editable too. A shape's id works as a block id everywhere.

You can also assemble from the catalog: find pieces with search_blocks, read their sockets with \
get_block, then place them with attach_part (snaps to a socket) or add_parts (free position, \
use onGround to rest on the floor). Every model follows one of three art styles (lowpoly, \
realistic, blocks): keep a whole project in one style and never mix blocks of different styles. \
Use generate for a complete random person, vehicle, \
building, house, tree, city or map. Prefer whichever gives the best result, and mix them.

Check your work with capture_view, using several views, before saying it's done. When a model \
is finished, group_parts makes it move as one, and frame_view shows it to the user.";

/// Runs what only the interface can answer.
pub trait Bridge {
    fn call(&self, method: &str, params: Value) -> Result<Value, String>;
}

fn rpc_result(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &Value, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn initialize(id: &Value, params: &Value) -> Value {
    let requested = params.get("protocolVersion").and_then(Value::as_str);
    let version = requested
        .filter(|version| PROTOCOL_VERSIONS.contains(version))
        .unwrap_or(PROTOCOL_VERSIONS[0]);
    rpc_result(
        id,
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": SERVER_NAME,
                "title": "Assets Studio Maker",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": INSTRUCTIONS,
        }),
    )
}

/// Returns the reply, or `None` for a notification, which gets no reply.
pub fn handle_message(message: &Value, bridge: &dyn Bridge) -> Option<Value> {
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        // A client's reply to a request we never make, or something that isn't JSON-RPC.
        let id = message.get("id").cloned().unwrap_or(Value::Null);
        let is_reply = message.get("result").is_some() || message.get("error").is_some();
        return (!is_reply).then(|| rpc_error(&id, -32600, "requisição inválida"));
    };
    let id = message.get("id")?;
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

    Some(match method {
        "initialize" => initialize(id, &params),
        "ping" => rpc_result(id, json!({})),
        "tools/list" => match bridge.call("list", json!({})) {
            Ok(result) => rpc_result(id, result),
            Err(error) => rpc_error(id, -32603, &error),
        },
        "tools/call" => match bridge.call("call", params) {
            Ok(result) => rpc_result(id, result),
            // Reported as a tool failure, so the agent reads it and can try again.
            Err(error) => rpc_result(
                id,
                json!({ "content": [{ "type": "text", "text": error }], "isError": true }),
            ),
        },
        _ => rpc_error(id, -32601, "método desconhecido"),
    })
}

#[derive(Debug, Default)]
struct AccessHeaders {
    host: Option<String>,
    origin: Option<String>,
    authorization: Option<String>,
    protocol_version: Option<String>,
}

/// Takes the same time wherever the keys differ, so the key can't be guessed byte by byte.
fn same_key(given: &str, expected: &str) -> bool {
    given.len() == expected.len()
        && given
            .bytes()
            .zip(expected.bytes())
            .fold(0, |difference, (a, b)| difference | (a ^ b))
            == 0
}

fn check_access(headers: &AccessHeaders, key: &str) -> Result<(), (u16, &'static str)> {
    if headers.origin.is_some() {
        return Err((403, "páginas da web não podem usar este servidor"));
    }
    // Guards against DNS rebinding, where a remote name is pointed at this machine.
    let host = headers.host.as_deref().unwrap_or_default();
    if host != format!("127.0.0.1:{PORT}") && host != format!("localhost:{PORT}") {
        return Err((403, "endereço não permitido"));
    }
    let given = headers
        .authorization
        .as_deref()
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if !same_key(given, key) {
        return Err((401, "chave de acesso inválida"));
    }
    if let Some(version) = &headers.protocol_version {
        if !PROTOCOL_VERSIONS.contains(&version.as_str()) {
            return Err((400, "versão do protocolo não suportada"));
        }
    }
    Ok(())
}

/// Every answer closes the connection. A connection kept open would outlive the server when the
/// person turns it off, and the client's next request would hang until it timed out.
fn send(request: Request, status: u16, extra_headers: &str, body: &[u8]) {
    let reason = StatusCode(status).default_reason_phrase();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut writer = request.into_writer();
    let _ = writer
        .write_all(head.as_bytes())
        .and_then(|()| writer.write_all(body))
        .and_then(|()| writer.flush());
}

fn send_json(request: Request, status: u16, body: &Value) {
    send(request, status, JSON_HEADER, body.to_string().as_bytes());
}

fn send_failure(request: Request, status: u16, message: &str) {
    let extra = if status == 401 {
        format!("{JSON_HEADER}WWW-Authenticate: Bearer\r\n")
    } else {
        JSON_HEADER.to_string()
    };
    send(request, status, &extra, json!({ "error": message }).to_string().as_bytes());
}

fn read_headers(request: &Request) -> AccessHeaders {
    let find = |name: &'static str| {
        request
            .headers()
            .iter()
            .find(|header| header.field.equiv(name))
            .map(|header| header.value.as_str().to_string())
    };
    AccessHeaders {
        host: find("Host"),
        origin: find("Origin"),
        authorization: find("Authorization"),
        protocol_version: find("MCP-Protocol-Version"),
    }
}

/// Reads the whole body, even past the limit. Answering while the client is still sending makes
/// Windows reset the connection, and the client would never see the answer.
fn read_body(request: &mut Request) -> std::io::Result<Vec<u8>> {
    let mut body = Vec::new();
    let reader = request.as_reader();
    reader.take((MAX_BODY_BYTES + 1) as u64).read_to_end(&mut body)?;
    std::io::copy(&mut reader.take(MAX_DRAINED_BYTES), &mut std::io::sink())?;
    Ok(body)
}

fn handle_request(mut request: Request, key: &str, bridge: &dyn Bridge) {
    let Ok(body) = read_body(&mut request) else {
        send_failure(request, 400, "não foi possível ler a requisição");
        return;
    };
    if request.url().split('?').next() != Some("/mcp") {
        send_failure(request, 404, "não encontrado");
        return;
    }
    if let Err((status, message)) = check_access(&read_headers(&request), key) {
        send_failure(request, status, message);
        return;
    }
    if *request.method() != Method::Post {
        // The server never sends messages on its own, so there is no stream to open.
        send(request, 405, "Allow: POST\r\n", b"");
        return;
    }
    if body.len() > MAX_BODY_BYTES {
        send_failure(request, 413, "requisição grande demais");
        return;
    }
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        send_json(request, 400, &rpc_error(&Value::Null, -32700, "JSON inválido"));
        return;
    };

    match handle_message(&message, bridge) {
        Some(reply) => send_json(request, 200, &reply),
        None => send(request, 202, "", b""),
    }
}

/// Hands calls to the interface and waits for its answers.
struct Hub {
    app: AppHandle,
    next_call: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    accepting: AtomicBool,
    key: Mutex<String>,
}

impl Bridge for Hub {
    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.accepting.load(Ordering::SeqCst) {
            return Err("o servidor está desligando".to_string());
        }
        let id = self.next_call.fetch_add(1, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().expect("pending lock").insert(id, sender);

        let call = json!({ "id": id, "method": method, "params": params });
        if let Err(error) = self.app.emit(AGENT_CALL, call) {
            self.pending.lock().expect("pending lock").remove(&id);
            return Err(error.to_string());
        }
        let answer = receiver.recv_timeout(BRIDGE_TIMEOUT);
        self.pending.lock().expect("pending lock").remove(&id);
        answer.unwrap_or_else(|_| Err("o editor não respondeu a tempo".to_string()))
    }
}

impl Hub {
    fn stop_accepting(&self) {
        self.accepting.store(false, Ordering::SeqCst);
        // Dropping the senders wakes whoever is still waiting for an answer.
        self.pending.lock().expect("pending lock").clear();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Settings {
    enabled: bool,
    key: String,
}

fn new_key() -> Result<String, String> {
    let mut bytes = [0u8; KEY_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn load_settings(path: &Path) -> Result<Settings, String> {
    let stored = fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .filter(|settings| !settings.key.is_empty());
    match stored {
        Some(settings) => Ok(settings),
        None => Ok(Settings {
            enabled: false,
            key: new_key()?,
        }),
    }
}

fn save_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    write_atomically(path, text.as_bytes())
}

/// What the interface shows about the server.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub enabled: bool,
    pub running: bool,
    pub url: String,
    pub key: String,
    pub error: Option<String>,
}

struct Running {
    server: Arc<Server>,
    thread: JoinHandle<()>,
}

struct Inner {
    settings: Settings,
    running: Option<Running>,
    error: Option<String>,
    /// Becomes true once the interface is listening, so no call gets lost at startup.
    attached: bool,
}

pub struct AgentServer {
    hub: Arc<Hub>,
    settings_path: PathBuf,
    inner: Mutex<Inner>,
}

impl AgentServer {
    pub fn new(app: AppHandle, settings_path: PathBuf) -> Result<Self, String> {
        let settings = load_settings(&settings_path)?;
        Ok(Self {
            hub: Arc::new(Hub {
                app,
                next_call: AtomicU64::new(1),
                pending: Mutex::new(HashMap::new()),
                accepting: AtomicBool::new(false),
                key: Mutex::new(settings.key.clone()),
            }),
            settings_path,
            inner: Mutex::new(Inner {
                settings,
                running: None,
                error: None,
                attached: false,
            }),
        })
    }

    fn status_of(inner: &Inner) -> AgentStatus {
        AgentStatus {
            enabled: inner.settings.enabled,
            running: inner.running.is_some(),
            url: format!("http://127.0.0.1:{PORT}/mcp"),
            key: inner.settings.key.clone(),
            error: inner.error.clone(),
        }
    }

    fn stop(&self, inner: &mut Inner) {
        let Some(running) = inner.running.take() else {
            return;
        };
        running.server.unblock();
        self.hub.stop_accepting();
        let _ = running.thread.join();
    }

    /// Tries a few times, because the previous listener takes a moment to release the port.
    fn bind() -> Result<Server, String> {
        let mut attempts = 1;
        loop {
            match Server::http(("127.0.0.1", PORT)) {
                Ok(server) => return Ok(server),
                Err(_) if attempts < BIND_ATTEMPTS => {
                    attempts += 1;
                    std::thread::sleep(BIND_RETRY);
                }
                Err(error) => return Err(format!("não foi possível usar a porta {PORT}: {error}")),
            }
        }
    }

    fn start(&self, inner: &mut Inner) {
        inner.error = None;
        let server = match Self::bind() {
            Ok(server) => Arc::new(server),
            Err(error) => {
                inner.error = Some(error);
                return;
            }
        };
        self.hub.accepting.store(true, Ordering::SeqCst);

        let hub = Arc::clone(&self.hub);
        let listener = Arc::clone(&server);
        // One request at a time, so the changes an agent makes apply in the order it sent them.
        let thread = std::thread::spawn(move || {
            for request in listener.incoming_requests() {
                let key = hub.key.lock().expect("key lock").clone();
                handle_request(request, &key, hub.as_ref());
            }
        });
        inner.running = Some(Running { server, thread });
    }

    fn sync(&self, inner: &mut Inner) {
        self.stop(inner);
        if inner.attached && inner.settings.enabled {
            self.start(inner);
        } else {
            inner.error = None;
        }
    }

    /// Called when the interface starts listening. A page reload lands here too.
    pub fn attach(&self) -> AgentStatus {
        let mut inner = self.inner.lock().expect("agent lock");
        inner.attached = true;
        if inner.running.is_none() {
            self.sync(&mut inner);
        }
        Self::status_of(&inner)
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<AgentStatus, String> {
        let mut inner = self.inner.lock().expect("agent lock");
        inner.settings.enabled = enabled;
        save_settings(&self.settings_path, &inner.settings)?;
        self.sync(&mut inner);
        Ok(Self::status_of(&inner))
    }

    /// Anything configured with the old key stops working right away.
    pub fn replace_key(&self) -> Result<AgentStatus, String> {
        let mut inner = self.inner.lock().expect("agent lock");
        inner.settings.key = new_key()?;
        save_settings(&self.settings_path, &inner.settings)?;
        self.hub.key.lock().expect("key lock").clone_from(&inner.settings.key);
        Ok(Self::status_of(&inner))
    }

    pub fn reply(&self, id: u64, answer: Result<Value, String>) {
        if let Some(sender) = self.hub.pending.lock().expect("pending lock").remove(&id) {
            let _ = sender.send(answer);
        }
    }

    pub fn shutdown(&self) {
        let mut inner = self.inner.lock().expect("agent lock");
        self.stop(&mut inner);
    }
}

#[cfg(test)]
#[path = "tests/mcp.rs"]
mod tests;

//! MCP host: transports, session lifecycle and the Tauri command surface.
//!
//! The host keeps one long-lived session per server:
//!
//! - `stdio` spawns the configured command once, performs the protocol
//!   `initialize` handshake and multiplexes JSON-RPC requests over the same
//!   stdin/stdout pair. The child is killed when the server is disconnected,
//!   reconfigured, disabled, deleted or the application exits.
//! - `http` keeps the negotiated `Mcp-Session-Id` / `MCP-Protocol-Version` and
//!   re-initializes once when the server reports that the session expired.
//!
//! Everything the UI needs (tools, resources, prompts, audit, status) goes
//! through this module; React never talks to a server directly.

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

use crate::agent::mcp_security::{is_cloud_metadata_host, is_loopback_url};

/// Protocol revision announced during `initialize`. Servers may negotiate a
/// different revision; the value they return is stored per session and echoed
/// back through `MCP-Protocol-Version`.
const PROTOCOL_VERSION: &str = "2025-06-18";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const STDERR_TAIL_LINES: usize = 40;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone)]
struct ServerConfig {
    transport: String,
    url: Option<String>,
    command: Option<String>,
    args: Vec<String>,
    env: HashMap<String, String>,
    headers: HeaderMap,
}

impl ServerConfig {
    fn fingerprint(&self) -> String {
        let mut headers: Vec<(String, String)> = self
            .headers
            .iter()
            .filter_map(|(name, value)| {
                value
                    .to_str()
                    .ok()
                    .map(|value| (name.as_str().to_string(), value.to_string()))
            })
            .collect();
        headers.sort();
        let mut env: Vec<(String, String)> = self
            .env
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        env.sort();
        serde_json::to_string(&json!({
            "transport": self.transport,
            "url": self.url,
            "command": self.command,
            "args": self.args,
            "env": env,
            "headers": headers,
        }))
        .unwrap_or_default()
    }
}

fn load_server(app: &tauri::AppHandle, id: &str) -> Result<ServerConfig, String> {
    let db = crate::local_store::connection(app)?;
    let (transport, command, url, raw_args, raw_env, raw_headers, enabled): (
        String,
        Option<String>,
        Option<String>,
        String,
        String,
        String,
        i64,
    ) = db
        .query_row(
            "SELECT transport,command,url,args_json,env_json,headers_json,enabled FROM mcp_servers WHERE id=?",
            params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .map_err(|_| "MCP server not found".to_string())?;
    if enabled == 0 {
        return Err("MCP server is disabled".into());
    }
    if !matches!(transport.as_str(), "stdio" | "http" | "sse") {
        return Err(format!("unsupported MCP transport '{transport}'"));
    }

    let mut headers = HeaderMap::new();
    let mut values: HashMap<String, String> =
        serde_json::from_str(&raw_headers).map_err(|e| e.to_string())?;
    let mut env: HashMap<String, String> =
        serde_json::from_str(&raw_env).map_err(|e| e.to_string())?;
    // Secrets live in the OS keyring; legacy rows may still carry them in
    // SQLite until the list command migrates them.
    if let Some((secret_env, secret_headers)) = crate::local_store::mcp_secrets(id) {
        env.extend(secret_env);
        values.extend(secret_headers);
    }
    for (name, value) in values {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host"
                | "content-length"
                | "mcp-protocol-version"
                | "mcp-method"
                | "mcp-name"
                | "mcp-session-id"
        ) {
            return Err(format!("reserved MCP header: {name}"));
        }
        headers.insert(
            HeaderName::from_str(&name).map_err(|e| e.to_string())?,
            HeaderValue::from_str(&value).map_err(|e| e.to_string())?,
        );
    }

    if transport != "stdio" {
        let url = url.as_deref().ok_or("MCP server URL is missing")?;
        validate_url_for_config(url)?;
    }

    Ok(ServerConfig {
        transport,
        url,
        command,
        args: serde_json::from_str(&raw_args).map_err(|e| e.to_string())?,
        env,
        headers,
    })
}

/// Validates a user-configured remote endpoint.
///
/// HTTPS is always allowed. Plain HTTP is only tolerated for loopback hosts so
/// local development servers keep working. Private / link-local / metadata
/// addresses are rejected even over HTTPS (cloud metadata is blocked first so
/// the error is precise).
fn validate_url_for_config(input: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(input).map_err(|e| format!("invalid MCP URL: {e}"))?;
    match parsed.scheme() {
        "https" => {}
        "http" if is_loopback_url(&parsed) => {}
        _ => return Err("remote MCP URLs must use HTTPS".into()),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "MCP URL has no host".to_string())?;
    if is_cloud_metadata_host(host) {
        return Err("MCP URL points at a cloud metadata endpoint".into());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !ip.is_loopback() && is_blocked_ip(ip) {
            return Err("MCP URL points at a private or local network address".into());
        }
    }
    Ok(parsed)
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4 == Ipv4Addr::new(169, 254, 169, 254)
        }
        IpAddr::V6(v6) => {
            v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6.is_loopback()
        }
    }
}

/// Rejects hostnames that resolve to a private address (DNS rebinding guard).
/// The check runs once when the HTTP session is created; literal IPs and
/// `localhost` are already handled by [`validate_url_for_config`].
fn ensure_public_resolution(parsed: &url::Url) -> Result<(), String> {
    let host = match parsed.host_str() {
        Some(host) if !host.eq_ignore_ascii_case("localhost") => host,
        _ => return Ok(()),
    };
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    let hostname = host.to_string();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let resolved = (hostname.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.map(|address| address.ip()).collect::<Vec<_>>())
            .map_err(|error| error.to_string());
        let _ = sender.send(resolved);
    });
    match receiver.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(addresses)) if !addresses.is_empty() => {
            if let Some(ip) = addresses
                .into_iter()
                .find(|ip| ip.is_loopback() || is_blocked_ip(*ip))
            {
                return Err(format!("MCP host resolves to a blocked address ({ip})"));
            }
            Ok(())
        }
        Ok(Ok(_)) => Err("MCP host did not resolve to any address".into()),
        Ok(Err(error)) => Err(format!("cannot resolve MCP host: {error}")),
        Err(_) => Err("MCP host resolution timed out".into()),
    }
}

fn parse_response(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    let value: Value = if trimmed.lines().any(|line| line.starts_with("data:")) {
        let normalized = trimmed.replace("\r\n", "\n");
        let mut found = None;
        for event in normalized.split("\n\n") {
            let payload = event
                .lines()
                .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                .collect::<Vec<_>>()
                .join("\n");
            if payload.trim().is_empty() || payload.trim() == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&payload) {
                if value.get("result").is_some() || value.get("error").is_some() {
                    found = Some(value);
                    break;
                }
            }
        }
        found.ok_or("empty MCP SSE response")?
    } else {
        serde_json::from_str(trimmed).map_err(|e| format!("invalid MCP response: {e}"))?
    };
    if let Some(error) = value.get("error") {
        return Err(format!("MCP error: {error}"));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "MCP response has no result".into())
}

fn initialize_params() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {
            "name": "Arcadia",
            "version": env!("CARGO_PKG_VERSION"),
        },
    })
}

// ---------------------------------------------------------------------------
// risk grading
// ---------------------------------------------------------------------------

/// R0 metadata, R1 read-only data, R2 write/exfiltration, R3 destructive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum McpRisk {
    R0,
    R1,
    R2,
    R3,
}

impl McpRisk {
    fn as_str(self) -> &'static str {
        match self {
            McpRisk::R0 => "R0",
            McpRisk::R1 => "R1",
            McpRisk::R2 => "R2",
            McpRisk::R3 => "R3",
        }
    }
}

const DESTRUCTIVE_VERBS: &[&str] = &[
    "delete", "remove", "drop", "destroy", "purge", "wipe", "uninstall", "terminate", "kill",
    "pay", "transfer", "execute", "exec", "shell", "command", "run",
];
const WRITE_VERBS: &[&str] = &[
    "create", "update", "write", "save", "edit", "publish", "post", "send", "upload", "insert",
    "append", "set", "put", "patch", "add", "commit", "push",
];
const READ_VERBS: &[&str] = &[
    "get", "list", "search", "read", "fetch", "query", "find", "lookup", "describe", "status",
    "info", "ping", "health", "version", "export", "download",
];
const METADATA_VERBS: &[&str] = &["ping", "list", "status", "info", "health", "version", "describe"];

/// Tool names and MCP annotations are the only inputs here; descriptions are
/// self-reported by the server and are deliberately ignored.
fn classify_tool(tool: &Value) -> McpRisk {
    let annotations = tool.get("annotations");
    let destructive = annotations
        .and_then(|value| value.get("destructiveHint"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let read_only = annotations
        .and_then(|value| value.get("readOnlyHint"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let name = tool
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let tokens: Vec<&str> = name
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect();
    let has = |verbs: &[&str]| {
        tokens
            .iter()
            .any(|token| verbs.iter().any(|verb| token.starts_with(verb)))
    };

    if destructive || has(DESTRUCTIVE_VERBS) {
        return McpRisk::R3;
    }
    if read_only {
        return if has(METADATA_VERBS) {
            McpRisk::R0
        } else {
            McpRisk::R1
        };
    }
    if has(WRITE_VERBS) {
        return McpRisk::R2;
    }
    if has(READ_VERBS) {
        return McpRisk::R1;
    }
    McpRisk::R2
}

fn schema_digest(tool: &Value) -> String {
    let raw = serde_json::to_string(tool.get("inputSchema").unwrap_or(&Value::Null)).unwrap_or_default();
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

fn value_digest(value: &Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_default();
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

// ---------------------------------------------------------------------------
// capability snapshots
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CapabilityEntry {
    name: String,
    digest: String,
}

/// Stored payload for one kind. Older builds stored a bare `Vec<CapabilityEntry>`;
/// the reader accepts both shapes.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CapabilitySnapshot {
    #[serde(default)]
    entries: Vec<CapabilityEntry>,
    #[serde(default)]
    items: Vec<Value>,
}

const CAPABILITY_ITEM_BYTES: usize = 200_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub changed: Vec<String>,
    pub first_seen: bool,
}

fn diff_capabilities(previous: &[CapabilityEntry], current: &[CapabilityEntry]) -> CapabilityDiff {
    use std::collections::BTreeMap;
    let previous: BTreeMap<&str, &str> = previous
        .iter()
        .map(|entry| (entry.name.as_str(), entry.digest.as_str()))
        .collect();
    let current_map: BTreeMap<&str, &str> = current
        .iter()
        .map(|entry| (entry.name.as_str(), entry.digest.as_str()))
        .collect();
    let mut added = Vec::new();
    let mut changed = Vec::new();
    for (name, digest) in &current_map {
        match previous.get(name) {
            None => added.push((*name).to_string()),
            Some(previous_digest) if previous_digest != digest => changed.push((*name).to_string()),
            _ => {}
        }
    }
    let mut removed: Vec<String> = previous
        .keys()
        .filter(|name| !current_map.contains_key(*name))
        .map(|name| (*name).to_string())
        .collect();
    added.sort();
    changed.sort();
    removed.sort();
    CapabilityDiff {
        added,
        removed,
        changed,
        first_seen: previous.is_empty(),
    }
}

fn capability_entries(value: &Value, key: &str) -> Vec<CapabilityEntry> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .enumerate()
                .map(|(index, item)| CapabilityEntry {
                    name: item
                        .get("uri")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("name").and_then(Value::as_str))
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("#{index}")),
                    digest: value_digest(item),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn capability_items(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn read_capability_snapshot(
    app: &tauri::AppHandle,
    server_id: &str,
    kind: &str,
) -> (CapabilitySnapshot, Option<String>) {
    let Ok(database) = crate::local_store::connection(app) else {
        return (CapabilitySnapshot::default(), None);
    };
    let row: Option<(String, String)> = database
        .query_row(
            "SELECT payload_json, captured_at FROM mcp_capability_snapshots WHERE server_id=?1 AND kind=?2",
            params![server_id, kind],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .ok()
        .flatten();
    let Some((raw, captured_at)) = row else {
        return (CapabilitySnapshot::default(), None);
    };
    if let Ok(entries) = serde_json::from_str::<Vec<CapabilityEntry>>(&raw) {
        return (
            CapabilitySnapshot {
                entries,
                items: Vec::new(),
            },
            Some(captured_at),
        );
    }
    (
        serde_json::from_str::<CapabilitySnapshot>(&raw).unwrap_or_default(),
        Some(captured_at),
    )
}

fn record_capability(
    app: &tauri::AppHandle,
    server_id: &str,
    kind: &str,
    current: &[CapabilityEntry],
    items: &[Value],
) -> CapabilityDiff {
    let (previous, _) = read_capability_snapshot(app, server_id, kind);
    let diff = diff_capabilities(&previous.entries, current);
    let mut items = items.to_vec();
    if serde_json::to_string(&items).map(|raw| raw.len()).unwrap_or(0) > CAPABILITY_ITEM_BYTES {
        items.clear();
    }
    if let Ok(database) = crate::local_store::connection(app) {
        let payload = serde_json::to_string(&CapabilitySnapshot {
            entries: current.to_vec(),
            items,
        })
        .unwrap_or_else(|_| "{\"entries\":[],\"items\":[]}".into());
        let _ = database.execute(
            "INSERT INTO mcp_capability_snapshots(server_id,kind,payload_json,captured_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(server_id,kind) DO UPDATE SET payload_json=excluded.payload_json, captured_at=excluded.captured_at",
            params![server_id, kind, payload, chrono::Utc::now().to_rfc3339()],
        );
    }
    diff
}

fn attach_capability_diff(value: &mut Value, diff: &CapabilityDiff) {
    if let Some(object) = value.as_object_mut() {
        if let Ok(payload) = serde_json::to_value(diff) {
            object.insert("arcadiaCapabilityDiff".into(), payload);
        }
    }
}

#[derive(Clone)]
struct CachedTool {
    name: String,
    risk: McpRisk,
    digest: String,
    granted: bool,
}

/// Injects the local risk grade (and whether a standing grant exists) into the
/// raw `tools/list` payload consumed by the UI.
fn enrich_tools(app: &tauri::AppHandle, server_id: &str, value: &mut Value) -> Vec<CachedTool> {
    let grants = crate::local_store::mcp_grants_for(app, server_id);
    let Some(tools) = value.get_mut("tools").and_then(Value::as_array_mut) else {
        return Vec::new();
    };
    let mut cached = Vec::new();
    for tool in tools.iter_mut() {
        let name = tool
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let risk = classify_tool(tool);
        let digest = schema_digest(tool);
        let granted = grants
            .iter()
            .any(|grant| grant.tool_name == name && grant.schema_digest == digest);
        if let Some(object) = tool.as_object_mut() {
            object.insert("arcadiaRisk".into(), json!(risk.as_str()));
            object.insert("arcadiaGranted".into(), json!(granted));
        }
        cached.push(CachedTool {
            name,
            risk,
            digest,
            granted,
        });
    }
    cached
}

// ---------------------------------------------------------------------------
// stdio transport
// ---------------------------------------------------------------------------

struct StdioTransport {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>,
    closed: AtomicBool,
    stderr_tail: Mutex<VecDeque<String>>,
}

/// Windows cannot execute `.cmd`/`.bat` shims through `CreateProcess`, so a
/// bare `npx` (which resolves to `npx.cmd`) needs to go through `cmd.exe`.
#[cfg(windows)]
fn windows_shell_target(executable: &str) -> Option<String> {
    let lower = executable.to_ascii_lowercase();
    if lower.ends_with(".cmd") || lower.ends_with(".bat") {
        return Some(executable.to_string());
    }
    if lower.ends_with(".exe")
        || executable.contains('\\')
        || executable.contains('/')
    {
        return None;
    }
    let path = std::env::var_os("PATH")?;
    let extensions = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    for directory in std::env::split_paths(&path) {
        for extension in extensions.split(';') {
            if !(extension.eq_ignore_ascii_case(".CMD") || extension.eq_ignore_ascii_case(".BAT")) {
                continue;
            }
            let candidate = directory.join(format!("{executable}{extension}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

impl StdioTransport {
    fn spawn(config: &ServerConfig) -> Result<Arc<Self>, String> {
        let executable = config
            .command
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or("MCP stdio command is missing")?;
        #[allow(unused_mut)]
        let mut process = Command::new(executable);
        #[cfg(windows)]
        if let Some(target) = windows_shell_target(executable) {
            process = Command::new("cmd.exe");
            process.arg("/C").arg(target);
        }
        let mut child = process
            .args(&config.args)
            .envs(&config.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("MCP stdio launch failed: {error}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or("MCP stdio stdin unavailable")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("MCP stdio stdout unavailable")?;
        let stderr = child
            .stderr
            .take()
            .ok_or("MCP stdio stderr unavailable")?;

        let transport = Arc::new(Self {
            stdin: Mutex::new(Some(stdin)),
            child: Mutex::new(child),
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            stderr_tail: Mutex::new(VecDeque::new()),
        });

        let reader_transport = transport.clone();
        std::thread::spawn(move || reader_loop(reader_transport, stdout));

        let stderr_transport = transport.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines() {
                let Ok(line) = line else { break };
                let mut tail = lock(&stderr_transport.stderr_tail);
                if tail.len() == STDERR_TAIL_LINES {
                    tail.pop_front();
                }
                tail.push_back(line);
            }
        });

        Ok(transport)
    }

    fn stderr_summary(&self) -> String {
        let tail = lock(&self.stderr_tail);
        tail.iter()
            .filter(|line| !line.trim().is_empty())
            .rev()
            .take(3)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ")
    }

    fn write_message(&self, value: &Value) -> Result<(), String> {
        let mut guard = lock(&self.stdin);
        let stdin = guard
            .as_mut()
            .ok_or_else(|| "MCP stdio server is not running".to_string())?;
        let body = serde_json::to_string(value).map_err(|error| error.to_string())?;
        writeln!(stdin, "{body}").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(self.closed_error());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        lock(&self.pending).insert(id.clone(), sender);
        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = self.write_message(&message) {
            lock(&self.pending).remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(self.closed_error()),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(format!("MCP stdio request timed out ({method})"))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(self.closed_error());
        }
        self.write_message(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
    }

    fn closed_error(&self) -> String {
        let stderr = self.stderr_summary();
        if stderr.is_empty() {
            "MCP stdio server closed without responding".into()
        } else {
            format!("MCP stdio server closed: {stderr}")
        }
    }

    fn kill(&self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Some(mut stdin) = lock(&self.stdin).take() {
            let _ = stdin.flush();
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let senders: Vec<_> = lock(&self.pending)
            .drain()
            .map(|(_, sender)| sender)
            .collect();
        for sender in senders {
            let _ = sender.send(Err("MCP stdio session closed".into()));
        }
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn reader_loop(transport: Arc<StdioTransport>, stdout: ChildStdout) {
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            // Notifications (logging, progress, resource updates) carry no id.
            continue;
        };
        let sender = lock(&transport.pending).remove(id);
        if let Some(sender) = sender {
            let result = if let Some(error) = value.get("error") {
                Err(format!("MCP error: {error}"))
            } else {
                value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| "MCP response has no result".to_string())
            };
            let _ = sender.send(result);
        }
    }
    transport.closed.store(true, Ordering::SeqCst);
    let senders: Vec<_> = lock(&transport.pending)
        .drain()
        .map(|(_, sender)| sender)
        .collect();
    for sender in senders {
        let _ = sender.send(Err(transport.closed_error()));
    }
}

// ---------------------------------------------------------------------------
// HTTP transport (Streamable HTTP, with SSE response support)
// ---------------------------------------------------------------------------

struct HttpTransport {
    client: reqwest::Client,
    url: String,
    headers: HeaderMap,
    session_id: Mutex<Option<String>>,
    protocol_version: Mutex<Option<String>>,
}

impl HttpTransport {
    fn new(config: &ServerConfig, parsed: url::Url) -> Result<Self, String> {
        ensure_public_resolution(&parsed)?;
        let allow_loopback = is_loopback_url(&parsed);
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("too many MCP redirects");
                }
                let next = attempt.url();
                if is_loopback_url(next) && !allow_loopback {
                    return attempt.error("MCP redirect to a local address is blocked");
                }
                match validate_url_for_config(next.as_str()) {
                    Ok(_) => attempt.follow(),
                    Err(_) => attempt.error("MCP redirect points at a blocked URL"),
                }
            }))
            .build()
            .map_err(|error| format!("cannot create MCP client: {error}"))?;
        Ok(Self {
            client,
            url: parsed.to_string(),
            headers: config.headers.clone(),
            session_id: Mutex::new(None),
            protocol_version: Mutex::new(None),
        })
    }

    fn clear_negotiation(&self) {
        *lock(&self.session_id) = None;
        *lock(&self.protocol_version) = None;
    }

    async fn send(
        &self,
        body: &Value,
        name: Option<&str>,
    ) -> Result<(Value, HeaderMap), String> {
        let mut request = self
            .client
            .post(&self.url)
            .headers(self.headers.clone())
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json, text/event-stream");
        if let Some(version) = lock(&self.protocol_version).clone() {
            request = request.header("MCP-Protocol-Version", version);
        }
        if let Some(session) = lock(&self.session_id).clone() {
            request = request.header("Mcp-Session-Id", session);
        }
        if let Some(name) = name {
            request = request.header("Mcp-Name", name);
        }
        let response = request
            .json(body)
            .send()
            .await
            .map_err(|error| format!("MCP connection failed: {error}"))?;
        let status = response.status();
        let headers = response.headers().clone();
        let text = read_body(response).await?;
        if matches!(status.as_u16(), 202 | 204) || text.trim().is_empty() {
            return Ok((Value::Null, headers));
        }
        if !status.is_success() {
            return Err(format!(
                "MCP HTTP {}: {}",
                status.as_u16(),
                text.chars().take(400).collect::<String>()
            ));
        }
        Ok((parse_response(&text)?, headers))
    }

    async fn initialize(&self) -> Result<Value, String> {
        self.clear_negotiation();
        let id = uuid::Uuid::new_v4().to_string();
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "initialize",
            "params": initialize_params(),
        });
        let (value, headers) = self.send(&body, None).await?;
        if let Some(session) = headers
            .get("mcp-session-id")
            .and_then(|value| value.to_str().ok())
        {
            *lock(&self.session_id) = Some(session.to_string());
        }
        if let Some(version) = value
            .get("protocolVersion")
            .and_then(Value::as_str)
            .filter(|version| !version.trim().is_empty())
        {
            *lock(&self.protocol_version) = Some(version.to_string());
        }
        Ok(value)
    }

    async fn request(&self, method: &str, params: Value, name: Option<&str>) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let (value, _) = self.send(&body, name).await?;
        Ok(value)
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let body = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.send(&body, None).await?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SSE transport (legacy HTTP+SSE: GET stream, POST messages to the announced
// endpoint, responses arrive as `message` events)
// ---------------------------------------------------------------------------

struct SseTransport {
    client: reqwest::Client,
    stream_url: String,
    headers: HeaderMap,
    endpoint: Mutex<Option<String>>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>,
    closed: AtomicBool,
    error: Mutex<Option<String>>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl SseTransport {
    fn connect(config: &ServerConfig, parsed: url::Url) -> Result<Arc<Self>, String> {
        ensure_public_resolution(&parsed)?;
        let allow_loopback = is_loopback_url(&parsed);
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 5 {
                    return attempt.error("too many MCP redirects");
                }
                let next = attempt.url();
                if is_loopback_url(next) && !allow_loopback {
                    return attempt.error("MCP redirect to a local address is blocked");
                }
                match validate_url_for_config(next.as_str()) {
                    Ok(_) => attempt.follow(),
                    Err(_) => attempt.error("MCP redirect points at a blocked URL"),
                }
            }))
            .build()
            .map_err(|error| format!("cannot create MCP SSE client: {error}"))?;
        let transport = Arc::new(Self {
            client,
            stream_url: parsed.to_string(),
            headers: config.headers.clone(),
            endpoint: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            closed: AtomicBool::new(false),
            error: Mutex::new(None),
            task: Mutex::new(None),
        });
        let weak = Arc::downgrade(&transport);
        let handle = tokio::spawn(async move {
            if let Some(transport) = weak.upgrade() {
                transport.read_stream().await;
            }
        });
        *lock(&transport.task) = Some(handle);
        Ok(transport)
    }

    fn closed_error(&self) -> String {
        lock(&self.error)
            .clone()
            .unwrap_or_else(|| "MCP SSE stream closed".to_string())
    }

    async fn read_stream(&self) {
        if let Err(error) = self.stream_loop().await {
            *lock(&self.error) = Some(error);
        }
        self.closed.store(true, Ordering::SeqCst);
        let senders: Vec<_> = lock(&self.pending)
            .drain()
            .map(|(_, sender)| sender)
            .collect();
        let error = self.closed_error();
        for sender in senders {
            let _ = sender.send(Err(error.clone()));
        }
    }

    async fn stream_loop(&self) -> Result<(), String> {
        let response = self
            .client
            .get(&self.stream_url)
            .headers(self.headers.clone())
            .header(ACCEPT, "text/event-stream")
            .send()
            .await
            .map_err(|error| format!("MCP SSE connection failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("MCP SSE HTTP {}", response.status().as_u16()));
        }
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("MCP SSE stream error: {error}"))?;
            let text = String::from_utf8_lossy(&chunk).replace("\r\n", "\n");
            buffer.push_str(&text);
            for (event, data) in drain_sse_events(&mut buffer) {
                self.handle_event(&event, &data)?;
            }
        }
        Err("MCP SSE stream ended".into())
    }

    fn handle_event(&self, event: &str, data: &str) -> Result<(), String> {
        match event {
            "endpoint" => {
                let endpoint = resolve_sse_endpoint(&self.stream_url, data)?;
                *lock(&self.endpoint) = Some(endpoint);
            }
            "message" => {
                if let Ok(value) = serde_json::from_str::<Value>(data) {
                    route_jsonrpc_message(&self.pending, value);
                }
            }
            _ => {}
        }
        Ok(())
    }

    async fn wait_endpoint(&self) -> Result<String, String> {
        for _ in 0..200 {
            if let Some(endpoint) = lock(&self.endpoint).clone() {
                return Ok(endpoint);
            }
            if self.closed.load(Ordering::SeqCst) {
                return Err(self.closed_error());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err("MCP SSE endpoint was not announced".into())
    }

    async fn post(&self, body: &Value) -> Result<(), String> {
        let endpoint = self.wait_endpoint().await?;
        let response = self
            .client
            .post(endpoint)
            .headers(self.headers.clone())
            .header(CONTENT_TYPE, "application/json")
            .timeout(REQUEST_TIMEOUT)
            .json(body)
            .send()
            .await
            .map_err(|error| format!("MCP SSE POST failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("MCP SSE POST HTTP {}", response.status().as_u16()));
        }
        Ok(())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err(self.closed_error());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        lock(&self.pending).insert(id.clone(), sender);
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(error) = self.post(&body).await {
            lock(&self.pending).remove(&id);
            return Err(error);
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(self.closed_error()),
            Err(_) => {
                lock(&self.pending).remove(&id);
                Err(format!("MCP SSE request timed out ({method})"))
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.post(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await
    }

    fn kill(&self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Some(handle) = lock(&self.task).take() {
            handle.abort();
        }
        let senders: Vec<_> = lock(&self.pending)
            .drain()
            .map(|(_, sender)| sender)
            .collect();
        for sender in senders {
            let _ = sender.send(Err("MCP SSE session closed".into()));
        }
    }
}

impl Drop for SseTransport {
    fn drop(&mut self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Some(handle) = self.task.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            handle.abort();
        }
    }
}

/// Extracts complete SSE frames from a growing buffer. `\r\n` is normalised by
/// the stream loop before calling this.
fn drain_sse_events(buffer: &mut String) -> Vec<(String, String)> {
    let mut events = Vec::new();
    while let Some(index) = buffer.find("\n\n") {
        let frame: String = buffer.drain(..index + 2).collect();
        let mut event = "message".to_string();
        let mut data = Vec::new();
        for line in frame.lines() {
            if let Some(value) = line.strip_prefix("event:") {
                event = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push(value.trim_start().to_string());
            }
        }
        if !data.is_empty() {
            events.push((event, data.join("\n")));
        }
    }
    events
}

fn resolve_sse_endpoint(base: &str, raw: &str) -> Result<String, String> {
    let base = url::Url::parse(base).map_err(|error| format!("invalid MCP SSE URL: {error}"))?;
    let endpoint = base
        .join(raw.trim())
        .map_err(|error| format!("invalid MCP SSE endpoint: {error}"))?;
    validate_url_for_config(endpoint.as_str())?;
    let same_origin = endpoint.scheme() == base.scheme()
        && endpoint.host_str() == base.host_str()
        && endpoint.port_or_known_default() == base.port_or_known_default();
    if !same_origin {
        return Err("MCP SSE endpoint must stay on the same origin".into());
    }
    Ok(endpoint.to_string())
}

fn route_jsonrpc_message(
    pending: &Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>,
    value: Value,
) {
    let Some(id) = value.get("id").and_then(Value::as_str) else {
        return;
    };
    let sender = lock(pending).remove(id);
    if let Some(sender) = sender {
        let result = parse_response_value(value);
        let _ = sender.send(result);
    }
}

fn parse_response_value(value: Value) -> Result<Value, String> {
    if let Some(error) = value.get("error") {
        return Err(format!("MCP error: {error}"));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "MCP response has no result".into())
}

async fn read_body(response: reqwest::Response) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err("MCP response exceeds 8 MiB".into());
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| error.to_string())?;
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("MCP response exceeds 8 MiB".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "MCP response is not UTF-8".into())
}

// ---------------------------------------------------------------------------
// session
// ---------------------------------------------------------------------------

enum Transport {
    Stdio(Arc<StdioTransport>),
    Http(HttpTransport),
    Sse(Arc<SseTransport>),
}

struct Session {
    fingerprint: String,
    transport: Transport,
    initialized: tokio::sync::Mutex<Option<Value>>,
    tools: Mutex<Option<Vec<CachedTool>>>,
    runtime: Mutex<RuntimeState>,
}

#[derive(Default)]
struct RuntimeState {
    last_error: Option<String>,
    last_ok_at: Option<String>,
    failure_count: u32,
}

impl Session {
    fn new(config: ServerConfig, fingerprint: String) -> Result<Self, String> {
        let transport = if config.transport == "stdio" {
            Transport::Stdio(StdioTransport::spawn(&config)?)
        } else {
            let parsed = validate_url_for_config(config.url.as_deref().unwrap_or_default())?;
            if config.transport == "sse" {
                Transport::Sse(SseTransport::connect(&config, parsed)?)
            } else {
                Transport::Http(HttpTransport::new(&config, parsed)?)
            }
        };
        Ok(Self {
            fingerprint,
            transport,
            initialized: tokio::sync::Mutex::new(None),
            tools: Mutex::new(None),
            runtime: Mutex::new(RuntimeState::default()),
        })
    }

    fn store_tools(&self, tools: Vec<CachedTool>) {
        *lock(&self.tools) = Some(tools);
    }

    fn cached_tool(&self, name: &str) -> Option<CachedTool> {
        lock(&self.tools)
            .as_ref()
            .and_then(|tools| tools.iter().find(|tool| tool.name == name).cloned())
    }

    fn is_http(&self) -> bool {
        matches!(self.transport, Transport::Http(_))
    }

    /// A stdio session dies with its child; HTTP sessions are stateless, so the
    /// only way to know they are healthy is the next request (or `ping`).
    fn is_alive(&self) -> bool {
        match &self.transport {
            Transport::Stdio(transport) => !transport.closed.load(Ordering::SeqCst),
            Transport::Http(_) => true,
            Transport::Sse(transport) => !transport.closed.load(Ordering::SeqCst),
        }
    }

    fn record_ok(&self) {
        let mut state = lock(&self.runtime);
        state.last_error = None;
        state.failure_count = 0;
        state.last_ok_at = Some(chrono::Utc::now().to_rfc3339());
    }

    fn record_error(&self, error: &str) {
        // JSON-RPC business errors prove the session is alive; only transport
        // and handshake failures count towards the health state.
        if error.starts_with("MCP error:") || error.starts_with("MCP HTTP 4") {
            return;
        }
        let mut state = lock(&self.runtime);
        state.last_error = Some(error.to_string());
        state.failure_count = state.failure_count.saturating_add(1);
    }

    fn snapshot(&self, server_id: &str) -> McpServerStatus {
        let info = self.initialized.try_lock().ok().and_then(|value| value.clone());
        let runtime = lock(&self.runtime);
        McpServerStatus {
            server_id: server_id.to_string(),
            connected: info.is_some() && self.is_alive(),
            protocol_version: self.protocol_version(),
            server_info: info
                .as_ref()
                .and_then(|value| value.get("serverInfo"))
                .cloned(),
            last_error: runtime.last_error.clone(),
            last_ok_at: runtime.last_ok_at.clone(),
            failure_count: runtime.failure_count,
        }
    }

    async fn initialize(&self) -> Result<Value, String> {
        match &self.transport {
            Transport::Stdio(transport) => {
                transport.request("initialize", initialize_params()).await
            }
            Transport::Http(transport) => transport.initialize().await,
            Transport::Sse(transport) => transport.request("initialize", initialize_params()).await,
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        match &self.transport {
            Transport::Stdio(transport) => transport.notify(method, params),
            Transport::Http(transport) => transport.notify(method, params).await,
            Transport::Sse(transport) => transport.notify(method, params).await,
        }
    }

    async fn ensure_ready(&self) -> Result<Value, String> {
        if !self.is_alive() {
            let error = match &self.transport {
                Transport::Stdio(transport) => transport.closed_error(),
                Transport::Http(_) => "MCP session is not running".into(),
                Transport::Sse(transport) => transport.closed_error(),
            };
            self.record_error(&error);
            return Err(error);
        }
        let mut initialized = self.initialized.lock().await;
        if let Some(info) = initialized.as_ref() {
            return Ok(info.clone());
        }
        let info = self.initialize().await.map_err(|error| {
            let message = format!("MCP initialize failed: {error}");
            self.record_error(&message);
            message
        })?;
        self.notify("notifications/initialized", json!({}))
            .await
            .map_err(|error| {
                let message = format!("MCP initialize handshake failed: {error}");
                self.record_error(&message);
                message
            })?;
        *initialized = Some(info.clone());
        self.record_ok();
        Ok(info)
    }

    async fn call(
        &self,
        method: &str,
        params: Value,
        name: Option<&str>,
    ) -> Result<Value, String> {
        self.ensure_ready().await?;
        let first = self.dispatch(method, params.clone(), name).await;
        if let Err(error) = &first {
            if self.is_http() && error.starts_with("MCP HTTP 404") {
                // Streamable HTTP servers drop the session when they restart;
                // re-initialize once and replay the request.
                *self.initialized.lock().await = None;
                if let Transport::Http(transport) = &self.transport {
                    transport.clear_negotiation();
                }
                self.ensure_ready().await?;
                let retried = self.dispatch(method, params, name).await;
                match &retried {
                    Ok(_) => self.record_ok(),
                    Err(error) => self.record_error(error),
                }
                return retried;
            }
            self.record_error(error);
        } else {
            self.record_ok();
        }
        first
    }

    async fn dispatch(
        &self,
        method: &str,
        params: Value,
        name: Option<&str>,
    ) -> Result<Value, String> {
        match &self.transport {
            Transport::Stdio(transport) => transport.request(method, params).await,
            Transport::Http(transport) => transport.request(method, params, name).await,
            Transport::Sse(transport) => transport.request(method, params).await,
        }
    }

    async fn info(&self) -> Option<Value> {
        self.initialized.lock().await.clone()
    }

    async fn ping(&self, timeout: Duration) -> Result<u64, String> {
        self.ensure_ready().await?;
        let started = Instant::now();
        match tokio::time::timeout(timeout, self.dispatch("ping", json!({}), None)).await {
            Ok(Ok(_)) => {
                self.record_ok();
                Ok(started.elapsed().as_millis() as u64)
            }
            Ok(Err(error)) => {
                self.record_error(&error);
                Err(error)
            }
            Err(_) => {
                let error = format!("MCP ping timed out after {} ms", timeout.as_millis());
                self.record_error(&error);
                Err(error)
            }
        }
    }

    fn shutdown(&self) {
        match &self.transport {
            Transport::Stdio(transport) => transport.kill(),
            Transport::Sse(transport) => transport.kill(),
            Transport::Http(_) => {}
        }
    }

    fn protocol_version(&self) -> Option<String> {
        match &self.transport {
            Transport::Http(transport) => lock(&transport.protocol_version).clone(),
            Transport::Stdio(_) | Transport::Sse(_) => self
                .initialized
                .try_lock()
                .ok()
                .and_then(|info| {
                    info.as_ref()
                        .and_then(|value| value.get("protocolVersion"))
                        .and_then(Value::as_str)
                        .map(str::to_string)
                }),
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Default)]
pub struct McpHost {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    recovery: Mutex<HashMap<String, RecoveryState>>,
}

struct RecoveryState {
    attempts: u32,
    next_attempt: Instant,
}

fn recovery_delay_secs(attempts: u32) -> u64 {
    let exponent = attempts.saturating_sub(1).min(6);
    (5u64 << exponent).min(300)
}

impl McpHost {
    fn get(&self, app: &tauri::AppHandle, server_id: &str) -> Result<Arc<Session>, String> {
        let config = load_server(app, server_id)?;
        let fingerprint = config.fingerprint();
        let mut sessions = lock(&self.sessions);
        if let Some(existing) = sessions.get(server_id) {
            if existing.fingerprint == fingerprint {
                return Ok(existing.clone());
            }
            existing.shutdown();
            sessions.remove(server_id);
        }
        let session = Arc::new(Session::new(config, fingerprint)?);
        sessions.insert(server_id.to_string(), session.clone());
        Ok(session)
    }

    async fn ready(&self, app: &tauri::AppHandle, server_id: &str) -> Result<Arc<Session>, String> {
        let mut last_error = String::new();
        for attempt in 0..3u32 {
            let session = match self.get_or_reconnect(app, server_id) {
                Ok(session) => session,
                Err(error) => {
                    last_error = error;
                    if !is_transient_failure(&last_error) || attempt == 2 {
                        self.publish_error(app, server_id, &last_error);
                        return Err(last_error);
                    }
                    tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
                    continue;
                }
            };
            match session.ensure_ready().await {
                Ok(_) => {
                    self.publish(app, server_id, &session);
                    return Ok(session);
                }
                Err(error) => {
                    last_error = error;
                    self.remove(server_id);
                    if !is_transient_failure(&last_error) || attempt == 2 {
                        self.publish_error(app, server_id, &last_error);
                        return Err(last_error);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))).await;
        }
        self.publish_error(app, server_id, &last_error);
        Err(last_error)
    }

    fn get_or_reconnect(
        &self,
        app: &tauri::AppHandle,
        server_id: &str,
    ) -> Result<Arc<Session>, String> {
        let session = self.get(app, server_id)?;
        if session.is_alive() {
            return Ok(session);
        }
        // The child exited behind our back: drop the stale session and spawn a
        // fresh one before the next request.
        self.remove(server_id);
        self.get(app, server_id)
    }

    fn publish(&self, app: &tauri::AppHandle, server_id: &str, session: &Session) {
        let _ = app.emit("mcp://status", session.snapshot(server_id));
    }

    fn publish_error(&self, app: &tauri::AppHandle, server_id: &str, error: &str) {
        let _ = app.emit(
            "mcp://status",
            McpServerStatus::disconnected(server_id).with_error(error),
        );
    }

    fn remove(&self, server_id: &str) {
        lock(&self.recovery).remove(server_id);
        let session = lock(&self.sessions).remove(server_id);
        if let Some(session) = session {
            session.shutdown();
        }
    }

    fn status(&self, server_id: &str) -> McpServerStatus {
        match lock(&self.sessions).get(server_id).cloned() {
            Some(session) => session.snapshot(server_id),
            None => McpServerStatus::disconnected(server_id),
        }
    }

    async fn tool_meta(
        &self,
        app: &tauri::AppHandle,
        session: &Session,
        server_id: &str,
        tool_name: &str,
    ) -> Result<CachedTool, String> {
        if let Some(tool) = session.cached_tool(tool_name) {
            return Ok(tool);
        }
        // The workbench normally lists tools first; a direct Agent call may
        // arrive without a cache, so fetch and grade them once.
        let mut value = session.call("tools/list", json!({}), None).await?;
        let cached = enrich_tools(app, server_id, &mut value);
        session.store_tools(cached);
        session.cached_tool(tool_name).ok_or_else(|| {
            format!("MCP tool '{tool_name}' is not exposed by this server")
        })
    }

    /// Kills every stdio child. Called from the app exit hook so `npx` and
    /// similar wrappers never outlive the browser.
    pub fn shutdown_all(&self) {
        let mut sessions = lock(&self.sessions);
        for (_, session) in sessions.drain() {
            session.shutdown();
        }
    }

    async fn liveness_once(&self, app: &tauri::AppHandle) {
        let sessions: Vec<(String, Arc<Session>)> = {
            let sessions = lock(&self.sessions);
            sessions
                .iter()
                .map(|(id, session)| (id.clone(), session.clone()))
                .collect()
        };
        for (server_id, session) in sessions {
            if session.is_alive() || !self.contains(&server_id) {
                continue;
            }
            let now = Instant::now();
            {
                let recovery = lock(&self.recovery);
                if recovery
                    .get(&server_id)
                    .is_some_and(|state| state.next_attempt > now)
                {
                    continue;
                }
            }
            match self.ready(app, &server_id).await {
                Ok(_) => {
                    lock(&self.recovery).remove(&server_id);
                }
                Err(error) => {
                    let mut recovery = lock(&self.recovery);
                    let attempts = recovery
                        .get(&server_id)
                        .map(|state| state.attempts)
                        .unwrap_or(0)
                        .saturating_add(1);
                    let delay = recovery_delay_secs(attempts);
                    recovery.insert(
                        server_id.clone(),
                        RecoveryState {
                            attempts,
                            next_attempt: Instant::now() + Duration::from_secs(delay),
                        },
                    );
                    drop(recovery);
                    if self.contains(&server_id) {
                        self.publish_error(app, &server_id, &error);
                    }
                }
            }
        }
    }

    async fn ping_once(&self, app: &tauri::AppHandle) {
        let sessions: Vec<(String, Arc<Session>)> = {
            let sessions = lock(&self.sessions);
            sessions
                .iter()
                .filter(|(_, session)| session.is_alive())
                .map(|(id, session)| (id.clone(), session.clone()))
                .collect()
        };
        for (server_id, session) in sessions {
            match session.ping(Duration::from_secs(8)).await {
                Ok(_) => {
                    if self.contains(&server_id) {
                        self.publish(app, &server_id, &session);
                    }
                }
                Err(error) => {
                    if !self.contains(&server_id) {
                        continue;
                    }
                    self.publish_error(app, &server_id, &error);
                    if !session.is_alive() {
                        self.remove(&server_id);
                    }
                }
            }
        }
    }

    fn contains(&self, server_id: &str) -> bool {
        lock(&self.sessions).contains_key(server_id)
    }
}

/// Fast liveness checks rebuild dead sessions within seconds; the slower ping
/// loop only probes healthy sessions so idle servers are not spammed.
pub fn start_health_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut liveness = tokio::time::interval(Duration::from_secs(5));
        liveness.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut ping = tokio::time::interval(Duration::from_secs(60));
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        liveness.tick().await;
        ping.tick().await;
        loop {
            tokio::select! {
                _ = liveness.tick() => {
                    if let Some(host) = app.try_state::<McpHost>() {
                        host.liveness_once(&app).await;
                    }
                }
                _ = ping.tick() => {
                    if let Some(host) = app.try_state::<McpHost>() {
                        host.ping_once(&app).await;
                    }
                }
            }
        }
    });
}

fn audit(
    app: &tauri::AppHandle,
    server_id: &str,
    method: &str,
    name: Option<&str>,
    approved: bool,
    risk: Option<&str>,
    result: &Result<Value, String>,
) {
    if let Ok(db) = crate::local_store::connection(app) {
        let _ = db.execute(
            "INSERT INTO mcp_audit_log(id,server_id,method,target_name,approved,success,error,created_at,risk) VALUES(?,?,?,?,?,?,?,?,?)",
            params![
                uuid::Uuid::new_v4().to_string(),
                server_id,
                method,
                name,
                approved as i64,
                result.is_ok() as i64,
                result.as_ref().err(),
                chrono::Utc::now().to_rfc3339(),
                risk
            ],
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpAuditEntry {
    pub id: String,
    pub server_id: String,
    pub method: String,
    pub target_name: Option<String>,
    pub approved: bool,
    pub success: bool,
    pub error: Option<String>,
    pub risk: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerStatus {
    pub server_id: String,
    pub connected: bool,
    pub protocol_version: Option<String>,
    pub server_info: Option<Value>,
    pub last_error: Option<String>,
    pub last_ok_at: Option<String>,
    pub failure_count: u32,
}

impl McpServerStatus {
    fn disconnected(server_id: &str) -> Self {
        Self {
            server_id: server_id.to_string(),
            connected: false,
            protocol_version: None,
            server_info: None,
            last_error: None,
            last_ok_at: None,
            failure_count: 0,
        }
    }

    fn with_error(mut self, error: &str) -> Self {
        self.last_error = Some(error.to_string());
        self.failure_count = 1;
        self
    }
}

/// Transport-level failures are worth retrying; configuration errors are not.
fn is_transient_failure(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    [
        "closed",
        "timed out",
        "timeout",
        "connection",
        "not running",
        "broken pipe",
        "os error",
        "refused",
        "dns",
        "failed to launch",
    ]
    .iter()
    .any(|needle| error.contains(needle))
}

// ---------------------------------------------------------------------------
// configuration import / export
// ---------------------------------------------------------------------------

fn config_version() -> u32 {
    1
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigEntry {
    pub name: String,
    pub transport: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub env_keys: Vec<String>,
    #[serde(default)]
    pub header_keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigExport {
    #[serde(default = "config_version")]
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub servers: Vec<McpConfigEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigChange {
    pub name: String,
    pub action: String,
    pub changed_fields: Vec<String>,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigPreview {
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub servers: Vec<McpConfigChange>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpMissingSecrets {
    pub name: String,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigImportSummary {
    pub created: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub missing_secrets: Vec<McpMissingSecrets>,
}

struct ExistingServerConfig {
    id: String,
    transport: String,
    command: Option<String>,
    url: Option<String>,
    args: Vec<String>,
    enabled: bool,
}

fn existing_server(
    database: &rusqlite::Connection,
    name: &str,
) -> Result<Option<ExistingServerConfig>, String> {
    database
        .query_row(
            "SELECT id,transport,command,url,args_json,enabled FROM mcp_servers WHERE name=?1",
            params![name],
            |row| {
                let args_json: String = row.get(4)?;
                Ok(ExistingServerConfig {
                    id: row.get(0)?,
                    transport: row.get(1)?,
                    command: row.get(2)?,
                    url: row.get(3)?,
                    args: serde_json::from_str(&args_json).unwrap_or_default(),
                    enabled: row.get::<_, i64>(5)? != 0,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn changed_fields(entry: &McpConfigEntry, existing: &ExistingServerConfig) -> Vec<String> {
    let mut changed = Vec::new();
    if entry.transport != existing.transport {
        changed.push("transport".to_string());
    }
    if entry.command != existing.command {
        changed.push("command".to_string());
    }
    if entry.url != existing.url {
        changed.push("url".to_string());
    }
    if entry.args != existing.args {
        changed.push("args".to_string());
    }
    if entry.enabled != existing.enabled {
        changed.push("enabled".to_string());
    }
    changed
}

fn normalize_config(config: McpConfigExport) -> Result<Vec<McpConfigEntry>, String> {
    if config.version != config_version() {
        return Err(format!("unsupported MCP config version: {}", config.version));
    }
    if config.servers.is_empty() {
        return Err("MCP config contains no servers".into());
    }
    let mut names = HashSet::new();
    let mut entries = Vec::new();
    for mut entry in config.servers {
        entry.name = entry.name.trim().to_string();
        entry.transport = entry.transport.to_ascii_lowercase();
        entry.command = entry.command.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        entry.url = entry.url.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());
        entry.args = entry.args.into_iter().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()).collect();
        entry.env_keys.sort();
        entry.env_keys.dedup();
        entry.header_keys.sort();
        entry.header_keys.dedup();
        if entry.name.is_empty() {
            return Err("MCP config entry has an empty name".into());
        }
        if !names.insert(entry.name.clone()) {
            return Err(format!("duplicate MCP server name in config: {}", entry.name));
        }
        match entry.transport.as_str() {
            "stdio" => {
                if entry.command.as_deref().unwrap_or("").is_empty() {
                    return Err(format!("stdio server '{}' is missing a command", entry.name));
                }
                entry.url = None;
            }
            "http" | "sse" => {
                let url = entry.url.as_deref().unwrap_or("");
                if url.is_empty() {
                    return Err(format!("{} server '{}' is missing a URL", entry.transport, entry.name));
                }
                validate_url_for_config(url)?;
                entry.command = None;
            }
            other => return Err(format!("unsupported MCP transport: {other}")),
        }
        entries.push(entry);
    }
    Ok(entries)
}

fn preview_config(
    database: &rusqlite::Connection,
    entries: &[McpConfigEntry],
) -> Result<McpConfigPreview, String> {
    let mut preview = McpConfigPreview {
        created: 0,
        updated: 0,
        unchanged: 0,
        servers: Vec::new(),
    };
    for entry in entries {
        let existing = existing_server(database, &entry.name)?;
        let (action, changed) = match existing {
            None => {
                preview.created += 1;
                ("create", Vec::new())
            }
            Some(existing) => {
                let changed = changed_fields(entry, &existing);
                if changed.is_empty() {
                    preview.unchanged += 1;
                    ("unchanged", changed)
                } else {
                    preview.updated += 1;
                    ("update", changed)
                }
            }
        };
        preview.servers.push(McpConfigChange {
            name: entry.name.clone(),
            action: action.to_string(),
            changed_fields: changed,
            env_keys: entry.env_keys.clone(),
            header_keys: entry.header_keys.clone(),
        });
    }
    Ok(preview)
}

fn apply_config(
    database: &rusqlite::Connection,
    entries: &[McpConfigEntry],
) -> Result<McpConfigImportSummary, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut summary = McpConfigImportSummary {
        created: 0,
        updated: 0,
        unchanged: 0,
        missing_secrets: Vec::new(),
    };
    for entry in entries {
        let args_json = serde_json::to_string(&entry.args).map_err(|error| error.to_string())?;
        match existing_server(database, &entry.name)? {
            Some(existing) => {
                let changed = changed_fields(entry, &existing);
                if changed.is_empty() {
                    summary.unchanged += 1;
                } else {
                    // Secrets are intentionally untouched: the exported file
                    // only carries key names.
                    database
                        .execute(
                            "UPDATE mcp_servers SET transport=?1, command=?2, url=?3, args_json=?4, enabled=?5, updated_at=?6 WHERE id=?7",
                            params![
                                entry.transport,
                                entry.command,
                                entry.url,
                                args_json,
                                entry.enabled as i64,
                                now,
                                existing.id
                            ],
                        )
                        .map_err(|error| error.to_string())?;
                    summary.updated += 1;
                }
            }
            None => {
                let id = format!("mcp-{}", uuid::Uuid::new_v4());
                database
                    .execute(
                        "INSERT INTO mcp_servers(id,name,transport,command,url,args_json,env_json,headers_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        params![
                            id,
                            entry.name,
                            entry.transport,
                            entry.command,
                            entry.url,
                            args_json,
                            "{}",
                            "{}",
                            entry.enabled as i64,
                            now,
                            now
                        ],
                    )
                    .map_err(|error| error.to_string())?;
                summary.created += 1;
                if !entry.env_keys.is_empty() || !entry.header_keys.is_empty() {
                    summary.missing_secrets.push(McpMissingSecrets {
                        name: entry.name.clone(),
                        env_keys: entry.env_keys.clone(),
                        header_keys: entry.header_keys.clone(),
                    });
                }
            }
        }
    }
    Ok(summary)
}

fn read_config_entries(database: &rusqlite::Connection) -> Result<Vec<McpConfigEntry>, String> {
    let mut statement = database
        .prepare("SELECT id,name,transport,command,url,args_json,env_json,headers_json,enabled FROM mcp_servers ORDER BY name")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    for row in rows {
        let (id, name, transport, command, url, args_json, env_json, headers_json, enabled) =
            row.map_err(|error| error.to_string())?;
        let mut env_keys: BTreeSet<String> = serde_json::from_str::<HashMap<String, String>>(&env_json)
            .map(|values| values.into_keys().collect())
            .unwrap_or_default();
        let mut header_keys: BTreeSet<String> = serde_json::from_str::<HashMap<String, String>>(&headers_json)
            .map(|values| values.into_keys().collect())
            .unwrap_or_default();
        // Migrated rows keep the keys in the OS keyring, not in SQLite.
        if let Some((secret_env, secret_headers)) = crate::local_store::mcp_secrets(&id) {
            env_keys.extend(secret_env.into_keys());
            header_keys.extend(secret_headers.into_keys());
        }
        entries.push(McpConfigEntry {
            name,
            transport,
            command,
            url,
            args: serde_json::from_str(&args_json).unwrap_or_default(),
            enabled: enabled != 0,
            env_keys: env_keys.into_iter().collect(),
            header_keys: header_keys.into_iter().collect(),
        });
    }
    Ok(entries)
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiagnosticStage {
    pub name: String,
    pub ok: bool,
    pub duration_ms: u64,
    pub count: Option<usize>,
    pub detail: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiagnosticReport {
    pub server_id: String,
    pub ok: bool,
    pub protocol_version: Option<String>,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub total_ms: u64,
    pub stages: Vec<McpDiagnosticStage>,
}

async fn diagnose_session(session: &Session) -> Vec<McpDiagnosticStage> {
    const CHECKS: [(&str, &str, &str); 3] = [
        ("tools", "tools/list", "tools"),
        ("resources", "resources/list", "resources"),
        ("prompts", "prompts/list", "prompts"),
    ];
    let mut stages = Vec::new();
    for (name, method, key) in CHECKS {
        let started = Instant::now();
        let outcome = tokio::time::timeout(
            Duration::from_secs(15),
            session.call(method, json!({}), None),
        )
        .await;
        let duration_ms = started.elapsed().as_millis() as u64;
        match outcome {
            Ok(Ok(value)) => {
                let count = value
                    .get(key)
                    .and_then(Value::as_array)
                    .map(|items| items.len());
                stages.push(McpDiagnosticStage {
                    name: name.to_string(),
                    ok: true,
                    duration_ms,
                    count,
                    detail: None,
                    error: None,
                });
            }
            Ok(Err(error)) => stages.push(McpDiagnosticStage {
                name: name.to_string(),
                ok: false,
                duration_ms,
                count: None,
                detail: None,
                error: Some(error),
            }),
            Err(_) => stages.push(McpDiagnosticStage {
                name: name.to_string(),
                ok: false,
                duration_ms,
                count: None,
                detail: None,
                error: Some("diagnostic step timed out".into()),
            }),
        }
    }
    stages
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn mcp_export_config(app: tauri::AppHandle) -> Result<McpConfigExport, String> {
    let database = crate::local_store::connection(&app)?;
    let servers = read_config_entries(&database)?;
    Ok(McpConfigExport {
        version: config_version(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        servers,
    })
}

#[tauri::command]
pub fn mcp_preview_config(
    app: tauri::AppHandle,
    config: McpConfigExport,
) -> Result<McpConfigPreview, String> {
    let entries = normalize_config(config)?;
    let database = crate::local_store::connection(&app)?;
    preview_config(&database, &entries)
}

#[tauri::command]
pub fn mcp_import_config(
    app: tauri::AppHandle,
    config: McpConfigExport,
) -> Result<McpConfigImportSummary, String> {
    let entries = normalize_config(config)?;
    let database = crate::local_store::connection(&app)?;
    apply_config(&database, &entries)
}

#[tauri::command]
pub async fn mcp_diagnose(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<McpDiagnosticReport, String> {
    let host = app.state::<McpHost>();
    let started = Instant::now();
    let mut report = McpDiagnosticReport {
        server_id: server_id.clone(),
        ok: false,
        protocol_version: None,
        server_name: None,
        server_version: None,
        total_ms: 0,
        stages: Vec::new(),
    };
    let init_started = Instant::now();
    let session = match host.ready(&app, &server_id).await {
        Ok(session) => session,
        Err(error) => {
            report.stages.push(McpDiagnosticStage {
                name: "initialize".into(),
                ok: false,
                duration_ms: init_started.elapsed().as_millis() as u64,
                count: None,
                detail: None,
                error: Some(error),
            });
            report.total_ms = started.elapsed().as_millis() as u64;
            return Ok(report);
        }
    };
    if let Some(info) = session.info().await {
        report.protocol_version = info
            .get("protocolVersion")
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(server) = info.get("serverInfo") {
            report.server_name = server.get("name").and_then(Value::as_str).map(str::to_string);
            report.server_version = server
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
    }
    report.stages.push(McpDiagnosticStage {
        name: "initialize".into(),
        ok: true,
        duration_ms: init_started.elapsed().as_millis() as u64,
        count: None,
        detail: report
            .server_name
            .clone()
            .map(|name| match report.server_version.clone() {
                Some(version) => format!("{name} {version}"),
                None => name,
            }),
        error: None,
    });
    report.stages.extend(diagnose_session(&session).await);
    report.ok = report.stages.iter().all(|stage| stage.ok);
    report.total_ms = started.elapsed().as_millis() as u64;
    Ok(report)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCachedCapabilities {
    pub tools: Vec<Value>,
    pub resources: Vec<Value>,
    pub prompts: Vec<Value>,
    pub captured_at: Option<String>,
}

#[tauri::command]
pub fn mcp_cached_capabilities(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<McpCachedCapabilities, String> {
    let (tools, tools_at) = read_capability_snapshot(&app, &server_id, "tools");
    let (resources, resources_at) = read_capability_snapshot(&app, &server_id, "resources");
    let (prompts, prompts_at) = read_capability_snapshot(&app, &server_id, "prompts");
    let captured_at = [tools_at, resources_at, prompts_at]
        .into_iter()
        .flatten()
        .max();
    Ok(McpCachedCapabilities {
        tools: tools.items,
        resources: resources.items,
        prompts: prompts.items,
        captured_at,
    })
}

#[tauri::command]
pub async fn mcp_discover(app: tauri::AppHandle, server_id: String) -> Result<Value, String> {    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    session
        .info()
        .await
        .ok_or_else(|| "MCP session is not initialized".to_string())
}

#[tauri::command]
pub async fn mcp_list_tools(app: tauri::AppHandle, server_id: String) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    let mut value = session.call("tools/list", json!({}), None).await?;
    let entries = capability_entries(&value, "tools");
    let items = capability_items(&value, "tools");
    let diff = record_capability(&app, &server_id, "tools", &entries, &items);
    let cached = enrich_tools(&app, &server_id, &mut value);
    session.store_tools(cached);
    attach_capability_diff(&mut value, &diff);
    Ok(value)
}

#[tauri::command]
pub fn mcp_revoke_tool_grant(
    app: tauri::AppHandle,
    server_id: String,
    tool_name: String,
) -> Result<(), String> {
    crate::local_store::mcp_revoke_grant(&app, &server_id, &tool_name)
}

#[tauri::command]
pub async fn mcp_list_resources(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    let mut value = session.call("resources/list", json!({}), None).await?;
    let entries = capability_entries(&value, "resources");
    let items = capability_items(&value, "resources");
    let diff = record_capability(&app, &server_id, "resources", &entries, &items);
    attach_capability_diff(&mut value, &diff);
    Ok(value)
}

#[tauri::command]
pub async fn mcp_list_prompts(app: tauri::AppHandle, server_id: String) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    let mut value = session.call("prompts/list", json!({}), None).await?;
    let entries = capability_entries(&value, "prompts");
    let items = capability_items(&value, "prompts");
    let diff = record_capability(&app, &server_id, "prompts", &entries, &items);
    attach_capability_diff(&mut value, &diff);
    Ok(value)
}

#[tauri::command]
pub async fn mcp_read_resource(
    app: tauri::AppHandle,
    server_id: String,
    uri: String,
) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    session
        .call("resources/read", json!({ "uri": uri }), None)
        .await
}

#[tauri::command]
pub async fn mcp_get_prompt(
    app: tauri::AppHandle,
    server_id: String,
    name: String,
    arguments: Option<Value>,
) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    session
        .call(
            "prompts/get",
            json!({ "name": name, "arguments": arguments.unwrap_or_else(|| json!({})) }),
            Some(&name),
        )
        .await
}

#[tauri::command]
pub async fn mcp_call_tool(
    app: tauri::AppHandle,
    server_id: String,
    name: String,
    arguments: Value,
    approved: bool,
) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = match host.ready(&app, &server_id).await {
        Ok(session) => session,
        Err(error) => {
            audit(
                &app,
                &server_id,
                "tools/call",
                Some(&name),
                false,
                None,
                &Err(error.clone()),
            );
            return Err(error);
        }
    };
    let tool = match host
        .tool_meta(&app, &session, &server_id, &name)
        .await
    {
        Ok(tool) => tool,
        Err(error) => {
            audit(
                &app,
                &server_id,
                "tools/call",
                Some(&name),
                false,
                None,
                &Err(error.clone()),
            );
            return Err(error);
        }
    };
    let granted = tool.granted
        || crate::local_store::mcp_grant_valid(&app, &server_id, &name, &tool.digest);
    // R0 needs no approval; R3 can never rely on a standing grant.
    let allowed = tool.risk == McpRisk::R0
        || approved
        || (tool.risk != McpRisk::R3 && granted);
    if !allowed {
        let error = format!(
            "MCP tool '{}' requires explicit approval (risk {})",
            name,
            tool.risk.as_str()
        );
        audit(
            &app,
            &server_id,
            "tools/call",
            Some(&name),
            false,
            Some(tool.risk.as_str()),
            &Err(error.clone()),
        );
        return Err(error);
    }
    let result = session
        .call(
            "tools/call",
            json!({"name": name, "arguments": arguments}),
            Some(&name),
        )
        .await;
    if result.is_ok() && approved && tool.risk == McpRisk::R1 {
        // First approval for an R1 read is remembered; schema changes
        // invalidate it because the digest is part of the grant.
        let _ = crate::local_store::mcp_save_grant(
            &app,
            &server_id,
            &name,
            tool.risk.as_str(),
            &tool.digest,
        );
    }
    audit(
        &app,
        &server_id,
        "tools/call",
        Some(&name),
        approved || granted || tool.risk == McpRisk::R0,
        Some(tool.risk.as_str()),
        &result,
    );
    result
}

#[tauri::command]
pub fn mcp_disconnect(app: tauri::AppHandle, server_id: String) -> Result<(), String> {
    app.state::<McpHost>().remove(&server_id);
    let _ = app.emit(
        "mcp://status",
        McpServerStatus::disconnected(&server_id),
    );
    Ok(())
}

#[tauri::command]
pub async fn mcp_ping(app: tauri::AppHandle, server_id: String) -> Result<u64, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    match session.ping(Duration::from_secs(8)).await {
        Ok(latency) => {
            host.publish(&app, &server_id, &session);
            Ok(latency)
        }
        Err(error) => {
            host.publish(&app, &server_id, &session);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn mcp_server_status(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<McpServerStatus, String> {
    Ok(app.state::<McpHost>().status(&server_id))
}

#[tauri::command]
pub fn mcp_list_audit(
    app: tauri::AppHandle,
    server_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<McpAuditEntry>, String> {
    let db = crate::local_store::connection(&app)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let mut entries = Vec::new();
    if let Some(server_id) = server_id {
        let mut statement = db
            .prepare("SELECT id,server_id,method,target_name,approved,success,error,created_at,risk FROM mcp_audit_log WHERE server_id=?1 ORDER BY created_at DESC LIMIT ?2")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![server_id, limit], row_audit)
            .map_err(|error| error.to_string())?;
        for row in rows {
            entries.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        let mut statement = db
            .prepare("SELECT id,server_id,method,target_name,approved,success,error,created_at,risk FROM mcp_audit_log ORDER BY created_at DESC LIMIT ?1")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![limit], row_audit)
            .map_err(|error| error.to_string())?;
        for row in rows {
            entries.push(row.map_err(|error| error.to_string())?);
        }
    }
    Ok(entries)
}

fn row_audit(row: &rusqlite::Row<'_>) -> rusqlite::Result<McpAuditEntry> {
    Ok(McpAuditEntry {
        id: row.get(0)?,
        server_id: row.get(1)?,
        method: row.get(2)?,
        target_name: row.get(3)?,
        approved: row.get::<_, i64>(4)? != 0,
        success: row.get::<_, i64>(5)? != 0,
        error: row.get(6)?,
        created_at: row.get(7)?,
        risk: row.get(8)?,
    })
}

#[tauri::command]
pub fn mcp_clear_audit(app: tauri::AppHandle, server_id: Option<String>) -> Result<(), String> {
    let db = crate::local_store::connection(&app)?;
    match server_id {
        Some(server_id) => db
            .execute("DELETE FROM mcp_audit_log WHERE server_id=?1", params![server_id])
            .map(|_| ())
            .map_err(|error| error.to_string()),
        None => db
            .execute("DELETE FROM mcp_audit_log", params![])
            .map(|_| ())
            .map_err(|error| error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_sse() {
        assert_eq!(
            parse_response(r#"{"jsonrpc":"2.0","result":{"ok":true}}"#).unwrap()["ok"],
            true
        );
        assert_eq!(
            parse_response("event: message\ndata: {\"result\":{\"ok\":true}}\n").unwrap()["ok"],
            true
        );
        assert_eq!(
            parse_response("event: message\ndata: {\"result\":\ndata: {\"ok\":true}}\n\n").unwrap()
                ["ok"],
            true
        );
    }

    #[test]
    fn initialize_params_announces_client() {
        let params = initialize_params();
        assert_eq!(params["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(params["clientInfo"]["name"], "Arcadia");
        assert!(params["capabilities"].is_object());
    }

    #[test]
    fn remote_url_policy_blocks_private_and_metadata_hosts() {
        assert!(validate_url_for_config("https://mcp.example.com/mcp").is_ok());
        assert!(validate_url_for_config("http://localhost:8080/mcp").is_ok());
        assert!(validate_url_for_config("http://127.0.0.1:8080/mcp").is_ok());
        assert!(validate_url_for_config("http://mcp.example.com/mcp").is_err());
        assert!(validate_url_for_config("https://10.0.5.5/mcp").is_err());
        assert!(validate_url_for_config("https://192.168.1.10/mcp").is_err());
        assert!(validate_url_for_config("https://169.254.169.254/latest").is_err());
        assert!(validate_url_for_config("https://metadata.google.internal/mcp").is_err());
        assert!(validate_url_for_config("file:///etc/passwd").is_err());
    }

    #[test]
    fn blocked_ip_classification_covers_private_and_loopback() {
        assert!(is_blocked_ip("10.1.2.3".parse().unwrap()));
        assert!(is_blocked_ip("172.16.0.1".parse().unwrap()));
        assert!(is_blocked_ip("192.168.0.1".parse().unwrap()));
        assert!(is_blocked_ip("169.254.1.1".parse().unwrap()));
        assert!(is_blocked_ip("::1".parse().unwrap()));
        assert!(!is_blocked_ip("93.184.216.34".parse().unwrap()));
    }

    #[test]
    fn fingerprint_changes_when_config_changes() {
        let mut config = ServerConfig {
            transport: "stdio".into(),
            url: None,
            command: Some("npx".into()),
            args: vec!["server".into()],
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let first = config.fingerprint();
        config.args.push("--debug".into());
        assert_ne!(first, config.fingerprint());
    }

    #[test]
    fn transient_failures_are_retried_but_config_errors_are_not() {
        assert!(is_transient_failure("MCP stdio server closed: boom"));
        assert!(is_transient_failure("MCP connection failed: timed out"));
        assert!(is_transient_failure("MCP stdio server is not running"));
        assert!(!is_transient_failure("MCP server is disabled"));
        assert!(!is_transient_failure("remote MCP URLs must use HTTPS"));
        assert!(!is_transient_failure("MCP server not found"));
    }

    #[test]
    fn recovery_backoff_grows_and_caps() {
        assert_eq!(recovery_delay_secs(1), 5);
        assert_eq!(recovery_delay_secs(2), 10);
        assert_eq!(recovery_delay_secs(3), 20);
        assert_eq!(recovery_delay_secs(4), 40);
        assert_eq!(recovery_delay_secs(99), 300);
    }

    #[test]
    fn disconnected_status_starts_clean() {
        let status = McpServerStatus::disconnected("mcp-1");
        assert!(!status.connected);
        assert_eq!(status.server_id, "mcp-1");
        assert!(status.last_error.is_none());
        let failed = status.with_error("boom");
        assert_eq!(failed.last_error.as_deref(), Some("boom"));
        assert_eq!(failed.failure_count, 1);
    }

    #[test]
    fn classifies_tool_risk_from_name_and_annotations() {
        assert_eq!(
            classify_tool(&json!({"name": "delete_repo", "annotations": {"destructiveHint": true}})),
            McpRisk::R3
        );
        assert_eq!(
            classify_tool(&json!({"name": "list_issues", "annotations": {"readOnlyHint": true}})),
            McpRisk::R0
        );
        assert_eq!(
            classify_tool(&json!({"name": "search_web", "annotations": {"readOnlyHint": true}})),
            McpRisk::R1
        );
        assert_eq!(classify_tool(&json!({"name": "send_email"})), McpRisk::R2);
        assert_eq!(classify_tool(&json!({"name": "remove_file"})), McpRisk::R3);
        // Unknown external tools are conservatively treated as writes.
        assert_eq!(classify_tool(&json!({"name": "echo"})), McpRisk::R2);
    }

    #[test]
    fn schema_digest_tracks_schema_changes() {
        let first = json!({"inputSchema": {"type": "object", "properties": {"q": {"type": "string"}}}});
        let second = json!({"inputSchema": {"type": "object", "properties": {"q": {"type": "number"}}}});
        assert_eq!(schema_digest(&first).len(), 16);
        assert_eq!(schema_digest(&first), schema_digest(&first));
        assert_ne!(schema_digest(&first), schema_digest(&second));
    }

    /// Drives the real HTTP transport against a one-request-at-a-time mock so
    /// the initialize handshake, session id propagation and request dispatch
    /// are covered without a network dependency.
    #[tokio::test]
    async fn http_session_negotiates_and_reuses_session_id() {
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let server_seen = seen.clone();

        let server = std::thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = listener.accept().expect("accept");
                let (headers, body) = read_http_request(&mut stream);
                let value: Value = serde_json::from_str(&body).expect("json body");
                let method = value["method"].as_str().unwrap_or_default().to_string();
                server_seen.lock().unwrap().push(method.clone());
                let id = value["id"].clone();
                let (status, extra, response_body) = match method.as_str() {
                    "initialize" => (
                        "200 OK",
                        Some(("Mcp-Session-Id", "session-42")),
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "protocolVersion": "2025-06-18",
                                "serverInfo": {"name": "mock", "version": "1.0.0"},
                                "capabilities": {"tools": {}}
                            }
                        })
                        .to_string(),
                    ),
                    "notifications/initialized" => ("202 Accepted", None, String::new()),
                    "tools/list" => {
                        assert_eq!(
                            headers.get("mcp-session-id").map(String::as_str),
                            Some("session-42"),
                            "tools/list must carry the negotiated session id"
                        );
                        (
                            "200 OK",
                            None,
                            json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "result": {"tools": [{"name": "echo"}]}
                            })
                            .to_string(),
                        )
                    }
                    other => panic!("unexpected MCP method {other}"),
                };
                let mut response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    response_body.len()
                );
                if let Some((name, value)) = extra {
                    response.push_str(&format!("{name}: {value}\r\n"));
                }
                response.push_str("\r\n");
                response.push_str(&response_body);
                stream.write_all(response.as_bytes()).expect("write response");
            }
        });

        let config = ServerConfig {
            transport: "http".into(),
            url: Some(format!("http://{address}/mcp")),
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let parsed = validate_url_for_config(config.url.as_deref().unwrap()).expect("url");
        let transport = HttpTransport::new(&config, parsed).expect("transport");
        let session = Session {
            fingerprint: "test".into(),
            transport: Transport::Http(transport),
            initialized: tokio::sync::Mutex::new(None),
            tools: Mutex::new(None),
            runtime: Mutex::new(RuntimeState::default()),
        };

        let result = session
            .call("tools/list", json!({}), None)
            .await
            .expect("tools/list");
        assert_eq!(result["tools"][0]["name"], "echo");
        server.join().expect("mock server");
        assert_eq!(
            seen.lock().unwrap().as_slice(),
            ["initialize", "notifications/initialized", "tools/list"]
        );
    }

    /// Exercises the real stdio child process: one spawn must serve both
    /// `tools/list` calls and the initialize handshake must happen once.
    #[tokio::test]
    async fn stdio_session_spawns_once_and_reuses_the_child() {
        if std::process::Command::new("node")
            .arg("--version")
            .output()
            .is_err()
        {
            return;
        }
        let script = r#"
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
let tools = 0, inits = 0;
rl.on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (!msg.id) return;
  const reply = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
  if (msg.method === 'initialize') {
    inits += 1;
    reply({ protocolVersion: '2025-06-18', serverInfo: { name: 'mock', version: '1.0.0' }, capabilities: { tools: {} } });
  } else if (msg.method === 'tools/list') {
    tools += 1;
    reply({ tools: [{ name: 'echo' }], count: tools, inits });
  } else if (msg.method === 'ping') {
    reply({});
  } else {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'unsupported' } }) + '\n');
  }
});
"#;
        let config = ServerConfig {
            transport: "stdio".into(),
            url: None,
            command: Some("node".into()),
            args: vec!["-e".into(), script.into()],
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "stdio-test".into()).expect("spawn mock");
        let first = session.call("tools/list", json!({}), None).await.expect("first list");
        assert_eq!(first["count"], 1);
        assert_eq!(first["inits"], 1);
        let second = session.call("tools/list", json!({}), None).await.expect("second list");
        assert_eq!(second["count"], 2, "the same child must serve both calls");
        assert_eq!(second["inits"], 1, "initialize must happen once per session");
        session.shutdown();
    }

    /// Manual compatibility check against a public Streamable HTTP server:
    /// `cargo test --lib smoke_real_deepwiki_http_server -- --ignored --nocapture`
    /// Manual compatibility check against Playwright MCP (browser tools).
    /// Only initialize + tools/list are exercised; no browser is launched.
    /// `cargo test --lib smoke_real_playwright_server -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "requires network and npx"]
    async fn smoke_real_playwright_server() {
        let config = ServerConfig {
            transport: "stdio".into(),
            url: None,
            command: Some("npx".into()),
            args: vec!["-y".into(), "@playwright/mcp@latest".into()],
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "playwright".into()).expect("spawn playwright server");
        let tools = tokio::time::timeout(
            Duration::from_secs(120),
            session.call("tools/list", json!({}), None),
        )
        .await
        .expect("playwright tools/list timed out")
        .expect("playwright tools/list failed");
        let names: Vec<&str> = tools["tools"]
            .as_array()
            .map(|items| items.iter().filter_map(|tool| tool.get("name").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        assert!(
            names.iter().any(|name| name.starts_with("browser_")),
            "unexpected playwright tools: {names:?}"
        );
        session.shutdown();
    }

    /// Manual compatibility check against the official "everything" server
    /// (tools + resources + prompts, no credentials):
    /// `cargo test --lib smoke_real_everything_server -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "requires network and npx"]
    async fn smoke_real_everything_server() {
        let config = ServerConfig {
            transport: "stdio".into(),
            url: None,
            command: Some("npx".into()),
            args: vec!["-y".into(), "@modelcontextprotocol/server-everything".into()],
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "everything".into()).expect("spawn everything server");
        let tools = tokio::time::timeout(
            Duration::from_secs(120),
            session.call("tools/list", json!({}), None),
        )
        .await
        .expect("tools/list timed out")
        .expect("tools/list failed");
        let tool_names: Vec<&str> = tools["tools"]
            .as_array()
            .map(|items| items.iter().filter_map(|tool| tool.get("name").and_then(Value::as_str)).collect())
            .unwrap_or_default();
        assert!(tool_names.contains(&"get-sum"), "unexpected tools: {tool_names:?}");

        let resources = session
            .call("resources/list", json!({}), None)
            .await
            .expect("resources/list failed");
        assert!(
            resources["resources"].as_array().is_some_and(|items| !items.is_empty()),
            "unexpected resources: {resources}"
        );
        let prompts = session
            .call("prompts/list", json!({}), None)
            .await
            .expect("prompts/list failed");
        assert!(
            prompts["prompts"].as_array().is_some_and(|items| !items.is_empty()),
            "unexpected prompts: {prompts}"
        );

        let result = session
            .call(
                "tools/call",
                json!({"name": "get-sum", "arguments": {"a": 2, "b": 3}}),
                Some("get-sum"),
            )
            .await
            .expect("tools/call get-sum failed");
        let text = result["content"]
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert!(text.contains('5'), "unexpected add result: {result}");
        session.shutdown();
    }

    #[tokio::test]
    #[ignore = "requires network"]
    async fn smoke_real_deepwiki_http_server() {
        let config = ServerConfig {
            transport: "http".into(),
            url: Some("https://mcp.deepwiki.com/mcp".into()),
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "deepwiki".into()).expect("deepwiki session");
        let tools = tokio::time::timeout(
            Duration::from_secs(60),
            session.call("tools/list", json!({}), None),
        )
        .await
        .expect("deepwiki tools/list timed out")
        .expect("deepwiki tools/list failed");
        let names: Vec<&str> = tools["tools"]
            .as_array()
            .map(|tools| {
                tools
                    .iter()
                    .filter_map(|tool| tool.get("name").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();
        assert!(names.contains(&"read_wiki_structure"), "unexpected tools: {names:?}");
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            session.call(
                "tools/call",
                json!({"name": "read_wiki_structure", "arguments": {"repoName": "facebook/react"}}),
                Some("read_wiki_structure"),
            ),
        )
        .await
        .expect("deepwiki tools/call timed out")
        .expect("deepwiki tools/call failed");
        assert!(
            result["content"].as_array().is_some_and(|content| !content.is_empty()),
            "unexpected tool result: {result}"
        );
        session.shutdown();
    }

    #[cfg(windows)]
    #[test]
    fn windows_resolves_bare_npx_to_a_cmd_shim() {
        let available = std::process::Command::new("cmd.exe")
            .arg("/C")
            .arg("where")
            .arg("npx")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        if !available {
            return;
        }
        let target = windows_shell_target("npx").expect("npx shim must be resolved");
        let lower = target.to_ascii_lowercase();
        assert!(lower.ends_with(".cmd") || lower.ends_with(".bat"));
    }

    /// Manual compatibility check against the real filesystem server:
    /// `cargo test --lib smoke_real_filesystem_server -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "requires network and npx"]
    async fn smoke_real_filesystem_server() {
        let directory = std::env::temp_dir().join(format!("arcadia-mcp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("temp dir");
        std::fs::write(directory.join("hello.txt"), "hi").expect("seed file");
        let config = ServerConfig {
            transport: "stdio".into(),
            url: None,
            command: Some("npx".into()),
            args: vec![
                "-y".into(),
                "@modelcontextprotocol/server-filesystem".into(),
                directory.display().to_string(),
            ],
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "smoke".into()).expect("spawn npx server");
        let tools = tokio::time::timeout(
            Duration::from_secs(120),
            session.call("tools/list", json!({}), None),
        )
        .await
        .expect("tools/list timed out")
        .expect("tools/list failed");
        assert!(!tools["tools"].as_array().map(Vec::is_empty).unwrap_or(true));
        let result = tokio::time::timeout(
            Duration::from_secs(60),
            session.call(
                "tools/call",
                json!({"name": "list_directory", "arguments": {"path": directory.display().to_string()}}),
                Some("list_directory"),
            ),
        )
        .await
        .expect("tools/call timed out")
        .expect("tools/call failed");
        assert!(result.get("content").is_some());
        session.shutdown();
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn sse_frames_are_split_and_multiline_data_is_joined() {
        let mut buffer = String::from(
            "event: endpoint\ndata: /messages?session=1\n\nevent: message\ndata: {\"a\":\ndata: 1}\n\npartial",
        );
        let events = drain_sse_events(&mut buffer);
        assert_eq!(
            events[0],
            ("endpoint".to_string(), "/messages?session=1".to_string())
        );
        assert_eq!(events[1].0, "message");
        assert_eq!(events[1].1, "{\"a\":\n1}");
        assert_eq!(buffer, "partial");
    }

    #[test]
    fn sse_endpoint_must_stay_on_the_stream_origin() {
        assert!(resolve_sse_endpoint("https://example.com/sse", "/messages").is_ok());
        assert!(resolve_sse_endpoint(
            "https://example.com/sse",
            "https://evil.example/messages"
        )
        .is_err());
        assert!(resolve_sse_endpoint("https://example.com/sse", "javascript:alert(1)").is_err());
    }

    #[tokio::test]
    async fn sse_transport_handshakes_and_receives_responses() {
        use std::io::Write;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind sse mock");
        let address = listener.local_addr().expect("sse address");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("stream connection");
            let _ = read_http_request(&mut stream);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\n\r\n",
                )
                .expect("stream headers");
            stream
                .write_all(b"event: endpoint\ndata: /messages?session=1\n\n")
                .expect("endpoint event");
            stream.flush().expect("flush endpoint");

            let (mut initialize, _) = listener.accept().expect("initialize post");
            let (_, body) = read_http_request(&mut initialize);
            let request: Value = serde_json::from_str(&body).expect("initialize json");
            initialize
                .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .expect("initialize ack");
            let result = json!({
                "jsonrpc": "2.0",
                "id": request["id"].clone(),
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": "sse-mock", "version": "1.0.0"},
                    "capabilities": {"tools": {}}
                }
            });
            stream
                .write_all(format!("event: message\ndata: {result}\n\n").as_bytes())
                .expect("initialize response");
            stream.flush().expect("flush initialize");

            let (mut initialized, _) = listener.accept().expect("initialized notification");
            let _ = read_http_request(&mut initialized);
            initialized
                .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .expect("notification ack");

            let (mut list, _) = listener.accept().expect("tools post");
            let (_, body) = read_http_request(&mut list);
            let request: Value = serde_json::from_str(&body).expect("tools json");
            list.write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .expect("tools ack");
            let result = json!({
                "jsonrpc": "2.0",
                "id": request["id"].clone(),
                "result": {"tools": [{"name": "echo"}]}
            });
            stream
                .write_all(format!("event: message\ndata: {result}\n\n").as_bytes())
                .expect("tools response");
            stream.flush().expect("flush tools");
        });

        let config = ServerConfig {
            transport: "sse".into(),
            url: Some(format!("http://{address}/sse")),
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let session = Session::new(config, "sse-test".into()).expect("sse session");
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            session.call("tools/list", json!({}), None),
        )
        .await
        .expect("sse call timed out")
        .expect("sse tools");
        assert_eq!(result["tools"][0]["name"], "echo");
        session.shutdown();
        server.join().expect("sse mock");
    }

    #[tokio::test]
    async fn diagnostics_cover_initialize_tools_resources_and_prompts() {
        use std::io::Write;

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind diagnostics mock");
        let address = listener.local_addr().expect("diagnostics address");
        let server = std::thread::spawn(move || {
            for _ in 0..5 {
                let (mut stream, _) = listener.accept().expect("diagnostics accept");
                let (_headers, body) = read_http_request(&mut stream);
                let request: Value = serde_json::from_str(&body).expect("diagnostics json");
                let method = request["method"].as_str().unwrap_or_default();
                let id = request["id"].clone();
                let (status, extra, response) = match method {
                    "initialize" => (
                        "200 OK",
                        Some(("Mcp-Session-Id", "diag-session")),
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "protocolVersion": "2025-06-18",
                                "serverInfo": {"name": "diag", "version": "1.2.3"},
                                "capabilities": {"tools": {}, "resources": {}, "prompts": {}}
                            }
                        })
                        .to_string(),
                    ),
                    "notifications/initialized" => ("202 Accepted", None, String::new()),
                    "tools/list" => (
                        "200 OK",
                        None,
                        json!({"jsonrpc": "2.0", "id": id, "result": {"tools": [{"name": "a"}, {"name": "b"}]}}).to_string(),
                    ),
                    "resources/list" => (
                        "200 OK",
                        None,
                        json!({"jsonrpc": "2.0", "id": id, "result": {"resources": [{"uri": "file:///a"}]}}).to_string(),
                    ),
                    "prompts/list" => (
                        "200 OK",
                        None,
                        json!({"jsonrpc": "2.0", "id": id, "result": {"prompts": []}}).to_string(),
                    ),
                    other => panic!("unexpected diagnostics method {other}"),
                };
                let mut response_text = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    response.len()
                );
                if let Some((name, value)) = extra {
                    response_text.push_str(&format!("{name}: {value}\r\n"));
                }
                response_text.push_str("\r\n");
                response_text.push_str(&response);
                stream
                    .write_all(response_text.as_bytes())
                    .expect("diagnostics response");
            }
        });

        let config = ServerConfig {
            transport: "http".into(),
            url: Some(format!("http://{address}/mcp")),
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HeaderMap::new(),
        };
        let parsed = validate_url_for_config(config.url.as_deref().unwrap()).expect("diag url");
        let transport = HttpTransport::new(&config, parsed).expect("diag transport");
        let session = Session {
            fingerprint: "diag".into(),
            transport: Transport::Http(transport),
            initialized: tokio::sync::Mutex::new(None),
            tools: Mutex::new(None),
            runtime: Mutex::new(RuntimeState::default()),
        };
        let stages = diagnose_session(&session).await;
        assert_eq!(stages.len(), 3);
        assert!(stages.iter().all(|stage| stage.ok));
        assert_eq!(stages[0].count, Some(2));
        assert_eq!(stages[1].count, Some(1));
        assert_eq!(stages[2].count, Some(0));
        server.join().expect("diagnostics mock");
    }

    #[test]
    fn capability_diff_reports_added_removed_and_changed() {
        let entry = |name: &str, digest: &str| CapabilityEntry {
            name: name.into(),
            digest: digest.into(),
        };
        let previous = vec![entry("a", "1"), entry("b", "1"), entry("c", "1")];
        let current = vec![entry("a", "2"), entry("b", "1"), entry("d", "1")];
        let diff = diff_capabilities(&previous, &current);
        assert_eq!(diff.added, vec!["d"]);
        assert_eq!(diff.removed, vec!["c"]);
        assert_eq!(diff.changed, vec!["a"]);
        assert!(!diff.first_seen);
        let first = diff_capabilities(&[], &current);
        assert!(first.first_seen);
        assert_eq!(first.added, vec!["a", "b", "d"]);
        assert!(diff_capabilities(&previous, &previous).added.is_empty());
    }

    #[test]
    fn capability_entries_use_uri_or_name_and_stable_digests() {
        let value = json!({
            "tools": [{"name": "search", "description": "one"}],
            "resources": [{"uri": "file:///a", "name": "a"}],
        });
        let tools = capability_entries(&value, "tools");
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "search");
        assert_eq!(tools[0].digest, value_digest(&json!({"name": "search", "description": "one"})));
        let resources = capability_entries(&value, "resources");
        assert_eq!(resources[0].name, "file:///a");
        assert!(capability_entries(&value, "prompts").is_empty());
    }

    #[test]
    fn config_import_preview_and_apply_preserve_secrets() {
        let database = rusqlite::Connection::open_in_memory().expect("memory db");
        database
            .execute_batch(
                "CREATE TABLE mcp_servers (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, transport TEXT NOT NULL,
                    command TEXT, url TEXT, args_json TEXT NOT NULL DEFAULT '[]',
                    env_json TEXT NOT NULL DEFAULT '{}', headers_json TEXT NOT NULL DEFAULT '{}',
                    enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );",
            )
            .expect("schema");
        database
            .execute(
                "INSERT INTO mcp_servers VALUES(?1,'local','stdio','node',NULL,'[]','{\"TOKEN\":\"secret\"}','{}',1,'t','t')",
                params![format!("cfg-{}", uuid::Uuid::new_v4())],
            )
            .expect("seed");

        let exported = read_config_entries(&database).expect("export");
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].env_keys, vec!["TOKEN".to_string()]);

        let update = McpConfigEntry {
            name: "local".into(),
            transport: "stdio".into(),
            command: Some("node".into()),
            url: None,
            args: vec!["server.js".into()],
            enabled: false,
            env_keys: vec!["TOKEN".into()],
            header_keys: Vec::new(),
        };
        let create = McpConfigEntry {
            name: "remote".into(),
            transport: "http".into(),
            command: None,
            url: Some("https://example.com/mcp".into()),
            args: Vec::new(),
            enabled: true,
            env_keys: vec!["API_KEY".into()],
            header_keys: Vec::new(),
        };
        let preview = preview_config(&database, &[update.clone(), create.clone()]).expect("preview");
        assert_eq!((preview.created, preview.updated, preview.unchanged), (1, 1, 0));
        assert_eq!(preview.servers[0].changed_fields, vec!["args", "enabled"]);

        let summary = apply_config(&database, &[update, create]).expect("apply");
        assert_eq!((summary.created, summary.updated, summary.unchanged), (1, 1, 0));
        assert_eq!(summary.missing_secrets[0].name, "remote");

        let env_json: String = database
            .query_row("SELECT env_json FROM mcp_servers WHERE name='local'", [], |row| row.get(0))
            .expect("existing env");
        assert_eq!(env_json, r#"{"TOKEN":"secret"}"#);
        let new_env: String = database
            .query_row("SELECT env_json FROM mcp_servers WHERE name='remote'", [], |row| row.get(0))
            .expect("new env");
        assert_eq!(new_env, "{}");
        let enabled: i64 = database
            .query_row("SELECT enabled FROM mcp_servers WHERE name='local'", [], |row| row.get(0))
            .expect("enabled");
        assert_eq!(enabled, 0);
    }

    #[test]
    fn config_normalization_rejects_invalid_entries() {
        let entry = |name: &str| McpConfigEntry {
            name: name.into(),
            transport: "http".into(),
            command: None,
            url: Some("https://example.com/mcp".into()),
            args: Vec::new(),
            enabled: true,
            env_keys: Vec::new(),
            header_keys: Vec::new(),
        };
        let config = |version: u32, servers: Vec<McpConfigEntry>| McpConfigExport {
            version,
            exported_at: String::new(),
            servers,
        };
        assert!(normalize_config(config(2, vec![entry("a")])).is_err());
        assert!(normalize_config(config(1, Vec::new())).is_err());
        assert!(normalize_config(config(1, vec![entry("a"), entry("a")])).is_err());
        let mut private = entry("private");
        private.url = Some("https://10.0.0.5/mcp".into());
        assert!(normalize_config(config(1, vec![private])).is_err());
        let mut missing_url = entry("missing");
        missing_url.url = None;
        assert!(normalize_config(config(1, vec![missing_url])).is_err());
        assert!(normalize_config(config(1, vec![entry("ok")])).is_ok());
    }

    fn read_http_request(stream: &mut std::net::TcpStream) -> (HashMap<String, String>, String) {
        use std::io::Read;
        let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
        let mut request_line = String::new();
        reader.read_line(&mut request_line).expect("request line");
        let mut headers = HashMap::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).expect("header line");
            if line == "\r\n" || line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
            }
        }
        let length = headers
            .get("content-length")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(0);
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).expect("request body");
        (
            headers,
            String::from_utf8(body).expect("utf8 request body"),
        )
    }
}

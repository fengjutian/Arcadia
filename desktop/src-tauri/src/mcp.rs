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
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
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
    let values: HashMap<String, String> =
        serde_json::from_str(&raw_headers).map_err(|e| e.to_string())?;
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
        env: serde_json::from_str(&raw_env).map_err(|e| e.to_string())?,
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
// stdio transport
// ---------------------------------------------------------------------------

struct StdioTransport {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>,
    closed: AtomicBool,
    stderr_tail: Mutex<VecDeque<String>>,
}

impl StdioTransport {
    fn spawn(config: &ServerConfig) -> Result<Arc<Self>, String> {
        let executable = config
            .command
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or("MCP stdio command is missing")?;
        let mut child = Command::new(executable)
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
}

struct Session {
    fingerprint: String,
    transport: Transport,
    initialized: tokio::sync::Mutex<Option<Value>>,
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
            Transport::Http(HttpTransport::new(&config, parsed)?)
        };
        Ok(Self {
            fingerprint,
            transport,
            initialized: tokio::sync::Mutex::new(None),
            runtime: Mutex::new(RuntimeState::default()),
        })
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
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        match &self.transport {
            Transport::Stdio(transport) => transport.notify(method, params),
            Transport::Http(transport) => transport.notify(method, params).await,
        }
    }

    async fn ensure_ready(&self) -> Result<Value, String> {
        if !self.is_alive() {
            let error = match &self.transport {
                Transport::Stdio(transport) => transport.closed_error(),
                Transport::Http(_) => "MCP session is not running".into(),
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
        if let Transport::Stdio(transport) = &self.transport {
            transport.kill();
        }
    }

    fn protocol_version(&self) -> Option<String> {
        match &self.transport {
            Transport::Http(transport) => lock(&transport.protocol_version).clone(),
            Transport::Stdio(_) => self
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

#[derive(Default)]
pub struct McpHost {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
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

    /// Kills every stdio child. Called from the app exit hook so `npx` and
    /// similar wrappers never outlive the browser.
    pub fn shutdown_all(&self) {
        let mut sessions = lock(&self.sessions);
        for (_, session) in sessions.drain() {
            session.shutdown();
        }
    }
}

fn audit(
    app: &tauri::AppHandle,
    server_id: &str,
    method: &str,
    name: Option<&str>,
    approved: bool,
    result: &Result<Value, String>,
) {
    if let Ok(db) = crate::local_store::connection(app) {
        let _ = db.execute(
            "INSERT INTO mcp_audit_log(id,server_id,method,target_name,approved,success,error,created_at) VALUES(?,?,?,?,?,?,?,?)",
            params![
                uuid::Uuid::new_v4().to_string(),
                server_id,
                method,
                name,
                approved as i64,
                result.is_ok() as i64,
                result.as_ref().err(),
                chrono::Utc::now().to_rfc3339()
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
    pub created_at: String,
}

#[derive(Debug, Serialize)]
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
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn mcp_discover(app: tauri::AppHandle, server_id: String) -> Result<Value, String> {
    let host = app.state::<McpHost>();
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
    session.call("tools/list", json!({}), None).await
}

#[tauri::command]
pub async fn mcp_list_resources(
    app: tauri::AppHandle,
    server_id: String,
) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    session.call("resources/list", json!({}), None).await
}

#[tauri::command]
pub async fn mcp_list_prompts(app: tauri::AppHandle, server_id: String) -> Result<Value, String> {
    let host = app.state::<McpHost>();
    let session = host.ready(&app, &server_id).await?;
    session.call("prompts/list", json!({}), None).await
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
    if !approved {
        let result = Err("MCP tool call requires explicit approval".into());
        audit(&app, &server_id, "tools/call", Some(&name), false, &result);
        return result;
    }
    let host = app.state::<McpHost>();
    let result = match host.ready(&app, &server_id).await {
        Ok(session) => {
            session
                .call(
                    "tools/call",
                    json!({"name": name, "arguments": arguments}),
                    Some(&name),
                )
                .await
        }
        Err(error) => Err(error),
    };
    audit(&app, &server_id, "tools/call", Some(&name), true, &result);
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
            .prepare("SELECT id,server_id,method,target_name,approved,success,error,created_at FROM mcp_audit_log WHERE server_id=?1 ORDER BY created_at DESC LIMIT ?2")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![server_id, limit], row_audit)
            .map_err(|error| error.to_string())?;
        for row in rows {
            entries.push(row.map_err(|error| error.to_string())?);
        }
    } else {
        let mut statement = db
            .prepare("SELECT id,server_id,method,target_name,approved,success,error,created_at FROM mcp_audit_log ORDER BY created_at DESC LIMIT ?1")
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

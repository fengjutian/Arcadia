//! User-managed site blacklist ("网站封杀名单").
//!
//! This is deliberately separate from the ABP-style rule engine in
//! [`crate::privacy`]: the blacklist is a small, user-curated list of hosts
//! that must never load. It is checked before any request leaves the app:
//!
//! - top-level navigation is rejected in `browser_create` / `browser_navigate`
//!   and cancelled in the WebView2 `NavigationStarting` handler;
//! - sub-resources are rejected in the `WebResourceRequested` handler when the
//!   sub-resource switch is on.
//!
//! Requests run on WebView2 threads where SQLite must not block, so the whole
//! list is compiled into an in-memory [`SiteRules`] snapshot on startup and
//! after every mutation. See `docs/site-blacklist-plan.md`.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, OnceLock, RwLock};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use url::Url;

use crate::local_store;

pub const SITE_BLOCKED_EVENT: &str = "browser://site-blocked";
pub const SITE_BLACKLIST_CHANGED_EVENT: &str = "browser://site-blacklist-changed";
pub const BLOCKED_ERROR_PREFIX: &str = "site-blocked:";

const MAX_NOTE_CHARS: usize = 200;
/// Newest N block events kept in SQLite. Older rows are pruned on insert.
const EVENT_RETENTION: i64 = 1_000;

/// Hosts that would block an entire public suffix if accepted. Keeping the list
/// short is fine: anything here is a user mistake, not a real site.
const PUBLIC_SUFFIXES: &[&str] = &[
    "com", "net", "org", "edu", "gov", "mil", "int", "io", "co", "ai", "app", "dev", "me", "info",
    "biz", "xyz", "top", "site", "online", "shop", "club", "wang", "cn", "uk", "jp", "kr", "de",
    "fr", "ru", "br", "in", "au", "ca", "us", "tw", "hk", "sg", "ch", "it", "nl", "se", "no", "es",
    "pl", "ir", "tr", "vn", "th", "id", "my", "ph", "nz", "za", "mx", "ar", "cl", "co.uk",
    "com.cn", "com.tw", "com.hk", "com.au", "co.jp", "co.kr", "co.nz", "co.za", "com.br", "com.sg",
    "net.cn", "org.cn", "gov.cn", "edu.cn",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistEntry {
    pub id: String,
    pub host: String,
    pub include_subdomains: bool,
    pub enabled: bool,
    pub note: Option<String>,
    pub source: String,
    pub hit_count: i64,
    pub last_blocked_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistSettings {
    pub enabled: bool,
    pub block_subresources: bool,
    pub updated_at: i64,
}

impl Default for SiteBlacklistSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            block_subresources: true,
            updated_at: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistEvent {
    pub id: String,
    pub host: String,
    pub rule_host: String,
    pub url: String,
    pub tab_label: Option<String>,
    pub blocked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistSummary {
    pub total: i64,
    pub enabled: i64,
    pub hit_total: i64,
    pub last_blocked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistImportResult {
    pub added: Vec<SiteBlacklistEntry>,
    pub duplicates: Vec<String>,
    pub invalid: Vec<SiteBlacklistInvalidInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteBlacklistInvalidInput {
    pub input: String,
    pub reason: String,
}

/// A match returned to callers. `host` is the host that was requested;
/// `rule_host` is the normalized entry that matched it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteMatch {
    pub host: String,
    pub rule_host: String,
    pub entry_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SiteBlockedEvent {
    version: u32,
    tab_label: String,
    url: String,
    host: String,
    rule_host: String,
    entry_id: String,
    resource_type: String,
}

#[derive(Debug, Clone)]
struct RuleRef {
    entry_id: String,
}

/// Immutable compiled snapshot. Cloned atomically on reload.
///
/// Rules are split into two hash maps instead of a linear list so request-time
/// matching is O(labels) rather than O(rules). A 5,000-entry imported list no
/// longer adds work to every `WebResourceRequested` callback.
#[derive(Debug, Clone, Default)]
pub struct SiteRules {
    enabled: bool,
    block_subresources: bool,
    /// `include_subdomains = false`: only the exact host matches.
    exact: HashMap<String, RuleRef>,
    /// `include_subdomains = true`: the host and every parent suffix match.
    suffix: HashMap<String, RuleRef>,
}

impl SiteRules {
    fn build(settings: SiteBlacklistSettings, entries: Vec<SiteBlacklistEntry>) -> Self {
        let mut exact = HashMap::new();
        let mut suffix = HashMap::new();
        for entry in entries.into_iter().filter(|entry| entry.enabled) {
            let rule = RuleRef { entry_id: entry.id };
            if entry.include_subdomains {
                suffix.insert(entry.host, rule);
            } else {
                exact.insert(entry.host, rule);
            }
        }
        Self {
            enabled: settings.enabled,
            block_subresources: settings.block_subresources,
            exact,
            suffix,
        }
    }

    pub fn blocks_subresources(&self) -> bool {
        self.enabled
            && self.block_subresources
            && !(self.exact.is_empty() && self.suffix.is_empty())
    }

    fn match_host(&self, raw_host: &str) -> Option<SiteMatch> {
        if !self.enabled {
            return None;
        }
        let host = normalize_match_host(raw_host);
        if host.is_empty() {
            return None;
        }
        if let Some(rule) = self.exact.get(host.as_str()) {
            return Some(SiteMatch {
                rule_host: host.clone(),
                host,
                entry_id: rule.entry_id.clone(),
            });
        }
        // IP literals have no subdomain hierarchy; suffix matching would let a
        // rule like `0.0.1` match every unrelated address ending in it.
        if host.parse::<IpAddr>().is_ok() {
            return None;
        }
        // Walk up the label chain: a.b.example.com → b.example.com →
        // example.com. The first hit is the longest (most specific) suffix.
        let mut found: Option<(String, String)> = None;
        let mut cursor = host.as_str();
        loop {
            if let Some(rule) = self.suffix.get(cursor) {
                found = Some((cursor.to_string(), rule.entry_id.clone()));
                break;
            }
            match cursor.find('.') {
                Some(index) => cursor = &cursor[index + 1..],
                None => break,
            }
        }
        found.map(|(rule_host, entry_id)| SiteMatch {
            host,
            rule_host,
            entry_id,
        })
    }

    fn match_url(&self, url: &str) -> Option<SiteMatch> {
        if !self.enabled || (self.exact.is_empty() && self.suffix.is_empty()) {
            return None;
        }
        let parsed = Url::parse(url).ok()?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return None;
        }
        let host = parsed.host_str()?;
        self.match_host(host)
    }
}

/// Extract the host from a canonical http(s) or ws(s) URL without constructing
/// a `Url`.
///
/// WebView2 hands `WebResourceRequested` a canonical lowercase ASCII URL, so
/// this hot path can stay allocation-free. It deliberately returns `None` for
/// anything that is not clearly http(s)/ws(s); navigations still go through
/// `Url::parse` in [`SiteRules::match_url`].
fn fast_url_host(url: &str) -> Option<&str> {
    let prefix_len = [
        ("https://", 8usize),
        ("http://", 7),
        ("wss://", 6),
        ("ws://", 5),
    ]
    .into_iter()
    .find_map(|(prefix, len)| {
        url.get(..len)
            .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
            .map(|_| len)
    })?;
    let rest = &url[prefix_len..];
    let end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..end];
    if authority.is_empty() {
        return None;
    }
    let authority = match authority.rfind('@') {
        Some(index) => &authority[index + 1..],
        None => authority,
    };
    if authority.starts_with('[') {
        let close = authority.find(']')?;
        return Some(&authority[..=close]);
    }
    let host = match authority.rfind(':') {
        Some(index) => &authority[..index],
        None => authority,
    };
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn normalize_match_host(host: &str) -> String {
    let host = host.trim();
    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    host.trim_end_matches('.').to_ascii_lowercase()
}

fn rules_cell() -> &'static RwLock<Arc<SiteRules>> {
    static CELL: OnceLock<RwLock<Arc<SiteRules>>> = OnceLock::new();
    CELL.get_or_init(|| RwLock::new(Arc::new(SiteRules::default())))
}

fn install(rules: SiteRules) {
    if let Ok(mut guard) = rules_cell().write() {
        *guard = Arc::new(rules);
    }
}

pub fn snapshot() -> Arc<SiteRules> {
    rules_cell()
        .read()
        .map(|guard| Arc::clone(&guard))
        .unwrap_or_default()
}

/// Match a URL against the live snapshot.
pub fn match_url(url: &str) -> Option<SiteMatch> {
    snapshot().match_url(url)
}

/// One-stop check for the sub-resource filter: honours the global switch and
/// the "block embedded resources" setting, reads the snapshot once, and avoids
/// `Url::parse` on the request hot path.
pub fn match_blocked_subresource(url: &str) -> Option<SiteMatch> {
    let rules = snapshot();
    if !rules.blocks_subresources() {
        return None;
    }
    let host = fast_url_host(url)?;
    rules.match_host(host)
}

/// Error string understood by `classifyNavigationError` on the UI side.
pub fn blocked_error(found: &SiteMatch) -> String {
    format!(
        "{BLOCKED_ERROR_PREFIX}{}|{}|{}",
        found.host, found.rule_host, found.entry_id
    )
}

/// Reload the compiled snapshot from SQLite. Called on startup and after every
/// mutation so the request threads never read the database.
pub fn reload<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let database = local_store::connection(app)?;
    let settings = read_settings(&database)?;
    let entries = read_entries(&database, Some(true))?;
    install(SiteRules::build(settings, entries));
    Ok(())
}

/// Emit `browser://site-blocked` and persist the hit. Called from both the
/// command path and the WebView2 navigation handler.
pub fn block_document<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    found: &SiteMatch,
    tab_label: Option<&str>,
    private: bool,
) {
    let label = tab_label.unwrap_or_default().to_string();
    let _ = app.emit(
        SITE_BLOCKED_EVENT,
        SiteBlockedEvent {
            version: 1,
            tab_label: label.clone(),
            url: url.to_string(),
            host: found.host.clone(),
            rule_host: found.rule_host.clone(),
            entry_id: found.entry_id.clone(),
            resource_type: "document".into(),
        },
    );
    if private {
        return;
    }
    let app = app.clone();
    let url = url.to_string();
    let found = found.clone();
    let label = if label.is_empty() { None } else { Some(label) };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = persist_block(&app, &url, &found, label.as_deref()) {
            eprintln!("site_blacklist: failed to record block: {error}");
        }
    });
}

fn persist_block<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    found: &SiteMatch,
    tab_label: Option<&str>,
) -> Result<(), String> {
    let mut database = local_store::connection(app)?;
    let now = now_seconds();
    {
        let transaction = database.transaction().map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE site_blacklist
                 SET hit_count = hit_count + 1, last_blocked_at = ?1
                 WHERE id = ?2",
                params![now, found.entry_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO site_blacklist_events(id, host, rule_host, url, tab_label, blocked_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    uuid::Uuid::new_v4().to_string(),
                    found.host,
                    found.rule_host,
                    url,
                    tab_label,
                    now
                ],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }
    // Keep the history bounded: the settings page only ever shows the newest
    // 20 rows, and a redirect chain can otherwise grow the table forever.
    let _ = database.execute(
        "DELETE FROM site_blacklist_events
         WHERE id NOT IN (
             SELECT id FROM site_blacklist_events
             ORDER BY blocked_at DESC, rowid DESC
             LIMIT ?1
         )",
        params![EVENT_RETENTION],
    );
    Ok(())
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// Normalize a user-supplied URL or domain into a bare punycode host.
///
/// Accepts `example.com`, `www.example.com`, `https://example.com/path`,
/// `*.example.com`, IDN hosts and IP literals. The scheme, port, path and query
/// are discarded; a leading `www.` is stripped because `example.com` already
/// covers it when subdomains are included.
pub fn normalize_host_input(input: &str) -> Result<String, String> {
    let mut value = input.trim();
    if value.is_empty() {
        return Err("请输入要封杀的网站".into());
    }
    // Tolerate a trailing separator when the user pastes a list into a field.
    value = value.trim_end_matches([',', ';', '，', '；']).trim();
    let wildcard = value.starts_with("*.");
    let value = if wildcard {
        &value[2..]
    } else {
        value.trim_start_matches('.')
    };
    if value.is_empty() {
        return Err("请输入要封杀的网站".into());
    }
    let with_scheme = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let parsed = Url::parse(&with_scheme).map_err(|_| "无法识别的网址或域名".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("只支持 http / https 网站".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("网址中不能包含账号或密码".into());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "网址缺少域名".to_string())?;
    let mut host = normalize_match_host(host);
    if let Some(stripped) = host.strip_prefix("www.") {
        if stripped.contains('.') {
            host = stripped.to_string();
        }
    }
    validate_host(&host)?;
    Ok(host)
}

fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty() {
        return Err("网址缺少域名".into());
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if host.len() > 253 {
        return Err("域名过长".into());
    }
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 {
        return Err("请输入完整域名，例如 example.com".into());
    }
    for label in &labels {
        if label.is_empty() {
            return Err("域名格式不正确".into());
        }
        if label.len() > 63 {
            return Err("域名片段过长".into());
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err("域名片段不能以连字符开头或结尾".into());
        }
        if !label
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-')
        {
            return Err("域名包含无效字符".into());
        }
    }
    if PUBLIC_SUFFIXES.contains(&host) {
        return Err("不能封杀整个公共后缀，请填写具体网站".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<SiteBlacklistEntry> {
    Ok(SiteBlacklistEntry {
        id: row.get(0)?,
        host: row.get(1)?,
        include_subdomains: row.get::<_, i64>(2)? != 0,
        enabled: row.get::<_, i64>(3)? != 0,
        note: row.get(4)?,
        source: row.get(5)?,
        hit_count: row.get(6)?,
        last_blocked_at: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

const ENTRY_COLUMNS: &str = "id, host, include_subdomains, enabled, note, source, hit_count, last_blocked_at, created_at, updated_at";

pub fn read_settings(database: &Connection) -> Result<SiteBlacklistSettings, String> {
    database
        .query_row(
            "SELECT enabled, block_subresources, updated_at
             FROM site_blacklist_settings WHERE id = 1",
            [],
            |row| {
                Ok(SiteBlacklistSettings {
                    enabled: row.get::<_, i64>(0)? != 0,
                    block_subresources: row.get::<_, i64>(1)? != 0,
                    updated_at: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
        .map(|value| value.unwrap_or_default())
}

pub fn read_entries(
    database: &Connection,
    only_enabled: Option<bool>,
) -> Result<Vec<SiteBlacklistEntry>, String> {
    let sql = match only_enabled {
        Some(true) => format!(
            "SELECT {ENTRY_COLUMNS} FROM site_blacklist WHERE enabled = 1 ORDER BY created_at DESC"
        ),
        _ => format!("SELECT {ENTRY_COLUMNS} FROM site_blacklist ORDER BY created_at DESC"),
    };
    let mut statement = database.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], row_to_entry)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn find_by_id(database: &Connection, id: &str) -> Result<Option<SiteBlacklistEntry>, String> {
    database
        .query_row(
            &format!("SELECT {ENTRY_COLUMNS} FROM site_blacklist WHERE id = ?1"),
            params![id],
            row_to_entry,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn find_by_host(database: &Connection, host: &str) -> Result<Option<SiteBlacklistEntry>, String> {
    database
        .query_row(
            &format!("SELECT {ENTRY_COLUMNS} FROM site_blacklist WHERE host = ?1"),
            params![host],
            row_to_entry,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn insert_entry(
    database: &Connection,
    host: &str,
    include_subdomains: bool,
    note: Option<&str>,
    source: &str,
) -> Result<Option<SiteBlacklistEntry>, String> {
    let now = now_seconds();
    let id = uuid::Uuid::new_v4().to_string();
    let note = note
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(MAX_NOTE_CHARS).collect::<String>());
    let changed = database
        .execute(
            "INSERT OR IGNORE INTO site_blacklist
             (id, host, include_subdomains, enabled, note, source, hit_count, created_at, updated_at)
             VALUES(?1, ?2, ?3, 1, ?4, ?5, 0, ?6, ?6)",
            params![id, host, include_subdomains as i64, note, source, now],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Ok(None);
    }
    find_by_id(database, &id)
}

fn sanitize_source(source: Option<&str>) -> &'static str {
    match source.unwrap_or("manual") {
        "import" => "import",
        "quick-block" => "quick-block",
        _ => "manual",
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn site_blacklist_list(app: AppHandle) -> Result<Vec<SiteBlacklistEntry>, String> {
    let database = local_store::connection(&app)?;
    read_entries(&database, None)
}

#[tauri::command]
pub fn site_blacklist_add(
    app: AppHandle,
    input: String,
    note: Option<String>,
    source: Option<String>,
    include_subdomains: Option<bool>,
) -> Result<SiteBlacklistEntry, String> {
    let host = normalize_host_input(&input)?;
    let database = local_store::connection(&app)?;
    // Blocking `example.com` covers its subdomains by default; this mirrors
    // how users describe "封杀一个网站". The form can opt into "仅本站".
    let entry = insert_entry(
        &database,
        &host,
        include_subdomains.unwrap_or(true),
        note.as_deref(),
        sanitize_source(source.as_deref()),
    )?
    .ok_or_else(|| format!("{host} 已在封杀名单中"))?;
    reload(&app)?;
    notify_changed(&app);
    Ok(entry)
}

#[tauri::command]
pub fn site_blacklist_add_many(
    app: AppHandle,
    input: String,
) -> Result<SiteBlacklistImportResult, String> {
    let database = local_store::connection(&app)?;
    let mut result = SiteBlacklistImportResult {
        added: Vec::new(),
        duplicates: Vec::new(),
        invalid: Vec::new(),
    };
    for raw in input.split(['\n', '\r', ',', ';', '，', '；']) {
        let candidate = raw.trim();
        if candidate.is_empty() {
            continue;
        }
        let host = match normalize_host_input(candidate) {
            Ok(host) => host,
            Err(reason) => {
                result.invalid.push(SiteBlacklistInvalidInput {
                    input: candidate.to_string(),
                    reason,
                });
                continue;
            }
        };
        if find_by_host(&database, &host)?.is_some()
            || result.duplicates.iter().any(|value| value == &host)
        {
            result.duplicates.push(host);
            continue;
        }
        match insert_entry(&database, &host, true, None, "import")? {
            Some(entry) => result.added.push(entry),
            None => result.duplicates.push(host),
        }
    }
    if !result.added.is_empty() {
        reload(&app)?;
        notify_changed(&app);
    }
    Ok(result)
}

#[tauri::command]
pub fn site_blacklist_remove(app: AppHandle, id: String) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute("DELETE FROM site_blacklist WHERE id = ?1", params![id])
        .map_err(|error| error.to_string())?;
    reload(&app)?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn site_blacklist_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute(
            "UPDATE site_blacklist SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![enabled as i64, now_seconds(), id],
        )
        .map_err(|error| error.to_string())?;
    reload(&app)?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn site_blacklist_set_scope(
    app: AppHandle,
    id: String,
    include_subdomains: bool,
) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute(
            "UPDATE site_blacklist
             SET include_subdomains = ?1, updated_at = ?2
             WHERE id = ?3",
            params![include_subdomains as i64, now_seconds(), id],
        )
        .map_err(|error| error.to_string())?;
    reload(&app)?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn site_blacklist_clear(app: AppHandle) -> Result<usize, String> {
    let database = local_store::connection(&app)?;
    let deleted = database
        .execute("DELETE FROM site_blacklist", [])
        .map_err(|error| error.to_string())?;
    database
        .execute("DELETE FROM site_blacklist_events", [])
        .map_err(|error| error.to_string())?;
    reload(&app)?;
    notify_changed(&app);
    Ok(deleted)
}

#[tauri::command]
pub fn site_blacklist_get_settings(app: AppHandle) -> Result<SiteBlacklistSettings, String> {
    let database = local_store::connection(&app)?;
    read_settings(&database)
}

#[tauri::command]
pub fn site_blacklist_set_settings(
    app: AppHandle,
    enabled: bool,
    block_subresources: bool,
) -> Result<(), String> {
    let database = local_store::connection(&app)?;
    database
        .execute(
            "INSERT INTO site_blacklist_settings(id, enabled, block_subresources, updated_at)
             VALUES(1, ?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
                 enabled = excluded.enabled,
                 block_subresources = excluded.block_subresources,
                 updated_at = excluded.updated_at",
            params![enabled as i64, block_subresources as i64, now_seconds()],
        )
        .map_err(|error| error.to_string())?;
    reload(&app)?;
    notify_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn site_blacklist_check(app: AppHandle, url: String) -> Result<Option<SiteMatch>, String> {
    let _ = app;
    Ok(match_url(&url))
}

#[tauri::command]
pub fn site_blacklist_events(
    app: AppHandle,
    limit: Option<i64>,
) -> Result<Vec<SiteBlacklistEvent>, String> {
    let database = local_store::connection(&app)?;
    let mut statement = database
        .prepare(
            "SELECT id, host, rule_host, url, tab_label, blocked_at
             FROM site_blacklist_events ORDER BY blocked_at DESC LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![limit.unwrap_or(20).clamp(1, 500)], |row| {
            Ok(SiteBlacklistEvent {
                id: row.get(0)?,
                host: row.get(1)?,
                rule_host: row.get(2)?,
                url: row.get(3)?,
                tab_label: row.get(4)?,
                blocked_at: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn site_blacklist_summary(app: AppHandle) -> Result<SiteBlacklistSummary, String> {
    let database = local_store::connection(&app)?;
    database
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(enabled), 0), COALESCE(SUM(hit_count), 0), MAX(last_blocked_at)
             FROM site_blacklist",
            [],
            |row| {
                Ok(SiteBlacklistSummary {
                    total: row.get(0)?,
                    enabled: row.get(1)?,
                    hit_total: row.get(2)?,
                    last_blocked_at: row.get(3)?,
                })
            },
        )
        .map_err(|error| error.to_string())
}

fn notify_changed<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(
        SITE_BLACKLIST_CHANGED_EVENT,
        serde_json::json!({ "version": 1 }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(enabled: bool, block_subresources: bool) -> SiteBlacklistSettings {
        SiteBlacklistSettings {
            enabled,
            block_subresources,
            updated_at: 0,
        }
    }

    fn entry(host: &str, include_subdomains: bool) -> SiteBlacklistEntry {
        SiteBlacklistEntry {
            id: format!("id-{host}"),
            host: host.into(),
            include_subdomains,
            enabled: true,
            note: None,
            source: "manual".into(),
            hit_count: 0,
            last_blocked_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn normalizes_bare_domains_and_urls() {
        assert_eq!(normalize_host_input("example.com").unwrap(), "example.com");
        assert_eq!(
            normalize_host_input("https://Example.COM/path?q=1#frag").unwrap(),
            "example.com"
        );
        assert_eq!(
            normalize_host_input("  www.example.com  ").unwrap(),
            "example.com"
        );
        assert_eq!(
            normalize_host_input("http://news.example.com:8080/a").unwrap(),
            "news.example.com"
        );
        assert_eq!(
            normalize_host_input("*.example.com").unwrap(),
            "example.com"
        );
        assert_eq!(
            normalize_host_input("例子.测试").unwrap(),
            "xn--fsqu00a.xn--0zwm56d"
        );
        assert_eq!(normalize_host_input("127.0.0.1").unwrap(), "127.0.0.1");
    }

    #[test]
    fn rejects_invalid_or_dangerous_inputs() {
        for input in [
            "",
            "   ",
            "com",
            "co.uk",
            "http://",
            "ftp://example.com",
            "javascript:alert(1)",
            "user:pass@example.com",
            "not a host",
            "localhost",
            "-bad.example.com",
        ] {
            assert!(
                normalize_host_input(input).is_err(),
                "`{input}` should be rejected"
            );
        }
    }

    #[test]
    fn matches_exact_and_subdomains() {
        let rules = SiteRules::build(
            settings(true, true),
            vec![entry("example.com", true), entry("news.example.com", false)],
        );
        assert_eq!(
            rules.match_url("https://example.com/a").unwrap().rule_host,
            "example.com"
        );
        assert_eq!(
            rules
                .match_url("https://deep.sub.example.com/")
                .unwrap()
                .rule_host,
            "example.com"
        );
        // More specific rule wins for its own host.
        assert_eq!(
            rules
                .match_url("https://news.example.com/x")
                .unwrap()
                .rule_host,
            "news.example.com"
        );
        // Subdomains are off for news.example.com, but the broader
        // example.com rule still covers its children.
        assert_eq!(
            rules
                .match_url("https://a.news.example.com/x")
                .unwrap()
                .rule_host,
            "example.com"
        );
        let narrow = SiteRules::build(settings(true, true), vec![entry("news.example.com", false)]);
        assert!(narrow.match_url("https://a.news.example.com/x").is_none());
        assert!(rules.match_url("https://example.org/").is_none());
        // Suffix boundary: notexample.com must not match example.com.
        assert!(rules.match_url("https://notexample.com/").is_none());
    }

    #[test]
    fn global_switch_disables_every_match() {
        let rules = SiteRules::build(settings(false, true), vec![entry("example.com", true)]);
        assert!(rules.match_url("https://example.com/").is_none());
        assert!(!rules.blocks_subresources());
    }

    #[test]
    fn subresource_switch_is_independent_of_match() {
        let rules = SiteRules::build(settings(true, false), vec![entry("example.com", true)]);
        assert!(rules.match_url("https://example.com/").is_some());
        assert!(!rules.blocks_subresources());
    }

    #[test]
    fn non_http_urls_never_match() {
        let rules = SiteRules::build(settings(true, true), vec![entry("example.com", true)]);
        assert!(rules.match_url("data:text/html,example.com").is_none());
        assert!(rules.match_url("about:blank").is_none());
        assert!(rules.match_url("not a url").is_none());
    }

    #[test]
    fn exact_only_scope_does_not_cover_children() {
        let rules = SiteRules::build(settings(true, true), vec![entry("example.com", false)]);
        assert!(rules.match_url("https://example.com/").is_some());
        assert!(rules.match_url("https://www.example.com/").is_none());
        assert!(rules.match_url("https://a.example.com/").is_none());
    }

    #[test]
    fn fast_host_handles_authority_forms() {
        assert_eq!(
            fast_url_host("https://Example.COM:8443/a"),
            Some("Example.COM")
        );
        assert_eq!(
            fast_url_host("http://user:pass@a.example.com/x"),
            Some("a.example.com")
        );
        assert_eq!(fast_url_host("https://[::1]:8080/"), Some("[::1]"));
        assert_eq!(
            fast_url_host("HTTPS://a.example.com"),
            Some("a.example.com")
        );
        assert_eq!(
            fast_url_host("wss://socket.example.com/ws"),
            Some("socket.example.com")
        );
        assert_eq!(fast_url_host("ws://a.example.com"), Some("a.example.com"));
        assert_eq!(fast_url_host("ftp://a.example.com"), None);
        assert_eq!(fast_url_host("https:///nohost"), None);
    }

    #[test]
    fn ip_hosts_only_match_exactly() {
        let rules = SiteRules::build(
            settings(true, true),
            vec![entry("0.0.1", true), entry("127.0.0.1", false)],
        );
        assert!(rules.match_url("http://127.0.0.1:8080/").is_some());
        // 10.0.0.1 ends with "0.0.1" but must not inherit its suffix rule.
        assert!(rules.match_url("http://10.0.0.1/").is_none());
    }

    #[test]
    fn indexed_lookup_scales_without_linear_scan() {
        // 2,000 unrelated rules must not change the result for a matched host.
        let mut entries: Vec<SiteBlacklistEntry> = (0..2_000)
            .map(|index| entry(&format!("spam{index}.example.net"), true))
            .collect();
        entries.push(entry("example.com", true));
        let rules = SiteRules::build(settings(true, true), entries);
        assert_eq!(
            rules
                .match_url("https://deep.a.example.com/x")
                .unwrap()
                .rule_host,
            "example.com"
        );
        assert!(rules.match_url("https://unrelated.org/").is_none());
    }

    #[test]
    fn disabled_entries_do_not_match() {
        let mut disabled = entry("example.com", true);
        disabled.enabled = false;
        let rules = SiteRules::build(settings(true, true), vec![disabled]);
        assert!(rules.match_url("https://example.com/").is_none());
    }

    #[test]
    fn blocked_error_round_trips_host_and_rule() {
        let found = SiteMatch {
            host: "a.example.com".into(),
            rule_host: "example.com".into(),
            entry_id: "id-1".into(),
        };
        assert_eq!(
            blocked_error(&found),
            "site-blocked:a.example.com|example.com|id-1"
        );
    }

    #[test]
    fn storage_round_trip_and_duplicate_detection() {
        let mut database = Connection::open_in_memory().unwrap();
        crate::local_store::run_migrations(&mut database).unwrap();

        let inserted = insert_entry(&database, "example.com", true, Some("测试"), "manual")
            .unwrap()
            .expect("first insert");
        assert!(insert_entry(&database, "example.com", true, None, "manual")
            .unwrap()
            .is_none());

        let entries = read_entries(&database, None).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].host, "example.com");
        assert!(entries[0].include_subdomains);

        database
            .execute(
                "UPDATE site_blacklist SET hit_count = 3, last_blocked_at = 42 WHERE id = ?1",
                params![inserted.id],
            )
            .unwrap();
        let summary = database
            .query_row(
                "SELECT COUNT(*), SUM(enabled), SUM(hit_count), MAX(last_blocked_at) FROM site_blacklist",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(summary, (1, 1, 3, 42));

        database
            .execute(
                "DELETE FROM site_blacklist WHERE id = ?1",
                params![inserted.id],
            )
            .unwrap();
        assert!(read_entries(&database, None).unwrap().is_empty());
    }

    #[test]
    fn settings_default_to_enabled_and_seeded() {
        let mut database = Connection::open_in_memory().unwrap();
        crate::local_store::run_migrations(&mut database).unwrap();
        let settings = read_settings(&database).unwrap();
        assert!(settings.enabled);
        assert!(settings.block_subresources);
    }
}

//! Page engine abstraction.
//!
//! Browser tabs are reached through [`PageEngine`] instead of through Tauri's
//! `Webview` API. Commands, session restore and the agent layer only speak
//! `label` + page operations, so the hosting layer can be swapped for a second
//! implementation (CEF) without touching business code.
//!
//! The only concrete implementation today is [`wry::WryPageEngine`], which wraps
//! the platform WebView that Tauri already manages (WebView2 on Windows,
//! WKWebView on macOS, WebKitGTK on Linux).
//!
//! Boundary rules for this module:
//!
//! - No caller outside `engine` may hold a `tauri::Webview`. Platform modules
//!   that must touch native COM handlers use
//!   [`PageEngine::with_platform_webview`], the single documented escape hatch.
//! - Engines are addressed by tab label only. Labels are validated by the
//!   caller (`validate_browser_label`) before they reach this layer.
//! - Operations keep the error strings the frontend already matches on, so a
//!   future engine swap does not change the user-visible contract.

use std::sync::Arc;

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};
use url::Url;

pub mod wry;

pub use wry::WryPageEngine;

/// Errors surfaced by a page engine.
///
/// `Display` is the contract: these strings travel to the frontend unchanged,
/// so new variants must not reword the existing ones.
#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    /// The label no longer maps to a live page (closed tab, failed create).
    #[error("browser tab webview not found")]
    NotFound,
    /// A page script did not answer within the engine's callback budget.
    #[error("page script timed out")]
    Timeout,
    /// The current engine cannot express the operation (CEF/WKWebView gaps).
    #[error("page engine does not support this operation")]
    Unsupported,
    /// Implementation-specific failure, already rendered for the frontend.
    #[error("{0}")]
    Message(String),
}

impl EngineError {
    pub fn msg(value: impl Into<String>) -> Self {
        Self::Message(value.into())
    }
}

impl From<String> for EngineError {
    fn from(value: String) -> Self {
        Self::Message(value)
    }
}

impl From<&str> for EngineError {
    fn from(value: &str) -> Self {
        Self::Message(value.to_string())
    }
}

impl From<tauri::Error> for EngineError {
    fn from(value: tauri::Error) -> Self {
        Self::Message(value.to_string())
    }
}

/// Tauri commands return `Result<_, String>`; this keeps `?` working without a
/// `map_err` on every page call.
impl From<EngineError> for String {
    fn from(value: EngineError) -> Self {
        value.to_string()
    }
}

pub type Result<T, E = EngineError> = std::result::Result<T, E>;

/// Logical (CSS pixel) rectangle a page occupies inside its host window.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Region for a clipped screenshot, in page coordinates.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureClip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What to capture: the viewport, the whole document, or an explicit region.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub full_page: bool,
    pub clip: Option<CaptureClip>,
}

/// Page lifecycle facts the engine reports back to the application.
///
/// The engine never touches SQLite, events or plugins itself: it forwards what
/// the platform told it and the application decides what it means. Callbacks are
/// synchronous and must not block; implementations spawn their own work.
pub trait PageObserver: Send + Sync {
    /// The current document finished loading and has a title.
    fn page_loaded(&self, label: &str, url: &str, title: &str);
    /// The page asked for a new window (`target=_blank`, `window.open`).
    fn new_window(&self, opener_label: &str, url: &str, private: bool);
    /// Returns `true` to let the download proceed, `false` to veto it.
    fn download_requested(&self, label: &str, url: &str, destination: &str, file_name: &str) -> bool;
    /// A download reached a terminal state.
    fn download_finished(&self, label: &str, url: &str, path: Option<&str>, success: bool);
}

/// Everything needed to open one tab.
///
/// Page-injection scripts are supplied by the caller as plain strings so this
/// module stays free of product policy: the application owns what runs inside a
/// page, the engine only knows where to put it.
pub struct PageSpec {
    pub label: String,
    pub url: Url,
    pub bounds: PageBounds,
    pub private: bool,
    pub permissions: Vec<crate::SitePermissionRule>,
    pub init_scripts: Vec<String>,
    pub observer: Arc<dyn PageObserver>,
}

/// The tab-hosting engine used by this process.
///
/// Deliberately object safe: one `Arc<dyn PageEngine>` is shared through Tauri
/// state, and a `feature` flag can pick the implementation at startup.
#[async_trait]
pub trait PageEngine: Send + Sync {
    /// Create (or no-op if it already exists) the page for `spec.label`.
    fn create(&self, spec: PageSpec) -> Result<()>;

    /// Whether a live page is registered for `label`.
    fn exists(&self, label: &str) -> bool;

    /// Run `script` in the page; errors when the document cannot be scripted
    /// (built-in PDF viewer, crashed renderer).
    fn eval(&self, label: &str, script: &str) -> Result<()>;

    /// Run `script` and return its JSON-serialized result.
    async fn eval_value(&self, label: &str, script: &str) -> Result<serde_json::Value>;

    /// Navigate the page. The caller has already validated the scheme.
    fn navigate(&self, label: &str, url: &Url) -> Result<()>;

    /// Reload the current document.
    fn reload(&self, label: &str) -> Result<()>;

    /// Stop loading the current document.
    fn stop(&self, label: &str) -> Result<()>;

    /// Current page URL (may differ from the address bar after redirects).
    fn url(&self, label: &str) -> Result<Url>;

    /// Position and size the page inside its host window.
    fn set_bounds(&self, label: &str, bounds: PageBounds) -> Result<()>;

    /// Current size in physical pixels.
    fn size(&self, label: &str) -> Result<(u32, u32)>;

    /// Resize in physical pixels.
    fn set_physical_size(&self, label: &str, width: u32, height: u32) -> Result<()>;

    /// Show or hide the page without tearing it down.
    fn set_visible(&self, label: &str, visible: bool) -> Result<()>;

    /// Give the page keyboard focus.
    fn focus(&self, label: &str) -> Result<()>;

    /// Set page zoom. `scale` is 1.0 for 100%.
    fn set_zoom(&self, label: &str, scale: f64) -> Result<()>;

    /// Ask the page to print (the platform shows its print/PDF UI).
    fn print(&self, label: &str) -> Result<()>;

    /// Open the engine's developer tools for this page.
    fn open_devtools(&self, label: &str) -> Result<()>;

    /// Capture a PNG and return it base64 encoded.
    async fn capture(&self, label: &str, request: CaptureRequest) -> Result<String>;

    /// Remove cookies, caches and origin-bound storage for the page.
    async fn clear_site_data(&self, label: &str) -> Result<()>;

    /// Tear the page down.
    fn close(&self, label: &str) -> Result<()>;

    /// Native escape hatch for platform modules that must install engine-level
    /// handlers (certificate errors, permissions, request filtering, process
    /// failure, suspension). This is the *only* way code outside `engine`
    /// obtains a platform WebView handle, and a future engine is expected to
    /// replace these handlers with its own native callbacks rather than
    /// implement this method.
    #[cfg(target_os = "windows")]
    fn with_platform_webview(
        &self,
        label: &str,
        f: Box<dyn FnOnce(tauri::webview::PlatformWebview) + Send>,
    ) -> Result<()>;
}

/// Tauri-managed holder for the active engine.
pub struct PageEngineState(pub Arc<dyn PageEngine>);

impl PageEngineState {
    pub fn new(engine: Arc<dyn PageEngine>) -> Self {
        Self(engine)
    }
}

/// Resolve the process-wide engine.
///
/// Cloning an `Arc` per call keeps command bodies free of `State` lifetimes,
/// which matters because most of them hold the engine across `.await`.
pub fn page_engine<R: Runtime>(app: &AppHandle<R>) -> Arc<dyn PageEngine> {
    app.state::<PageEngineState>().0.clone()
}

/// Convenience bridge for platform modules that must install native handlers.
///
/// Wraps [`PageEngine::with_platform_webview`] so call sites keep the
/// `app.get_webview(label)`-free shape they had with `with_webview`, without
/// each module boxing its own closure.
#[cfg(target_os = "windows")]
pub fn with_platform_webview<R: Runtime, F>(app: &AppHandle<R>, label: &str, f: F) -> Result<()>
where
    F: FnOnce(tauri::webview::PlatformWebview) + Send + 'static,
{
    page_engine(app).with_platform_webview(label, Box::new(f))
}

/// Evaluate `script` and deserialize its JSON result.
///
/// Kept as a free function (not a trait method) because trait objects cannot
/// carry generic methods.
pub async fn eval_json<T: DeserializeOwned>(
    engine: &dyn PageEngine,
    label: &str,
    script: &str,
) -> Result<T> {
    let value = engine.eval_value(label, script).await?;
    serde_json::from_value(value)
        .map_err(|error| EngineError::Message(format!("invalid page response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_errors_keep_frontend_visible_wording() {
        assert_eq!(EngineError::NotFound.to_string(), "browser tab webview not found");
        assert_eq!(EngineError::Timeout.to_string(), "page script timed out");
        assert_eq!(
            String::from(EngineError::msg("boom")),
            "boom",
            "EngineError must convert into the command error string unchanged"
        );
    }

    #[test]
    fn bounds_deserialize_from_the_frontend_contract() {
        let bounds: PageBounds =
            serde_json::from_str(r#"{"x":1.5,"y":0,"width":800,"height":600}"#).unwrap();
        assert_eq!(bounds.width, 800.0);
        assert_eq!(bounds.x, 1.5);
    }
}

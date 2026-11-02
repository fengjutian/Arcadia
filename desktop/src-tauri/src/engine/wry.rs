//! `PageEngine` on top of Tauri's platform WebView (wry).
//!
//! This module owns every call into `tauri::Webview` for browser tabs. Nothing
//! else in the crate may resolve a tab webview directly: business code goes
//! through the [`PageEngine`] trait, and native platform modules use
//! [`PageEngine::with_platform_webview`].
//!
//! Swapping in CEF means adding a sibling module that implements the same trait
//! and picking it at startup; this file is the only thing that would be retired.

use std::time::Duration;

use async_trait::async_trait;
use tauri::webview::{
    DownloadEvent, NewWindowResponse, PageLoadEvent, Webview, WebviewBuilder, WebviewUrl,
};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalSize};
use url::Url;

use super::{CaptureRequest, EngineError, PageBounds, PageEngine, PageSpec, Result};

/// Budget for a page script that must answer before the command returns.
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

/// Tauri/WebView implementation of [`PageEngine`].
pub struct WryPageEngine {
    app: AppHandle,
}

impl WryPageEngine {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    /// Resolve the live tab webview. The only `get_webview` in the crate.
    fn view(&self, label: &str) -> Result<Webview> {
        self.app.get_webview(label).ok_or(EngineError::NotFound)
    }
}

/// Run a script in a page and parse its JSON result.
///
/// Free function so it can also be awaited from `on_page_load`, where the
/// engine itself is not reachable.
async fn eval_webview_json(
    webview: Webview,
    script: &str,
    timeout: Duration,
) -> Result<serde_json::Value> {
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    webview
        .eval_with_callback(script, move |result| {
            let _ = sender.send(result);
        })
        .map_err(|error| EngineError::Message(error.to_string()))?;
    // Never block the WebView UI thread waiting for its own callback.
    let raw = tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(timeout))
        .await
        .map_err(|error| EngineError::Message(error.to_string()))?
        .map_err(|_| EngineError::Timeout)?;
    serde_json::from_str(&raw)
        .map_err(|error| EngineError::Message(format!("invalid page response: {error}")))
}

#[async_trait]
impl PageEngine for WryPageEngine {
    fn create(&self, spec: PageSpec) -> Result<()> {
        let PageSpec {
            label,
            url,
            bounds,
            private,
            permissions,
            init_scripts,
            observer,
        } = spec;
        if self.app.get_webview(&label).is_some() {
            return Ok(());
        }

        let page_label = label.clone();
        let page_observer = observer.clone();
        let opener_label = label.clone();
        let new_window_observer = observer.clone();
        let download_label = label.clone();
        let download_observer = observer;

        // WebView2's native InPrivate controller is not available on every
        // runtime used by child WebViews. Give private tabs a dedicated
        // ephemeral profile instead: it provides the same storage separation
        // without depending on that controller API, and the directory is
        // removed when the tab closes.
        let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url));
        if private {
            builder = builder
                .data_directory(std::env::temp_dir().join("arcadia-private-webviews").join(&label));
        }
        for script in &init_scripts {
            builder = builder.initialization_script(script.as_str());
        }
        let builder = builder
            .on_page_load(move |webview, payload| {
                if payload.event() != PageLoadEvent::Finished {
                    return;
                }
                let label = page_label.clone();
                let observer = page_observer.clone();
                let url = payload.url().to_string();
                tauri::async_runtime::spawn(async move {
                    // Best-effort title; a page that blocks script execution
                    // just yields an empty title rather than dropping the event.
                    let title = eval_webview_json(webview, "document.title", SCRIPT_TIMEOUT)
                        .await
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    observer.page_loaded(&label, &url, &title);
                });
            })
            .on_new_window(move |url, _features| {
                if matches!(url.scheme(), "http" | "https") {
                    new_window_observer.new_window(&opener_label, url.as_str(), private);
                }
                NewWindowResponse::Deny
            })
            .on_download(move |_webview, event| match event {
                DownloadEvent::Requested { url, destination } => {
                    let url = url.to_string();
                    let destination = destination.to_string_lossy().into_owned();
                    let file_name = std::path::Path::new(&destination)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("download")
                        .to_string();
                    download_observer.download_requested(&download_label, &url, &destination, &file_name)
                }
                DownloadEvent::Finished { url, path, success } => {
                    let url = url.to_string();
                    let path = path.map(|value| value.to_string_lossy().into_owned());
                    download_observer.download_finished(
                        &download_label,
                        &url,
                        path.as_deref(),
                        success,
                    );
                    true
                }
                _ => true,
            });

        // This app hosts tabs as child WebViews of one native Window, not as
        // separate WebviewWindows, so resolve that window instead of the
        // (empty) webview-window registry.
        let window = self
            .app
            .windows()
            .into_values()
            .next()
            .ok_or_else(|| EngineError::msg("browser window not found"))?;
        window.add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )?;

        // Engine-level handlers. A CEF implementation installs the equivalents
        // through its own CefClient handlers instead.
        crate::certificate_guard::attach_certificate_guard(&self.app, &label);
        crate::privacy::attach_navigation_guard(&self.app, &label);
        crate::permission_guard::attach_permission_guard(&self.app, &label, permissions, private);
        crate::webview_process_guard::attach_process_guard(&self.app, &label);
        let _ = crate::privacy::platform::attach_from_runtime(&self.app, &label, private);
        Ok(())
    }

    fn exists(&self, label: &str) -> bool {
        self.app.get_webview(label).is_some()
    }

    fn eval(&self, label: &str, script: &str) -> Result<()> {
        self.view(label)?
            .eval(script)
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    async fn eval_value(&self, label: &str, script: &str) -> Result<serde_json::Value> {
        eval_webview_json(self.view(label)?, script, SCRIPT_TIMEOUT).await
    }

    fn navigate(&self, label: &str, url: &Url) -> Result<()> {
        self.view(label)?
            .navigate(url.clone())
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn reload(&self, label: &str) -> Result<()> {
        self.view(label)?
            .reload()
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn stop(&self, label: &str) -> Result<()> {
        self.eval(label, "window.stop()")
    }

    fn url(&self, label: &str) -> Result<Url> {
        self.view(label)?
            .url()
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn set_bounds(&self, label: &str, bounds: PageBounds) -> Result<()> {
        let view = self.view(label)?;
        view.set_position(LogicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| EngineError::Message(error.to_string()))?;
        view.set_size(LogicalSize::new(
            bounds.width.max(1.0),
            bounds.height.max(1.0),
        ))
        .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn size(&self, label: &str) -> Result<(u32, u32)> {
        self.view(label)?
            .size()
            .map(|size| (size.width, size.height))
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn set_physical_size(&self, label: &str, width: u32, height: u32) -> Result<()> {
        self.view(label)?
            .set_size(PhysicalSize::new(width.max(1), height.max(1)))
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn set_visible(&self, label: &str, visible: bool) -> Result<()> {
        let view = self.view(label)?;
        if visible {
            view.show()
        } else {
            view.hide()
        }
        .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn focus(&self, label: &str) -> Result<()> {
        self.view(label)?
            .set_focus()
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn set_zoom(&self, label: &str, scale: f64) -> Result<()> {
        // WebView2 exposes a zoom controller, but macOS/Linux do not, so the
        // contract stays engine-neutral: page zoom is applied to the document.
        self.eval(
            label,
            &format!("document.documentElement.style.zoom={scale}"),
        )
    }

    fn print(&self, label: &str) -> Result<()> {
        self.eval(label, "window.print()")
    }

    fn open_devtools(&self, label: &str) -> Result<()> {
        self.view(label)?.open_devtools();
        Ok(())
    }

    async fn capture(&self, label: &str, request: CaptureRequest) -> Result<String> {
        let view = self.view(label)?;
        #[cfg(target_os = "windows")]
        {
            capture_windows(view, request).await
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (view, request);
            Err(EngineError::msg(
                "native screenshot is currently available on Windows/WebView2",
            ))
        }
    }

    async fn clear_site_data(&self, label: &str) -> Result<()> {
        let view = self.view(label)?;
        #[cfg(target_os = "windows")]
        clear_webview_profile_data(&view).await?;
        // Clear origin-bound DOM databases as well. The native profile call
        // above removes HTTP-only cookies and disk/cache storage that
        // JavaScript cannot see.
        view.eval(
            "(()=>{try{localStorage.clear()}catch{}try{sessionStorage.clear()}catch{}try{caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k))))}catch{}try{indexedDB.databases?.().then(dbs=>dbs.forEach(db=>db.name&&indexedDB.deleteDatabase(db.name)))}catch{}})()",
        )
        .map_err(|error| EngineError::Message(error.to_string()))
    }

    fn close(&self, label: &str) -> Result<()> {
        self.view(label)?
            .close()
            .map_err(|error| EngineError::Message(error.to_string()))
    }

    #[cfg(target_os = "windows")]
    fn with_platform_webview(
        &self,
        label: &str,
        f: Box<dyn FnOnce(tauri::webview::PlatformWebview) + Send>,
    ) -> Result<()> {
        self.view(label)?
            .with_webview(move |platform| f(platform))
            .map_err(|error| EngineError::Message(error.to_string()))
    }
}

/// Clear cookies and caches through the WebView2 profile API.
#[cfg(target_os = "windows")]
async fn clear_webview_profile_data(view: &Webview) -> Result<()> {
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS,
    };
    use windows::core::Interface;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(sender)));
    view.with_webview(move |platform| {
        let callback_sender = sender.clone();
        let result: std::result::Result<(), String> = (|| {
            let core = unsafe { platform.controller().CoreWebView2() }
                .map_err(|error| error.to_string())?;
            let core13 = core
                .cast::<ICoreWebView2_13>()
                .map_err(|error| error.to_string())?;
            let profile = unsafe { core13.Profile() }.map_err(|error| error.to_string())?;
            let profile2 = profile
                .cast::<ICoreWebView2Profile2>()
                .map_err(|error| error.to_string())?;
            let kinds = COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES
                | COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE
                | COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE
                | COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS;
            let callback = ClearBrowsingDataCompletedHandler::create(Box::new(move |status| {
                if let Ok(mut slot) = callback_sender.lock() {
                    if let Some(sender) = slot.take() {
                        let _ = sender.send(status.map_err(|error| error.to_string()));
                    }
                }
                Ok(())
            }));
            unsafe { profile2.ClearBrowsingData(kinds, &callback) }
                .map_err(|error| error.to_string())?;
            Ok(())
        })();
        if let Err(error) = result {
            if let Ok(mut slot) = sender.lock() {
                if let Some(sender) = slot.take() {
                    let _ = sender.send(Err(error));
                }
            }
        }
    })?;
    tokio::time::timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| EngineError::msg("清理 Cookie 与磁盘缓存超时"))?
        .map_err(|_| EngineError::msg("清理 Cookie 与磁盘缓存回调已取消"))?;
    Ok(())
}

/// Capture the page through the DevTools protocol (`Page.captureScreenshot`).
#[cfg(target_os = "windows")]
async fn capture_windows(view: Webview, request: CaptureRequest) -> Result<String> {
    use std::sync::mpsc;
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

    let (sender, receiver) = mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                let _ = sender.send(Err(error.to_string()));
                return;
            }
        };
        let callback_sender = sender.clone();
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
                let value = status.map(|_| result).map_err(|error| error.to_string());
                let _ = callback_sender.send(value);
                Ok(())
            }));
        let method = CoTaskMemPWSTR::from("Page.captureScreenshot");
        let params_value = if let Some(clip) = request.clip {
            serde_json::json!({"format":"png","fromSurface":true,"clip":{"x":clip.x.max(0.0),"y":clip.y.max(0.0),"width":clip.width.max(1.0),"height":clip.height.max(1.0),"scale":1}})
        } else {
            serde_json::json!({"format":"png","captureBeyondViewport":request.full_page,"fromSurface":true})
        };
        let params_json = params_value.to_string();
        let params = CoTaskMemPWSTR::from(params_json.as_str());
        let started = unsafe {
            core.CallDevToolsProtocolMethod(
                *method.as_ref().as_pcwstr(),
                *params.as_ref().as_pcwstr(),
                &handler,
            )
        };
        if let Err(error) = started {
            let _ = sender.send(Err(error.to_string()));
        }
    })?;
    // Never wait for the DevTools callback on WebView2's UI thread. Keeping
    // that thread free is required for the callback itself and for all other
    // browser/window buttons to remain responsive while capture is pending.
    let raw = tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(Duration::from_secs(30))
    })
    .await
    .map_err(|error| EngineError::Message(error.to_string()))?
    .map_err(|_| EngineError::msg("screenshot timed out"))??;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| EngineError::Message(error.to_string()))?;
    value
        .get("data")
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .ok_or_else(|| EngineError::msg("screenshot data missing"))
}

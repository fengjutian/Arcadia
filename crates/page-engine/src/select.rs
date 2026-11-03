//! Backend selection.
//!
//! The application ships one page engine per build. The CEF backend is opt-in at
//! compile time (`--features cef`) and Windows-only; everything else uses the
//! system WebView. Selection never fails the app: if CEF is compiled in but
//! cannot initialize (missing runtime files, sandbox denied, initialization
//! error), the process falls back to wry and records why, so the capability
//! surface can show it instead of leaving the user with a dead browser.
//!
//! Host callbacks travel with the selection: [`select`] hands the app's
//! [`PagePlatformHooks`] to whichever engine is built, so both backends install
//! the same native handlers at the same point in a page's lifecycle.

use std::sync::Arc;

use tauri::AppHandle;

use super::{EngineKind, PageEngine, PagePlatformHooks, WryPageEngine};

/// The engine a process is actually running, plus the reason for a downgrade.
pub struct Selection {
    pub kind: EngineKind,
    pub engine: Arc<dyn PageEngine>,
    /// `Some` when the preferred engine was unavailable and wry took over.
    pub fallback_reason: Option<String>,
}

/// Pick the best available backend for this process.
///
/// A CEF build is opt-in per launch (`ARCADIA_PAGE_ENGINE=cef`) until the engine
/// reaches parity: a partially implemented backend must never silently replace
/// a working browser.
pub fn select(app: &AppHandle, hooks: Arc<dyn PagePlatformHooks>) -> Selection {
    #[cfg(all(target_os = "windows", feature = "cef"))]
    {
        if !cef_requested() {
            return Selection {
                kind: EngineKind::Wry,
                engine: Arc::new(WryPageEngine::new(app.clone(), hooks)),
                fallback_reason: Some(
                    "CEF backend compiled in; set ARCADIA_PAGE_ENGINE=cef to use it".to_string(),
                ),
            };
        }
        match super::cef::try_create(app, hooks.clone()) {
            Ok(engine) => {
                return Selection {
                    kind: EngineKind::Cef,
                    engine,
                    fallback_reason: None,
                }
            }
            Err(error) => {
                eprintln!("[engine] CEF unavailable, falling back to wry: {error}");
                return Selection {
                    kind: EngineKind::Wry,
                    engine: Arc::new(WryPageEngine::new(app.clone(), hooks)),
                    fallback_reason: Some(error),
                };
            }
        }
    }

    #[cfg(not(all(target_os = "windows", feature = "cef")))]
    {
        let fallback_reason = if cfg!(feature = "cef") {
            Some("CEF backend is Windows-only".to_string())
        } else {
            None
        };
        Selection {
            kind: EngineKind::Wry,
            engine: Arc::new(WryPageEngine::new(app.clone(), hooks)),
            fallback_reason,
        }
    }
}

/// Whether this launch explicitly asked for the CEF backend.
#[cfg(all(target_os = "windows", feature = "cef"))]
fn cef_requested() -> bool {
    std::env::var("ARCADIA_PAGE_ENGINE")
        .map(|value| value.eq_ignore_ascii_case("cef"))
        .unwrap_or(false)
}

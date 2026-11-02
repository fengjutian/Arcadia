//! CEF backend (Windows, `--features cef`).
//!
//! Status: **scaffolding**. The build wiring is in place — the `cef` crate
//! links against the CEF binary distribution pointed to by `CEF_PATH` — but no
//! page is hosted yet, so [`try_create`] declines and
//! [`super::select::select`] falls back to wry.
//!
//! The trait surface to fill in is [`PageEngine`]; see
//! `docs/cef-windows-plan.md` for the handler mapping and the order of work.

use std::sync::Arc;

use tauri::AppHandle;

use super::PageEngine;

/// Why a CEF build would refuse to start right now.
const NOT_IMPLEMENTED: &str = "CEF backend is compiled in but not implemented yet";

/// Try to construct the CEF engine for this process.
///
/// Called once during Tauri setup. Returning `Err` is not fatal: the caller
/// downgrades to wry and surfaces the reason through `browser_capabilities`.
pub fn try_create(_app: &AppHandle) -> Result<Arc<dyn PageEngine>, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

/// CEF version baked into the build, for the capability panel.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

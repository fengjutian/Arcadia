//! Capability matrix probe. The values returned here are the source of truth
//! mirrored by `services/browserCapabilities.ts` on the frontend; the
//! `capability_flags_match_matrix_expectations` test pins the contract.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilities {
    /// True when granular byte-level download progress is observable.
    pub download_progress_bytes: bool,
    /// True when downloads can be paused/resumed through Tauri/WebView APIs.
    pub download_pause_resume: bool,
    /// True when in-flight downloads can be cancelled from the host.
    pub download_cancel: bool,
    /// True when a native permission-requested event is observable.
    pub native_permission_events: bool,
    /// True when a native context menu can be hooked to the webview.
    pub native_context_menu: bool,
    /// True when site data can be cleared through the host webview profile.
    pub clear_site_data: bool,
    /// True when TLS/certificate errors can be intercepted from code.
    pub certificate_error_interceptor: bool,
    /// Best-effort backend label for diagnostics ("webview2", "wkwebview", ...).
    pub webview_backend: Option<&'static str>,
    /// Version of the engine that will host child webviews, as reported by the
    /// platform. On Windows this is the installed WebView2 runtime, e.g.
    /// `"156.0.4314.58"`. `None` when the platform exposes no queryable runtime
    /// version (WKWebView / WebKitGTK ship with the OS and are not probed yet).
    pub webview_version: Option<String>,
    /// Chromium milestone parsed out of `webview_version` (`156`), so consumers
    /// can gate features without re-implementing the parse. `None` on backends
    /// that are not Chromium-based or that did not report a version.
    pub chromium_major: Option<u32>,
    /// Tauri crate version compiled into the binary (resolved from `Cargo.lock`
    /// by `build.rs`), not this crate's own version.
    pub tauri_runtime_version: Option<&'static str>,
}

#[tauri::command]
pub fn browser_capabilities() -> BrowserCapabilities {
    let webview_version = webview_runtime_version();
    let chromium_major = webview_version.as_deref().and_then(chromium_milestone);
    BrowserCapabilities {
        download_progress_bytes: true,
        download_pause_resume: false,
        download_cancel: true,
        native_permission_events: cfg!(target_os = "windows"),
        native_context_menu: false,
        clear_site_data: cfg!(target_os = "windows"),
        certificate_error_interceptor: cfg!(target_os = "windows"),
        webview_backend: Some(webview_backend_label()),
        webview_version,
        chromium_major,
        tauri_runtime_version: option_env!("ARCADIA_TAURI_VERSION"),
    }
}

/// Extracts the Chromium milestone from a WebView2 / Edge version string.
///
/// WebView2's first segment *is* the Chromium milestone (Edge and Chrome share
/// it); the trailing segments are Microsoft's own build numbers, which differ
/// from Chrome's for the same milestone.
fn chromium_milestone(version: &str) -> Option<u32> {
    version.split('.').next()?.trim().parse().ok()
}

/// Asks the WebView2 loader which runtime it would use.
///
/// This works before any webview exists, which is what makes it usable for
/// diagnostics on startup. The loader hands back a `CoTaskMemAlloc` string, so
/// ownership moves into `CoTaskMemPWSTR` and is released on drop.
#[cfg(target_os = "windows")]
fn webview_runtime_version() -> Option<String> {
    use webview2_com::{
        CoTaskMemPWSTR,
        Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString,
    };
    use windows::core::{PCWSTR, PWSTR};

    let mut raw = PWSTR::null();
    unsafe {
        // A null executable folder asks for the Evergreen runtime, which is the
        // one Tauri's child webviews use unless a fixed-version runtime is set.
        GetAvailableCoreWebView2BrowserVersionString(PCWSTR::null(), &mut raw).ok()?;
    }
    let version = CoTaskMemPWSTR::from(raw).to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

#[cfg(not(target_os = "windows"))]
fn webview_runtime_version() -> Option<String> {
    // WKWebView / WebKitGTK versions come from the OS and are not exposed
    // through an equivalent probe; reporting `None` beats reporting a guess.
    None
}

#[cfg(target_os = "windows")]
fn webview_backend_label() -> &'static str {
    "webview2"
}

#[cfg(target_os = "macos")]
fn webview_backend_label() -> &'static str {
    "wkwebview"
}

#[cfg(target_os = "linux")]
fn webview_backend_label() -> &'static str {
    "webkitgtk"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn webview_backend_label() -> &'static str {
    "unknown"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_flags_match_matrix_expectations() {
        let caps = browser_capabilities();
        assert!(
            caps.download_progress_bytes,
            "download progress is always observable"
        );
        assert!(
            !caps.download_pause_resume,
            "Tauri 2 stable does not expose native pause/resume"
        );
        assert!(
            caps.download_cancel,
            "on_download Requested return-false is wired"
        );
        assert_eq!(caps.native_permission_events, cfg!(target_os = "windows"));
        assert!(
            !caps.native_context_menu,
            "wry has no context-menu integration in stable"
        );
        assert_eq!(caps.clear_site_data, cfg!(target_os = "windows"));
        assert_eq!(
            caps.certificate_error_interceptor,
            cfg!(target_os = "windows")
        );
        assert!(
            caps.webview_backend.is_some(),
            "backend label must be set on every target"
        );
    }

    #[test]
    fn tauri_runtime_version_is_the_dependency_not_this_crate() {
        let caps = browser_capabilities();
        let version = caps
            .tauri_runtime_version
            .expect("build.rs must pin ARCADIA_TAURI_VERSION from Cargo.lock");
        assert_ne!(
            version,
            env!("CARGO_PKG_VERSION"),
            "tauri runtime version must come from the dependency graph, not this crate"
        );
        assert!(
            version.split('.').count() >= 2,
            "expected a semver-shaped Tauri version, got {version}"
        );
    }

    #[test]
    fn chromium_milestone_reads_the_leading_segment() {
        assert_eq!(chromium_milestone("156.0.4314.58"), Some(156));
        assert_eq!(chromium_milestone("109.0.1518.78"), Some(109));
        assert_eq!(chromium_milestone("120"), Some(120));
        assert_eq!(chromium_milestone(""), None);
        assert_eq!(chromium_milestone("unknown"), None);
        assert_eq!(chromium_milestone("..1"), None);
    }

    #[test]
    fn webview_version_is_probed_only_where_the_platform_reports_it() {
        let caps = browser_capabilities();
        if cfg!(target_os = "windows") {
            // WebView2 Runtime is a documented prerequisite on Windows
            // (README "环境要求"), so a missing probe result is a real defect.
            let version = caps
                .webview_version
                .as_deref()
                .expect("WebView2 runtime version must be readable on Windows");
            assert!(
                version.split('.').count() >= 2,
                "expected a dotted WebView2 version, got {version}"
            );
            assert_eq!(
                caps.chromium_major,
                chromium_milestone(version),
                "chromium_major must be derived from webview_version"
            );
        } else {
            assert!(caps.webview_version.is_none());
            assert!(caps.chromium_major.is_none());
        }
    }
}

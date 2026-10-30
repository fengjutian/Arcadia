//! Emits native WebView2 process failures to the React tab lifecycle.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const PROCESS_FAILED_EVENT: &str = "browser://process-failed";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFailedPayload {
    pub version: u8,
    pub tab_label: String,
    pub kind: String,
    pub fatal: bool,
}

#[cfg(target_os = "windows")]
mod windows_guard {
    use super::*;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::ProcessFailedEventHandler;

    fn describe(kind: COREWEBVIEW2_PROCESS_FAILED_KIND) -> (&'static str, bool) {
        if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
            ("browser-exited", true)
        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
            ("renderer-exited", true)
        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE {
            ("renderer-unresponsive", true)
        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED {
            ("frame-renderer-exited", true)
        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED {
            // WebView2 normally recreates the GPU process without losing the page.
            ("gpu-exited", false)
        } else {
            ("auxiliary-process-exited", false)
        }
    }

    pub fn attach<R: Runtime>(app: &AppHandle<R>, label: &str) {
        let Some(view) = app.get_webview(label) else { return };
        let event_app = app.clone();
        let event_label = label.to_string();
        let _ = view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else { return };
            let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw_kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                unsafe { args.ProcessFailedKind(&mut raw_kind) }?;
                let (kind, fatal) = describe(raw_kind);
                let _ = event_app.emit_to(
                    "main",
                    PROCESS_FAILED_EVENT,
                    ProcessFailedPayload {
                        version: 1,
                        tab_label: event_label.clone(),
                        kind: kind.to_string(),
                        fatal,
                    },
                );
                Ok(())
            }));
            let mut token = 0_i64;
            let _ = unsafe { core.add_ProcessFailed(&handler, &mut token) };
        });
    }
}

pub fn attach_process_guard<R: Runtime>(app: &AppHandle<R>, label: &str) {
    #[cfg(target_os = "windows")]
    windows_guard::attach(app, label);
    #[cfg(not(target_os = "windows"))]
    let _ = (app, label);
}


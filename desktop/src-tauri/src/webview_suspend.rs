//! Native WebView suspension with a cross-platform fallback contract.

use tauri::{AppHandle, Manager, Runtime};

fn validate_label(label: &str) -> Result<(), String> {
    if label.starts_with("browser-") && label.len() <= 160 {
        Ok(())
    } else {
        Err("invalid browser label".into())
    }
}

#[cfg(target_os = "windows")]
async fn suspend_windows<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<bool, String> {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use webview2_com::TrySuspendCompletedHandler;
    use windows::core::Interface;

    let view = app
        .get_webview(label)
        .ok_or_else(|| "browser tab webview not found".to_string())?;
    let (sender, receiver) = tokio::sync::oneshot::channel::<bool>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let setup_sender = sender.clone();
    view.with_webview(move |platform| {
        let result = unsafe { platform.controller().CoreWebView2() }
            .and_then(|core| core.cast::<ICoreWebView2_3>());
        let Ok(core3) = result else {
            if let Some(sender) = setup_sender.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(false);
            }
            return;
        };
        let callback_sender = setup_sender.clone();
        let handler = TrySuspendCompletedHandler::create(Box::new(move |_error, success| {
            if let Some(sender) = callback_sender.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(success);
            }
            Ok(())
        }));
        if unsafe { core3.TrySuspend(&handler) }.is_err() {
            if let Some(sender) = setup_sender.lock().ok().and_then(|mut value| value.take()) {
                let _ = sender.send(false);
            }
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(tokio::time::timeout(Duration::from_secs(3), receiver)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or(false))
}

#[tauri::command]
pub async fn browser_suspend(app: tauri::AppHandle, label: String) -> Result<bool, String> {
    validate_label(&label)?;
    #[cfg(target_os = "windows")]
    return suspend_windows(&app, &label).await;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub fn browser_resume(app: tauri::AppHandle, label: String) -> Result<bool, String> {
    validate_label(&label)?;
    #[cfg(target_os = "windows")]
    {
        use std::sync::{Arc, Mutex};
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows::core::Interface;

        let view = app
            .get_webview(&label)
            .ok_or_else(|| "browser tab webview not found".to_string())?;
        let result = Arc::new(Mutex::new(false));
        let output = result.clone();
        view.with_webview(move |platform| {
            let resumed = unsafe { platform.controller().CoreWebView2() }
                .and_then(|core| core.cast::<ICoreWebView2_3>())
                .and_then(|core| unsafe { core.Resume() })
                .is_ok();
            if let Ok(mut value) = output.lock() {
                *value = resumed;
            }
        })
        .map_err(|error| error.to_string())?;
        let resumed = result.lock().map(|value| *value).unwrap_or(false);
        Ok(resumed)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(false)
    }
}


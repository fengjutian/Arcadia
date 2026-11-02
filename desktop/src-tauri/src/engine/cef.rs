//! CEF backend (Windows, `--features cef`).
//!
//! Scope: the T1+T2 spike from `docs/cef-windows-plan.md` — process model,
//! `CefInitialize`, one child HWND per tab, navigation and geometry. Everything
//! else returns [`EngineError::Unsupported`], and the backend is only selected
//! when `ARCADIA_PAGE_ENGINE=cef` is set, so a partial CEF build never silently
//! replaces a working wry browser.
//!
//! Threading drives the shape of this module:
//!
//! - CEF runs its own UI thread (`multi_threaded_message_loop = 1`), so the
//!   winit main thread stays free and no message pump is needed.
//! - CEF objects are reference counted non-atomically and are not `Send`. They
//!   live in [`BROWSERS`], a thread-local on the CEF UI thread.
//! - Every operation therefore *posts* a task to the UI thread. The only state
//!   shared across threads is the plain-data [`Shared`] map (URLs, HWNDs).

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use cef::*;
use url::Url;

use super::{CaptureRequest, EngineError, PageBounds, PageEngine, PageSpec, Result};

/// State that is safe to touch from any thread.
#[derive(Default)]
struct Shared {
    /// Last known URL per tab, kept in sync by the display handler so `url()`
    /// stays synchronous like the wry implementation.
    urls: Mutex<HashMap<String, Url>>,
    /// Container HWND per tab, as `isize` so it can cross threads.
    windows: Mutex<HashMap<String, isize>>,
}

impl Shared {
    fn set_url(&self, label: &str, url: Url) {
        if let Ok(mut map) = self.urls.lock() {
            map.insert(label.to_string(), url);
        }
    }

    fn url(&self, label: &str) -> Option<Url> {
        self.urls.lock().ok().and_then(|m| m.get(label).cloned())
    }

    fn set_window(&self, label: &str, hwnd: isize) {
        if let Ok(mut map) = self.windows.lock() {
            map.insert(label.to_string(), hwnd);
        }
    }

    fn window(&self, label: &str) -> Option<isize> {
        self.windows.lock().ok().and_then(|m| m.get(label).copied())
    }

    fn forget(&self, label: &str) {
        if let Ok(mut map) = self.urls.lock() {
            map.remove(label);
        }
        if let Ok(mut map) = self.windows.lock() {
            map.remove(label);
        }
    }
}

thread_local! {
    /// Live browsers, owned by the CEF UI thread.
    static BROWSERS: RefCell<HashMap<String, cef::Browser>> = RefCell::new(HashMap::new());
}

// --- thread hop -----------------------------------------------------------

cef::wrap_task! {
    struct UiTask {
        run: Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>,
    }
    impl Task {
        fn execute(&self) {
            let callback = self.run.lock().ok().and_then(|mut slot| slot.take());
            if let Some(callback) = callback {
                callback();
            }
        }
    }
}

/// Run `f` on the CEF UI thread.
fn on_ui<F: FnOnce() + Send + 'static>(f: F) {
    let run: Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>> = Arc::new(Mutex::new(Some(Box::new(f))));
    let mut task = UiTask::new(run);
    cef::post_task(cef::ThreadId::UI, Some(&mut task));
}

// --- CEF application + client --------------------------------------------


cef::wrap_client! {
    struct ArcadiaClient {
        label: String,
        shared: Arc<Shared>,
        observer: Arc<dyn super::PageObserver>,
    }
    impl Client {
        fn life_span_handler(&self) -> Option<cef::LifeSpanHandler> {
            Some(ArcadiaLifeSpan::new(self.label.clone(), self.shared.clone()))
        }
        fn display_handler(&self) -> Option<cef::DisplayHandler> {
            Some(ArcadiaDisplay::new(
                self.label.clone(),
                self.shared.clone(),
                self.observer.clone(),
            ))
        }
        fn load_handler(&self) -> Option<cef::LoadHandler> {
            Some(ArcadiaLoad::new(
                self.label.clone(),
                self.shared.clone(),
                self.observer.clone(),
            ))
        }
    }
}

cef::wrap_life_span_handler! {
    struct ArcadiaLifeSpan {
        label: String,
        shared: Arc<Shared>,
    }
    impl LifeSpanHandler {
        fn on_after_created(&self, browser: Option<&mut cef::Browser>) {
            if let Some(browser) = browser {
                BROWSERS.with(|map| {
                    map.borrow_mut().insert(self.label.clone(), browser.clone());
                });
            }
        }
        fn on_before_close(&self, _browser: Option<&mut cef::Browser>) {
            BROWSERS.with(|map| {
                map.borrow_mut().remove(&self.label);
            });
            self.shared.forget(&self.label);
        }
    }
}

cef::wrap_display_handler! {
    struct ArcadiaDisplay {
        label: String,
        shared: Arc<Shared>,
        observer: Arc<dyn super::PageObserver>,
    }
    impl DisplayHandler {
        fn on_address_change(
            &self,
            _browser: Option<&mut cef::Browser>,
            _frame: Option<&mut cef::Frame>,
            url: Option<&cef::CefString>,
        ) {
            let raw = url.map(|u| u.to_string()).unwrap_or_default();
            if let Ok(parsed) = Url::parse(&raw) {
                self.shared.set_url(&self.label, parsed);
            }
        }
        fn on_title_change(
            &self,
            _browser: Option<&mut cef::Browser>,
            title: Option<&cef::CefString>,
        ) {
            let title = title.map(|t| t.to_string()).unwrap_or_default();
            let url = self
                .shared
                .url(&self.label)
                .map(|u| u.to_string())
                .unwrap_or_default();
            self.observer.page_loaded(&self.label, &url, &title);
        }
    }
}

cef::wrap_load_handler! {
    struct ArcadiaLoad {
        label: String,
        shared: Arc<Shared>,
        observer: Arc<dyn super::PageObserver>,
    }
    impl LoadHandler {
        fn on_load_end(
            &self,
            _browser: Option<&mut cef::Browser>,
            frame: Option<&mut cef::Frame>,
            _http_status_code: ::std::os::raw::c_int,
        ) {
            let Some(frame) = frame else { return };
            if frame.is_main() == 0 {
                return;
            }
            // `frame.url()` hands back an owned userfree CEF string, which the
            // wrapper does not convert to `String`; the address-change handler
            // already tracks the committed URL, so read it from there.
            let url = self
                .shared
                .url(&self.label)
                .map(|u| u.as_str().to_string())
                .unwrap_or_default();
            if let Ok(parsed) = Url::parse(&url) {
                self.shared.set_url(&self.label, parsed);
            }
            self.observer.page_loaded(&self.label, &url, "");
        }
    }
}

// --- engine ---------------------------------------------------------------

/// The CEF-backed [`PageEngine`].
pub struct CefPageEngine {
    shared: Arc<Shared>,
    /// Parent HWND of every tab container (the Tauri main window).
    parent: isize,
}

impl CefPageEngine {
    fn view(&self, label: &str) -> Result<isize> {
        self.shared.window(label).ok_or(EngineError::NotFound)
    }
}

#[async_trait::async_trait]
impl PageEngine for CefPageEngine {
    fn create(&self, spec: PageSpec) -> Result<()> {
        let PageSpec {
            label,
            url,
            bounds,
            observer,
            ..
        } = spec;

        let hwnd = create_container(&label, self.parent, bounds)?;
        self.shared.set_window(&label, hwnd);
        self.shared.set_url(&label, url.clone());

        let shared = self.shared.clone();
        let mut client = ArcadiaClient::new(label.clone(), shared, observer);
        let target = url.to_string();
        let width = bounds.width.round().max(1.0) as i32;
        let height = bounds.height.round().max(1.0) as i32;

        on_ui(move || {
            let window_info = cef::WindowInfo::default().set_as_child(
                window_handle(hwnd),
                &cef::Rect {
                    x: 0,
                    y: 0,
                    width,
                    height,
                },
            );
            let target = cef::CefString::from(target.as_str());
            let browser_settings = cef::BrowserSettings::default();
            cef::browser_host_create_browser(
                Some(&window_info),
                Some(&mut client),
                Some(&target),
                Some(&browser_settings),
                None,
                None,
            );
        });
        Ok(())
    }

    fn exists(&self, label: &str) -> bool {
        self.shared.window(label).is_some()
    }

    fn eval(&self, label: &str, script: &str) -> Result<()> {
        if !self.exists(label) {
            return Err(EngineError::NotFound);
        }
        let label = label.to_string();
        let script = script.to_string();
        on_ui(move || {
            let script = cef::CefString::from(script.as_str());
            with_main_frame(&label, |frame| {
                frame.execute_java_script(Some(&script), None, 0);
            });
        });
        Ok(())
    }

    async fn eval_value(&self, _label: &str, _script: &str) -> Result<serde_json::Value> {
        Err(EngineError::msg(
            "CEF eval_value needs the MessageRouter bridge (T4)",
        ))
    }

    fn navigate(&self, label: &str, url: &Url) -> Result<()> {
        if !self.exists(label) {
            return Err(EngineError::NotFound);
        }
        self.shared.set_url(label, url.clone());
        let label = label.to_string();
        let target = url.to_string();
        on_ui(move || {
            let target = cef::CefString::from(target.as_str());
            with_main_frame(&label, |frame| frame.load_url(Some(&target)));
        });
        Ok(())
    }

    fn reload(&self, label: &str) -> Result<()> {
        // The BrowserHost reload binding is not reachable through the wrapper
        // trait in this version; re-loading the tracked URL is equivalent for
        // the spike and costs one extra navigation.
        let current = self.url(label)?;
        self.navigate(label, &current)
    }

    fn stop(&self, label: &str) -> Result<()> {
        self.eval(label, "window.stop()")
    }

    fn url(&self, label: &str) -> Result<Url> {
        self.shared.url(label).ok_or(EngineError::NotFound)
    }

    fn set_bounds(&self, label: &str, bounds: PageBounds) -> Result<()> {
        let hwnd = self.view(label)?;
        platform::set_rect(
            hwnd,
            bounds.x.round() as i32,
            bounds.y.round() as i32,
            bounds.width.round().max(1.0) as i32,
            bounds.height.round().max(1.0) as i32,
        )
        .map_err(EngineError::Message)
    }

    fn size(&self, label: &str) -> Result<(u32, u32)> {
        let hwnd = self.view(label)?;
        platform::client_size(hwnd).map_err(EngineError::Message)
    }

    fn set_physical_size(&self, label: &str, width: u32, height: u32) -> Result<()> {
        let hwnd = self.view(label)?;
        platform::set_size(hwnd, width.max(1) as i32, height.max(1) as i32)
            .map_err(EngineError::Message)
    }

    fn set_visible(&self, label: &str, visible: bool) -> Result<()> {
        let hwnd = self.view(label)?;
        platform::show(hwnd, visible).map_err(EngineError::Message)
    }

    fn focus(&self, label: &str) -> Result<()> {
        let hwnd = self.view(label)?;
        platform::focus(hwnd).map_err(EngineError::Message)
    }

    fn set_zoom(&self, label: &str, scale: f64) -> Result<()> {
        self.eval(
            label,
            &format!("document.documentElement.style.zoom={scale}"),
        )
    }

    fn print(&self, label: &str) -> Result<()> {
        self.eval(label, "window.print()")
    }

    fn open_devtools(&self, _label: &str) -> Result<()> {
        Err(EngineError::Unsupported)
    }

    async fn capture(&self, _label: &str, _request: CaptureRequest) -> Result<String> {
        Err(EngineError::Unsupported)
    }

    async fn clear_site_data(&self, _label: &str) -> Result<()> {
        Err(EngineError::Unsupported)
    }

    fn close(&self, label: &str) -> Result<()> {
        let hwnd = self.view(label)?;
        let key = label.to_string();
        on_ui(move || {
            let browser = BROWSERS.with(|map| map.borrow_mut().remove(&key));
            if let Some(browser) = browser {
                if let Some(host) = browser.host() {
                    host.close_browser(1);
                }
            }
        });
        platform::destroy(hwnd);
        self.shared.forget(&label);
        Ok(())
    }

    fn with_platform_webview(
        &self,
        _label: &str,
        _f: Box<dyn FnOnce(tauri::webview::PlatformWebview) + Send>,
    ) -> Result<()> {
        // Platform modules are wry-only; a CEF build installs its own handlers.
        Err(EngineError::Unsupported)
    }
}

/// Run `f` on the main frame of the live browser for `label` (CEF UI thread).
fn with_main_frame(label: &str, f: impl FnOnce(&cef::Frame)) {
    BROWSERS.with(|map| {
        if let Some(browser) = map.borrow().get(label) {
            if let Some(frame) = browser.main_frame() {
                f(&frame);
            }
        }
    });
}

// --- process model --------------------------------------------------------

/// True when this process is a CEF subprocess (`--type=renderer` etc.).
///
/// Must run before any Tauri initialization.
pub fn run_subprocess_if_needed() -> bool {
    if !std::env::args().any(|arg| arg.starts_with("--type=")) {
        return false;
    }
    let args = cef::args::Args::new();
    cef::execute_process(Some(args.as_main_args()), None, std::ptr::null_mut());
    true
}

/// Initialize CEF. The error string is what the fallback reports.
pub fn initialize() -> std::result::Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("cannot resolve the executable path: {error}"))?;
    let exe = exe.to_string_lossy().to_string();

    let mut settings = cef::Settings::default();
    // v1 spike: sandbox off. Enabling it needs cef_sandbox.lib plus a
    // `sandbox_info` argument; tracked as a release blocker in the plan.
    settings.no_sandbox = 1;
    settings.multi_threaded_message_loop = 1;
    settings.browser_subprocess_path = cef::CefString::from(exe.as_str());
    // CEF warns when the cache root is left at the default: the default is
    // keyed by exe path and breaks per-user isolation on shared installs.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let cache = std::path::Path::new(&local).join("Arcadia").join("cef-cache");
        settings.root_cache_path = cef::CefString::from(cache.to_string_lossy().as_ref());
    }

    let args = cef::args::Args::new();
    let code = cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        None,
        std::ptr::null_mut(),
    );
    // CEF follows the C convention here: non-zero means success. The wrapper
    // returns the raw cef_initialize result, so 0 is the failure case.
    if code == 0 {
        return Err(format!("CefInitialize failed with code {code}"));
    }
    Ok(())
}

/// Build the CEF engine, or explain why it cannot run here.
pub fn try_create(app: &tauri::AppHandle) -> std::result::Result<Arc<dyn PageEngine>, String> {
    let parent = main_window_hwnd(app).ok_or_else(|| {
        "main window has no Win32 handle yet (CEF must be selected after the window exists)"
            .to_string()
    })?;
    initialize()?;
    Ok(Arc::new(CefPageEngine {
        shared: Arc::new(Shared::default()),
        parent,
    }))
}

/// The Tauri main window's HWND as a plain integer so it can cross threads.
fn main_window_hwnd(app: &tauri::AppHandle) -> Option<isize> {
    use tauri::Manager;
    let window = app.windows().into_values().next()?;
    let hwnd = window.hwnd().ok()?;
    Some(hwnd.0 as isize)
}

pub fn shutdown() {
    cef::shutdown();
}

// --- Win32 window plumbing ------------------------------------------------

type RawHwnd = isize;

fn window_handle(hwnd: isize) -> cef::WindowHandle {
    debug_assert_eq!(
        std::mem::size_of::<cef::WindowHandle>(),
        std::mem::size_of::<isize>()
    );
    unsafe { std::mem::transmute_copy(&hwnd) }
}

fn create_container(label: &str, parent: RawHwnd, bounds: PageBounds) -> Result<RawHwnd> {
    platform::create_child_window(
        label,
        parent,
        bounds.x.round() as i32,
        bounds.y.round() as i32,
        bounds.width.round().max(1.0) as i32,
        bounds.height.round().max(1.0) as i32,
    )
    .map_err(EngineError::Message)
}

mod platform {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetClientRect, SetWindowPos, ShowWindow, SWP_NOACTIVATE,
        SWP_NOZORDER, SW_HIDE, SW_SHOW, WS_CHILD, WS_CLIPCHILDREN, WS_CLIPSIBLINGS, WS_VISIBLE,
    };

    pub fn create_child_window(
        label: &str,
        parent: isize,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<isize, String> {
        let class = wide("STATIC");
        let title = wide(label);
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                title.as_ptr(),
                WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
                x,
                y,
                width.max(1),
                height.max(1),
                parent as HWND,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        };
        if hwnd.is_null() {
            return Err("CreateWindowExW failed for the tab container".into());
        }
        Ok(hwnd as isize)
    }

    pub fn set_rect(hwnd: isize, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
        let ok = unsafe {
            SetWindowPos(
                hwnd as HWND,
                std::ptr::null_mut(),
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
        };
        if ok == 0 {
            return Err("SetWindowPos failed".into());
        }
        Ok(())
    }

    pub fn set_size(hwnd: isize, width: i32, height: i32) -> Result<(), String> {
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        unsafe { GetClientRect(hwnd as HWND, &mut rect) };
        set_rect(hwnd, rect.left, rect.top, width, height)
    }

    pub fn client_size(hwnd: isize) -> Result<(u32, u32), String> {
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        let ok = unsafe { GetClientRect(hwnd as HWND, &mut rect) };
        if ok == 0 {
            return Err("GetClientRect failed".into());
        }
        Ok((
            (rect.right - rect.left).max(0) as u32,
            (rect.bottom - rect.top).max(0) as u32,
        ))
    }

    pub fn show(hwnd: isize, visible: bool) -> Result<(), String> {
        unsafe { ShowWindow(hwnd as HWND, if visible { SW_SHOW } else { SW_HIDE }) };
        Ok(())
    }

    pub fn focus(hwnd: isize) -> Result<(), String> {
        unsafe { SetFocus(hwnd as HWND) };
        Ok(())
    }

    pub fn destroy(hwnd: isize) {
        unsafe { DestroyWindow(hwnd as HWND) };
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

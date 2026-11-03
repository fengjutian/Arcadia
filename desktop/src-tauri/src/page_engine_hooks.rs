//! Application-side implementation of the page engine's host hooks.
//!
//! `page-engine` owns the tab/page lifecycle but knows nothing about
//! certificates, request filtering, permission prompts or crash reporting:
//! those are product policy. This module is the single place where the app
//! plugs that policy into whichever engine is hosting pages.

use std::sync::Arc;

use page_engine::{PagePlatformHooks, SitePermissionRule};
use tauri::AppHandle;

pub struct BrowserPageHooks;

impl PagePlatformHooks for BrowserPageHooks {
    fn attach(
        &self,
        app: &AppHandle,
        label: &str,
        private: bool,
        permissions: &[SitePermissionRule],
    ) {
        crate::certificate_guard::attach_certificate_guard(app, label);
        crate::privacy::attach_navigation_guard(app, label);
        crate::permission_guard::attach_permission_guard(app, label, permissions.to_vec(), private);
        crate::webview_process_guard::attach_process_guard(app, label);
        let _ = crate::privacy::platform::attach_from_runtime(app, label, private);
    }
}

/// The hook set the app registers with the page engine at startup.
pub fn browser_page_hooks() -> Arc<dyn PagePlatformHooks> {
    Arc::new(BrowserPageHooks)
}

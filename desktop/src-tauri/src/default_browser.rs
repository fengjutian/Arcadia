//! Default-browser registration and launch hand-off.
//!
//! Windows owns the default-browser choice: since Windows 10 the user picks it
//! and the selection is protected by the `UserChoice` hash, so no application
//! can switch it silently. What an app *can* do is register itself as a per-user
//! browser candidate under `HKCU`, deep-link the user to the Default Apps page,
//! and report the real current default instead of pretending a switch happened.
//! This module does those three things.
//!
//! A registered browser is started with the clicked URL as its first argument,
//! so [`PendingLaunchUrl`] keeps that argument until the UI claims it once.

use serde::Serialize;

/// Name Windows shows in Default Apps; also the value name under
/// `Software\RegisteredApplications`.
#[allow(dead_code)]
const APP_NAME: &str = "Arcadia";

/// The ProgID Windows associates with `http` / `https` when Arcadia is chosen.
#[allow(dead_code)]
const PROG_ID: &str = "ArcadiaHTML";

#[allow(dead_code)]
const APP_KEY: &str = r"Software\Clients\StartMenuInternet\Arcadia";
#[allow(dead_code)]
const CAPABILITIES_KEY: &str = r"Software\Clients\StartMenuInternet\Arcadia\Capabilities";
#[allow(dead_code)]
const URL_ASSOCIATIONS_KEY: &str = r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations";
#[allow(dead_code)]
const REGISTERED_APPLICATIONS_KEY: &str = r"Software\RegisteredApplications";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultBrowserStatus {
    /// False on platforms where this module only exposes a stub (macOS/Linux).
    pub platform_supported: bool,
    /// True only when Windows resolves both `http` and `https` to our ProgID.
    pub is_default: bool,
    /// True when the CurrentUser registration entries are present.
    pub registered: bool,
    /// ProgID Windows currently uses for web links, if it could be read.
    pub current_prog_id: Option<String>,
    /// Friendly product name for a known ProgID (e.g. "Google Chrome").
    pub current_app_name: Option<String>,
}

impl DefaultBrowserStatus {
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    fn unsupported() -> Self {
        Self {
            platform_supported: false,
            is_default: false,
            registered: false,
            current_prog_id: None,
            current_app_name: None,
        }
    }
}

/// URL handed to the process by the shell, kept until the UI asks for it once.
#[derive(Default)]
pub struct PendingLaunchUrl(std::sync::Mutex<Option<String>>);

impl PendingLaunchUrl {
    /// Captures the URL from the current process arguments (the shell passes the
    /// clicked address as argv[1]).
    pub fn from_env() -> Self {
        Self::from_args(std::env::args().skip(1))
    }

    pub fn from_args<I: IntoIterator<Item = String>>(args: I) -> Self {
        let url = args.into_iter().find_map(|arg| launch_url(&arg));
        Self(std::sync::Mutex::new(url))
    }

    fn take(&self) -> Result<Option<String>, String> {
        self.0
            .lock()
            .map(|mut slot| slot.take())
            .map_err(|error| error.to_string())
    }
}

/// Accepts only absolute http(s) URLs, so a stray argument can never become a
/// privileged navigation.
pub fn launch_url(raw: &str) -> Option<String> {
    let parsed = url::Url::parse(raw.trim()).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }
    Some(parsed.to_string())
}

/// Maps a Windows ProgID to the product name users recognise. Unknown ProgIDs
/// return `None` and the UI falls back to showing the raw ProgID.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn friendly_name(prog_id: &str) -> Option<&'static str> {
    let lower = prog_id.trim().to_ascii_lowercase();
    let name = if lower == "arcadiahtml" || lower == "arcadia" {
        "Arcadia"
    } else if lower.starts_with("chrome") {
        "Google Chrome"
    } else if lower == "msedgehtm" || lower.starts_with("microsoftedge") {
        "Microsoft Edge"
    } else if lower.starts_with("firefox") {
        "Mozilla Firefox"
    } else if lower.starts_with("brave") {
        "Brave"
    } else if lower.starts_with("vivaldi") {
        "Vivaldi"
    } else if lower.starts_with("opera") {
        "Opera"
    } else if lower.starts_with("chromium") {
        "Chromium"
    } else if lower.starts_with("arc") {
        "Arc"
    } else {
        return None;
    };
    Some(name)
}

/// Reads the value out of `reg query` output:
///
/// ```text
/// HKEY_CURRENT_USER\...\UserChoice
///     ProgId    REG_SZ    MSEdgeHTM
/// ```
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_reg_value(stdout: &str, name: &str) -> Option<String> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("HKEY") {
            continue;
        }
        let mut parts = trimmed.split_whitespace();
        let Some(key) = parts.next() else { continue };
        if !key.eq_ignore_ascii_case(name) {
            continue;
        }
        // The second token is the value type (`REG_SZ`); everything after it is
        // the value itself, which may contain spaces.
        let _kind = parts.next()?;
        return Some(parts.collect::<Vec<_>>().join(" "));
    }
    None
}

#[tauri::command]
pub fn default_browser_status() -> DefaultBrowserStatus {
    platform::status()
}

#[tauri::command]
pub fn default_browser_register() -> Result<DefaultBrowserStatus, String> {
    platform::register()
}

#[tauri::command]
pub fn default_browser_open_settings() -> Result<(), String> {
    platform::open_settings()
}

#[tauri::command]
pub fn default_browser_take_launch_url(
    state: tauri::State<'_, PendingLaunchUrl>,
) -> Result<Option<String>, String> {
    state.take()
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{
        friendly_name, parse_reg_value, DefaultBrowserStatus, APP_KEY, APP_NAME, CAPABILITIES_KEY,
        PROG_ID, REGISTERED_APPLICATIONS_KEY, URL_ASSOCIATIONS_KEY,
    };
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn hive(key: &str) -> String {
        format!("HKCU\\{key}")
    }

    fn run_reg(args: &[String]) -> Result<String, String> {
        let output = std::process::Command::new("reg.exe")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("failed to run reg.exe: {error}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("reg.exe exited with {}", output.status)
            } else {
                stderr
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Reads a REG_SZ value; a missing key or value is not an error there.
    fn query_value(key: &str, name: &str) -> Option<String> {
        let args = vec![
            "query".to_string(),
            hive(key),
            "/v".to_string(),
            name.to_string(),
        ];
        let output = run_reg(&args).ok()?;
        parse_reg_value(&output, name)
    }

    fn set_value(key: &str, name: Option<&str>, value: &str) -> Result<(), String> {
        let mut args = vec!["add".to_string(), hive(key)];
        match name {
            Some(name) => {
                args.push("/v".to_string());
                args.push(name.to_string());
            }
            None => args.push("/ve".to_string()),
        }
        args.push("/t".to_string());
        args.push("REG_SZ".to_string());
        args.push("/d".to_string());
        args.push(value.to_string());
        args.push("/f".to_string());
        run_reg(&args).map(|_| ())
    }

    fn user_choice(scheme: &str) -> Option<String> {
        query_value(
            &format!(r"{URL_ASSOCIATIONS_KEY}\{scheme}\UserChoice"),
            "ProgId",
        )
    }

    fn is_registered() -> bool {
        query_value(REGISTERED_APPLICATIONS_KEY, APP_NAME)
            .map(|value| value.trim().eq_ignore_ascii_case(CAPABILITIES_KEY))
            .unwrap_or(false)
    }

    pub fn status() -> DefaultBrowserStatus {
        let http = user_choice("http");
        let https = user_choice("https");
        let is_default = http.as_deref() == Some(PROG_ID) && https.as_deref() == Some(PROG_ID);
        let current = https.clone().or_else(|| http.clone());
        DefaultBrowserStatus {
            platform_supported: true,
            is_default,
            registered: is_registered(),
            current_app_name: current
                .as_deref()
                .and_then(friendly_name)
                .map(str::to_string),
            current_prog_id: current,
        }
    }

    pub fn register() -> Result<DefaultBrowserStatus, String> {
        let executable = std::env::current_exe()
            .map_err(|error| format!("cannot resolve the application path: {error}"))?;
        let executable = executable.to_string_lossy().to_string();
        let quoted_exe = format!("\"{executable}\"");
        let open_with_url = format!("\"{executable}\" \"%1\"");
        let icon = format!("\"{executable}\",0");
        let prog_id_key = format!(r"Software\Classes\{PROG_ID}");

        // The ProgID is what Windows stores in UserChoice once the user picks us.
        set_value(&prog_id_key, None, "Arcadia Document")?;
        set_value(&format!(r"{prog_id_key}\DefaultIcon"), None, &icon)?;
        set_value(
            &format!(r"{prog_id_key}\shell\open\command"),
            None,
            &open_with_url,
        )?;

        // The StartMenuInternet client is what makes us a browser candidate in
        // Settings → Default apps.
        set_value(APP_KEY, None, APP_NAME)?;
        set_value(&format!(r"{APP_KEY}\DefaultIcon"), None, &icon)?;
        set_value(&format!(r"{APP_KEY}\shell\open\command"), None, &quoted_exe)?;
        set_value(CAPABILITIES_KEY, None, APP_NAME)?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\ApplicationName"),
            None,
            APP_NAME,
        )?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\ApplicationDescription"),
            None,
            "Arcadia local-first AI knowledge browser",
        )?;
        set_value(&format!(r"{CAPABILITIES_KEY}\ApplicationIcon"), None, &icon)?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\URLAssociations"),
            Some("http"),
            PROG_ID,
        )?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\URLAssociations"),
            Some("https"),
            PROG_ID,
        )?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\FileAssociations"),
            Some(".htm"),
            PROG_ID,
        )?;
        set_value(
            &format!(r"{CAPABILITIES_KEY}\FileAssociations"),
            Some(".html"),
            PROG_ID,
        )?;
        set_value(
            REGISTERED_APPLICATIONS_KEY,
            Some(APP_NAME),
            CAPABILITIES_KEY,
        )?;

        Ok(status())
    }

    pub fn open_settings() -> Result<(), String> {
        // `registeredAppUser` focuses our entry on Windows 11; Windows 10 ignores
        // the extra query string and still opens Default Apps.
        const URI: &str = "ms-settings:defaultapps?registeredAppUser=Arcadia";
        std::process::Command::new("cmd.exe")
            .args(["/C", "start", "", URI])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to open the Default Apps page: {error}"))
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::DefaultBrowserStatus;

    pub fn status() -> DefaultBrowserStatus {
        DefaultBrowserStatus::unsupported()
    }

    pub fn register() -> Result<DefaultBrowserStatus, String> {
        Err("default browser registration is only implemented on Windows".into())
    }

    pub fn open_settings() -> Result<(), String> {
        Err("opening the system default-apps page is only implemented on Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_reg_value_that_contains_spaces() {
        let output = "\r\nHKEY_CURRENT_USER\\Software\\RegisteredApplications\r\n    Arcadia    REG_SZ    Software\\Clients\\StartMenuInternet\\Arcadia\\Capabilities\r\n\r\n";
        assert_eq!(
            parse_reg_value(output, "Arcadia").as_deref(),
            Some(r"Software\Clients\StartMenuInternet\Arcadia\Capabilities")
        );
    }

    #[test]
    fn ignores_other_values_and_missing_output() {
        let output = "HKEY_CURRENT_USER\\x\r\n    ProgId    REG_SZ    MSEdgeHTM\r\n";
        assert_eq!(
            parse_reg_value(output, "ProgId").as_deref(),
            Some("MSEdgeHTM")
        );
        assert_eq!(parse_reg_value(output, "Arcadia"), None);
        assert_eq!(parse_reg_value("", "ProgId"), None);
    }

    #[test]
    fn names_common_browsers_and_degrades_for_unknown_prog_ids() {
        assert_eq!(friendly_name("ChromeHTML"), Some("Google Chrome"));
        assert_eq!(friendly_name("MSEdgeHTM"), Some("Microsoft Edge"));
        assert_eq!(
            friendly_name("FirefoxURL-308046B0AF4A39CB"),
            Some("Mozilla Firefox")
        );
        assert_eq!(friendly_name("ArcadiaHTML"), Some("Arcadia"));
        assert_eq!(friendly_name("SomeVendor.Browser"), None);
    }

    #[test]
    fn takes_the_first_http_url_from_the_arguments_and_only_once() {
        let pending = PendingLaunchUrl::from_args([
            "--flag".to_string(),
            "file:///C:/notes.html".to_string(),
            "https://example.com/a?b=1".to_string(),
        ]);
        assert_eq!(
            pending.take().unwrap().as_deref(),
            Some("https://example.com/a?b=1")
        );
        assert_eq!(pending.take().unwrap(), None);
    }

    #[test]
    fn rejects_non_http_launch_arguments() {
        assert_eq!(launch_url("file:///C:/notes.html"), None);
        assert_eq!(launch_url("javascript:alert(1)"), None);
        assert_eq!(launch_url("not a url"), None);
        assert_eq!(
            launch_url("http://example.com"),
            Some("http://example.com/".to_string())
        );
    }
}

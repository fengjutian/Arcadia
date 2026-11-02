use url::Url;

pub fn normalize_navigation(input: &str) -> Result<String, url::ParseError> {
    let trimmed = input.trim();
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Url::parse(trimmed).map(|url| url.to_string());
    }
    if trimmed.contains('.') && !trimmed.contains(' ') {
        return Url::parse(&format!("https://{trimmed}")).map(|url| url.to_string());
    }
    Url::parse_with_params("https://www.google.com/search", &[("q", trimmed)])
        .map(|url| url.to_string())
}

/// Toast kinds the in-page layer knows how to draw.
pub const TOAST_KINDS: [&str; 5] = ["success", "error", "warning", "info", "loading"];

/// One notification to paint inside a page.
pub struct PageToast<'a> {
    pub id: &'a str,
    pub kind: &'a str,
    pub text: &'a str,
    pub duration_ms: u64,
    pub theme: &'a str,
}

/// Script that shows (or updates) one toast inside the page's own document.
///
/// The browser route paints every tab in a native child WebView that sits above
/// the React surface, so a host-DOM toast either cannot be seen (it is under the
/// page) or has to reflow the WebView out of the way (the notification bar this
/// replaces). Drawing the toast in the page itself keeps the layout untouched
/// and still floats above the page content, which is what a browser notification
/// is supposed to do.
///
/// The toast lives in a closed shadow root attached to a `position: fixed` host,
/// so page CSS cannot restyle it and page scripts cannot read its contents. The
/// document keeps the registry on `window.__arcadiaToast`, which makes the
/// second call for the same id an in-place update instead of a second row.
pub fn page_toast_script(toast: &PageToast<'_>) -> Result<String, String> {
    validate_toast(toast)?;
    let config = serde_json::json!({
        "id": toast.id,
        // `id` is validated to `[A-Za-z0-9_-]`, so it needs no escaping; the
        // payload still goes through serde_json so the text can contain quotes,
        // backticks or `</script>` without ending up as script source.
        "kind": toast.kind,
        "text": toast.text,
        "duration": toast.duration_ms,
        "theme": toast.theme,
    });
    Ok(PAGE_TOAST_TEMPLATE.replace(PAGE_TOAST_CONFIG_SLOT, &config.to_string()))
}

/// Script that removes one toast by id; a no-op once the page has navigated.
pub fn page_toast_close_script(id: &str) -> Result<String, String> {
    if !is_valid_toast_id(id) {
        return Err("invalid toast id".into());
    }
    let id = serde_json::to_string(id).map_err(|error| error.to_string())?;
    Ok(PAGE_TOAST_CLOSE_TEMPLATE.replace(PAGE_TOAST_ID_SLOT, &id))
}

fn is_valid_toast_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn validate_toast(toast: &PageToast<'_>) -> Result<(), String> {
    if !is_valid_toast_id(toast.id) {
        return Err("invalid toast id".into());
    }
    if !TOAST_KINDS.contains(&toast.kind) {
        return Err(format!("unsupported toast kind: {}", toast.kind));
    }
    if toast.theme != "light" && toast.theme != "dark" {
        return Err(format!("unsupported toast theme: {}", toast.theme));
    }
    Ok(())
}

const PAGE_TOAST_CONFIG_SLOT: &str = "__ARCADIA_TOAST_CONFIG__";
const PAGE_TOAST_ID_SLOT: &str = "__ARCADIA_TOAST_ID__";

const PAGE_TOAST_TEMPLATE: &str = r#"(() => {
  const config = __ARCADIA_TOAST_CONFIG__;
  const registry = (window.__arcadiaToast = window.__arcadiaToast || { items: Object.create(null) });
  const dark = config.theme === 'dark';
  const ICONS = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4.5"/><path d="M12 16h.01"/></svg>',
    warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
    loading: '<svg class="arcadia-toast-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>'
  };
  if (!registry.host || !registry.host.isConnected) {
    const host = document.createElement('div');
    host.setAttribute('data-arcadia-toast-host', '');
    host.style.cssText = 'all:initial;position:fixed;top:14px;right:14px;z-index:2147483646;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      '.arcadia-toast-stack{display:flex;flex-direction:column;align-items:flex-end;gap:8px}',
      '.arcadia-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:9px;min-width:180px;max-width:min(380px,78vw);padding:10px 12px;border:1px solid var(--arcadia-toast-border,#d8deda);border-radius:10px;background:var(--arcadia-toast-bg,#fff);color:var(--arcadia-toast-fg,#303a34);font:13px/1.45 system-ui,"Microsoft YaHei",sans-serif;box-shadow:0 10px 28px rgba(23,32,27,.18);animation:arcadia-toast-in .16s ease-out}',
      '.arcadia-toast.is-leaving{animation:arcadia-toast-out .14s ease-in forwards}',
      '.arcadia-toast>.icon{display:inline-flex;flex:none;margin-top:1px}',
      '.arcadia-toast>.text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.arcadia-toast[data-kind=success]>.icon{color:#52c41a}',
      '.arcadia-toast[data-kind=error]>.icon{color:#ff4d4f}',
      '.arcadia-toast[data-kind=warning]>.icon{color:#faad14}',
      '.arcadia-toast[data-kind=info]>.icon{color:var(--arcadia-toast-accent,#3f8f63)}',
      '.arcadia-toast[data-kind=loading]>.icon{color:var(--arcadia-toast-accent,#3f8f63)}',
      '.arcadia-toast-spinner{animation:arcadia-toast-spin .9s linear infinite}',
      '@keyframes arcadia-toast-in{from{opacity:0;transform:translateY(-6px)}}',
      '@keyframes arcadia-toast-out{to{opacity:0;transform:translateY(-6px)}}',
      '@keyframes arcadia-toast-spin{to{transform:rotate(360deg)}}'
    ].join('');
    const stack = document.createElement('div');
    stack.className = 'arcadia-toast-stack';
    shadow.append(style, stack);
    document.documentElement.appendChild(host);
    registry.host = host;
    registry.stack = stack;
    registry.items = Object.create(null);
  }
  const host = registry.host;
  host.style.setProperty('--arcadia-toast-bg', dark ? '#202823' : '#fff');
  host.style.setProperty('--arcadia-toast-fg', dark ? '#e5ebe7' : '#303a34');
  host.style.setProperty('--arcadia-toast-border', dark ? '#46514a' : '#d8deda');
  host.style.setProperty('--arcadia-toast-accent', dark ? '#7cc79c' : '#3f8f63');
  host.style.colorScheme = dark ? 'dark' : 'light';
  const remove = (entry, animate) => {
    if (!entry || entry.removed) return;
    entry.removed = true;
    clearTimeout(entry.timer);
    delete registry.items[entry.id];
    if (!animate || !entry.el.isConnected) { entry.el.remove(); return; }
    entry.el.classList.add('is-leaving');
    setTimeout(() => entry.el.remove(), 150);
  };
  let entry = registry.items[config.id];
  if (!entry) {
    Object.keys(registry.items).forEach(key => {
      const other = registry.items[key];
      if (other && other.text === config.text) remove(other, false);
    });
    const el = document.createElement('div');
    el.className = 'arcadia-toast';
    el.setAttribute('role', config.kind === 'error' ? 'alert' : 'status');
    el.setAttribute('data-kind', config.kind);
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.innerHTML = ICONS[config.kind] || ICONS.info;
    const text = document.createElement('span');
    text.className = 'text';
    el.append(icon, text);
    registry.stack.appendChild(el);
    entry = { id: config.id, el: el, icon: icon, textEl: text, text: '', kind: config.kind, removed: false, timer: 0 };
    el.addEventListener('click', () => remove(entry, true));
    registry.items[config.id] = entry;
  }
  if (entry.kind !== config.kind) {
    entry.kind = config.kind;
    entry.el.setAttribute('data-kind', config.kind);
    entry.icon.innerHTML = ICONS[config.kind] || ICONS.info;
  }
  entry.text = config.text;
  entry.textEl.textContent = config.text;
  clearTimeout(entry.timer);
  if (config.duration > 0) entry.timer = setTimeout(() => remove(entry, true), config.duration);
  return true;
})()"#;

const PAGE_TOAST_CLOSE_TEMPLATE: &str = r#"(() => {
  const id = __ARCADIA_TOAST_ID__;
  const registry = window.__arcadiaToast;
  if (!registry || !registry.items) return;
  const entry = registry.items[id];
  if (!entry) return;
  clearTimeout(entry.timer);
  delete registry.items[id];
  if (entry.el && entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
})()"#;

/// Slot filled with the JSON config of the in-page Space menu.
pub const SPACE_MENU_CONFIG_SLOT: &str = "__ARCADIA_SPACE_MENU_CONFIG__";

/// Maximum number of rows accepted from the frontend. The real menu is well
/// under this; the cap only keeps a runaway payload from freezing the page.
const SPACE_MENU_MAX_ROWS: usize = 120;

/// Validates the Space-menu payload and returns the script that paints it
/// inside the page.
///
/// The Space switch sits in the left rail, but the page is a native child
/// WebView that always paints above the host document: a host menu anchored
/// there is cut in half by the page. Hiding or resizing the page to make room
/// is worse (blank or reflowing content), so the menu is drawn inside the page
/// instead, in a closed shadow root, exactly like the page toast and the
/// toolbar panels. The page keeps running underneath and nothing moves.
pub fn space_menu_script(config: &serde_json::Value) -> Result<String, String> {
    let object = config
        .as_object()
        .ok_or_else(|| "space menu config must be an object".to_string())?;
    let items = object
        .get("items")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "space menu items must be an array".to_string())?;
    if items.len() > SPACE_MENU_MAX_ROWS {
        return Err("space menu has too many rows".into());
    }
    for item in items {
        let row = item
            .as_object()
            .ok_or_else(|| "space menu row must be an object".to_string())?;
        for field in ["key", "label", "type"] {
            if let Some(value) = row.get(field) {
                if !value.is_string() && !value.is_null() {
                    return Err(format!("space menu row field {field} must be a string"));
                }
            }
        }
    }
    for field in ["x", "y"] {
        if let Some(value) = object.get(field) {
            let Some(number) = value.as_f64() else {
                return Err(format!("space menu {field} must be a number"));
            };
            if !number.is_finite() {
                return Err(format!("space menu {field} must be finite"));
            }
        }
    }
    Ok(SPACE_MENU_TEMPLATE.replace(SPACE_MENU_CONFIG_SLOT, &config.to_string()))
}

const SPACE_MENU_TEMPLATE: &str = r#"(() => {
  const config = __ARCADIA_SPACE_MENU_CONFIG__;
  const dark = config.theme === 'dark';
  const x = Math.max(0, Number(config.x) || 0);
  const y = Math.max(0, Number(config.y) || 0);
  window.__arcadiaSpaceMenu?.close?.(false);

  const emit = action => {
    try {
      window.__TAURI_INTERNALS__?.invoke('browser_emit_event', {
        event: 'browser://toolbar-menu-action',
        payload: { version: 1, tabLabel: config.tabLabel, action, value: null },
      }).catch(() => undefined);
    } catch (_) { /* the host may already be gone */ }
  };

  const host = document.createElement('div');
  host.setAttribute('data-arcadia-space-menu', '');
  host.style.cssText = 'all:initial;position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.menu{width:236px;max-height:min(76vh,620px);overflow:auto;padding:5px;border:1px solid #d8ded9;border-radius:10px;background:#fff;color:#252c28;box-shadow:0 12px 32px rgba(25,40,31,.18);font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;animation:arcadia-space-menu-in .12s ease-out}',
    '@keyframes arcadia-space-menu-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    'button{all:unset;display:flex;align-items:center;gap:7px;width:100%;padding:8px 10px;border-radius:7px;cursor:pointer;color:inherit;font:inherit}',
    'button:hover{background:#eef5ef}',
    'button:disabled{color:#a9b3ac;cursor:default;background:transparent}',
    '.head{padding:7px 10px 4px;color:#6b7a70;font-size:11px;font-weight:700;letter-spacing:.4px}',
    '.sep{height:1px;margin:5px 6px;background:#eef1ef}',
    '.check{flex:0 0 11px;color:#3c8a5c;font-size:11px;line-height:1}',
    '.dot{flex:0 0 10px;width:10px;height:10px;border-radius:50%;border:1px solid rgba(0,0,0,.12)}',
    '.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.menu.dark{border-color:#46534c;background:#202823;color:#e1e9e4;box-shadow:0 12px 32px rgba(0,0,0,.4)}',
    '.dark button:hover{background:#2d3b33}',
    '.dark .head{color:#8ea095}',
    '.dark .sep{background:#33403a}',
    '.dark button:disabled{color:#5e6b64}',
  ].join('');
  const menu = document.createElement('div');
  menu.className = dark ? 'menu dark' : 'menu';
  menu.setAttribute('role', 'menu');
  shadow.append(style, menu);

  const close = notify => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keydown, true);
    host.remove();
    if (window.__arcadiaSpaceMenu && window.__arcadiaSpaceMenu.host === host) delete window.__arcadiaSpaceMenu;
    if (notify !== false) emit('__dismiss__');
  };
  const outside = event => { if (!event.composedPath().includes(host)) close(); };
  const keydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const rows = [...menu.querySelectorAll('button:not(:disabled)')];
      if (!rows.length) return;
      const index = rows.indexOf(shadow.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[(index + step + rows.length) % rows.length].focus();
    }
  };
  // Keep the page from reacting to clicks, wheel or key presses aimed at the
  // menu; the host still sees them through its own capture listeners.
  for (const type of ['pointerdown', 'mousedown', 'click', 'wheel', 'keydown']) {
    host.addEventListener(type, event => event.stopPropagation());
  }

  for (const item of Array.isArray(config.items) ? config.items : []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'divider') {
      const sep = document.createElement('div');
      sep.className = 'sep';
      menu.append(sep);
      continue;
    }
    if (item.type === 'section') {
      const head = document.createElement('div');
      head.className = 'head';
      head.textContent = String(item.label ?? '');
      menu.append(head);
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    row.disabled = Boolean(item.disabled);
    if (item.checked) {
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = '✓';
      row.append(check);
    }
    if (item.swatch) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = String(item.swatch);
      row.append(dot);
    }
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = String(item.label ?? '');
    row.append(label);
    if (item.key) {
      row.addEventListener('click', () => {
        emit('space:' + item.key);
        close(false);
      });
    }
    menu.append(row);
  }

  document.documentElement.append(host);
  window.__arcadiaSpaceMenu = { host, close };
  setTimeout(() => {
    if (!host.isConnected) return;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
  }, 0);
})()"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn adds_https_to_domains() {
        assert_eq!(
            normalize_navigation("example.com").unwrap(),
            "https://example.com/"
        );
    }
    #[test]
    fn turns_words_into_search() {
        assert!(normalize_navigation("tauri browser")
            .unwrap()
            .contains("q=tauri+browser"));
    }

    fn toast(text: &str) -> PageToast<'_> {
        PageToast {
            id: "tab-1-0",
            kind: "error",
            text,
            duration_ms: 3_000,
            theme: "dark",
        }
    }

    fn config_of(script: &str) -> serde_json::Value {
        let start = script.find("const config = ").unwrap() + "const config = ".len();
        let end = start + script[start..].find(";\n").unwrap();
        serde_json::from_str(&script[start..end]).unwrap()
    }

    #[test]
    fn toast_config_survives_text_that_looks_like_source() {
        let script = page_toast_script(&toast(r#"a "quoted" `tick` ${x} </script>"#)).unwrap();
        let config = config_of(&script);
        assert_eq!(config["text"], r#"a "quoted" `tick` ${x} </script>"#);
        assert_eq!(config["id"], "tab-1-0");
        assert_eq!(config["kind"], "error");
        assert_eq!(config["duration"], 3_000);
        assert_eq!(config["theme"], "dark");
    }

    #[test]
    fn toast_scripts_reject_unknown_kinds_themes_and_ids() {
        let mut kind = toast("hi");
        kind.kind = "explode";
        assert!(page_toast_script(&kind).is_err());

        let mut theme = toast("hi");
        theme.theme = "solarized";
        assert!(page_toast_script(&theme).is_err());

        let mut id = toast("hi");
        id.id = "tab 1";
        assert!(page_toast_script(&id).is_err());

        assert!(page_toast_close_script("tab-1-0").is_ok());
        assert!(page_toast_close_script("tab 1;alert(1)").is_err());
    }

    #[test]
    fn toast_close_script_removes_only_the_named_row() {
        let script = page_toast_close_script("tab-1-0").unwrap();
        assert!(script.contains(r#"const id = "tab-1-0";"#));
        assert!(script.contains("delete registry.items[id]"));
    }
}

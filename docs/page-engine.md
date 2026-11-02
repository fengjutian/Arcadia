# PageEngine：页面承载层抽象

> 状态：已完成（2026-11-02）。对应 [开发路线图](roadmap.md) Iteration 7 启动条件第 1 条。
> 代码：`desktop/src-tauri/src/engine/`。

## 为什么有这一层

实验期浏览器标签直接跑在 Tauri 的系统 WebView 上（Windows WebView2 / macOS WKWebView / Linux WebKitGTK）。换内核之前必须先把「业务要一个页面做什么」与「哪个内核在做」拆开，否则接入 CEF 等于重写命令层。

这一层只做抽象，不改变任何现有行为：命令名、参数、错误文案、事件负载全部保持原样。

## 结构

```text
engine/mod.rs     PageEngine trait、EngineError、PageSpec / PageBounds / CaptureRequest、
                  PageObserver、PageEngineState、eval_json 辅助函数
engine/wry.rs     WryPageEngine —— 当前唯一实现，唯一持有 tauri::Webview 的模块
```

命令层通过 `engine::page_engine(&app)` 取得 `Arc<dyn PageEngine>`，之后只使用 tab label：

```rust
let engine = engine::page_engine(&app);
engine.set_bounds(&label, bounds)?;
```

## 三个边界

1. **业务代码不持有 `tauri::Webview`。**
   全仓库 `app.get_webview(...)` 只出现在 `engine/wry.rs`（解析标签 + 两处存在性检查）。
   命令仍会收到 Tauri 注入的 `webview: tauri::Webview` 参数（例如 `browser_permission_request`），
   但只读 `label()`，页面信息一律走引擎。

2. **平台模块走唯一的逃生口。**
   证书错误、权限请求、请求过滤、进程失败、挂起/恢复都需要 WebView2 的 COM 句柄。
   这些模块（`certificate_guard`、`permission_guard`、`privacy/`、`webview_process_guard`、
   `webview_suspend`）统一调用：

   ```rust
   crate::engine::with_platform_webview(app, label, move |platform| { /* COM */ });
   ```

   这既是 CEF 实现需要替换的地方（换成 `CefClient` 的 handler），也是未来审计「还有多少内核专属代码」的入口。

3. **引擎不做产品决策。**
   页面生命周期通过 `PageObserver` 回调应用层：加载完成、`target=_blank`、下载开始/结束。
   引擎不知道 SQLite、插件、封杀名单的存在；`AppPageObserver`（`lib.rs`）把它们接回去。
   初始注入脚本由调用方以 `Vec<String>` 传入 `PageSpec`，引擎只负责注入位置。

## 接口

| 分类 | 方法 |
| --- | --- |
| 生命周期 | `create` / `exists` / `close` |
| 脚本 | `eval` / `eval_value`（+ `engine::eval_json::<T>`） |
| 导航 | `navigate` / `reload` / `stop` / `url` |
| 几何 | `set_bounds` / `size` / `set_physical_size` / `set_visible` / `focus` |
| 页面能力 | `set_zoom` / `print` / `open_devtools` / `capture` / `clear_site_data` |
| 平台逃生口 | `with_platform_webview`（`#[cfg(windows)]`） |

错误统一为 `EngineError`，`Display` 就是前端看到的文案（`browser tab webview not found`、
`page script timed out` 等），因此实现替换不会改变用户可见的错误。

## 接入 CEF 时要做的事

1. 新增 `engine/cef.rs`，实现同一个 trait；`create` 里把 `PageSpec` 映射到 `CefBrowserHost::CreateBrowser`
   与 `CefClient` 的回调，而不是 `WebviewBuilder`。
2. 在 `run()` 的 `setup` 里按 feature flag 选择构造 `WryPageEngine` 还是 `CefPageEngine`，
   `PageEngineState` 的类型不变。
3. 把第 2 条列出的平台模块替换为 CEF 的对应 handler：证书错误 → `OnCertificateError`，
   权限 → `OnRequestMediaAccessPermission`，请求过滤 → `CefResourceRequestHandler`，
   进程失败 → `OnRenderProcessTerminated`，挂起/恢复 → `WasHidden`/`WasShown`。
4. 补齐当前只在 wry 上存在的行为差异（`set_zoom` 现在是注入 CSS，CEF 可用 `SetZoomLevel`），
   并在 `browserCapabilities.ts` 契约上逐项标注。

## 现状核对（2026-11-02）

- `cargo check --all-targets`：通过，无警告。
- `cargo fmt -- --check`：通过。
- `npm run test:rust`：271 个用例，270 通过；`local_store::tests::cjk_index_matches_title_by_pinyin_and_initials`
  失败，属于拼音检索（commit `9172080`）既有问题，与本次抽象无关。
- 前端契约未变：`browser_capture_screenshot` 的 `clip`、`browser_create` 的 `bounds` 序列化形状与重构前一致。
- 第二个实现已接线：`engine/select.rs` 在 `--features cef` 且 Windows 时优先 CEF、失败回落 wry，
  `browser_capabilities.pageEngine` 回报实际后端。CEF 宿主尚未实现，见
  [Windows CEF 接入方案](cef-windows-plan.md)。

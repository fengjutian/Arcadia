# Windows CEF 接入方案（wry 保留为 fallback）

> 状态：**T1+T2 spike 已实现并编译通过，运行时未验证**（2026-11-02）。
> 决策：CEF 列为**远期规划**，近期仍以 wry 为主，不提供界面切换；对比与触发条件见 [页面引擎选型](page-engine-selection.md)。
> 前置：[PageEngine 抽象](page-engine.md)。决策：只在 Windows 上引入自带 Chromium，
> 其他平台与非 CEF 构建继续使用系统 WebView。
>
> 当前 CEF 后端覆盖：进程模型（`main.rs` 子进程分流 + `execute_process`）、
> `CefInitialize`、每标签子 HWND、`navigate/reload/stop/url`、`set_bounds/size/visible/focus`、
> `eval`（`ExecuteJavaScript`）、`close`。未覆盖：`eval_value`（需 T4 MessageRouter）、
> `capture`、`clear_site_data`、`with_platform_webview`（返回 `Unsupported`）。
> 由于尚未到能力等价，CEF 仅在 `ARCADIA_PAGE_ENGINE=cef` 时启用，否则一律 wry。

## 0. 已验证的事实（2026-11-02）

| 项 | 结果 |
| --- | --- |
| CEF 二进制 | `156.0.15+gcf671c0+chromium-156.0.8078.80` windows64，标准分发包 350 MB |
| `cef` crate | `156.3.0+156.0.15`，`cef-dll-sys` 通过 CMake 编译 `libcef_dll_wrapper` |
| 构建 | `cargo check --features cef --lib` **通过**（冷构建 8m22s，主要耗时在 wrapper 的 C++ 编译） |
| 默认构建 | `cargo check --all-targets` 通过，**不依赖 CEF**（可选依赖，未启用时不参与构建） |
| 测试 | 270 通过 / 1 失败，失败项是既有的拼音检索用例，与 CEF 无关 |

尚未验证、必须等宿主实现后才能验证的：CEF 与 winit 消息循环共存、子 HWND 嵌入、
`libcef.dll` 随包分发后的运行时加载、沙箱开启。

## 1. 范围与原则

- **只赌 Windows**。macOS / Linux 不打包 Chromium：那会把安装包从 MB 级推到 300 MB 级，
  且需要公证 / 多发行版适配，收益（三端同内核）不是当前产品要验证的东西。
- **wry 永远可回落**。CEF 初始化失败（缺 DLL、被安全软件拦截、沙箱拒绝）时进程降级到
  wry，并把原因写进 `browser_capabilities.pageEngineFallback`，而不是启动失败。
- **命令层零改动**。CEF 实现同一个 `PageEngine` trait；`PageSpec` / `PageObserver` /
  错误文案都不变。
- **能力按 backend 分列**。`browserCapabilities` 新增 `pageEngine`，前端不得假设
  “Windows 就一定有 WebView2 的那些能力”。

## 2. 已完成的接线

| 位置 | 内容 |
| --- | --- |
| `engine/select.rs` | `select(&app)` 选择后端：`--features cef` 且 Windows 时先试 CEF，失败回落 wry 并记录原因 |
| `engine/mod.rs` | `EngineKind::{Wry,Cef}`、`PageEngineState { kind, engine, fallback_reason }`、`describe(&app)` |
| `lib.rs` | `setup` 中 `PageEngineState::new(engine::select::select(app.handle()))` |
| `capabilities.rs` | `page_engine` / `page_engine_fallback` 两个字段，`browser_capabilities(app)` |
| `services/browserCapabilities.ts` | 可选字段 `pageEngine?: 'wry' \| 'cef'`、`pageEngineFallback?: string \| null` |
| `Cargo.toml` | `cef = { version = "156.3.0", optional = true }`，`[features] cef = ["dep:cef"]` |
| `scripts/fetch-cef.ps1` | 按 `Cargo.toml` 里的版本下载并解压 Windows x64 分发包 |
| `package.json` | `npm run cef:fetch`、`npm run check:cef`（`cargo check --features cef`） |

构建方式：

```powershell
cd desktop
npm run cef:fetch                       # 下载到 .cache/cef-sdk（git 忽略）
$env:CEF_PATH = (powershell -NoProfile -File scripts/fetch-cef.ps1 -PrintPath)
npm run check:cef                       # 只验证类型与链接，不产出安装包
```

不带 `--features cef` 的构建完全不依赖 CEF：`cef` 是可选依赖，也不影响 CI 的默认路径。

## 3. 关键设计决策

### 3.1 进程模型

CEF 是多进程的：browser 进程 + renderer / GPU / utility 子进程。子进程**复用同一个 exe**，
靠命令行 `--type=...` 区分。因此 `main.rs` 必须在任何 Tauri 初始化之前拦截：

```rust
fn main() {
    #[cfg(all(target_os = "windows", feature = "cef"))]
    if ai_knowledge_browser_lib::engine::cef::run_subprocess_if_needed() {
        return; // renderer/gpu 子进程：跑完 CEF 的消息循环后直接退出
    }
    ai_knowledge_browser_lib::run();
}
```

`CefSettings.browser_subprocess_path` 指向当前 exe 自身。

### 3.2 消息循环

Windows 上选 **`multi_threaded_message_loop = true`**：CEF 在自己的 UI 线程上跑消息循环，
winit/Tauri 继续拥有主线程。代价是浏览器对象必须在 CEF UI 线程创建 —— 通过
`CefPostTask(TID_UI, ...)` 从 main thread 投递。

另一条路是 `external_message_pump = true` + 在 winit 的 `about_to_wait` 里调
`do_message_loop_work()`，能把 CEF 拉回主线程，但需要改 `tauri::Builder` 的运行方式。
**v1 用 MTML**；如果后面发现焦点/输入转发有问题，再评估外部泵。

### 3.3 每个标签一个子 HWND

`WindowInfo::default().set_as_child(parent_hwnd, &Rect { x, y, width, height })`：

- `parent_hwnd` = Tauri 主窗口的 HWND（`window.hwnd()`）。
- 每个标签先创建一个 `WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS` 的容器窗口，再交给 CEF；
  `set_bounds` 直接 `SetWindowPos` 该容器。
- 隐藏标签用 `ShowWindow(SW_HIDE)`，对应 `PageEngine::set_visible`；切走时 CEF 可选
  `WasHidden/WaShown`（对应 `webview_suspend` 的语义）。

### 3.4 JS 求值

CEF 的 `ExecuteJavaScript` 不返回值。`eval_value` 用 **`CefMessageRouter`**
（`cef::wrapper::message_router`）：host 侧注册 query handler，页面侧注入一个
promise 封装，5 秒超时与现有 `page script timed out` 文案保持一致。

### 3.5 私有标签

每个私密标签用独立 `RequestContext`，`cache_path` 指向 `%TEMP%\arcadia-cef-private\<label>`，
`persist_session_cookies = false`，关闭时删目录 —— 与现在 WebView2 的私有 profile 策略一致。

## 4. Handler 映射

| 现有能力 | 现在（wry） | CEF 对应 |
| --- | --- | --- |
| 页面加载完成 | `on_page_load` | `LoadHandler::on_load_end` + `DisplayHandler::on_title_change` |
| `target=_blank` | `on_new_window` | `LifeSpanHandler::on_before_popup`（返回 1 并 `observer.new_window`） |
| 下载 | `on_download` | `DownloadHandler::{on_before_download,on_download_updated}` |
| 证书错误 | `ServerCertificateErrorDetected`（COM） | `RequestHandler::on_certificate_error` |
| 权限请求 | `PermissionRequested`（COM） | `PermissionHandler::{on_request_media_access_permission,on_show_permission_prompt}` |
| 广告/黑名单子资源拦截 | `WebResourceRequested`（COM） | `RequestHandler::get_resource_request_handler` → `on_before_resource_load` 返回 cancel |
| 渲染进程崩溃 | `ProcessFailed`（COM） | `RequestHandler::on_render_process_terminated` |
| 挂起/恢复 | `TrySuspend/Resume`（COM） | `BrowserHost::was_hidden/was_shown` |
| 截图 | `Page.captureScreenshot`（CDP） | 同一个 CDP 方法，CEF 支持 `CallDevToolsProtocolMethod` |
| 打印 | `window.print()` | `BrowserHost::print()` 或继续注入 |
| 清理站点数据 | WebView2 profile API | `CefRequestContext` 重建 + `delete_cookies`；或删 profile 目录 |

`with_platform_webview` 在 CEF 实现里返回 `EngineError::Unsupported`：平台模块只在
wry 后端下被调用，CEF 用上面这些 handler 取代它们。

## 5. 任务拆分

| # | 任务 | 交付 | 估时 |
| --- | --- | --- | --- |
| T1 | 进程模型与初始化 | `main.rs` 子进程分支、`Settings`、`execute_process`、`shutdown`、`try_create` 真正初始化 | 3–4d |
| T2 | 窗口嵌入与几何 | 每标签 HWND、`set_bounds/size/visible/focus`、DPI、close | 4–5d |
| T3 | 导航与生命周期 | `navigate/reload/stop/url`、`page_loaded`、popup→新标签、崩溃事件 | 3–4d |
| T4 | 脚本通道 | MessageRouter + `eval`/`eval_value`、超时与错误文案对齐 | 3–4d |
| T5 | 平台能力迁移 | 证书、权限、子资源过滤、进程失败、挂起恢复 | 6–8d |
| T6 | 其余页面操作 | 下载、截图、打印、devtools、清理站点数据、缩放 | 4–6d |
| T7 | 打包与升级 | CEF 运行时随包、签名、版本锁定、增量更新策略 | 5–7d |
| T8 | 双实现 CI | 两套后端跑同一批命令级测试；能力矩阵分 backend | 3–4d |

合计 **31–42 人日**（约 6–8 人周），与之前的评估一致。T1–T2 是关键路径，也是唯一
“做不通就得改方案”的部分（消息循环 + 窗口嵌入）。

## 6. 风险

1. **输入与焦点**：CEF 在自己的 UI 线程创建子窗口，Tauri 的输入分发可能与 WebView2 不同，
   快捷键（Ctrl+T/W/L）和 IME 需要单独回归。
2. **体积与启动**：`libcef.dll` 约 200 MB，安装后运行时约 350 MB；冷启动多 0.5–1.5s。
   需要给出“随包 / 首次下载”的书面结论。
3. **跟版成本**：CEF 跟 Chrome 每 4 周一个大版本，`Cargo.toml` 的 `+156.0.15` 与二进制版本
   必须同步升。这是永久成本。
4. **安全**：v1 关闭沙箱（`no_sandbox = 1`）只为打通链路；上线前必须打开并用
   `sandbox_info` 传入 `initialize`，否则一个渲染进程漏洞就是本机任意代码执行。
5. **两套后端的行为漂移**：命令级测试必须同时跑 wry 与 CEF，否则 fallback 路径会腐烂。

## 7. 验收

- `--features cef` 构建出的程序：浏览 → 保存 → 检索 → 引用 主路径与 wry 构建行为一致。
- 删除 `libcef.dll` 后启动：自动回落 wry，`browserCapabilities.pageEngine` 为 `wry` 且
  `pageEngineFallback` 有可读原因。
- `browser_capabilities` 在两个后端下返回各自的真实能力，不谎报。
- 安装包体积与升级策略有书面结论（T7）。

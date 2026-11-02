# 页面引擎选型：wry 与 CEF

> 状态：决策记录（2026-11-02）。
> 结论：**近期以 wry（系统 WebView）为主，CEF 作为远期规划**，不进入当前迭代。
> 关联：[PageEngine 抽象](page-engine.md) · [Windows CEF 接入方案](cef-windows-plan.md) · [WebView 原生能力矩阵](browser-native-capability-matrix.md)

## 0. 决策

| 事项 | 结论 |
| --- | --- |
| 当前主力引擎 | **wry**：Windows 用 WebView2，macOS 用 WKWebView，Linux 用 WebKitGTK |
| CEF 的定位 | **远期规划**。`engine/cef.rs` 与 `--features cef` 保留为可选实现，不进入默认构建与 CI 默认路径 |
| 是否提供界面上的引擎切换 | **否**。发布版不含 CEF 运行时，开关无法兑现；排障仍用 `ARCADIA_PAGE_ENGINE=cef` |
| 若诉求只是「固定内核版本」 | 优先评估 **Fixed Version WebView2**（见 §8），成本比 CEF 低一个数量级 |
| 重新讨论的前提 | 出现 §10 列出的任一触发条件 |

一句话：**wry 是「别人替你养内核」的路线，CEF 是「自己养一个浏览器」的路线。**产品闭环还没验证完之前，把内核变成自有资产不划算。

## 1. 两者是什么

- **wry** 是 Rust 的 WebView 抽象库，Tauri 的网页承载层就是它。它**不含内核**，只把操作系统已有的 WebView 包一层统一 API。
- **CEF**（Chromium Embedded Framework）是完整的嵌入式浏览器框架，**自带一份 Chromium**（当前锁定 `156.0.15+gcf671c0+chromium-156.0.8078.80`，约 350 MB），通过 C/C++ API 暴露浏览器级能力。

| 维度 | wry（Tauri WebView 层） | CEF |
| --- | --- | --- |
| 定位 | WebView **封装库**，不含内核 | 完整**浏览器框架** |
| 内核来源 | 系统：WebView2 / WKWebView / WebKitGTK | 自带 `libcef.dll` + 资源包，随应用分发 |
| 版本控制 | **不受控**，Evergreen 自动升级 | **完全受控**，固定版本 |
| 新增体积 | 0（依赖系统组件） | 约 350 MB |
| 平台 | 三端一套代码 | 三端可跑，但打包与公证各自为政 |
| API 面 | Tauri 稳定 API 的子集 + `webview2-com` 手工 COM 逃生口 | 完整 CEF C API（数十个 handler） |
| 进程模型 | 每标签一个 WebView2 controller，**共享** WebView2 进程树 | 自管 browser / renderer / GPU / utility 子进程与沙箱 |
| 编译与集成 | `cargo build` 直接过 | C++ wrapper 冷编译约 8 分钟；`main()` 要被 CEF 子进程分流接管 |
| 安全更新 | 微软推 Edge 更新，应用自动受益 | Chromium 每 4 周一个大版本，**自己跟** |
| 谁在用 | Tauri 生态全部应用 | Spotify、Steam、Teams（旧版）、各类 IDE |

## 2. wry 的优势

1. **零分发成本。** 安装包保持 MB 级；不用管 dll 加载、资源路径、子进程 exe 路径，也不会因自带浏览器运行时触发杀软误报。
2. **三端一套代码，且是 Tauri 一等公民。** WebView 生命周期、事件、权限、注入脚本、`eval` 全部现成。这也是 `PageEngine` 抽象能低成本落地（40 处 `get_webview`、15 处 `.eval()` 收敛进 trait）的原因——wry 的语义和 Tauri 完全同构。
3. **系统级优化红利。** WebView2 共享 Edge 的进程复用、GPU 加速、休眠策略；WKWebView 共享 Safari 的 JIT 与内存压缩。自打包 CEF 拿不到这些。
4. **安全补丁不需要自己扛。** 浏览器内核 CVE 频率很高。Evergreen 意味着用户由微软打补丁；CEF 意味着旧版本会一直带着已知漏洞，除非持续发版。
5. **能力缺口多数只是「Tauri 没暴露」，不是「做不到」。** 项目已用 `webview2-com` 手工 COM 补齐了证书拦截（`ICoreWebView2_14`）、按 origin 清站点数据（`ICoreWebView2Profile2`）、标签挂起（`ICoreWebView2_3::TrySuspend`）。wry 的真实成本是「每个深层能力写一次 COM」，而不是「拿不到」。

## 3. wry 的局限

1. **内核版本不可控，行为会漂移。** Evergreen 自动升级：今天 156、下个月可能是 158，CSS/JS 假设、渲染差异、API 行为都可能变。**无法固定、无法回滚、无法在 CI 里锁定**，问题往往只在用户机器上出现。
2. **能力上限由 Tauri 暴露面决定，且按平台割裂。** macOS / Linux 上证书拦截、清站点数据、原生权限事件、请求过滤均为 no-op，实际上形成「Windows 功能完整、其他平台阉割」的格局。
3. **单标签隔离做不到。** 每标签一个 controller，但共享同一浏览器进程树：拿不到单标签内存、单标签崩溃隔离、独立 cookie jar（容器标签）、独立 profile。
4. **依赖用户机器上的 WebView2 Runtime。** Win10 早期版本、精简系统、部分企业镜像缺失；离线/内网环境是硬伤。
5. **请求拦截粒度不如 CEF。** WebView2 的 `WebResourceRequested` 只能改 header/URL、拦请求；CEF 的 `CefResourceRequestHandler` 能做响应改写、重定向链控制、自定义 scheme handler。

## 4. CEF 的优势

1. **内核完全可控。** 固定版本 = 行为可复现、可回归、可回滚。对「正文提取结果要稳定」这类知识库需求是实质收益；`scripts/fetch-cef.ps1` 按 `Cargo.toml` 版本下载正是为此。
2. **能力是完整浏览器级。** `CefResourceRequestHandler`（请求/响应双向改写、自定义协议）、`OnCertificateError`、`OnBeforeBrowse`（导航前拦截，比注入脚本拦 `target=_blank` 干净）、原生下载管理、DevTools remote debugging、多进程沙箱、每标签独立 `RequestContext`（真正的容器标签/隐私隔离）。
3. **进程隔离是天然语义。** renderer 崩溃只影响一个标签；现在要靠 `webview_process_guard` 监测 WebView2 进程失败，在 CEF 里这是内建行为。
4. **跨平台行为可统一。** 同一套 Chromium 跑三端，回归只需针对一个内核，理论上能消灭能力矩阵的平台分裂。
5. **不依赖任何系统组件。** 离线、内网、精简系统、无 Edge 的 Windows Server 都能跑。

## 5. CEF 的成本

1. **包体积从 MB 级涨到 300 MB 级。** 下载转化率、更新带宽、安装时长、签名耗时全部受影响。这是产品决策，不是技术决策。
2. **安全更新变成自己的责任。** Chromium 每 4 周一个 stable，CEF 分支跟随：要么持续升级（每次大版本跳跃 + 回归），要么带着已知 CVE 发版。**这是最容易被低估的长期成本。**
3. **进程模型侵入应用入口。** CEF 子进程复用同一个 exe、靠 `--type=...` 区分，`main()` 必须在 Tauri 初始化前分流，进而影响启动路径、崩溃上报、单实例锁、命令行解析的所有假设。
4. **线程亲和性会把代码结构拧弯。** CEF 对象引用计数非原子、`!Send`、绑定 CEF UI 线程；`BROWSERS` 只能是 thread_local，每个操作都要 `post_task` 到 UI 线程。这是长期维护负担。
5. **`eval_value` 要自己搭桥。** wry 里 `EvaluateScript` 直接拿返回值；CEF 必须走 `CefMessageRouter`（JS ↔ C++ 异步 IPC）加 Promise/超时管理。没有这座桥，保存网页、页面状态、资源探测、截图全部不可用。
6. **跨平台打包复杂度陡增。** macOS 要处理 framework 布局、Helper 子应用、公证与 hardened runtime；Linux 要处理发行版 glibc 差异。所以本项目一开始就把 CEF 收敛为 Windows-only。
7. **调试体验反而变差。** DevTools 要开 remote debugging port，沙箱加多进程下断点、日志、崩溃分析都更麻烦。

## 6. 落到本项目的能力差距

| 需求 | wry 现状 | CEF 现状 |
| --- | --- | --- |
| 保存网页正文（依赖 `eval_value`） | ✅ 直接可用 | ❌ 需 MessageRouter（T4） |
| 广告 / 追踪拦截（请求过滤） | ✅ 已用 COM 实现 | ⚠️ 需重写为 `CefResourceRequestHandler` |
| 证书拦截 | ✅ Windows 已实现，macOS/Linux no-op | ⚠️ `OnCertificateError`，需重写 |
| 权限提示 | ✅ 注入脚本 + COM | ⚠️ `OnRequestMediaAccessPermission`，需重写 |
| 截图 | ✅ | ❌ 未实现 |
| 清站点数据 | ✅ Windows | ❌ 未实现 |
| 标签挂起 / LRU | ✅ `TrySuspend` | ⚠️ `WasHidden` 语义不同 |
| 每标签内存 | ❌ | ✅ 可拿 |
| 容器标签 / 独立 profile | ❌ 成本高 | ✅ `RequestContext` |

**这张表就是结论：wry 侧的能力是「已经做完的」，CEF 侧是「全部要重做一遍」。**现在切过去等于推翻已验证的产品链路重建。

## 7. 为什么不做「界面上的引擎选项」

需求侧曾提出「默认 wry、用户可切 CEF」。技术上可以，但当前不成立：

1. **CEF 生命周期不允许热切换。** `CefInitialize` / `CefShutdown` 每进程只允许一轮，切过去就回不来，只能「保存 → 重启生效」。
2. **发布版里没有 CEF。** 默认构建不含 `cef` feature；要让选项可用必须随包分发 350 MB 的分发版，且 `libcef.dll` 必须与 exe 同目录（Tauri 默认塞进 `resources/`，需要额外映射或复制）。
3. **CEF 后端尚未达到能力等价。** 见 §6，`eval_value` 缺失会直接打断「保存到知识库」主链路。此时开放选项，等于把一个半成品当成品推给用户。

因此：**选项的位置保留在 `PageEngine` 抽象与 `capabilities.pageEngine` 上报里，界面开关等 CEF 补齐后再做。**

## 8. 中间路线：Fixed Version WebView2

如果真实诉求是「内核版本可控 + 不依赖用户机器上的 WebView2」，这条路比 CEF 便宜一个数量级：**仍是 wry 代码路径，只是把 WebView2 Runtime 随包分发并用 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指过去。**

| | wry + 系统 WebView2 | wry + 固定版 WebView2 | CEF |
| --- | --- | --- | --- |
| 新增体积 | 0 | 约 180 MB | 约 350 MB |
| 内核版本 | 不受控 | **固定** | 固定 |
| 代码改动 | — | 改启动参数/环境变量 | 重写整个 `PageEngine` 实现 |
| 现有 COM 代码 | 全部复用 | 全部复用 | 全部重写 |
| 安全更新 | 微软 | 自己（下载新版 Fixed Version 包） | 自己 |
| 平台 | 三端 | 仅 Windows | 三端（各自打包） |

**适用判据：只要「固定版本」，选它；要「摆脱微软组件 / 需要 WebView2 没有的深层能力」，才轮到 CEF。**

## 9. 对当前工作的约束

1. **页面操作一律走 `PageEngine` trait。** 业务层不得出现 `tauri::Webview` / `app.get_webview(...)`；平台模块只能通过 `engine::with_platform_webview` 逃生口拿句柄。这是日后换内核唯一不返工的前提。
2. **新增原生能力先查 wry 暴露面**，再在「注入脚本 / 手工 COM / 放弃」三选一，并把结论写进 [能力矩阵](browser-native-capability-matrix.md)，同时更新 `browser_capabilities` 与前端契约。
3. **不要写死内核版本假设。** Evergreen 会升级，`chromium_major` 是「当前实际值」而非常量；前端不得据此锁定 CSS/JS 行为。
4. **CEF 代码保持可选。** `cef` 依赖、`engine/cef.rs`、`main.rs` 的子进程分流都必须在 `cfg(feature = "cef")` 下；默认 `cargo check --all-targets` 不依赖 CEF，CI 默认路径不跑 CEF。
5. **能力上报要区分「实际在用」与「构建是否包含」。** 现在只有 `pageEngine` / `pageEngineFallback`；若将来加界面开关，需要补 `pageEngineRequested` 与 `cefCompiled`，否则前端只能靠猜。

## 10. 重新评估的触发条件

出现任意一条，就把 CEF 从远期规划拉回排期：

1. **必须固定或回滚内核**：正文提取/渲染结果要可复现，或客户合同要求版本锁定。
2. **必须支持离线、内网、无 WebView2 的环境**（政企、精简系统、Windows Server）。
3. **需要 wry 结构上拿不到的能力**：真正的容器标签（独立 cookie jar）、细粒度响应改写、自定义协议、单标签内存与崩溃隔离。
4. **要做多内核浏览器**：那时 CEF 是第一个替代内核的必然选择。
5. **WebView2 出现阻断级行为变化**且无法通过 COM 绕过。

## 11. 工作量估算（估）

| 路线 | 到达「可用」的估算 | 说明 |
| --- | --- | --- |
| Fixed Version WebView2 | 1–2 天 | 打包 + 路径注入 + 干净机器验证，代码复用现有 wry 路径 |
| CEF 补齐（T4：`eval_value` + 请求过滤 + 证书/权限 handler） | 2–3 周 | 不含打包；`engine/cef.rs` 现有覆盖仅为进程模型与导航/几何 |
| CEF 发行版（打包、双包分发、签名、CI） | 3–5 天 | 含 `libcef.dll` 同目录映射与干净机器回落验证 |

参照 [Windows CEF 接入方案](cef-windows-plan.md) 的既有结论：CEF 冷构建约 8 分 22 秒（主要是 `libcef_dll_wrapper` 的 C++ 编译）。

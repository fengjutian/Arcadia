# 开发路线与任务拆分

> 本文档按代码实际状态维护，不是计划稿。最后校验：2026-10-27。
> 状态图例：`[x]` 已实现并有测试覆盖 · `[~]` 部分实现或仅单平台 · `[ ]` 未开始。

## Iteration 0：地基

- [x] PRD、架构、迁移设计与 Tauri 工程
- [x] React 产品壳与核心页面
- [x] Rust 端 SQLite + FTS5（迁移 #17：虚表 + 触发器同步 + BM25 排序 + 前缀匹配）
- [x] Tauri 工程及插件权限（`capabilities/default.json`）
- [x] 版本化迁移器：`schema_version` 表 + `MIGRATIONS` 常量 + 启动钩子，当前 26 个迁移
- [x] 前端 Vitest + Rust cargo test（Windows 上经 `npm run test:rust`，见「测试现状」）

## Iteration 1：可浏览

- [x] 为每个 Tab 创建/销毁独立 WebView
- [x] WebView 切换、尺寸同步、导航、刷新和历史控制
- [x] 页面 URL、标题与加载状态同步
- [x] favicon 同步与 history 可用状态读取
- [x] 新窗口转应用内标签、外部协议确认、证书错误拦截
- [x] 标签重排、分组、同域关闭、静音、标签搜索
- [x] 私密标签、工作区、会话恢复、崩溃恢复、最近关闭标签
- [x] 站点权限提示（三态）与权限等待超时
- [x] 证书错误拦截：Windows 走 `ICoreWebView2_14::add_ServerCertificateErrorDetected` 真实订阅；macOS / Linux 为 no-op
- [x] 下载中心：`reqwest` 流式 + Range 续传 + 危险文件判定 + 暂停/取消/重试
- [x] 媒体资源探测 MVP：Resource Timing + DOM 媒体元素扫描、分类去重、复制链接与下载中心联动
- [x] ~~启动/监管 Go sidecar~~ — 已取消，Go 后端整条删除（见 §决策记录）

## Iteration 2：Reader 与持久化

- [x] 集成 Mozilla Readability 正文提取
- [x] Turndown HTML → Markdown、危险内容清理与资源地址规范化
- [x] 从原生 WebView 按需获取 DOM 并展示 Reader Mode
- [x] SQLite Repository、迁移器、事务与 FTS5
- [x] Rust 端 `local_documents` 写入即 READY
- [x] 本地 Markdown 文档阅读、来源跳转、导出、删除确认、星标、收藏、集合、笔记
- [x] 页面懒加载与 vendor 分包
- [x] 持久化任务表 `tasks`，含 `attempts` / `max_attempts` / `available_at` / `last_error`
- [x] 任务重试退避（30s → 2min → 10min → 30min）、超时回收与崩溃后 stale 恢复
- [x] RAG 索引使用服务端 supervisor：启动时把卡在 `CHUNKING`/`EMBEDDING`/`INDEXING` 的任务重置为 `PENDING`，Provider 变更后标记 `STALE` 而非删除
- [x] 全库备份导出与恢复

## Iteration 3：AI 与隐私

- [x] Provider 配置与系统密钥环（`keyring`：Credential Manager / Keychain / Secret Service）
- [x] OpenAI Compatible 与 Ollama 两类 Provider，含 Base URL 校验
- [x] 流式摘要、页面问答、翻译、自动标签
- [x] 规则编译、网络拦截和站点级统计（Windows 真实拦截）
- [x] 网站封杀名单：用户名单 + 导航前取消 + 子资源阻断 + 命中记录（迁移 #26）
- [~] 敏感日志审计与权限集成测试 — 已有 `logRedaction` 与 Agent 审计日志，权限集成测试仍待补
- [~] 隐私拦截跨平台 — macOS / Linux 受 WKWebView / WebKitGTK 接口限制，暂为 no-op

## Iteration 4：RAG

- [x] 分块策略与版本化（`CHUNKER_VERSION`）、`document_chunks` + FTS5
- [x] Embedding 队列 `rag_index_jobs`，支持重试与陈旧标记
- [x] 本地向量索引（可插拔 `VectorIndex`，含 BruteForce 实现）
- [x] BM25 词法召回、RRF 融合
- [x] Reranker
- [x] 引用强制校验与修复（`rag_answer` 返回引用映射）
- [x] 跨文档问答与评测集（`retrievalEval` / `evaluator.rs`）

## Iteration 5：Agent、MCP 与插件（原计划外，已实现）

- [x] 受控 Agent：runtime / supervisor / tools / approval / budget / checkpoint / artifacts
- [x] Agent 工具风险分级与审批流，敏感调用写审计日志
- [x] MCP 客户端与 MCP 安全策略
- [x] 插件 Manifest v1 校验、`.arcadia-plugin` 安装器、权限授权表
- [x] Wasmtime 组件运行时：空 `WasiCtx`、Fuel、内存上限、epoch 超时
- [x] 插件生命周期（INSTALLING / DISABLED / ENABLED / FAILED / QUARANTINED）与审计
- [ ] 插件宿主能力覆盖全部内置功能（目前按批次开放）
- [ ] 插件市场与签名校验

## 进行中

界面布局与滚动所有权收口。最近若干次提交围绕 preview 布局诊断与 scroll audit 展开，诊断代码已移除，剩余工作是把滚动统一收敛到 `.route-view`，使侧栏与窗口 chrome 保持固定。当前工作区有一个未提交的 `desktop/src/styles/compact.scss` 改动正是该收尾。

## 测试现状

`npm run test:rust` 是 Windows 上的 Rust 测试入口，当前 **247 个用例全部通过**（前端为 61 个文件 / 481 用例）。

直接用 `cargo test` 会让测试二进制在加载阶段以 `0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）退出：`tauri` 默认特性 `common-controls-v6` 与 `tauri-plugin-dialog` 固定启用的 `rfd/common-controls-v6` 都会静态导入 `comctl32!TaskDialogIndirect`，该导出只存在于 comctl32 v6 组件，需要应用清单声明 `Microsoft.Windows.Common-Controls`。应用主程序由 `tauri-build` 注入清单，测试 harness 没有。

`desktop/scripts/run-rust-tests.mjs` 先构建测试 harness，再用 Windows SDK 的 `mt.exe` 把 `desktop/src-tauri/test-manifest.xml` 写入测试二进制后运行；不改依赖、不加全局链接参数，也不影响应用清单。非 Windows 平台直接透传 `cargo test`。

> 注：`cargo::rustc-link-arg-tests` 无法解决这个问题 —— 它只作用于 `[[test]]` 集成测试目标，不覆盖 `--lib` 单元测试；而给全目标加 `/MANIFEST:EMBED` 会与 `tauri-build` 已嵌入的 MANIFEST 资源冲突（CVT1100 duplicate resource）。

## 下一步（按优先级）

1. 提交布局收尾改动，结束当前工作流。
2. 清理残留：`tauri.conf.json` 的 CSP 仍白名单已删除的 `http://127.0.0.1:8787`；统一 `package.json`（0.3.0）与 `tauri.conf.json`（0.1.0）的版本号。
3. 补齐搜索分页，缓解文档量增长后的列表端压力。
4. 扩展插件宿主能力，覆盖知识库写入、AI 调用之外的常用能力。
5. macOS / Linux 的隐私拦截与证书拦截等价实现（受平台接口限制，需先做可行性验证）。

## 决策记录

- Go sidecar 整条移除。桌面应用从未真正调用该服务，Rust 端 `local_store.rs` 已承担全部持久化与检索职责；保留双存储会造成数据所有权分裂。
- 不采用独立进程 JSON-RPC 作为第三方插件运行时（难以在三平台稳定限制文件、网络、子进程和系统调用）；JSON-RPC 仍用于 MCP，但不作为插件安全边界。详见 [WASM 插件运行时方案](wasm-plugin-runtime-plan.md)。
- UI 组件层自建（`components/ui/`，API 对齐 Ant Design，底层 `@base-ui/react`），不引入 `antd` 依赖。

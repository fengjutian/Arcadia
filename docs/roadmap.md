# 开发路线与任务拆分

> 本文档按代码实际状态维护，不是计划稿。最后校验：2026-11-02。
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

## Iteration 6：交互遗产与知识沉淀（借鉴 Arc，规划中）

> 触发：[Arc 于 2026-12-22 停服](https://arc.net)，其交互模式已被 Dia 与主流浏览器吸收。本节只保留对「知识浏览器」定位成立的条目，目标不是成为 Arc 替代品，而是把 Arc 验证过的组织方式嫁接到「浏览 → 保存 → 检索 → 引用」闭环上。
> 状态以各条目勾选为准：`6.1`、`6.2`、`6.15` 已完成；`6.3`、`6.6`、`6.13`、`6.14` 部分落地，其余未开始。按性价比排序：`6.3` 不依赖布局收口；`6.4` 起依赖布局收口。
> 三大浏览器的补充模式（Omnibox 前缀、历史聚类、Collections、Immersive Reader、睡眠标签、容器与插件权限）见 [主流浏览器借鉴分析](browser-borrowing-analysis.md)。

### 6.1 统一命令栏

- [x] 借鉴：Arc 的 `⌘T` 命令栏把导航、切标签与动作执行合并在一个输入框，动作本身可被搜索（[Command Bar Actions](https://start.arc.net/command-bar-actions)）。
- 现状：`TabSearchPalette`、`BookmarkSearchPalette`、`HistorySearchPalette`、`BulkSummaryPalette` 是四个独立 Modal；地址栏只负责导航。
- 已落地（2026-11-02）：`features/command/` 提供 `CommandPalette` 与 `commandModel`（前缀解析、评分、分组），`Ctrl/⌘ + K` 打开；覆盖标签页、历史、收藏、归档、知识库与 10 个浏览器动作；`Tab` 循环范围，`@` / `~` / `/` / `?` / `>` 前缀直选；`!gh` 一类站内搜索（8 个内置快捷词，结果在新标签打开）；自定义 `!` 词表通过「管理快捷搜索词」维护，存 `local_session` 并随备份导出；已知域名 + `Tab` 进入站内搜索模式（再按 `Tab` 或 `Esc` 退出）。测试 16 + 16 例。
- 已落地（2026-11-02，旧入口下线）：删除 `TabSearchPalette`、`HistorySearchPalette`、`BookmarkSearchPalette` 及其快捷键（`Ctrl+Shift+A` / `Ctrl+H` / `Ctrl+Shift+O` 不再绑定）；历史删除/清空与收藏改名/删除迁到知识库（新增「收藏」页签、编辑弹窗，历史行内删除），新增 `local_delete_history` 命令；浏览器菜单与工具栏「查看全部」改为打开命令栏或知识库。`BulkSummaryPalette` 保留——它是任务对话框，不是搜索入口。
- 验收情况：四类结果同屏分组、键盘可达、动作有反馈、旧 palette 已移除；纯函数与交互测试见上。
- 做法：新增单一命令栏，前缀分域：`@` 标签、`/` 知识库、`?` 问 AI、`>` 动作；复用 `tabSearchIndex`、`historySearchIndex`、`bookmarkSearchIndex`；动作表映射现有高频 Tauri command。
- 增补（借 Chrome / Firefox）：`Tab` 就地切换搜索域；域名 + Tab 触发站内搜索，模板复用 `searchEngine.ts`；允许用户自定义 `!` 快捷词。
- 验收：`Ctrl/Cmd + K` 打开；四类结果同屏分组且键盘可达；动作有成功/失败反馈；旧 palette 入口保留一个版本周期后移除；新增纯函数与交互测试。

### 6.2 标签生命周期：Today → Archive → Library

- [x] 借鉴：Arc 的 Today 与自动归档——超时标签进入可搜索的 Archive，而不是直接消失。
- 现状：`closed_tabs` + `RecoveryPanel` 是「恢复」语义，知识库是「保存」语义，缺少「读过但没存」的中间层。
- 已落地（2026-11-02）：迁移 #31 `tab_archive` + `tab_archive_fts`（触发器同步）；命令 `local_archive_tab` / `local_list_archived_tabs` / `local_delete_archived_tab` / `local_clear_archived_tabs`；标签右键「归档标签页」、命令栏 `~` 归档检索与「归档当前标签页」动作；知识库「归档」页签（按日分组、打开、删除）。Rust 测试 `archive_roundtrips_through_fts`。
- 已落地（2026-11-02，自动归档）：`BrowserTab.lastActiveAt` 随会话持久化，恢复时旧会话以 `savedAt` 兜底；启动后一次性扫描，按配置的空闲时长归档非固定/非私密/非播放中标签并提示，失败保留原标签。`features/archive/archiveSettings.ts` 提供开关与 12h/24h/3d/7d 阈值（知识库「归档」页签内可改）。SearchPage 新增「浏览痕迹」分组。RAG 检索把归档页作为额外来源（合成 chunk id `archive:<id>`），AI 回答可引用并打开原文。纯函数 `planAutoArchive`（5 例）、设置读写（5 例）、`extra_source_hits` 与 `restoreFromSnapshot` 时间戳测试。
- 待补：无（容量上限 500/2000/5000/10000 可在知识库「归档」页签内配置，写入时按上限裁剪）。
- 做法：临时标签超时（默认 12 小时，可配置）或手动归档；归档写 SQLite 并同步 FTS5；搜索结果新增「浏览痕迹」类型；AI 引用允许指向归档页。
- 验收：归档后可按标题/URL 找回；私密标签永不归档；保留策略与容量上限可配置；UI 上「恢复」与「归档」语义不混淆。
- 增补（借 Chrome Journeys）：对历史做「研究轨迹」聚类视图，每簇可保存为集合或直接提问；聚类为纯函数，不新增表。

### 6.3 笔记/高亮落库并进入检索与 RAG

- [~] 借鉴：Arc 让笔记贴着浏览发生；本项目已实现划词笔记，但只完成了一半。
- 现状：`features/notes/notes.ts` 把高亮存在 `localStorage`（上限 500 条），不进 SQLite、不进 FTS、不进备份、不参与 RAG。
- 已落地（2026-11-02）：迁移 #32 `page_notes` + `page_notes_fts`；命令 `local_list/save/delete/clear_page_notes` 与 `local_search_page_notes`；`features/notes/noteStore.ts` 负责读写、旧 `localStorage` 一次性迁移与失败回滚；BrowserPage 改为异步加载并逐条持久化；SearchPage 新增「笔记」结果分组（FTS 命中、高亮引文与批注、点击回到原文）；备份（`local_export/import_backup`）新增 `notes` 字段并兼容旧备份。RAG 检索新增笔记/剪藏召回（`retrieval::extra_source_hits`，合成 chunk id `note:<id>` / `clip:<id>`），AI 回答可引用；前端引用条支持无文档行的来源，点击打开原文。Rust 测试 `page_notes_roundtrip_through_fts`、`extra_source_hits_include_notes_and_clips`。
- 待补：颜色与文本锚点的写入 UI、独立笔记浏览页、向量索引覆盖笔记。
- 做法：迁移到 SQLite 并随文档关联；写入 FTS5 与向量索引；保存网页时把该页笔记挂到文档；备份/导出覆盖笔记；一次性迁移旧 `localStorage` 数据。
- 验收：重启与备份恢复后笔记仍在；可按笔记正文检索；RAG 引用可标注笔记来源；迁移可重复执行且幂等。
- 增补（借 Chrome highlights）：高亮记录 `quote / prefix / suffix / color`，用文本锚点而非 XPath，保证页面改版后仍可定位。

### 6.4 Space 化工作区

- [ ] 借鉴：Arc 的 Space 是独立标签集合 + 身份 + 默认行为，切换 Space 等于换一个浏览器。
- 现状：`workspaces` 表只存 `payload` 快照，入口在设置页点「恢复」；标签仍是顶部横向 Tabs；左侧 64px rail 只切换视图。
- 做法：Workspace 升级为 Space，绑定知识集合、AI 上下文范围与站点路由（见 6.5）；新标签与保存默认落当前 Space；侧栏提供 Space 切换。
- 验收：切换 Space 不丢失未保存标签；集合与 AI 上下文按 Space 隔离；会话恢复按 Space 还原；旧 `workspaces` payload 有迁移路径。
- 增补（借 Edge Workspaces / Chrome 标签组）：支持「整体打开」；命名/颜色/持久化的标签组作为 Space 内的第二层结构。
- 依赖：布局与滚动所有权收口完成。

### 6.5 站点路由（Arc ATC 的知识库版）

- [ ] 借鉴：Arc 的 Air Traffic Control 按域名把页面路由到固定 Space/Profile（[ZDNET](https://www.zdnet.com/article/arcs-air-traffic-control-is-a-great-way-to-keep-your-browser-organized/)）。
- 做法：新增 `site_routing` 表（host → Space / 集合 / 是否默认进 Reader）；导航前匹配；沿用 `site_blacklist` 的内存快照 + 写路径整体替换模式，避免在 WebView2 回调线程上访问 SQLite。
- 验收：命中规则自动归位；规则可暂停、删除、即时生效；不阻塞导航线程；规则冲突（多条命中）有确定优先级。

### 6.6 引用 Peek

- [~] 借鉴：Arc 的 Peek 就地预览、不离开当前页；本项目只保留与引用相关的部分。
- 已落地（2026-11-02）：`features/peek/PeekDrawer.tsx` 统一预览笔记、归档条目与文档（文档按 12k 字截断，带「查看全文 / 打开原文」）；搜索结果里的笔记/浏览痕迹改为就地预览，AI 回答的引用改为 Peek（「查看全文」再进入完整文档抽屉）。知识库卡片仍用完整抽屉。
- 待补：首屏 300ms 指标实测（目前未压测）、知识库卡片是否也切到 Peek 待评估。
- 做法：在 AI 回答引用、搜索结果、知识库卡片三处提供侧栏预览；复用 Readability/Turndown 管线与本地 Markdown 渲染；不触发网页脚本、不发生导航。
- 验收：三处入口均可打开；首屏 300ms 内出内容；支持「在标签页打开」；当前页面与对话状态不丢失。

### 6.7 「随手收」小窗（Little Arc）

- [ ] 借鉴：Arc 从其他应用点链接时弹小窗，不打断当前 Space。
- 做法：全局快捷键或托盘唤起单 WebView 小窗 → 提取正文 → 摘要 + 保存到当前 Space 的集合 → 关闭；复用 `FloatingAssistantWindow` 的多窗口经验。
- 验收：不打断主窗口与当前标签；保存失败有明确错误与重试；私密/敏感站点默认不自动提取；支持「在主窗口打开」。

### 6.8 新标签页改为研究现场

- [ ] 借鉴：Arc / Arc Search 的新标签是「输入框 + 最近上下文」，不是门户。
- 现状：`NewTabPage` 是搜索引擎 + 微软/Google 工具矩阵 + 天气。
- 做法：首屏展示当前 Space、待整理（读过未存）、最近保存、今日阅读；搜索引擎选择保留，工具矩阵降级为次要入口。
- 验收：无数据时有引导而非空白；首屏可交互时间不超过 200ms；不引入新的网络依赖。

### 6.9 按站点阅读偏好（Boosts 的安全子集）

- [ ] 借鉴：Arc 的 Boosts 支持按站点定制外观，但本项目只取不执行脚本的部分。
- 做法：站点级 Reader 偏好（字号、宽度、主题、是否自动进 Reader）与纯 CSS 隐藏元素；后者走插件 grant，与 `browserAppearance`、`typography` 衔接。
- 验收：站点级覆盖优先于全局；只注入 CSS，不执行站点提供的脚本；可一键恢复默认。

### 6.10 Space 视觉身份

- [ ] 借鉴：Arc 给 Space 配图标与颜色，让「位置感」可被一眼识别。
- 做法：Space 颜色/图标、标签自定义命名、保存完成的「沉淀」微动效；沿用现有米色纸张体系。
- 验收：与现有视觉语言一致；不引入 `antd`；正文与控件对比度满足 WCAG AA；动效可被「减少动态效果」关闭。

### 6.11 Arc / Dia 数据导入（时机项）

- [ ] 触发：Arc 停服前后会有一批用户需要安置书签、文件夹与标签。
- 做法：解析 Arc/Dia 导出的书签 HTML 与标签清单，预览后写入 `bookmarks` 与 Space。
- 验收：导入前可预览与去重；写入在事务内完成，失败不留下半份数据；不导入密码等敏感数据。

### 6.12 分屏泛化：任意两个对象并排

- [ ] 借鉴：Arc 的 Split View；本项目已有更强的「多来源搜索对比」（`SearchComparisonWorkspace`）。
- 做法：把对比布局泛化为「网页 vs 文档、文档 vs 文档、文档 vs 对话」；Rust 侧复用每标签独立 WebView 与尺寸同步。
- 验收：分屏关闭不关闭标签；焦点与权限提示归属正确；窗口缩放与最小宽度有明确降级。
- 依赖：布局收口完成。

### 6.13 睡眠标签 UI 与站点例外

- [~] 借鉴：Chrome Memory Saver / Edge Sleeping Tabs——机制的价值在可见性与可控性，不在回收本身。
- 现状：`webview_suspend.rs` 已在 Windows 真实调用 `ICoreWebView2_3::TrySuspend`，`lruPolicy.ts` 已保护固定/发声/下载中的标签；但界面没有睡眠态、没有原因说明、没有站点例外。
- 已落地（2026-11-02）：睡眠标签在标签条显示月亮徽标 + 悬停提示；标签右键新增「立即休眠 / 唤醒标签页」（当前标签与固定标签不可休眠）；手动休眠会先记录滚动位置再挂起，非 Windows 走「销毁 WebView + 点击重建」的既有降级路径。
- 待补：站点级「永不自动休眠」与原因说明；唤醒后滚动位置的恢复提示。
- 做法：标签睡眠徽标与 hover 原因；右键「立即休眠 / 唤醒」；站点级「永不自动休眠」；唤醒后的状态恢复提示。
- 验收：睡眠态可被用户识别；唤醒不丢导航历史；例外规则持久化并即时生效；非 Windows 平台明确降级为不可用而非静默失败。

### 6.14 阅读队列（待读）

- [~] 借鉴：Chrome Reading List——「稍后读」与「已保存」是两种不同意图。
- 现状：只有「保存到知识库」，没有轻量的待读队列。
- 已落地（2026-11-02）：迁移 #33 `reading_queue`（按 URL 去重，重复加入只更新时间）；命令 `local_list/add/remove/clear_reading_queue`；标签右键「稍后读」、命令栏「稍后读（加入待读）」动作；知识库「待读」页签（打开原文、移出）。Rust 测试 `reading_queue_upserts_by_url_and_keeps_newest_first`，前端 `features/reading-queue/` 5 例。
- 待补：地址栏星标旁的快捷入口；「读完转保存」的一键动作。
- 做法：新增阅读队列（`reading_queue` 表或 documents 状态扩展）；入口在地址栏星标旁与知识库「待读」页签；读完可一键转保存或归档。
- 验收：加入/移除有即时反馈；队列按加入时间排序；重启后保留；与归档（6.2）语义不重叠。

### 6.15 剪藏片段

- [x] 借鉴：Edge Collections——把选区、图片、链接连同备注收进集合，而不是只能整篇保存。
- 已落地（2026-11-02）：迁移 #34 `clips` + `clips_fts`；命令 `local_list/search/save/delete/clear_clips`；右键菜单新增「剪藏选中文字 / 剪藏此链接 / 剪藏此图片 / 剪藏整页」，自动带上来源 URL 与标题；命令栏新增「剪藏当前页」动作；知识库新增「剪藏」页签（按类型、来源、时间展示，可按集合筛选，可跳回原文、删除，按行归入集合，单条或筛选结果导出 Markdown 并保留出处）；SearchPage 新增「剪藏」结果分组，命中后走 Peek 预览；RAG 可把剪藏作为引用来源。Rust 测试 `clips_roundtrip_through_fts`、`extra_source_hits_include_notes_and_clips`，前端 `features/clips/` 9 例。
- 做法：统一「剪藏」对象（`kind / content / sourceUrl / note / collectionId`），落 SQLite、进 FTS5、可导出；选区来源复用右键菜单「加入笔记」。
- 验收：四类剪藏均可创建；来源可回溯；导出 Markdown 保留出处；与整篇保存共用一套检索与引用。

### 6.16 统一站点面板

- [ ] 借鉴：三家浏览器的「点地址栏锁图标 → 一个面板看站点数据」。
- 现状：站点权限、网站封杀、广告过滤、清除站点数据分散在四处。
- 做法：合并为单一 `<SitePanel>`，分区展示权限、屏蔽规则、过滤统计与清除入口。
- 验收：一个入口可达全部站点级设置；改动即时生效；不复用旧的四套弹层。

### 明确不做

- **Boosts 式任意 JS/CSS 注入**：与「网页不可信、插件默认零能力」的安全模型冲突。
- **Easel 式白板/画布**：偏离「浏览 → 沉淀 → 检索」闭环，收益不在本产品主路径上。
- **以云账号或同步作为使用前提**：本地优先与数据可带走是差异点；Arc 停服时用户被迫导出正是反例。
- **为差异化重做浏览器 chrome**：Arc 的教训是学习成本高于交互收益，主流浏览器随后补齐了垂直标签与分屏。

## Iteration 7：内核演进（实验期 WebView → Chromium）

> 定位：这是**平台阶段的划分**，不是「现在不是 Chromium」。Windows 上的 WebView2 本身就是 Chromium 内核；两者的差别在于内核由谁分发、由谁锁定版本，以及宿主能拿到多少接口。

- [ ] 实验阶段继续使用系统 WebView（Windows：WebView2；macOS：WKWebView；Linux：WebKitGTK），验证成功后再接入自带 Chromium。
- 为什么实验期先用 WebView：
  - 零内核维护：不打包 Chromium 运行时（约 150–250 MB），安装包保持 MB 级，安全更新跟随系统。
  - 产品验证优先：浏览 → 保存 → 检索 → RAG → Agent 的闭环是当前要验证的对象，内核不是变量。
  - 跨平台成本低：三端都由系统提供内核，不必自建渲染进程管理、GPU 兼容与输入法处理。
- 代价（已记录在能力矩阵）：`wry` 暴露面窄，原生权限事件、原生右键菜单、单标签进程内存、音频检测只能靠注入脚本或手工 COM；macOS / Linux 的隐私拦截与证书拦截为 no-op。见 [WebView 原生能力矩阵](browser-native-capability-matrix.md)。
- 验证成功的判据（进入第二阶段的出口，任一项未满足则继续留在 WebView）：
  1. 「浏览 → 保存 → 检索 → 引用」主路径在真实使用中稳定，无阻断级缺陷。
  2. 布局与滚动所有权收口完成，§进行中 关闭。
  3. 数据层（SQLite / FTS5 / RAG / Agent）与 webview 承载层解耦，业务代码不直接调用 Tauri webview API。
  4. 内核能力缺口有书面清单：区分「产品必需」与「有了更好」。
- 第二阶段做法（**暂缓，见本节末尾决策**）：以 CEF（或等价的自托管 Chromium）作为 `PageEngine` 的第二个实现，与现有 wry 实现并存，用 feature flag 切换。**已收敛为 Windows-only**：CEF 只随 Windows 构建分发，wry 始终保留为回落路径（初始化失败自动降级并上报原因）。详见 [Windows CEF 接入方案](cef-windows-plan.md)。
- 启动条件（顺序不可颠倒）：
  1. ~~先把 webview 承载层收口成内部 trait（`create / eval / navigate / set_bounds / capture / focus`），把散落在 `lib.rs` 的 `get_webview`（40 处）与 `.eval()`（15 处）全部收进去。这一步无论最终换不换内核都该做。~~ **已完成（2026-11-02）**：`desktop/src-tauri/src/engine/` 提供 `PageEngine` trait 与 `WryPageEngine` 实现；业务命令只按 tab label 调用，`get_webview` 仅存在于 `engine/wry.rs`（1 处解析 + 2 处存在性检查），平台模块统一走 `with_platform_webview` 逃生口。行为与错误文案保持不变。
  2. 补齐运行时版本探测（`webview_version` / `chromium_major`），作为两套实现的行为基线。已实现，见 `browser_capabilities`。
  3. 最后才引入 CEF，且只在新实现上做能力增强，不回改业务层。
- 什么情况下换 CEF 才划算：需要 Chrome 扩展、需要完整 CDP、需要锁定内核版本、或需要三端同内核。若痛点只是权限事件 / 右键菜单 / 单标签内存，走 `webview2-com` COM 路径即可，不换内核。
- 验收：实验期功能在 CEF 实现下行为等价；能力矩阵中标为「不支持」的条目逐项转为支持或有明确降级；安装包体积与升级策略有书面结论；两套实现共用同一份前端契约（`services/browserCapabilities.ts`）。
- 明确不做：不把「换 Chromium」当成能力补齐的捷径——换内核只解决宿主接口问题，不解决产品问题。
- **决策（2026-11-02）**：CEF 列为**远期规划**，近期以 wry 为主，不提供界面上的引擎切换（发布版不含 CEF 运行时，开关无法兑现）。多路径对比、能力差距与重新评估的触发条件见 [页面引擎选型](page-engine-selection.md)。

## 进行中

界面布局与滚动所有权收口。最近若干次提交围绕 preview 布局诊断与 scroll audit 展开，诊断代码已移除，剩余工作是把滚动统一收敛到 `.route-view`，使侧栏与窗口 chrome 保持固定。2026-11-02 校验：`desktop/src/styles/compact.scss` 当前无未提交修改。

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
6. 继续 Iteration 6 收尾：`6.3` 把笔记接入搜索与 RAG；`6.1` 站内搜索模板、自定义 `!` 快捷词；`6.2` 自动归档与 SearchPage 浏览痕迹。
7. 布局收口完成后进入 `6.4` Space 化与 `6.5` 站点路由；`6.6`–`6.12` 按用户反馈再排序。
8. ~~Iteration 7 的第 1 步：把 webview 承载层收口为 `PageEngine` trait，作为日后接入 Chromium 的前置条件；只做抽象，不改变现有行为，可在 `6.4` 之前并行。~~ 已完成（2026-11-02）：见 `desktop/src-tauri/src/engine/`。下一步是先按 §进行中 收口布局，再决定是否进入 CEF 第二阶段——启动条件第 2 条（版本探测）已具备，第 3 条需要书面结论。

## 决策记录

- Go sidecar 整条移除。桌面应用从未真正调用该服务，Rust 端 `local_store.rs` 已承担全部持久化与检索职责；保留双存储会造成数据所有权分裂。
- 不采用独立进程 JSON-RPC 作为第三方插件运行时（难以在三平台稳定限制文件、网络、子进程和系统调用）；JSON-RPC 仍用于 MCP，但不作为插件安全边界。详见 [WASM 插件运行时方案](wasm-plugin-runtime-plan.md)。
- 借鉴 Arc 只限交互层（Space、标签生命周期、命令栏、Peek、按站点规则），不沿用其「通用浏览器替代品 + 云账号」路线；理由见 Iteration 6 的「明确不做」。
- UI 组件层自建（`components/ui/`，API 对齐 Ant Design，底层 `@base-ui/react`），不引入 `antd` 依赖。
- 实验阶段使用系统 WebView，验证成功后再评估接入自带 Chromium。理由：换内核等于重写 webview 承载层（约 1–2 个月专项 + 永久跟版成本），在产品闭环未验证前投入不划算；且 Windows 上 WebView2 本身已是 Chromium，真正的差距是宿主接口与跨平台一致性。详见 Iteration 7 与 [页面引擎选型](page-engine-selection.md)。

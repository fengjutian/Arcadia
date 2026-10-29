# 插件生态分析：现状、缺口与可引入能力

> 依据当前工作区代码（2026-10-29，含未提交的 PDF/DOCX 附件改动）。
> **结论先行**：真正"可安装的插件"目前只有第三方 WASM 插件一条链路；设置页里的两个"内置插件"是前端开关，不走插件系统。插件平台已经具备不错的安全底座，但**能力面明显小于权限面**——15 个权限只有 4 个有宿主实现，事件 6 个，UI 扩展位置 1 个。下一步的收益不在"再写几个插件"，而在补齐宿主能力、UI 扩展点与分发链路。

---

## 1. 当前"插件"到底有几个

### 1.1 内置插件（2 个，前端实现，不是运行时插件）

| 名称 | 实现 | 开关存储 | 是否受插件系统管理 |
| --- | --- | --- | --- |
| 链接净化器 | [`trackingCleaner.ts`](../desktop/src/features/plugins/trackingCleaner.ts) | `localStorage` | 否：无 manifest、无权限、无审计、不可分发 |
| 广告过滤器 | [`adBlocker.ts`](../desktop/src/features/plugins/adBlocker.ts) + 注入脚本 | `localStorage` | 否：默认开启，仅按会话统计 |

设置页把它们标成"示例 / 内置"（[`SettingsPage.tsx`](../desktop/src/pages/settings/SettingsPage.tsx#L1021-L1024)），但它们在数据库 `plugins` 表里没有记录，也不会出现在审计里。**"插件"在产品文案与运行时里是两套东西。**

### 1.2 第三方 WASM 插件（唯一真正的插件链路）

- **包格式**：`.arcadia-plugin`（ZIP），`plugin.json` + `plugin.wasm` + 可选 `assets/`；单包 20 MiB、解压 50 MiB、最多 256 个文件；校验 `sha256`，组件路径固定为 `plugin.wasm`（[`installer.rs`](../desktop/src-tauri/src/plugins/installer.rs#L61-L146)）。
- **运行时**：Wasmtime Component Model + WIT，空 `WasiCtx`，64 MiB 线性内存、1000 万 Fuel、5 秒 epoch 超时、单实例（[`runtime.rs`](../desktop/src-tauri/src/plugins/runtime.rs#L22-L24)、[`runtime.rs`](../desktop/src-tauri/src/plugins/runtime.rs#L257-L276)）。
- **宿主函数 6 个**：`log`、`knowledge_search`、`knowledge_get`、`knowledge_save`、`ai_chat`、`http_fetch`（[`arcadia-plugin.wit`](../desktop/src-tauri/wit/arcadia-plugin.wit#L1-L17)）。
- **权限 15 个**：见下表，实际有宿主实现的只有 4 个。
- **事件 6 个**：`page.loaded`、`tab.closed`、`document.saved`、`document.updated`、`document.deleted`、`ui.command`（最后一个是前端按钮触发的命令通道，不是生命周期事件）。
- **UI 贡献**：只允许 `location = "settings"`，渲染成一个按钮，点击后向插件派发 `ui.command`（[`manifest.rs`](../desktop/src-tauri/src/plugins/manifest.rs#L72-L80)）。
- **生命周期**：安装后 `DISABLED` → 授权 → `ENABLED`，启动失败 `FAILED`，启动时恢复已启用插件（[`installer.rs`](../desktop/src-tauri/src/plugins/installer.rs#L176-L216)）。计划里的 `QUARANTINED` 只存在于建表约束与文档，运行时从未写入（[`local_store.rs`](../desktop/src-tauri/src/local_store.rs#L330)）。
- **审计**：安装、启停、授权、事件、卸载都写 `plugin_audit_log`，不含正文；UI 按最近 500 条展示。

### 1.3 权限与宿主实现对照

| 权限 | 宿主实现 | 说明 |
| --- | --- | --- |
| `knowledge_read` | ✅ `knowledge_search` / `knowledge_get` | 只到"文档级"，不是 chunk 级检索 |
| `knowledge_write` | ✅ `knowledge_save` | 保存文档 |
| `ai_chat` | ✅ `ai_chat` | 直接调用已配置 Provider |
| `network_request` | ✅ `http_fetch` | 仅 HTTPS、精确 host、禁跳转 |
| `page_read` / `page_write` | ❌ | 读不到当前页 |
| `tab_read` / `tab_create` / `tab_close` | ❌ | 管不了标签 |
| `history_read` | ❌ | 读不到历史 |
| `bookmark_read` / `bookmark_write` | ❌ | 读写不了书签 |
| `ai_embedding` | ❌ | 拿不到向量能力 |
| `filesystem_read` / `filesystem_write` | ❌ | 没有插件私有目录访问 |

> 也就是说：插件可以在 manifest 里声明 15 种权限，但其中 11 种**声明后也无处调用**——WIT 里没有对应函数，授权实际是空操作。用户会看到一串授权开关，授了也没用。

### 1.4 相邻但不算插件的扩展面

- **MCP 客户端**：独立的安全策略与审计，只服务于 Agent，和 WASM 插件互不联通。
- **Agent 工具**：7 个硬编码工具（`rag_search`、`knowledge_read`、`browser_current_page`、`browser_extract`、`knowledge_save`、`mcp_list_tools`、`mcp_call_tool`，见 [`agent/runtime.rs`](../desktop/src-tauri/src/agent/runtime.rs#L285-L291)），走审批、预算、审计；插件无法注册工具。
- **AI Provider**：OpenAI 兼容 / Ollama，插件不能新增 Provider。
- **隐私规则 / 站点黑名单**：内置能力，插件不能贡献规则。
- **助手页**（截图场景）：RAG 问答 + 强制引用、跨文档问答、PDF/DOCX/文本附件（15 MB / 10 万字上限）、"深度研究"受控 Agent、运行历史。

**关键结构问题：插件、MCP、Agent 工具是三套并行的扩展体系，能力重叠但互不相通。** 插件最弱：只能被动响应事件，不能出现在助手或 Agent 的决策链里。

---

## 2. 能力缺口（按影响排序）

| # | 缺口 | 证据 | 影响 |
| --- | --- | --- | --- |
| 1 | 11/15 权限是空声明 | 上述对照表 | 授权页误导用户，插件能力上限被锁死 |
| 2 | UI 只有"设置页按钮" | `location != "settings"` 直接拒绝 | 插件无法进入工具栏、右键菜单、阅读器、助手，用户几乎感知不到 |
| 3 | 事件面窄 | 仅 5 个生命周期事件 | 无法响应导航、新标签、书签、下载、助手回答、搜索 |
| 4 | 进不了 Agent / 检索 / 解析管线 | 工具注册表硬编码 | 插件不能贡献工具、解析器、检索器、答案后处理 |
| 5 | 无签名、无市场、无更新/回滚 | `SIGNATURE` 仅是计划；安装只认本地 zip | 只能"开发者模式"分发；升级后旧版本目录残留 |
| 6 | `QUARANTINED` 未落地 | 仅建表约束 | 恶意/崩溃循环插件只能反复 `FAILED`，没有隔离态 |
| 7 | 内置插件与第三方插件两套体系 | 内置插件不走 DB/权限/审计 | 同一个"插件"概念有两种能力与两种信任模型 |
| 8 | 事件链路有写放大 | 每个事件新开 SQLite 连接 + 每个订阅插件一条审计（[`installer.rs`](../desktop/src-tauri/src/plugins/installer.rs#L361-L409)） | `page.loaded` 每次加载触发，多标签 + 多插件时 DB 压力线性增长 |
| 9 | 宿主返回无大小上限 | `knowledge_search` 最多返回 50 篇**含 Markdown 全文**的文档 | 突破运行时方案里"请求/返回 ≤ 1 MiB"的约定，单次调用可能几十 MB |
| 10 | AI 调用绕过 Agent 预算/审批 | `ai_chat` 直接 `ai_chat(app, provider, request)` | 插件可无限消耗模型额度，且不进入 Agent 审计 |
| 11 | 网络策略过刚 | 精确 host、禁跳转、禁 `Authorization`/`Cookie`、仅 HTTPS | API 型插件接入成本高，CDN/多域名服务几乎不可用 |
| 12 | 开发者体验缺失 | 只有 `samples/hello-plugin`，无 SDK/CLI/热重载/文档 | 第三方开发者门槛高，生态起不来 |

补充两点实现细节：

- 包里的 `assets/` 会被解压，但运行时没有任何文件读取 API，**静态资源目前是死能力**。
- 每个插件独立 `Engine`，事件用实例级 `Mutex` 串行；超时靠"每次调用起一个线程 + epoch"，插件数量上来后调度开销明显。

---

## 3. 可以引入的功能

### 3.1 P0：先把平台能力补齐（解锁已有权限）

| 能力 | 契约/权限 | 能支撑什么 | 主要落点 |
| --- | --- | --- | --- |
| 页面读取 | `page.read` / `page.selection` / `page.dom`（`page_read`） | 翻译、摘要、剪藏、OCR、站点适配 | WIT + `runtime.rs` + WebView eval 封装 |
| 标签操作 | `tab.list/open/close/activate`（`tab_*`） | 一键收集全部标签、会话整理 | `lib.rs` 现有 `browser_*` 命令 |
| 书签/历史 | `bookmark.*` / `history.search` | 知识库导入、去重、复习 | `bookmarks.rs`、历史表 |
| 私有文件目录 | `fs.read/write`（限定 `plugins/<id>/data`） | 缓存、配置、离线数据 | `installer.rs` + 路径守卫 |
| Embedding | `ai.embed`（`ai_embedding`） | 插件自建索引、聚类 | `providers` |
| Chunk 级检索 | `rag.search`（复用 `knowledge_read`） | 让插件拿到段落而非整篇文档 | `rag/` |
| UI 扩展点 | 工具栏、右键菜单、阅读器侧栏、助手侧栏、命令面板 | 插件真正"被看见" | manifest `uiContributions` + 前端注册表 |
| 事件目录 | `page.navigated`、`tab.created/activated`、`bookmark.added`、`download.completed`、`assistant.answer`、`search.performed` | 自动化、统计、联动 | 各命令出口统一 dispatch |
| 插件即 Agent 工具 | manifest `tools[]`（name/description/JSON Schema） | 深度研究能调用插件；与 MCP 工具同构 | `agent/tools.rs` 动态注册，风险等级由宿主判定 |
| 签名与分发 | Ed25519 `SIGNATURE`、市场索引、更新/回滚、权限 diff | 从"开发者模式"走向可运营市场 | `installer.rs` + 新命令 |
| 开发者工具 | `arcadia-plugin` CLI、模板、dev 热重载、WIT 文档 | 降低第三方门槛 | 新 crate / 脚本 |

> 建议顺序：**页面读取 → UI 扩展点 → 插件工具化 → 签名/市场**。前两步决定插件"有没有用"，后两步决定"能不能规模化"。

### 3.2 P1：官方插件候选（按用户价值排序）

| 插件 | 依赖能力 | 用户价值 | 复杂度 |
| --- | --- | --- | --- |
| 沉浸式翻译（全文/对照/划词） | `page_read` + `ai_chat` | 高：浏览器最高频的 AI 场景 | 中 |
| 摘要卡片 / 要点速览 | `page_read` + `ai_chat` | 高：与现有摘要能力复用 | 低 |
| 剪藏 / 稍后读（划词、图片、整页） | `page_read` + `knowledge_write` | 高：补齐"采集"入口 | 低 |
| 导出与同步（Obsidian / Notion / Readwise / Zotero / WebDAV） | `knowledge_read` + 网络/文件 | 高：知识库价值外溢 | 中 |
| RSS / Newsletter 订阅 | `http_fetch` + `knowledge_write` + 定时事件 | 中：把"浏览"变成"流入" | 中 |
| 站点适配器（arXiv/PubMed、GitHub、YouTube/B 站字幕、公众号） | `page_read` + 网络 | 中：显著提升抽取质量 | 中 |
| 自动整理（URL 规则 → 保存/打标签/归集合） | `page.loaded` + `knowledge_write` | 中：低代码自动化 | 低 |
| 提示词库 / 术语表 | `ai_chat` + 设置页 UI | 中：轻量、易传播 | 低 |
| 本地模型路由（Ollama / LM Studio） | Provider 扩展 | 中：隐私与成本 | 中 |
| 图片 OCR | `page_read` / 附件钩子 | 中：扫描件、截图 | 中 |
| 日报 / 周报 | 定时事件 + 知识库摘要 | 中：留存抓手 | 中 |
| 隐私增强（Cookie 清理、规则包） | 新权限 + 内部 API | 中：与现有隐私栈协同 | 高 |

### 3.3 助手页（截图）近期可加，不依赖插件平台

这些改动直接提升截图这条链路的完成度，且不需要等插件生态：

1. **引用可点击定位原文并高亮**，并在回答顶部显示引用覆盖率；当前引用只是标签。
2. **回答导出 Markdown / 一键存为知识库笔记**；现在回答只能看，不能沉淀。
3. **附件扩展**：EPUB、PPTX、XLSX、图片 OCR，以及 URL/文件夹批量导入；当前仅 PDF/DOCX/文本。
4. **检索范围过滤**：全部 / 集合 / 标签 / 时间 / 来源，避免"问整个库"时召回噪声。
5. **深度研究可视化**：步骤、来源清单、可中断续跑、引用校验结果；当前只有最终答案与运行历史。
6. **Agent 历史增强**：重放、对比、导出。
7. **多文档对比与表格问答**：跨文档问答已有基础，缺对比视图。
8. **对话导出/只读分享**：本地优先，导出 HTML 即可，不必上云。

---

## 4. 建议路线（4 个迭代）

**Sprint 1（约 2 周）— 让插件"有用"**
- 页面读取 + 标签/书签/历史宿主函数
- 事件目录补齐（导航、标签、书签、下载）
- 工具栏 + 右键菜单两个 UI 扩展点
- 插件注册为 Agent 工具（走现有 approval/budget/审计）
- 验收：一个"划词翻译"插件 + 一个"收集全部标签"插件可端到端跑通

**Sprint 2（约 2–3 周）— 让生态"可分发"**
- Ed25519 签名、市场索引、更新/回滚、权限 diff
- `QUARANTINED` 落地（连续 trap/崩溃循环）
- SDK/CLI + 3 个官方示例（page/translate/tool）
- 验收：脱离源码即可安装、升级、回滚、审计

**Sprint 3（约 2–3 周）— 官方插件与助手集成**
- 翻译、剪藏、导出三个官方插件
- 助手扩展钩子：附件解析器、检索器、答案后处理器、引用渲染器
- 验收：助手能调用插件解析 EPUB/OCR，回答可由插件后处理

**Sprint 4 — 性能与治理**
- 连接池/只读连接、同版本 Engine 复用、审计采样或聚合
- 宿主返回 1 MiB 硬上限、`knowledge_search` 只回片段
- 插件额度（AI token/网络流量）与熔断

---

## 5. 风险与边界

- **`page_read` 是最高敏感权限**：等于读取用户所有网页。必须逐站点授权、只读、DOM 大小上限；`page_write` 必须单独授权 + 审批，不能与读捆绑。
- **网络放宽要有代价**：子域通配、loopback、重定向需要单独授权并写审计；`Authorization`/`Cookie` 仍应默认禁止，改由宿主代持凭据。
- **插件工具的风险等级必须由宿主判定**，不能让 manifest 自封 `safe`；否则会绕过 Agent 的审批分级。
- **市场审核与密钥管理**是长期成本：签名只解决"包没被篡改"，不解决"作者是坏人"。
- **跨平台差异**：DOM 读取、注入脚本在 WebView2 / WKWebView / WebKitGTK 上行为不同，需按平台降级。
- **性能**：事件链路当前是"每事件一条连接 + 每个插件一条审计"，插件数量增长前必须改。

## 6. 不建议做

- 允许插件注入任意 HTML/JS 到主界面（XSS 与权限穿透）。
- 原生动态库、子进程插件（与既有安全决策冲突）。
- 让插件直接打开 SQLite 文件（绕过权限与审计）。
- 由 manifest 声明自身风险等级或审批策略。
- 默认授予全站 `page_read`。

---

## 附录：现状速查

| 指标 | 当前值 |
| --- | --- |
| 内置"插件" | 2（前端实现，不受插件系统管理） |
| 第三方插件运行时 | 1（Wasmtime Component） |
| 权限 | 15 个，4 个有宿主实现 |
| 宿主函数 | 6 |
| 生命周期事件 | 5（+1 个 `ui.command` 命令通道） |
| UI 扩展位置 | 1（设置页） |
| 可达生命周期状态 | 3（DISABLED / ENABLED / FAILED）；`INSTALLING`、`QUARANTINED` 未落地 |
| 官方示例 | 1（hello-plugin） |
| 签名 / 市场 / 更新 | 均无 |

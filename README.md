# Arcadia — AI Knowledge Browser

Arcadia 是一款以浏览器为入口、以本地知识库为核心的桌面阅读工具。它把网页浏览、正文提取、Markdown 保存、本地检索、RAG 问答和 AI 辅助放在同一个工作流中。

项目已经越过早期原型阶段：浏览、阅读、保存、检索、AI Provider、RAG、隐私拦截、WASM 插件运行时和受控 Agent 都已在代码中实现并有测试覆盖。当前的工作重心是界面布局收口，而不是补齐功能主干。

各迭代的准确状态见 [开发路线图](docs/roadmap.md)。

## 核心特性

### 浏览

- 基于 Tauri 2 原生 WebView 的多标签浏览器，每个标签对应一个独立子 WebView。
- 支持地址输入、搜索、前进、后退、刷新和停止加载。
- 网页中的 `target="_blank"` 与 `window.open()` 会转换为应用内标签页。
- 支持网页标题、favicon、加载状态和标签页快捷操作（重排、分组、关闭同域标签、静音、搜索）。
- 私密标签、多工作区、会话恢复与崩溃恢复、最近关闭标签。
- 站点权限提示、证书错误拦截与一次性放行（Windows 使用 WebView2 COM 订阅，macOS/Linux 为 no-op）。
- 下载中心：`reqwest` 流式下载、Range 续传、危险文件判定、暂停 / 取消 / 重试。
- 媒体资源探测：手动扫描当前页面已加载的视频、音频、HLS/DASH 清单、字幕与文档，并交给下载中心。

### 阅读与知识库

- 使用 Mozilla Readability 提取正文，并通过 Turndown 转换为 Markdown。
- 网页可直接保存到桌面端本地 SQLite，不要求任何外部服务运行。
- 知识库、搜索、详情与删除操作直接读取本地真实数据。
- 不内置演示文章，也不会在服务不可用时展示伪造数据。
- 星标、集合、标签、笔记、Markdown 导出、全库备份与恢复。

### 检索与 AI

- 本地 SQLite **FTS5** 全文检索（`unicode61` 分词 + `bm25()` 排序 + 前缀匹配）。
- RAG 链路：分块 → Embedding → 本地向量索引 + BM25 词法召回 → RRF 融合 → Reranker → 强制引用校验。
- OpenAI Compatible 与 Ollama 两类 Provider，API Key 存放于系统密钥环。
- 流式摘要、页面问答、翻译、自动标签、跨文档问答。
- 受控 Agent：runtime / supervisor / tools / approval / budget / checkpoint，并支持 MCP 客户端。

### 隐私与插件

- 广告与追踪规则编译、匹配、WebView2 请求拦截、站点级开关与真实拦截统计。
- 网站封杀名单：用户维护的站点级黑名单，命中后在发出请求前取消导航，并可阻断站外页面嵌入的被封杀资源与直链下载。
- 插件采用 Wasmtime + WASI Preview 2 组件模型，默认零能力，配合 Fuel、内存上限与超时隔离。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + T` | 新建标签页 |
| `Ctrl/Cmd + W` | 关闭当前标签页 |
| `Ctrl/Cmd + L` | 聚焦并选中地址栏 |
| `Ctrl/Cmd + Tab` | 切换到下一个标签页 |
| `Ctrl/Cmd + Shift + Tab` | 切换到上一个标签页 |
| `Ctrl/Cmd + 1…9` | 切换到指定标签页，`9` 表示最后一个 |
| `Ctrl/Cmd + R` 或 `F5` | 刷新当前网页 |
| `Alt + ←/→` | 后退或前进 |
| `Esc` | 停止加载 |

## 技术栈

桌面端：Tauri 2、Rust、React 19、TypeScript、Vite 6、SCSS。

UI 组件：`desktop/src/components/ui/` 是自建组件层，对外 API 对齐 Ant Design 的用法，底层由 `@base-ui/react` 提供交互原语，图标统一使用 `lucide-react`。项目**不依赖** `antd` 包。

内容处理：`@mozilla/readability`、Turndown、`react-markdown` + `remark-gfm`。

检索：桌面内置 SQLite **FTS5**（`local_documents_fts` / `document_chunks_fts` 虚表 + 自动同步触发器），配合自实现的向量索引、BM25、RRF 融合与 Reranker。

Provider 与网络：`reqwest` + `rustls-tls`，流式响应。

插件运行时：`wasmtime`（`component-model` + `cranelift`），WIT 描述宿主能力。

密钥存储：`keyring`（Windows Credential Manager / macOS Keychain / Linux Secret Service）。

## 架构

```text
┌──────────────────────────────────────────────────────┐
│ React UI                                             │
│ Browser / Library / Search / Assistant / Settings    │
└────────────────────────┬─────────────────────────────┘
                         │ Tauri commands（179 个）
┌────────────────────────▼─────────────────────────────┐
│ Tauri / Rust                                         │
│  browser/        WebView 生命周期、导航、安全边界     │
│  local_store.rs  SQLite + 26 个顺序迁移 + FTS5        │
│  rag/            分块、索引、词法/向量召回、融合、引用 │
│  providers/      OpenAI 兼容 / Ollama / Embedding     │
│  privacy/        规则编译、请求拦截、统计             │
│  plugins/        Manifest、安装器、Wasmtime 运行时    │
│  agent/          运行时、工具、审批、预算、检查点      │
│  downloads/  mcp/  bookmarks.rs  session_lock.rs ...  │
└──────────┬────────────────────────────┬──────────────┘
           │                            │
   ┌───────▼────────┐          ┌────────▼─────────┐
   │ 本地 SQLite    │          │ AI Provider      │
   │ knowledge.db   │          │ OpenAI 兼容/Ollama│
   └────────────────┘          └──────────────────┘
```

桌面应用采用本地优先设计。文档保存、检索和全文搜索全部由 Tauri 原生层管理，不依赖任何外部服务进程，也不暴露入站 HTTP API。

远程网页运行在独立子 WebView 中。网页内容不能直接调用应用的高权限命令；React UI 通过受控的 Tauri command 完成导航、页面快照和 SQLite 操作。

## 项目目录

```text
.
├── desktop/
│   ├── src/                         # React / TypeScript UI
│   │   ├── app/                     # 视图路由
│   │   ├── components/ui/           # 自建 UI 组件层（对齐 Ant Design 用法）
│   │   ├── features/                # 浏览器、AI、RAG、下载、隐私等领域模块
│   │   ├── layouts/                 # 应用外壳
│   │   ├── pages/                   # Browser / Library / Search / Assistant / Settings
│   │   ├── services/                # 原生浏览器、会话、下载等适配器
│   │   ├── shared/                  # 通用工具与 hooks
│   │   ├── styles/                  # 全局与紧凑布局样式
│   │   ├── api.ts                   # 桌面本地数据与命令访问入口
│   │   └── types.ts                 # 前端共享类型
│   └── src-tauri/
│       ├── capabilities/            # 主窗口最小权限
│       ├── src/browser/             # URL 规范化与导航校验
│       ├── src/local_store.rs       # SQLite 迁移、FTS5、备份恢复
│       ├── src/rag/                 # 分块、索引、召回、融合、引用
│       ├── src/providers/           # LLM / Embedding Provider
│       ├── src/privacy/             # 规则与请求拦截
│       ├── src/plugins/             # Manifest、安装器、WASM 运行时
│       ├── src/agent/               # 受控 Agent
│       └── src/lib.rs               # Tauri commands 与启动逻辑
├── docs/                            # PRD、架构、路线图、开发文档与专项方案
├── specs/                           # 历史需求规格（见其 readme）
├── website/                         # Astro 官网（Netlify 发布）
└── netlify.toml
```

## 环境要求

- Node.js 20 或更高版本
- npm
- Rust stable 与 Cargo
- Tauri 2 对应的平台编译依赖
- Windows：Microsoft Edge WebView2 Runtime

平台依赖的安装方式请参考 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 安装与运行

安装前端依赖：

```bash
cd desktop
npm install
```

推荐以完整桌面模式运行：

```bash
cd desktop
npm run tauri:dev
```

该命令会同时启动 Vite 与 Tauri，可以使用原生 WebView、页面抓取和本地 SQLite。

只运行 Web UI：

```bash
cd desktop
npm run dev
```

纯 Web 模式主要用于查看界面。由于没有 Tauri 原生层，真实网页子 WebView 和桌面 SQLite 不可用。

## 本地数据

桌面端数据库文件名为 `knowledge.db`，存放在 Tauri 为应用分配的数据目录中。应用标识为：

```text
com.arcadia.knowledge-browser
```

具体目录由操作系统决定：

- Windows：用户的 `AppData` 应用数据目录。
- macOS：用户的 `Library/Application Support` 目录。
- Linux：用户数据目录，通常位于 `~/.local/share`。

请不要在应用运行时直接修改数据库文件。备份时应先完全退出应用，再复制 `knowledge.db`。

Schema 由 `desktop/src-tauri/src/local_store.rs` 中的 `MIGRATIONS` 常量管理，当前共 **26 个顺序迁移**，覆盖文档、会话、集合、任务、Provider、下载、历史、书签、工作区、阅读活动、凭证、MCP、Agent、插件、RAG 索引与隐私统计等表。应用内也提供「导出备份 / 从文件恢复」。

## 保存网页

1. 在浏览器页打开网页并等待加载完成。
2. 点击右侧面板中的「保存到知识库」。
3. Arcadia 提取当前页面正文并转换为 Markdown。
4. 文档写入桌面 SQLite，并由触发器同步 FTS5 索引。
5. 在「知识库」或「搜索」页面查看内容。

页面无法提取正文时，应用会给出错误提示并取消保存，而不会生成示例内容。

## 构建

构建前端资源：

```bash
cd desktop
npm run build
```

构建桌面安装包：

```bash
cd desktop
npm run tauri:build
```

安装包产物位于 Tauri 的 `target/release/bundle` 目录。

官网单独构建：

```bash
cd website
npm run build
```

## 测试与检查

```bash
# 前端
cd desktop
npm run test          # Vitest，61 个文件 / 481 用例
npm run build         # tsc --noEmit + vite build

# Rust
cd desktop/src-tauri
cargo fmt -- --check
cargo check --all-targets

cd ..
npm run test:rust     # 247 个用例，见下方说明
```

> **Windows 上请用 `npm run test:rust` 跑 Rust 测试，不要直接执行 `cargo test`。**
>
> 直接 `cargo test` 会让测试二进制在进入 `main` 之前以 `0xC0000139`（`STATUS_ENTRYPOINT_NOT_FOUND`）退出，没有任何测试输出。原因是 `tauri` 默认启用的 `common-controls-v6` 特性、以及 `tauri-plugin-dialog` 固定启用的 `rfd/common-controls-v6`，都会让依赖图静态导入 `comctl32!TaskDialogIndirect`。该导出只存在于 comctl32 v6 组件中，需要通过应用清单声明 `Microsoft.Windows.Common-Controls` 才能解析；应用主程序由 `tauri-build` 注入清单，而 Cargo 的测试 harness 二进制没有。
>
> `npm run test:rust`（`desktop/scripts/run-rust-tests.mjs`）会先构建测试 harness，再用 Windows SDK 的 `mt.exe` 把 `desktop/src-tauri/test-manifest.xml` 写入测试二进制，然后运行。它不修改依赖、不加全局链接参数，也不影响应用自身的清单。非 Windows 平台该脚本直接透传 `cargo test`。
>
> 需要 Windows SDK 提供 `mt.exe`；缺失时脚本会提示，并说明 `0xC0000139` 的含义。

## 安全说明

- 仅允许浏览 `http` 与 `https` 地址；`file:`、`javascript:` 等高权限或可执行协议会被拒绝。
- 外部网页与应用 UI 使用不同的 WebView 安全边界，网页不能调用 privileged commands。
- 页面快照设置了 8 MiB 大小限制，脚本回调等待上限 5 秒。
- Provider API Key 存放于系统密钥环，不写入前端包、日志或版本库。
- 插件默认在空 `WasiCtx` 下运行，不继承环境变量、标准流、网络或目录；文件、网络请求需经宿主代理并校验白名单。
- Agent 的写入、删除、外发类工具走审批与风险分级，敏感调用写入审计日志且脱敏。
- SQLite 只写入应用数据目录，全部使用参数绑定。

## 当前限制

- 隐私拦截与证书错误拦截在 Windows 上为真实实现；macOS / Linux 因 WKWebView / WebKitGTK 未暴露等价接口，目前为 no-op。
- 网站封杀在 Windows 上于请求发出前拦截；macOS / Linux 的页面内跳转与重定向依赖 URL 轮询兜底，可能有短暂延迟，且不阻断子资源。
- 页面权限提示、右键菜单、可听检测（audible）与进程级内存统计受限于 Tauri 2 / WebView2 公开接口，部分依赖注入脚本或暂未实现。
- 桌面搜索暂无分页，文档量很大时列表端会出现性能压力。
- 插件只能调用已开放的宿主能力，尚未覆盖全部内置功能。
- Go 服务端已整体移除，仓库内不存在 `backend/` 目录；若需要多端同步应在 Rust 端另行设计。
- 某些登录站点、反爬虫策略或高度动态页面可能影响正文提取。
- 纯 Web 开发模式不能替代 Tauri 桌面环境的完整验证。

## 路线图

- 完成界面布局与滚动所有权的收尾。
- 补齐插件宿主能力、搜索分页与跨平台隐私/证书能力。
- 建立桌面数据与可选远程服务之间的同步机制（暂未开始）。

详细拆分见 [开发路线图](docs/roadmap.md)。

## 更多资料

- [产品需求](docs/PRD.md)
- [系统架构](docs/architecture.md)
- [开发路线图](docs/roadmap.md)
- [开发技术文档](docs/development-guide.md)
- [WebView 原生能力矩阵](docs/browser-native-capability-matrix.md)
- [网站封杀名单方案](docs/site-blacklist-plan.md)
- [WASM 插件运行时方案](docs/wasm-plugin-runtime-plan.md)

## 贡献

提交变更前，请至少运行与修改范围对应的构建和测试。涉及桌面原生功能时，应同时验证 TypeScript 构建与 Rust 检查；Rust 测试请用 `npm run test:rust`。

建议提交信息保持清晰，例如：

```text
feat: add local document search
fix: open target blank links in app tabs
docs: expand desktop setup guide
```

## License

当前仓库尚未声明开源许可证。在添加正式许可证前，请勿默认将代码用于再分发。

# 系统架构

## 组件边界

```text
React UI（Browser / Library / Search / Assistant / Settings）
  │ 179 个 typed Tauri commands
Tauri + Rust
  ├── browser/        WebView 生命周期、导航校验、快照
  ├── local_store.rs  SQLite + 26 个顺序迁移 + FTS5 + 备份恢复
  ├── rag/            chunker / indexer / lexical / vector / fusion / reranker / citation / evaluator
  ├── providers/      openai / ollama / embedding
  ├── privacy/        parser / compiler / matcher / listener / events / platform
  ├── plugins/        manifest / installer / runtime（Wasmtime 组件）
  ├── agent/          runtime / supervisor / tools / approval / budget / checkpoint
  ├── site_blacklist.rs  用户网站封杀名单（导航前拦截）
  ├── downloads.rs  mcp.rs  bookmarks.rs  session_lock.rs
  └── keyring         系统密钥环（Provider API Key）
        │ 可选远端
        ▼
AI Provider（OpenAI-compatible / Ollama，本地或远端）
```

- React 只负责交互和显示，不持有 API Key，不直接读写数据库。
- Rust 管理 WebView、系统权限、安全边界、所有本地数据、全文与向量检索、Provider 调用；不依赖任何本地 HTTP 服务。
- 桌面应用不暴露入站 HTTP API。如需多端协作，应在 Rust 端构建独立服务；不要重新引入第二套存储。
- AI Provider 仅指外部大模型 API（OpenAI-compatible / Ollama 等），所有调用均由 Rust 端直接发出，密钥从系统密钥环读取。

## 前端工程结构

```text
desktop/src/
├── app/            # 视图路由（AppRouter）
├── layouts/        # 应用外壳和跨页面布局
├── pages/          # 路由级页面：Browser / Library / Search / Assistant / Settings
├── components/ui/  # 自建 UI 组件层，API 对齐 Ant Design 用法
├── features/       # 领域模块：browser / ai / rag / reader / downloads / history /
│                   # bookmarks / notes / privacy / plugins / tasks / settings / search
├── services/       # Tauri command、会话、原生浏览器、下载等适配器
├── shared/         # 无业务依赖的通用 hooks 与工具
├── styles/         # SCSS 变量、主题和全局样式
├── api.ts          # 桌面本地数据与命令访问入口
└── types.ts        # 前端共享类型
```

UI 组件层位于 `components/ui/`：对外暴露与 Ant Design 一致的组件名和 props（`Button`、`Modal`、`Table`、`Form`、`message` 等），内部由 `@base-ui/react` 提供交互原语，图标统一来自 `lucide-react`。项目**不依赖** `antd` 包；新增组件应加在这一层，页面不直接引用 `@base-ui/react`。

页面不能直接依赖具体网络实现，应通过 feature/service 层访问数据。五个视图（`browser` / `library` / `search` / `ai` / `settings`）由 `AppRouter` 用本地 state 管理，已挂载的视图用 `mountedViews` 保活，不使用 URL Router。

浏览器页面通过 `services/nativeBrowser.ts` 管理 Tauri 子 WebView。React 负责计算内容区域的逻辑坐标、Tab 生命周期与显示状态；Rust command 负责协议校验、导航、刷新和历史操作。非 Tauri 开发环境自动使用内置预览，不会因缺少原生 API 崩溃。

## 模块依赖规则

领域模块不依赖 HTTP，也不存在 HTTP 客户端层；前端通过 `api.ts` 调用 Tauri command，Rust 端在 command 边界做校验、映射和错误转换。存储通过 Repository 接口注入。AI Provider、Embedding、Reranker 与 VectorIndex 均为可替换 trait / 接口，便于切换本地与远端实现。Reader 的浏览器侧提取与 Rust 端标准化使用版本化 payload（chunker 亦带 `CHUNKER_VERSION`）。

## 保存状态机

```text
BrowserPage.save()
  ├─ browser_snapshot(label) → URL + HTML（≤ 8 MiB）
  ├─ extractArticle(snapshot) → Markdown + metadata（失败则中止，不写占位）
  ├─ local_save_document(document)
  │    ├─ INSERT OR REPLACE INTO local_documents
  │    └─ AFTER INSERT 触发器同步 local_documents_fts
  └─ local_get_document(id) → 详情回显
```

文档保存即 READY（无 PENDING/PROCESSING 中间态）。Embedding / 摘要 / 自动标签等长任务由后台队列承载：Rust 端 `tasks` 表保存 `kind`、`payload`、`status`、`attempts`、`max_attempts`、`available_at`、`last_error`；RAG 索引另有 `rag_index_jobs` 由服务端 supervisor 驱动，启动时会把卡在中间状态的任务重置为 `PENDING`。任务失败不回滚已保存的正文。

## 检索与 RAG

```text
query
  ├─ 词法召回：document_chunks_fts / local_documents_fts + bm25()
  └─ 向量召回：document_embeddings + VectorIndex（BruteForce 实现，可替换）
        └─ RRF 融合 → Reranker → context
                                        └─ rag_answer：引用强制校验 + 修复
```

- 分块与索引由 Rust 端 supervisor 驱动，任务落在 `rag_index_jobs`，重试退避 30s → 2min → 10min → 30min，Provider/模型变更时标记 `STALE` 而非删除。
- 回答层只接收带 document/chunk 标识的上下文，输出必须保留引用映射；引用缺失时按修复策略重试，而不是编造来源。
- 评测集覆盖检索质量（`rag/evaluator.rs`、`features/ai/retrievalEval.ts`）。

## 安全边界

- WebView 页面与应用 UI 使用不同 origin，网页不能调用 privileged commands。
- 网站封杀在导航前执行：`browser_create` / `browser_navigate` 与 WebView2 `NavigationStarting` 都会取消命中名单的请求，子资源过滤在 ABP 之前生效。
- Tauri command 使用最小 capability（`capabilities/default.json`）；文件路径需 canonicalize 后校验允许目录。
- Provider 密钥存系统密钥环（`keyring`：Credential Manager / Keychain / Secret Service），不进入前端包、日志或数据库。
- Agent tool 定义风险级别；写入、删除、外发内容经策略检查，高风险动作必须确认，敏感调用写审计日志。
- 插件在空 `WasiCtx` 中运行，不继承环境变量、标准流、网络或目录；文件与网络请求必须经宿主代理，并校验 HTTPS、域名白名单、响应大小和超时上限。
- 日志统一清洗密钥、cookie、authorization 与页面敏感正文。

## 插件运行时

插件使用 `.arcadia-plugin`（ZIP）包，内含 `plugin.json`、`plugin.wasm` 与可选静态资源。安装时校验反向域名 ID、语义化版本、路径逃逸、符号链接、大小配额与 WASM 摘要；运行在 Wasmtime + WASI Preview 2 Component Model 上，通过 WIT 暴露宿主能力，每个宿主函数先经 `PluginContext.require()` 校验权限。生命周期状态为 `INSTALLING / DISABLED / ENABLED / FAILED / QUARANTINED`，连续超时或 Trap 触发隔离。详见 [WASM 插件运行时方案](wasm-plugin-runtime-plan.md)。

# Arcadia 需求规格索引

以浏览器为入口、知识库为核心、AI 为智能层的桌面知识浏览器。

## 当前进度

项目状态以 [docs/roadmap.md](../../docs/roadmap.md) 为准。简述：

- 浏览器：多标签 WebView、下载中心、站点权限、证书拦截（Windows）、私密标签、工作区、会话与崩溃恢复。
- 知识库：Readability + Turndown 提取、SQLite（26 个迁移）+ FTS5、集合、星标、笔记、备份恢复。
- 检索与 AI：OpenAI Compatible / Ollama Provider（Key 走系统密钥环）、流式摘要/问答/翻译/自动标签、混合检索（BM25 + 向量 + RRF + Reranker）与带引用 RAG、跨文档问答。
- 隐私：规则编译、WebView2 请求拦截、站点级开关与统计（Windows；macOS/Linux 受限）。
- 插件：`.arcadia-plugin` 安装器、权限授权、Wasmtime 组件运行时与审计。
- Agent：受控运行时、工具审批、预算与检查点，支持 MCP。
- 官网：`website/`（Astro），通过 Netlify 发布。

Go 后端已整体移除，仓库中不存在 `backend/` 目录。

## 本地运行

桌面端（推荐，含原生 WebView 与本地 SQLite）：

```bash
cd desktop
npm install
npm run tauri:dev
```

仅前端 UI：

```bash
cd desktop
npm run dev
```

纯 Web 模式没有原生层，子 WebView 与 SQLite 不可用。

## 验证

```bash
cd desktop
npm run test      # Vitest，454 用例
npm run build     # tsc + vite build

cd src-tauri
cargo check --all-targets
# cargo test 在 Windows 上存在已知阻塞，见 docs/roadmap.md
```

详细范围与技术决策见 [docs/PRD.md](../../docs/PRD.md) 与 [docs/architecture.md](../../docs/architecture.md)。

## 关于本目录下的历史规格

`specs/feature-*` 是 2026-09-14 ~ 09-15 期间生成的规划稿，描述的是**已废弃的 Go 后端 + Ant Design** 形态，其中的任务清单从未回填为完成状态。它们仅作历史记录保留，**不代表当前实现**，也不应作为开发依据。

当前真实状态的唯一来源：

- [docs/roadmap.md](../../docs/roadmap.md) — 迭代状态与阻塞项
- [docs/architecture.md](../../docs/architecture.md) — 系统结构
- [docs/development-guide.md](../../docs/development-guide.md) — 实现细节

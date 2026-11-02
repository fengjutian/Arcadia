# Arcadia MCP 集成规划

> 文档状态：规划基线  
> 更新日期：2026-10-30  
> 适用范围：`desktop` Tauri 桌面端

## 1. 背景与目标

Arcadia 已具备 MCP Server 配置、工具与资源发现、工具调用和基础审计能力，但现阶段仍以“手工连接与手工调用”为主，尚未形成与 AI 助手、受控 Agent、权限策略和运行状态完整联动的产品闭环。

本规划的目标是将 MCP 建设为 Arcadia 的统一外部能力接入层：用户能够安全地添加和管理 MCP Server；助手和 Agent 能在明确策略下发现并调用工具；每次敏感操作可解释、可授权、可撤销、可审计；服务异常不会拖垮主应用。

### 1.1 产品目标

- 提供统一的 MCP 工作台，覆盖配置、连接、能力发现、调试、状态和审计。
- 将已启用的 MCP 工具接入 AI 助手和受控 Agent，而不是只允许用户手工调用。
- 对外发数据、写入、删除、执行命令等操作实施分级审批。
- 支持本地 `stdio`、Streamable HTTP 和兼容 SSE 的远程服务。
- 让用户清楚知道“哪个模型、因为什么、向哪个 Server、发送了什么类型的数据”。

### 1.2 非目标

- MCP 不作为第三方代码的安全沙箱；不信任代码仍由 WASM 插件运行时隔离。
- 首期不提供公共 MCP Server 商店、付费市场或云端同步。
- 不允许网页内容直接调用 MCP；所有调用必须经过 Rust 宿主和策略层。
- 不承诺兼容服务端的私有扩展，只实现明确支持的 MCP 协议版本与能力。

## 2. 当前实现基线

截至 2026-10-30，仓库已有以下能力：

| 领域 | 当前状态 | 主要位置 |
| --- | --- | --- |
| Server 存储 | 已支持名称、传输方式、命令/URL、参数、环境变量、请求头和启停状态 | `desktop/src-tauri/src/local_store.rs` |
| 传输层 | 已支持 `stdio`、HTTP 与 SSE 响应解析 | `desktop/src-tauri/src/mcp.rs` |
| 能力发现 | 已支持工具列表、资源列表和初始化发现 | `mcp_discover`、`mcp_list_tools`、`mcp_list_resources` |
| 工具调用 | 已支持 JSON 参数调用，并要求显式 `approved=true` | `mcp_call_tool` |
| 安全基础 | 远程地址要求 HTTPS；限制保留请求头、响应大小与超时 | `mcp.rs`、`agent/mcp_security.rs` |
| 审计 | 已记录 Server、方法、目标、授权、成功状态和错误 | `mcp_audit_log` |
| 配置 UI | 设置页已有 Server 增删改、连接、工具调用和资源查看 | `SettingsPage.tsx` |
| 独立入口 | 已有侧边栏 MCP 工作台 | `pages/mcp/McpPage.tsx` |
| Agent 工具定义 | 已声明 `mcp_list_tools` 与 `mcp_call_tool`，但运行时接线仍不完整 | `agent/tools.rs` |

### 2.1 主要缺口

1. `stdio` 每次请求启动一次子进程，缺少长连接、进程复用、健康检查和退出回收。
2. HTTP/SSE 会话能力不完整，未统一管理初始化状态、会话 ID、重连和协议协商。
3. 工具发现结果未持久化，无法做变更对比、离线展示或授权失效处理。
4. 审批粒度偏粗，尚未根据工具风险、参数内容、数据外发范围和用户策略分级。
5. 助手与 Agent 尚未形成稳定的动态工具注册、选择、调用和结果回填链路。
6. 环境变量和请求头仍随 Server 配置存储，敏感值应迁移到系统密钥环。
7. 缺少提示注入防护、结果内容标记、调用预算、速率限制和熔断。
8. 缺少端到端兼容性测试、恶意 Server 测试和跨平台 `stdio` 测试。

## 3. 目标架构

```text
React UI
  ├─ MCP 工作台：配置 / 状态 / 工具 / 资源 / 审计
  └─ Assistant / Agent：展示计划、审批卡片、调用结果
                     │ typed Tauri commands / events
Rust MCP Host
  ├─ Registry        Server 配置、能力快照、启停状态
  ├─ Session Manager 初始化、连接复用、心跳、重连、回收
  ├─ Transports      stdio / Streamable HTTP / SSE compatibility
  ├─ Policy Engine   风险分级、数据外发、审批、预算、速率限制
  ├─ Secret Store    系统密钥环中的 token / header / env secret
  ├─ Audit           脱敏调用记录、状态事件、错误与耗时
  └─ Agent Bridge    动态工具注册、schema 校验、结果规范化
                     │
              External MCP Servers
```

### 3.1 边界原则

- React 只展示和发起意图，不持有明文密钥，不直接访问 MCP Server。
- 所有传输、协议校验、限额和审计在 Rust 侧执行。
- MCP 返回内容一律视为“不可信外部输入”，不能覆盖系统指令或绕过审批。
- Agent 只能调用 Registry 中“已启用、已连接、能力快照未失效”的工具。
- Server 工具 schema 变化后，相关持久授权自动失效并要求重新确认。

## 4. 功能规划

### 4.1 Server 生命周期

状态模型：

```text
DISABLED
  -> CONNECTING
  -> READY
  -> DEGRADED
  -> RECONNECTING
  -> FAILED
  -> DISABLED
```

要求：

- 应用启动时只恢复“启用且允许自动连接”的 Server。
- `stdio` 子进程必须绑定应用生命周期；退出、禁用、删除时可靠终止。
- 连接使用指数退避，连续失败达到阈值后熔断，不无限重启。
- 状态事件通过 Tauri event 推送 UI，禁止页面轮询制造额外连接。
- 记录最近成功时间、最近错误、连续失败次数、往返耗时和协议版本。

### 4.2 能力发现与缓存

- 初始化完成后拉取 `tools/list`、`resources/list` 和 `prompts/list`。
- 保存能力快照，包括名称、描述、JSON Schema、Server 版本和摘要。
- 每次重连或用户刷新时比较摘要，显示新增、删除和变更能力。
- 工具 schema 先经过结构与大小校验，再转换为 Agent 可用定义。
- 对超长描述、递归 schema、异常枚举数量设置上限，防止上下文膨胀。

### 4.3 工具调用

标准流程：

```text
Agent/用户提出调用
  -> schema 校验
  -> 风险判定
  -> 数据外发摘要
  -> 策略匹配
  -> 必要时请求审批
  -> 执行（超时 / 取消 / 大小限制）
  -> 结果清洗与不可信内容标记
  -> 回填 Agent
  -> 写入脱敏审计
```

调用必须支持取消、超时、最大响应大小、并发上限和单次运行预算。工具失败不得自动改用风险更高的其他工具。

### 4.4 资源与 Prompt

- 资源首期只读，支持列表、元信息展示和按 URI 读取。
- 资源正文进入模型前显示来源 Server，并应用内容长度和类型限制。
- Prompt 模板只作为用户可选择的输入模板，不自动提升为系统指令。
- 二进制资源默认不送入模型；后续按 MIME 类型接入安全解析器。

### 4.5 助手与 Agent 集成

- 在对话中显示当前可用的 MCP Server 和工具数量。
- Agent 启动时生成本次运行的工具快照，运行中 schema 变化不热替换。
- 模型只接收满足当前任务、权限和预算的工具子集。
- 调用前展示 Server、工具、参数摘要、数据外发范围和风险等级。
- 调用后显示成功/失败、耗时、结果摘要，并允许展开原始 JSON。
- MCP 结果不得被当作可信指令；对疑似提示注入内容标记并降权。

## 5. 安全与隐私规划

### 5.1 风险分级

| 等级 | 示例 | 默认策略 |
| --- | --- | --- |
| R0 只读元数据 | 列出工具、读取公开状态 | 可自动执行并记录 |
| R1 只读数据 | 搜索、读取用户选择的资源 | 首次确认，可按 Server 记忆 |
| R2 外发或写入 | 发送页面正文、创建记录、发送消息 | 每次确认或限定范围授权 |
| R3 高风险 | 删除、支付、执行命令、修改凭据 | 必须逐次确认，不可永久授权 |

风险判定不能只依赖 Server 自报描述；应结合工具名称、schema 字段、参数内容、目标资源和宿主策略。

### 5.2 密钥管理

- Token、Authorization、Cookie 和敏感环境变量存入系统密钥环。
- SQLite 只保存引用 ID 与非敏感配置。
- UI 回显使用占位符，不提供读取明文命令。
- 导出备份默认不包含密钥；如未来支持密钥导出，必须单独加密并二次确认。

### 5.3 网络策略

- 远程 Server 默认只允许 HTTPS。
- 拒绝环回、私网、链路本地和云元数据地址；本地开发模式必须显式开启。
- 每次重定向重新校验目标地址，禁止 HTTPS 降级到 HTTP。
- DNS 解析结果也需做地址策略校验，降低 DNS rebinding 风险。
- 对请求数量、响应大小、连接数和总耗时实施 Server 级限额。

### 5.4 审计与脱敏

审计记录包含：运行 ID、Server、工具、风险等级、审批人/策略、开始和结束时间、结果状态、耗时、参数摘要和错误码。

不得记录：完整密钥、Authorization/Cookie、完整页面正文、完整文件内容或未脱敏工具结果。用户可按 Server 和时间筛选，并可清理历史记录。

## 6. 数据模型演进

在现有 `mcp_servers`、`mcp_audit_log` 基础上增加：

- `mcp_capability_snapshots`：Server、协议版本、能力类型、schema JSON、摘要、发现时间。
- `mcp_server_state`：状态、会话信息、最近成功/错误、失败次数、延迟指标。
- `mcp_grants`：Server、工具、schema 摘要、授权范围、风险等级、过期时间。
- `mcp_call_runs`：运行关联、状态、审批 ID、耗时、脱敏摘要和错误码。

所有迁移必须顺序追加，不修改历史迁移；备份恢复要覆盖新增表。

## 7. 分阶段实施

### Phase 0：基线收口与契约测试

目标：把已有能力变成可稳定演进的基线。

- [ ] 固化 MCP 协议版本、请求/响应上限和错误码。
- [ ] 为三个传输建立统一 trait 和模拟 Server 测试夹具。
- [ ] 补齐 URL、请求头、超时、SSE 解析、进程退出和审计测试。
- [ ] 统一设置页与 MCP 工作台的配置逻辑，消除重复状态管理。
- [x] 修复 Agent 工具定义与实际 MCP 调用之间的接线缺口。

验收：三个传输的初始化、发现、调用、超时、取消和失败均有自动化测试；现有功能无回归。

### Phase 1：会话管理与可观测性

目标：从“一次一进程/一次一请求”升级为受控长连接。

- [ ] 实现 `McpSessionManager` 与 Server 状态机。
- [ ] 复用 `stdio` 子进程和 HTTP 会话，支持可靠关闭。
- [ ] 增加健康检查、退避重连、熔断和状态事件。
- [ ] 工作台展示连接状态、延迟、协议版本和最近错误。
- [ ] 增加能力快照及变更对比。

验收：连续调用不重复启动进程；Server 崩溃后按策略恢复；关闭应用无残留子进程。

### Phase 2：安全策略与密钥迁移

目标：达到可面向普通用户启用的安全下限。

- [ ] 敏感环境变量和请求头迁移至系统密钥环。
- [ ] 实现 SSRF、重定向、DNS 解析结果和本地地址策略。
- [ ] 实现 R0–R3 风险分级、授权范围和授权失效。
- [ ] 加入速率、并发、调用时长、响应大小和运行预算限制。
- [ ] 完成审计脱敏与审计查看器。

验收：密钥不进入 SQLite、日志和前端状态；恶意 URL、超大响应、无限流和高风险免审批调用均被阻止。

### Phase 3：Assistant / Agent 闭环

目标：让 MCP 成为真实可用的 Agent 工具来源。

- [ ] 动态注册经过筛选的 MCP 工具。
- [ ] 每次 Agent 运行固定工具快照和预算。
- [ ] 实现对话内审批卡片、取消、结果展示和失败恢复。
- [ ] MCP 结果接入提示注入检测，并标记为不可信内容。
- [ ] 增加工具选择质量、调用成功率和审批转化率评测。

验收：Agent 能完成“发现工具—提出调用—用户审批—执行—引用结果”的端到端流程，拒绝审批后不会绕过或重复骚扰。

### Phase 4：资源、Prompt 与生态兼容

目标：补齐协议能力并形成可维护的兼容矩阵。

- [ ] 支持资源读取、订阅能力（服务端声明时）和安全内容解析。
- [ ] 支持 Prompt 列表与用户选择式使用。
- [ ] 建立官方参考 Server 与常见社区 Server 的兼容测试矩阵。
- [ ] 提供配置导入/导出，导入前展示差异且不携带明文密钥。
- [ ] 发布故障诊断与开发者调试信息。

验收：兼容矩阵中的 Server 可稳定完成声明能力；不支持的扩展给出明确错误而非静默失败。

## 8. 测试策略

### 8.1 单元测试

- JSON-RPC 编解码、ID 匹配、错误映射和协议版本协商。
- URL/地址策略、请求头过滤、schema 校验和风险分类。
- SSE 分帧、部分读取、超长帧、非 UTF-8 和异常关闭。
- 审计脱敏、授权匹配、授权过期和 schema 摘要变化。

### 8.2 集成测试

- 内置模拟 `stdio` Server：正常、超时、崩溃、污染 stderr、超大响应。
- 本地 HTTP 测试 Server：重定向、慢响应、断流、错误状态和会话恢复。
- SQLite 迁移、备份恢复、密钥引用缺失和旧配置升级。
- Agent 调用、审批拒绝、取消、预算耗尽和应用重启恢复。

### 8.3 安全测试

- SSRF、DNS rebinding、重定向降级、云元数据地址访问。
- 提示注入、工具描述投毒、递归/超大 schema 和结果炸弹。
- 路径穿越、命令/参数边界、环境变量泄漏和日志泄密。
- 子进程孤儿、进程树逃逸和应用关闭后的资源回收。

## 9. 质量指标

- 连接成功率：正常网络下 ≥ 99%。
- 工具调用宿主错误率：≤ 0.5%（不含 Server 自身业务错误）。
- 状态恢复：Server 临时中断后在策略允许时可恢复，且不产生调用重复提交。
- 安全：R2/R3 未授权调用为 0；密钥明文日志为 0。
- 性能：能力缓存命中时打开工作台不触发阻塞式网络请求；UI 操作保持可取消。
- 可诊断性：所有失败映射到稳定错误码，并给出用户可执行的处理建议。

## 10. 发布与回滚

- 使用功能开关分别控制“会话复用”“Agent 动态工具”“资源读取”。
- 新版首次启动只迁移配置，不自动连接新增 Server。
- 数据迁移失败时停止启用 MCP，但不影响浏览器、知识库和普通 AI 对话。
- 新连接管理器保留一个版本的旧调用路径作为紧急回退，不回滚数据库迁移。
- 分阶段发布：开发者模式 → 内部测试 → 小比例用户 → 默认开启。

## 11. 推荐执行顺序

1. 先完成 Phase 0，建立协议契约与测试基线。
2. 再完成 Phase 1，解决连接复用、状态和资源回收问题。
3. Phase 2 安全收口完成前，不默认向 Agent 开放 MCP 工具。
4. Phase 3 打通助手与 Agent，形成用户可见的完整价值。
5. 最后扩展资源、Prompt、配置迁移和生态兼容。

首个可交付里程碑建议定义为：**一个本地 `stdio` Server 和一个远程 HTTP Server 能稳定保持会话，工具可被 Agent 发现，R2 调用逐次审批，调用全程可取消且有脱敏审计记录。**

## 12. 实施进展（2026-11-02）

本轮开发落地了“长连接 + 可观测 + 资源/Prompt + 审计查看”的第一批能力：

- `mcp.rs` 重写为 `McpHost` 会话管理器：
  - `stdio` 进程每个 Server 只启动一次，按 JSON-RPC `id` 多路复用请求，断线/超时/退出时回收子进程；应用退出时统一 `shutdown_all`。
  - HTTP 传输执行标准 `initialize` → `notifications/initialized` 握手，保存并复用 `Mcp-Session-Id` 与协商后的 `MCP-Protocol-Version`；会话过期（HTTP 404）时自动重新初始化一次。
  - 不再使用自定义的 `server/discover`，改为协议内的 `initialize`。
- 新增命令：`mcp_list_prompts`、`mcp_read_resource`、`mcp_get_prompt`、`mcp_disconnect`、`mcp_server_status`、`mcp_list_audit`、`mcp_clear_audit`。
- 远程地址策略接入请求路径：HTTPS/本地 HTTP 白名单、云元数据与私网/链路本地地址拦截、DNS 解析校验、重定向二次校验（公共地址不可重定向到本地）。
- 工作台补齐：Server 编辑/删除/启停、连接状态与协议版本、断开连接、资源正文读取、Prompt 列表与查看、审计日志查看与清空。
- 测试：新增 HTTP 握手的真实 mock server 测试（校验只初始化一次、会话头透传、方法顺序），Rust 279 项测试与前端 734 项测试全部通过。

仍未完成（按优先级）：

1. `stdio` 进程健康检查、指数退避重连、熔断与状态事件；HTTP 断线重连目前只覆盖 404。
2. 敏感 env / headers 迁移系统密钥环，前端不再回显明文。
3. R0–R3 风险分级、持久授权、速率/并发/预算限制。
4. 能力快照持久化与变更对比；资源和 Prompt 的订阅、MIME 安全解析。
5. Assistant 对话内的 MCP 工具动态注册与审批卡片（当前仍只有两个 Agent 元工具）。
6. 标准 MCP 的 SSE 传输（当前 `sse` 仍复用 Streamable HTTP 的 POST + SSE 响应解析）。
7. 设置页与工作台配置逻辑合并、配置导入导出、兼容性测试矩阵。

### 12.1 第二批：会话韧性、健康检查与密钥环（2026-11-02）

- 会话存活检测：stdio 子进程退出后，下一次请求会丢弃旧会话并重新拉起，不再复用已死亡的进程。
- 指数退避重连：初始化/传输失败在 0ms、250ms、750ms 三次尝试后放弃；配置类错误（停用、非法 URL、找不到 Server）不重试。
- 健康检查：新增 `mcp_ping`（协议 `ping`，8 秒超时）与“检测”按钮，返回真实往返延迟；失败会写入会话健康状态。
- 状态事件：后端通过 `mcp://status` 推送连接/协议版本/最近成功时间/最近错误/连续失败次数，工作台改为事件驱动，不再轮询。
- 密钥环：MCP 的 env 与 headers 改为按 Server 存入系统密钥环（账户 `mcp-secrets:<id>`），SQLite 的 `env_json`/`headers_json` 只保留 `{}`；列表与编辑接口只返回 `********` 掩码，保留掩码保存即“不修改”。旧数据在首次打开工作台时自动迁移；备份天然不包含密钥。
- 修复：按 id 更新 Server，重命名不再产生重复记录；删除 Server 时同步删除密钥环节点。
- 测试：Rust 283 项通过（新增密钥合并/掩码、瞬时错误判定、状态初始值、真实 stdio 子进程复用与 HTTP 握手用例），前端类型检查、734 项单测与构建通过。

下一批建议：Assistant 对话内动态注册 MCP 工具与审批卡片；stdio 崩溃后的状态事件补上 `DEGRADED` 中间态；为健康检查增加可配置间隔与后台巡检。

### 12.2 第三批：后台巡检与对话内 MCP 审批（2026-11-02）

- 后台健康巡检：应用启动后每 60 秒对已连接会话发送 `ping`。成功刷新 `lastOkAt`，失败推送 `mcp://status`；stdio 子进程已退出时自动移除会话。状态灯不再依赖用户下一次操作才会变化。
- 研究 Agent 的 MCP 闭环：
  - 修复 `tools/list` 返回 `{ tools: [...] }` 时的解析（此前按数组处理，实际永远拿不到工具）。
  - 从最多 3 个启用 Server 收集最多 16 个工具，按问题关键词与工具名/描述匹配选择，不再盲目取第一个。
  - 依据工具 `inputSchema` 填充 `query` / `question` / `text` 等字符串参数。
  - 调用前在助手对话中弹出审批卡片，展示 Server、工具、描述与参数 JSON；允许后才以 `approved=true` 执行，拒绝、失败、超时都记录为步骤并继续。
  - 工具结果以“不可信外部资料”的身份进入最终回答上下文，并限制长度。
- 测试：前端新增 tools 信封解析、审批通过、审批拒绝用例；全量 737 项通过。

仍未完成：Rust 侧 `ToolRegistry` 的动态注册（当前运行时注册表仍是启动时构建，Agent supervisor 的工具执行路径也未接入）；SSE 原生传输。

### 12.3 第四批：R0–R3 风险分级与授权记忆（2026-11-02）

- 风险分级：`tools/list` 返回时按工具名与 MCP annotations（`readOnlyHint` / `destructiveHint`）计算 R0–R3；**描述文本不参与判定**，未知工具保守归为 R2，破坏性动词（delete/remove/exec/pay…）直接 R3。
- 能力注解：每个工具结果注入 `arcadiaRisk` 与 `arcadiaGranted`；schema 变化会通过 8 字节 SHA-256 摘要让旧授权失效。
- 后端强制：`mcp_call_tool` 不再盲信前端布尔值——R0 自动放行，R1/R2 需本次审批或有效授权，R3 永远逐次审批且忽略历史授权。
- 授权记忆：R1 首次批准并成功后写入 `mcp_tool_grants`（迁移 36），工作台显示“已记住授权”并可撤销；R2 不记忆，R3 禁止记忆。
- 审计：`mcp_audit_log` 增加 `risk` 列，审计抽屉展示风险等级。
- 助手审批卡片展示风险标签，R3 额外提示“每次调用都需要确认”。
- 测试：新增风险分类、schema 摘要、授权作用域用例；前端新增 R0 自动放行、R1 授权复用用例。全量 Rust 286 项、前端 739 项通过。

### 12.4 第五批：原生 SSE 传输（2026-11-02）

- `sse` 不再复用 Streamable HTTP 的 POST 语义，改为真正的 Legacy HTTP+SSE：
  - 后台 GET `text/event-stream`，解析 `endpoint` 事件拿到消息端点。
  - JSON-RPC 请求 POST 到该端点（202/2xx），响应作为 `message` 事件回到同一流，按 id 路由到等待中的请求。
  - 通知（`notifications/initialized`）走同一端点，不等待响应。
  - 端点必须与流同源，并复用私有地址/元数据地址校验。
  - 断流后会话标记为不可用，由会话管理器在下一次请求时重建；断开/退出时 abort 流任务并清理挂起请求。
- 测试：新增 SSE 分帧、跨源端点拒绝、真实 TCP mock 的完整握手（endpoint → initialize → initialized → tools/list）用例。Rust 全量 289 项通过。

### 12.5 第六批：工具参数表单与校验（2026-11-02）

- 工作台不再让用户面对裸 JSON：按工具 `inputSchema.properties` 生成表单。
- 支持 `string` / `number` / `integer` / `boolean` / `enum` / `array` / `object`；数组与对象使用带即时校验的 JSON 子编辑器。
- 必填标记、字段描述、`default` 预填；调用前按 schema 校验必填、类型和枚举，错误信息定位到具体字段。
- 保留“表单 / JSON”切换，复杂 schema 或高级用户仍可直接编辑原始 JSON。
- 新增 `features/mcp/schema.ts` 纯函数与 `ToolArgumentsEditor` 组件；参数状态由字符串改为结构化对象。
- 测试：新增 schema 字段提取、默认值、必填/类型/枚举校验用例；前端 104 文件 / 743 用例通过。

### 12.6 第七批：配置导入 / 导出（2026-11-02）

- 工作台新增“导出 / 导入”：
  - 导出为 `arcadia-mcp-config.json`，包含 Server 名称、传输方式、命令/URL、参数、启停状态与 **密钥键名**；不包含任何密钥值。
  - 导入先调用预览：按名称给出“新建 / 更新 / 无变化”和变更字段，用户确认后才写库。
  - 更新同名 Server 时只改连接配置，SQLite 与系统密钥环中的密钥保持原样；新建 Server 的密钥需导入后补填，导入结果会列出缺失的键名。
  - 后端校验版本、重复名称、传输方式、stdio 命令、HTTP/SSE URL，并复用私网/元数据地址策略。
- 导出提供复制到剪贴板与文件下载两种方式。
- 测试：新增“导入预览/应用且保留密钥”“非法配置拒绝”用例；Rust 291 项通过。

### 12.7 第八批：兼容性诊断与空闲自愈（2026-11-02）

- 工作台新增“诊断”：按 `initialize → tools/list → resources/list → prompts/list` 逐阶段执行，输出每阶段成功/失败、耗时、返回数量（工具/资源/Prompt）与服务端名称/协议版本；初始化失败也会生成报告而不是直接报错。
- 后台巡检升级：除了 ping，发现会话已死亡（stdio 子进程退出、SSE 断流）时会在后台重建会话并推送状态，无需等用户下一次点击；重建失败继续按 60 秒节奏上报错误。
- 诊断与风险/授权/审计解耦，不会触发工具调用，也不会写入审计。
- 测试：新增真实 HTTP mock 的诊断用例（4 个阶段、数量与耗时）；Rust 292 项通过。

### 12.8 第九批：工具结果结构化渲染（2026-11-02）

- 工作台“调用结果”不再直接倾倒 JSON，按 MCP `content` 块渲染：
  - `text`：等宽文本、超长折叠（超过 6000 字符可展开）。
  - `image` / `audio`：仅接受白名单 MIME（svg 被拒绝）并以 data URI 内联展示。
  - `resource`：展示 URI、MIME 与正文。
  - `structuredContent`：独立格式化区域。
  - `isError`：红色错误提示。
- 保留“渲染结果 / 原始 JSON”一键切换，未知块类型回落为格式化 JSON。
- 测试：新增结果解析用例（文本、图片 MIME 白名单、资源、错误、纯文本回退）；前端 106 文件 / 752 用例通过。

### 12.9 第十批：断流快速重连与退避（2026-11-02）

- 巡检拆成两条节奏：
  - **5 秒 liveness 扫描**：只检查 `is_alive()`，发现 stdio 子进程退出或 SSE 断流就立即重建会话（重新 spawn / 重连 + initialize），不再等 60 秒巡检。
  - **60 秒 ping**：只探测健康会话，避免对空闲 Server 高频发请求。
- 重建失败按 5s → 10s → 20s → 40s … 指数退避，单 Server 上限 300 秒；成功或断开/删除时清零。
- 状态事件仍在重建成功/失败时推送，UI 不需要轮询。
- 测试：新增退避序列用例（含上限）；Rust 293 项通过。

### 12.10 第十一批：Windows `npx` 兼容修复与真实 Server 冒烟（2026-11-02）

- 修复 Windows 下 stdio 无法启动 `npx` 的问题：`CreateProcess` 不认识 `npx.cmd`，现在按 `PATH` + `PATHEXT` 解析裸命令，`.cmd`/`.bat` 统一通过 `cmd.exe /C` 启动；`.exe` 保持直接 spawn。
- 新增 Windows 单元测试：`npx` 必须解析到 `.cmd`/`.bat` shim。
- 新增手工真实 Server 冒烟（`#[ignore]`，需网络）：
  `cargo test --lib smoke_real_filesystem_server -- --ignored --nocapture`
  实际拉起 `npx -y @modelcontextprotocol/server-filesystem`，完成 `initialize`、`tools/list`、`tools/call(list_directory)`，返回内容正常。
- 测试：Rust 294 项通过 + 1 项忽略（真实冒烟）；真实冒烟本机通过。

### 12.12 第十二批：真实 Streamable HTTP 冒烟（2026-11-02）

- 新增 `smoke_real_deepwiki_http_server`（`#[ignore]`，需网络）：对公开的 `https://mcp.deepwiki.com/mcp` 执行 `initialize`、`tools/list`、`tools/call(read_wiki_structure)`。
- 本机实测 2.33 秒通过，验证了 Streamable HTTP 的 SSE-formatted 响应解析、协议头、工具调用与真实服务端兼容性。
- 公开的 legacy SSE 端点已基本下线（DeepWiki `/sse` 直接返回 deprecated 错误），原生 SSE 传输继续由本地 TCP mock 覆盖。
- 当前真实兼容矩阵：本地 stdio filesystem、远程 Streamable HTTP DeepWiki；Rust 全量 294 通过 + 2 项忽略冒烟。

### 12.13 第十三批：助手侧研究过程展示（2026-11-02）

- 研究 Agent 的步骤不再只存在于“运行历史”抽屉：回答下方新增可折叠的“研究过程（N 步）”，列出检索、MCP 工具调用、生成回答三个阶段。
- MCP 步骤使用橙色标签区分，详情（工具返回摘要）以等宽小字折叠展示；拒绝/失败/超时也会作为步骤出现。
- 步骤随对话持久化：`StoredConversationTurn` 增加 `steps`，解析时限制 20 步、摘要 300 字、详情 4000 字，避免历史膨胀。
- 测试：新增研究步骤持久化用例；前端全量 107 文件 / 756 用例通过。

### 12.14 第十四批：能力快照与变更对比（2026-11-02）

- 迁移 37 新增 `mcp_capability_snapshots(server_id, kind, payload_json, captured_at)`，按 Server 分别保存 tools / resources / prompts 的名称与内容摘要。
- `mcp_list_tools/resources/prompts` 返回时计算当前快照，与上次比较后注入 `arcadiaCapabilityDiff`（added / removed / changed / firstSeen），并更新快照。
- 工作台连接后若检测到非首次的能力变化，显示可关闭的黄色提示：按工具/资源/提示词分别给出新增、移除、变更数量。
- 摘要基于完整条目 JSON（含描述、schema、URI），因此描述或输入 schema 改动也会被识别。
- 测试：新增能力 diff 与快照条目摘要用例；Rust 全量 296 通过 + 2 项忽略冒烟。

### 12.15 第十五批：研究 Agent 的模型工具选择（2026-11-02）

- 研究 Agent 不再只靠关键词猜工具：把最多 16 个候选工具（Server、名称、描述、schema 摘要）编成目录，让模型返回 JSON：
  `{"server":"...","tool":"...","arguments":{...}}` 或 `{"tool":null}`。
- 模型明确返回 `null` 时尊重判断、不调用工具；输出无法解析时回退到原来的关键词启发式，保证可用性。
- 模型生成的参数先按 `inputSchema` 校验（必填/类型/枚举），不完整则记录步骤并跳过，不再盲目调用。
- 规划调用的 token 计入运行预算；审批、风险分级、执行与结果回填链路保持不变。
- 测试：新增“模型选择工具与参数”“模型明确不调用”用例；前端全量 107 文件 / 758 用例通过。

### 12.16 第十六批：多轮工具循环（2026-11-02）

- 研究 Agent 从“选一次工具”升级为有上限的多轮循环：
  - 每轮把已有工具结果（截断后）作为 observation 交给模型，模型可选择下一个工具或返回 `{"tool":null}`；
  - 受 `maxToolCalls`（默认 3）与 `maxSteps` 双重约束，不会无限调用；
  - 用户拒绝审批、工具调用失败、模型参数不完整都会终止循环，避免重复骚扰或死循环；
  - 只有第一轮解析失败才回退关键词启发式，后续轮次失败直接停止。
- 所有 observation 汇总后以“不可信外部资料”加入最终回答上下文。
- 测试：新增两轮工具循环用例；前端全量 107 文件 / 759 用例通过。

### 12.17 第十七批：研究过程里的结构化工具结果（2026-11-02）

- `AgentStep` 增加 `result`，研究步骤不再只有 JSON 摘要：工具调用成功后，回答下方的“研究过程”直接渲染 MCP `content` 块（文本、图片、资源、结构化结果）。
- 复用 `ToolResultView` 的 `compact` 模式：不显示“渲染结果 / 原始 JSON”工具栏，图片限高、文本限高，适合嵌在步骤列表里。
- 体积控制：序列化超过 20KB 的结果替换为截断文本块；对话持久化时同样丢弃超过 20KB 的 `result`，避免历史记录被 base64 图片撑爆。
- 测试：新增结构化结果保留/超限丢弃用例；前端全量 107 文件 / 761 用例通过。

### 12.18 第十八批：停用未接入的后端 Agent supervisor（2026-11-02）

- 应用启动时不再构建 `ToolRegistry`、也不再启动 `AgentSupervisor`。核查结论：前端从未调用 `agent_start`，而 supervisor 查询的是大写状态（`PLANNING/RUNNING`），前端写入的是小写（`running/completed`），该循环实际上永远匹配不到运行。
- 从 Tauri 注册表中移除 14 个 `agent_*` 命令（start/pause/resume/cancel/get_run/record_step/request_approval/approve/deny/verify_approval/save_checkpoint/latest_checkpoint/mark_unknown_runs/recover_interrupted）。
- 移除前端 `api.ts` 中对应的 `agentStart` 等函数与 `AgentRunMeta` / `AgentBudgetLimits` 类型，避免继续暴露不可用的 API。
- Rust 侧模块（`supervisor`、`runtime`、`tools`、`approval`、`budget`、`checkpoint`）暂时保留并在 `agent/mod.rs` 标注“未启动、为未来后端 Agent 预留”；产品研究 Agent 继续通过 `local_record_agent_run` 记录运行。
- 测试：行为无变化；Rust 296 通过 + 2 项忽略，前端 761 通过。

### 12.19 第十九批：官方 everything Server 真实冒烟（2026-11-02）

- 新增 `smoke_real_everything_server`（`#[ignore]`，需网络）：拉起 `npx -y @modelcontextprotocol/server-everything`。
- 实测覆盖：`tools/list`（echo / get-sum / 资源链接 / 图片 / 结构化内容等 17 个工具）、`resources/list`、`prompts/list`、`tools/call(get-sum)` 返回正确结果。
- 本机 2.21 秒通过，补上了此前只用 mock 覆盖的 resources / prompts 真实链路。
- 真实兼容矩阵现为：本地 stdio filesystem、本地 stdio everything（tools+resources+prompts）、远程 Streamable HTTP DeepWiki；Rust 296 通过 + 3 项忽略冒烟。

### 12.20 第二十批：Playwright MCP 真实冒烟（2026-11-02）

- 新增 `smoke_real_playwright_server`（`#[ignore]`，需网络）：拉起 `npx -y @playwright/mcp@latest`，只执行 `initialize` + `tools/list`，不启动浏览器。
- 本机 21.25 秒通过，返回的 `browser_*` 工具列表正常，验证了大型 Node Stdio Server 的启动与握手。
- 真实兼容矩阵补齐为：filesystem（文件）、everything（tools/resources/prompts）、Playwright（浏览器）、DeepWiki（远程 HTTP）。
- Rust 全量 296 通过 + 4 项忽略冒烟。

### 12.21 第二十一批：删除后端 Agent 死代码（2026-11-02）

- 删除 `agent/` 下未接入的运行时模块：`runtime`、`supervisor`、`tools`、`approval`、`budget`、`checkpoint`、`commands`、`types`（共 8 个文件）。
- 保留并明确职责：`mcp_security`（MCP URL 校验，被 `mcp.rs` 使用）、`security`（提示注入检测）、`security_commands`（两个 Tauri 命令）。
- 同步移除 `agent/mod.rs` 的模块声明与 re-export，`lib.rs` 不再引用已删除模块。
- 产品研究 Agent 仍由前端 `agentLoop` 驱动，运行记录走 `local_record_agent_run` / `local_update_agent_run_status`，行为无变化。
- 测试：随死代码移除 28 个 Rust 用例；Rust **268 通过 + 4 项忽略冒烟**，前端 761 通过。

### 12.22 第二十二批：工具结果复制与下载（2026-11-02）

- 工作台与助手研究过程的工具结果都支持复制原始 JSON；调用结果工具栏额外提供“下载 JSON”。
- 研究过程的 compact 视图只保留一个“复制”按钮，避免嵌套工具栏过重。
- 复制使用 Clipboard API，失败时静默（非 Tauri/浏览器权限受限场景）。
- 测试：行为无变化；Rust 268 通过 + 4 项忽略，前端全量 108 文件 / 769 用例通过（含并行新增的 McpPage 用例）。

### 12.23 第二十三批：并行工具调用（2026-11-02）

- 规划协议扩展为 `{"calls":[{server,tool,arguments}, ...]}`：模型一次最多给出 2 个互不依赖的工具，仍兼容旧的单工具 JSON 与 `{"tool":null}`。
- 审批按顺序逐个弹出；拒绝某一个时跳过该调用并停止继续申请；已批准的调用进入下一批。
- 已批准调用通过 `Promise.all` 并行执行，各自 20 秒超时；单个失败只记录该步骤，不影响同批其他结果。
- 仍受 `maxToolCalls` 约束：一次返回多个调用时会按剩余预算截断。
- 测试：新增并行执行用例（同时活跃调用数 = 2）；前端全量 108 文件 / 770 用例通过。

### 12.24 第二十四批：工具列表筛选（2026-11-02）

- 工具数量超过 5 个时，工作台显示筛选输入框，按工具名与描述实时过滤；计数标签显示 `匹配数/总数`。
- 无匹配时显示“没有匹配的工具”，切换 Server / 断开时自动清空筛选。
- 解决 everything / Playwright 这类 17+ 工具 Server 在长列表里难以定位的问题。
- 测试：行为无变化；Rust 268 通过 + 4 项忽略，前端 770 通过。


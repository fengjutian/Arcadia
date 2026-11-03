# MCP 发布前检查清单

> 适用范围：`desktop` Tauri 桌面端  
> 更新时间：2026-11-03

## 1. 自动化验证

在 `desktop` 目录执行：

```bash
npm run test            # 前端全量（当前 108 文件 / 774 用例）
npx tsc --noEmit -p tsconfig.app.json
npm run build           # tsc + vite build
```

在 `desktop/src-tauri` 目录执行：

```bash
cargo check --lib
cargo test --lib        # 当前 272 通过 + 4 项忽略
```

真实 Server 冒烟（需要网络 / npx）：

```bash
cargo test --lib smoke_real -- --ignored --nocapture
```

当前覆盖：

| 形态 | Server | 验证内容 |
| --- | --- | --- |
| 本地 stdio | `@modelcontextprotocol/server-filesystem` | initialize、tools/list、list_directory |
| 本地 stdio | `@modelcontextprotocol/server-everything` | tools、resources、prompts、get-sum |
| 本地 stdio | `@playwright/mcp@latest` | initialize、tools/list（不启动浏览器） |
| 远程 HTTP | `https://mcp.deepwiki.com/mcp` | Streamable HTTP、tools/list、read_wiki_structure |

## 2. 手工 UI 验收

1. 设置 → MCP：添加一个 stdio Server（`npx -y @modelcontextprotocol/server-everything`）。
2. 回到 MCP 工作台：连接并发现，确认工具 / 资源 / Prompt 数量正确。
3. 点击“诊断”：四个阶段应为绿色，协议版本与服务端名称正确。
4. 调用 `get-sum`（a=2,b=3）：确认参数表单、风险徽标、授权弹窗与结果渲染正常。
5. 在审计中确认出现 `tools/call`、风险等级与成功状态。
6. 断开连接：确认状态灯变化；点击“查看缓存”能看到上次能力快照。
7. 导出配置：确认 JSON 只有密钥名、没有密钥值；再导入并预览 diff。
8. 助手 → 研究：提问一个需要工具的问题，确认审批卡片、研究过程步骤与结构化结果。

## 3. 安全回归

- 非 HTTPS 远程地址、私网 / 云元数据地址应被拒绝。
- 敏感 env / headers 只存在于系统密钥环，SQLite 中为 `{}`。
- R3 工具每次调用都必须确认，且不能记忆授权。
- 拒绝审批后不应继续调用或重复弹窗。
- 删除 Server 后应清理密钥环与能力快照授权记录。

## 4. 已知限制

- 流式 tool-calling 未实现；规划调用统一走非流式。
- 真实 Provider 冒烟依赖 API key，未纳入自动化。
- GitHub MCP 冒烟需要 token，未纳入。
- 资源 / Prompt 只能缓存浏览，不能离线执行。
- Rust 侧后端 Agent 运行时已删除，研究 Agent 完全由前端驱动。

## 5. 发布前结论

自动化测试、类型检查、构建与四个真实 Server 冒烟均通过后，可进入手工 UI 验收；手工项全部通过即可发布。

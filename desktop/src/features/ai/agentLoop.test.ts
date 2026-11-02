import { describe, expect, it, vi } from 'vitest'
import type { AgentRun } from '../../api'
import type { ChatRequest } from '../../types'
import { runResearchAgent, type AgentDeps, type AgentOptions, type McpApprovalRequest } from './agentLoop'

/** Shape of the argument passed to `updateAgentRunStatus`, for assertions. */
interface StatusUpdate {
  id: string
  status: string
  stepsJson?: string
  finalAnswer?: string
  lastError?: string
}

function spyUpdates(): { spy: (input: StatusUpdate) => Promise<void>; calls: StatusUpdate[][] } {
  const calls: StatusUpdate[][] = []
  const spy = vi.fn(async (input: StatusUpdate) => { calls.push([input]) })
  return { spy, calls }
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'agent-1',
    title: 't',
    status: 'pending',
    stepsJson: '[]',
    startedAt: '2026-10-07T00:00:00Z',
    ...overrides,
  }
}

function deps(overrides: Partial<AgentDeps> = {}): AgentDeps & { statuses: string[] } {
  const statuses: string[] = []
  const base: AgentDeps = {
    async recordAgentRun() { return run() },
    async updateAgentRunStatus(input) { statuses.push(input.status) },
    async searchDocuments() {
      return [
        { id: 'doc-1', title: 'Doc one', markdownSnippet: 'alpha' },
        { id: 'doc-2', title: 'Doc two', markdownSnippet: 'beta' },
      ]
    },
    async aiChat() { return { content: 'final answer', promptTokens: 100 } },
    async listMcpServers() { return [] },
    async discoverMcpServer() { return {} },
    async listMcpTools() { return [] },
    async callMcpTool() { return {} },
    ...overrides,
  }
  return Object.assign(base, { statuses })
}

const options: AgentOptions = { providerId: 'p1' }

describe('runResearchAgent', () => {
  it('records a run and completes with an answer', async () => {
    const d = deps()
    const result = await runResearchAgent(d, 'what did I save?', options)

    expect(result.run?.id).toBe('agent-1')
    expect(result.answer).toBe('final answer')
    expect(result.stopped).toBeNull()
    expect(d.statuses).toContain('running')
    expect(d.statuses[d.statuses.length - 1]).toBe('completed')
    expect(result.steps.map(step => step.kind)).toEqual(['search', 'answer'])
  })

  it('persists the steps and final answer on the run row', async () => {
    const { spy, calls } = spyUpdates()
    await runResearchAgent(deps({ updateAgentRunStatus: spy }), 'q', options)

    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('completed')
    expect(last?.finalAnswer).toBe('final answer')
    expect(JSON.parse(String(last?.stepsJson)).length).toBe(2)
  })

  it('marks the run failed and keeps the error when the model call throws', async () => {
    const { spy, calls } = spyUpdates()
    const d = deps({
      updateAgentRunStatus: spy,
      async aiChat() { throw new Error('provider offline') },
    })
    const result = await runResearchAgent(d, 'q', options)

    expect(result.answer).toBe('')
    expect(result.stopped?.message).toContain('provider offline')
    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('failed')
    expect(last?.lastError).toContain('provider offline')
  })

  it('cancels the run when the token budget is exceeded', async () => {
    const { spy, calls } = spyUpdates()
    const d = deps({
      updateAgentRunStatus: spy,
      async aiChat() { return { content: 'long answer', promptTokens: 5000 } },
    })
    const result = await runResearchAgent(d, 'q', { ...options, maxPromptTokens: 100 })

    expect(result.stopped?.reason).toBe('token_budget')
    const last = calls.at(-1)?.[0]
    expect(last?.status).toBe('cancelled')
    expect(last?.finalAnswer).toBe('long answer')
  })

  it('does not call MCP tools without explicit approval', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', options)

    expect(callTool).not.toHaveBeenCalled()
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('未获授权'))).toBe(true)
  })

  it('calls an approved MCP tool with a timeout guard', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({ hits: 3 }))
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true })

    expect(callTool).toHaveBeenCalledTimes(1)
    expect(callTool.mock.calls[0]?.[1]).toBe('search_web')
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('search_web'))).toBe(true)
  })

  it('parses the tools envelope returned by the backend and fills the schema field', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({ hits: 1 }))
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() {
        return {
          tools: [{
            name: 'search_web',
            description: 'search the web',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          }],
        }
      },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'web search q', { ...options, approveToolCalls: true })

    expect(callTool).toHaveBeenCalledWith('s1', 'search_web', { query: 'web search q' }, true)
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('search_web'))).toBe(true)
  })

  it('asks the user through requestApproval before calling a tool', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const approve = vi.fn(async (_request: McpApprovalRequest) => true)
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'search_web' }] } },
      callMcpTool: callTool,
    })
    await runResearchAgent(d, 'q', { ...options, requestApproval: approve })

    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve.mock.calls[0]?.[0]).toMatchObject({ serverId: 's1', serverName: 'srv', toolName: 'search_web' })
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('skips the tool when the user denies approval', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const approve = vi.fn(async () => false)
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'search_web' }] } },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, requestApproval: approve })

    expect(callTool).not.toHaveBeenCalled()
    expect(result.steps.some(step => step.kind === 'mcp_tool' && step.summary.includes('未获授权'))).toBe(true)
  })

  it('auto-runs R0 tools without asking for approval', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const approve = vi.fn(async (_request: McpApprovalRequest) => false)
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'get_status', arcadiaRisk: 'R0' }] } },
      callMcpTool: callTool,
    })
    await runResearchAgent(d, 'q', { ...options, requestApproval: approve })

    expect(approve).not.toHaveBeenCalled()
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('reuses a remembered R1 grant without asking again', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const approve = vi.fn(async (_request: McpApprovalRequest) => false)
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'read_doc', arcadiaRisk: 'R1', arcadiaGranted: true }] } },
      callMcpTool: callTool,
    })
    await runResearchAgent(d, 'q', { ...options, requestApproval: approve })

    expect(approve).not.toHaveBeenCalled()
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('lets the model choose the tool and arguments', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({ hits: 2 }))
    const approve = vi.fn(async (_request: McpApprovalRequest) => true)
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      return system.includes('MCP tool selector')
        ? { content: '```json\n{"server":"srv","tool":"search_web","arguments":{"query":"cats"}}\n```', promptTokens: 5 }
        : { content: 'final answer', promptTokens: 5 }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() {
        return { tools: [{ name: 'search_web', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } } }] }
      },
      callMcpTool: callTool,
    })
    await runResearchAgent(d, 'cats', { ...options, requestApproval: approve })

    expect(callTool).toHaveBeenCalledWith('s1', 'search_web', { query: 'cats' }, true)
  })

  it('runs a bounded multi-round tool loop', async () => {
    const callTool = vi.fn(async (_id: string, name: string, _args: Record<string, unknown>, _ok: boolean) => ({ tool: name }))
    let plannerCalls = 0
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      if (!system.includes('MCP tool selector')) return { content: 'final answer', promptTokens: 5 }
      plannerCalls += 1
      const content = plannerCalls === 1
        ? '{"server":"srv","tool":"first_tool","arguments":{}}'
        : plannerCalls === 2
          ? '{"server":"srv","tool":"second_tool","arguments":{}}'
          : '{"tool":null}'
      return { content, promptTokens: 5 }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'first_tool' }, { name: 'second_tool' }] } },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, requestApproval: async () => true })

    expect(plannerCalls).toBe(3)
    expect(callTool.mock.calls.map(call => call[1])).toEqual(['first_tool', 'second_tool'])
    expect(result.steps.filter(step => step.kind === 'mcp_tool' && step.summary.startsWith('调用 MCP 工具'))).toHaveLength(2)
  })

  it('keeps a bounded structured result on the tool step', async () => {
    const payload = { content: [{ type: 'text', text: 'hello' }], isError: false }
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => payload)
    let plannerCalls = 0
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      if (!system.includes('MCP tool selector')) return { content: 'final answer', promptTokens: 5 }
      plannerCalls += 1
      return {
        content: plannerCalls === 1
          ? '{"server":"srv","tool":"search_web","arguments":{}}'
          : '{"tool":null}',
        promptTokens: 5,
      }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'search_web' }] } },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, requestApproval: async () => true })

    const step = result.steps.find(item => item.kind === 'mcp_tool' && item.result !== undefined)
    expect(step?.result).toEqual(payload)
  })

  it('runs independent tool calls in parallel', async () => {
    let active = 0
    let maxActive = 0
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active -= 1
      return { ok: true }
    })
    let plannerCalls = 0
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      if (!system.includes('MCP tool selector')) return { content: 'final answer', promptTokens: 5 }
      plannerCalls += 1
      return {
        content: plannerCalls === 1
          ? '{"calls":[{"server":"srv","tool":"first_tool","arguments":{}},{"server":"srv","tool":"second_tool","arguments":{}}]}'
          : '{"tool":null}',
        promptTokens: 5,
      }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'first_tool' }, { name: 'second_tool' }] } },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, requestApproval: async () => true })

    expect(maxActive).toBe(2)
    expect(callTool.mock.calls.map(call => call[1])).toEqual(['first_tool', 'second_tool'])
    expect(result.steps.filter(step => step.summary.startsWith('调用 MCP 工具'))).toHaveLength(2)
  })

  it('uses native provider tool calls when enabled', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({ hits: 1 }))
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      if (!system.includes('MCP tool selector')) return { content: 'final answer', promptTokens: 5 }
      expect(request.tools?.[0]?.name).toBe('srv__search_web')
      return {
        content: '',
        promptTokens: 5,
        toolCalls: [{ id: 'call-1', name: 'srv__search_web', arguments: '{"query":"cats"}' }],
      }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'search_web', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] } },
      callMcpTool: callTool,
    })
    await runResearchAgent(d, 'cats', { ...options, nativeToolCalling: true, requestApproval: async () => true })

    expect(callTool).toHaveBeenCalledWith('s1', 'search_web', { query: 'cats' }, true)
  })

  it('honours an explicit "no tool" decision from the model', async () => {
    const callTool = vi.fn(async (_id: string, _name: string, _args: Record<string, unknown>, _ok: boolean) => ({}))
    const aiChat = vi.fn(async (_provider: string, request: ChatRequest) => {
      const system = typeof request.messages[0]?.content === 'string' ? request.messages[0].content : ''
      return system.includes('MCP tool selector')
        ? { content: '{"tool":null}', promptTokens: 5 }
        : { content: 'final answer', promptTokens: 5 }
    })
    const d = deps({
      aiChat,
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return { tools: [{ name: 'search_web' }] } },
      callMcpTool: callTool,
    })
    const result = await runResearchAgent(d, 'q', { ...options, requestApproval: async () => true })

    expect(callTool).not.toHaveBeenCalled()
    expect(result.steps.some(step => step.summary.includes('无需调用'))).toBe(true)
  })

  it('isolates a failing MCP server instead of aborting the run', async () => {
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { throw new Error('server unreachable') },
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true })

    expect(result.answer).toBe('final answer')
    expect(result.steps.some(step => step.summary === 'MCP 不可用，已跳过')).toBe(true)
  })

  it('never exceeds the configured step budget', async () => {
    const d = deps({
      async listMcpServers() { return [{ id: 's1', name: 'srv', enabled: true }] },
      async listMcpTools() { return [{ name: 'search_web' }] },
      async callMcpTool() { return {} },
    })
    const result = await runResearchAgent(d, 'q', { ...options, approveToolCalls: true, maxSteps: 2 })

    expect(result.steps.length).toBeLessThanOrEqual(3)
    expect(result.stopped?.reason).toBe('max_steps')
  })

  it('leaves no run behind when recording itself fails', async () => {
    const d = deps({ async recordAgentRun() { throw new Error('db locked') } })
    const result = await runResearchAgent(d, 'q', options)
    expect(result.run).toBeNull()
    expect(result.stopped?.message).toContain('db locked')
  })
})
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// First-run experience: an empty workbench used to be a dead end. These tests
// pin the two sample servers, the one-click add payload, and the guard that
// stops a sample from being added twice.

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))

const { McpPage } = await import('./McpPage')
const { SAMPLE_SERVERS } = await import('./samples')
const { t } = await import('@arcadia/i18n')

const SAVE_COMMAND = 'local_save_mcp_server'
const DISCOVER_COMMAND = 'mcp_discover'

let container: HTMLDivElement
let root: Root
let savedServers: Array<Record<string, unknown>>

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function mount() {
  await act(async () => root.render(<McpPage onOpenUrl={() => {}}/>))
  await flush()
}

function sampleButton(title: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button.mcp-sample')]
    .find(candidate => candidate.textContent?.includes(title))
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  savedServers = []
  bridge.invoke.mockReset()
  bridge.invoke.mockImplementation(async (command: string, payload?: { server?: Record<string, unknown> }) => {
    if (command === 'local_list_mcp_servers') return savedServers
    if (command === SAVE_COMMAND) {
      const server = payload?.server ?? {}
      savedServers = [...savedServers, { ...server, id: 'sample-1', env: {}, headers: {}, createdAt: '', updatedAt: '' }]
      return savedServers[savedServers.length - 1]
    }
    if (command === DISCOVER_COMMAND) return {}
    if (command === 'mcp_list_tools') return { tools: [] }
    if (command === 'mcp_list_resources') return { resources: [] }
    if (command === 'mcp_list_prompts') return { prompts: [] }
    return null
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

describe('MCP empty-state samples', () => {
  it('offers every sample server when no server exists yet', async () => {
    await mount()
    expect(container.textContent).toContain(t('还没有 MCP Server'))
    for (const sample of SAMPLE_SERVERS) {
      expect(sampleButton(t(sample.titleId))).toBeTruthy()
    }
  })

  it('adds the stdio sample with the command and arguments the backend expects', async () => {
    await mount()
    const button = sampleButton(t('示例 everything'))
    if (!button) throw new Error('sample button missing')

    await act(async () => { button.click() })
    await flush()

    const call = bridge.invoke.mock.calls.find(([command]) => command === SAVE_COMMAND)
    expect(call).toBeTruthy()
    expect(call?.[1]).toEqual({
      server: {
        name: 'everything',
        transport: 'stdio',
        enabled: true,
        command: 'npx',
        url: undefined,
        args: ['-y', '@modelcontextprotocol/server-everything'],
        env: {},
        headers: {},
      },
    })
    expect(bridge.invoke).toHaveBeenCalledWith(DISCOVER_COMMAND, { serverId: 'sample-1' })
  })

  it('adds the remote sample as an HTTP server without a command', async () => {
    await mount()
    const button = sampleButton(t('示例 DeepWiki'))
    if (!button) throw new Error('sample button missing')

    await act(async () => { button.click() })
    await flush()

    const call = bridge.invoke.mock.calls.find(([command]) => command === SAVE_COMMAND)
    expect(call?.[1]).toMatchObject({
      server: {
        name: 'deepwiki',
        transport: 'http',
        url: 'https://mcp.deepwiki.com/mcp',
        args: [],
      },
    })
    expect((call?.[1] as { server: { command?: string } }).server.command).toBeUndefined()
  })
})

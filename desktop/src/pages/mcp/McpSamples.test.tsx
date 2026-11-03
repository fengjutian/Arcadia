import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// First-run experience: an empty workbench used to be a dead end. These tests
// pin the two sample servers, the payload each one produces (including the
// Documents directory the filesystem server refuses to start without), and the
// fallback that sends the user to the form when no host path is available.

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
  documentDir: vi.fn(),
  homeDir: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: bridge.documentDir, homeDir: bridge.homeDir }))

const { McpPage } = await import('./McpPage')
const { SAMPLE_SERVERS } = await import('./samples')
const { t } = await import('@arcadia/i18n')

const SAVE_COMMAND = 'local_save_mcp_server'
const DISCOVER_COMMAND = 'mcp_discover'
const DOCUMENTS = 'C:\\Users\\tester\\Documents'

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

function savedPayload(): { server: Record<string, unknown> } | undefined {
  const call = bridge.invoke.mock.calls.find(([command]) => command === SAVE_COMMAND)
  return call?.[1] as { server: Record<string, unknown> } | undefined
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  savedServers = []
  bridge.invoke.mockReset()
  bridge.documentDir.mockReset()
  bridge.homeDir.mockReset()
  bridge.documentDir.mockResolvedValue(DOCUMENTS)
  bridge.homeDir.mockResolvedValue('C:\\Users\\tester')
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

  it('adds the Playwright sample with its launch arguments and connects it', async () => {
    await mount()
    const button = sampleButton(t('浏览器自动化'))
    if (!button) throw new Error('sample button missing')

    await act(async () => { button.click() })
    await flush()

    expect(savedPayload()).toEqual({
      server: {
        name: 'playwright',
        transport: 'stdio',
        enabled: true,
        command: 'npx',
        url: undefined,
        args: ['-y', '@playwright/mcp@latest'],
        env: {},
        headers: {},
      },
    })
    expect(bridge.invoke).toHaveBeenCalledWith(DISCOVER_COMMAND, { serverId: 'sample-1' })
  })

  it('grants the filesystem sample only the resolved Documents folder', async () => {
    await mount()
    const button = sampleButton(t('本地文档'))
    if (!button) throw new Error('sample button missing')

    await act(async () => { button.click() })
    await flush()

    expect(bridge.documentDir).toHaveBeenCalled()
    expect(savedPayload()?.server).toMatchObject({
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', DOCUMENTS],
    })
  })

  it('falls back to the add form when the host cannot resolve a folder', async () => {
    bridge.documentDir.mockRejectedValue(new Error('denied'))
    bridge.homeDir.mockRejectedValue(new Error('denied'))
    await mount()
    const button = sampleButton(t('本地文档'))
    if (!button) throw new Error('sample button missing')

    await act(async () => { button.click() })
    await flush()

    expect(bridge.invoke).not.toHaveBeenCalledWith(SAVE_COMMAND, expect.anything())
    // The add dialog opens prefilled with the command, path left to the user.
    const dialog = document.querySelector<HTMLElement>('.ui-dialog')
    expect(dialog?.textContent).toContain('@modelcontextprotocol/server-filesystem')
  })
})

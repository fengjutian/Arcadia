import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A freshly connected Playwright server exposes ~25 tools. The workbench shows
// a one-line guide pointing at browser_navigate with the URL pre-filled, so the
// first successful call is two clicks instead of reading 25 descriptions.

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))
vi.mock('@tauri-apps/api/path', () => ({ documentDir: vi.fn(), homeDir: vi.fn() }))

const { McpPage } = await import('./McpPage')
const { t } = await import('@arcadia/i18n')

const SERVER = {
  id: 'pw',
  name: 'playwright',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
  env: {},
  headers: {},
  enabled: true,
  createdAt: '',
  updatedAt: '',
}

const TOOLS = {
  tools: [
    {
      name: 'browser_navigate',
      description: 'Navigate to a URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      arcadiaRisk: 'R2',
    },
    { name: 'browser_click', description: 'Click', inputSchema: { type: 'object', properties: {} }, arcadiaRisk: 'R2' },
  ],
}

let container: HTMLDivElement
let root: Root
let connected: boolean

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.trim() === label)
}

async function mountAndConnect(onAskAssistant?: (question: string) => void) {
  await act(async () => root.render(<McpPage onOpenUrl={() => {}} onAskAssistant={onAskAssistant}/>))
  await flush()
  const connect = button(t('连接并发现'))
  if (!connect) throw new Error('connect button missing')
  await act(async () => { connect.click() })
  await flush()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  connected = false
  bridge.invoke.mockReset()
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === 'local_list_mcp_servers') return [SERVER]
    if (command === 'mcp_discover') { connected = true; return {} }
    if (command === 'mcp_server_status') return { serverId: 'pw', connected, protocolVersion: '2025-06-18' }
    if (command === 'mcp_list_tools') return TOOLS
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

describe('MCP first-call guide', () => {
  it('points at browser_navigate after Playwright connects', async () => {
    await mountAndConnect()
    expect(container.textContent).toContain(t('先从打开一个网页开始'))
    expect(button(t('填入参数'))).toBeTruthy()
  })

  it('pre-fills the URL argument when the guide is applied', async () => {
    await mountAndConnect()
    const fill = button(t('填入参数'))
    if (!fill) throw new Error('fill button missing')

    await act(async () => { fill.click() })
    await flush()

    const url = container.querySelector<HTMLInputElement>('input[aria-label="url"]')
    expect(url?.value).toBe('https://example.com')
  })

  it('stays dismissed for that server once acknowledged', async () => {
    await mountAndConnect()
    const dismiss = button(t('知道了'))
    if (!dismiss) throw new Error('dismiss button missing')

    await act(async () => { dismiss.click() })
    await flush()

    expect(container.textContent).not.toContain(t('先从打开一个网页开始'))
  })

  it('hands a ready-made question to the assistant', async () => {
    const onAskAssistant = vi.fn()
    await mountAndConnect(onAskAssistant)
    const tryIt = button(t('去助手试试'))
    if (!tryIt) throw new Error('assistant hand-off button missing')

    await act(async () => { tryIt.click() })
    await flush()

    expect(onAskAssistant).toHaveBeenCalledWith(t('用 Playwright 打开 https://example.com，告诉我页面标题和主要内容。'))
  })
})

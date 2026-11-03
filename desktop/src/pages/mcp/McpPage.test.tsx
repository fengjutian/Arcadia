import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The "servers that need secrets" dialog used to be rendered unconditionally:
// its state started out as `undefined` while `open` was computed as
// `importResult !== null`, which is `true` for `undefined`. The MCP page stays
// mounted in the app shell, so an empty dialog covered every screen until the
// predicate was fixed. These tests pin the empty/absent behaviour.

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }))

const { McpPage } = await import('./McpPage')
const { t } = await import('@arcadia/i18n')

const SERVERS_COMMAND = 'local_list_mcp_servers'
const PREVIEW_COMMAND = 'mcp_preview_config'
const IMPORT_COMMAND = 'mcp_import_config'

type ImportSummary = {
  created: number
  updated: number
  unchanged: number
  missingSecrets: Array<{ name: string; envKeys: string[]; headerKeys: string[] }>
}

let container: HTMLDivElement
let root: Root
let summary: ImportSummary

function secretDialog(): HTMLElement | null {
  const title = t('需要补充密钥的 Server')
  return [...document.querySelectorAll<HTMLElement>('.ui-dialog')]
    .find(dialog => dialog.querySelector('.ui-dialog__title')?.textContent === title) ?? null
}

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(candidate => candidate.textContent?.trim() === label)
}

async function flush() {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

async function mount() {
  await act(async () => root.render(<McpPage onOpenUrl={() => {}}/>))
  await flush()
}

async function importConfig() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('import input missing')
  const file = new File([JSON.stringify({ version: 1, servers: [] })], 'mcp.json', { type: 'application/json' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await flush()
  const confirm = button(t('确认导入'))
  if (!confirm) throw new Error('confirm button missing')
  await act(async () => { confirm.click() })
  await flush()
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  summary = { created: 0, updated: 0, unchanged: 0, missingSecrets: [] }
  bridge.invoke.mockReset()
  bridge.invoke.mockImplementation(async (command: string) => {
    if (command === SERVERS_COMMAND) return []
    if (command === PREVIEW_COMMAND) return { created: 1, updated: 0, unchanged: 0, servers: [] }
    if (command === IMPORT_COMMAND) return summary
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

describe('MCP secret dialog', () => {
  it('stays closed on mount even though no import has happened yet', async () => {
    await mount()
    expect(secretDialog()).toBeNull()
  })

  it('does not open after an import that needs no secrets', async () => {
    await mount()
    await importConfig()

    expect(bridge.invoke).toHaveBeenCalledWith(IMPORT_COMMAND, expect.anything())
    expect(secretDialog()).toBeNull()
  })

  it('lists the servers that need secrets and closes on confirm', async () => {
    summary = { created: 1, updated: 0, unchanged: 0, missingSecrets: [{ name: 'github', envKeys: ['GITHUB_TOKEN'], headerKeys: [] }] }
    await mount()
    await importConfig()

    const dialog = secretDialog()
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('github')
    expect(dialog?.textContent).toContain('GITHUB_TOKEN')

    const close = button(t('关闭'))
    expect(close).toBeTruthy()
    await act(async () => { close!.click() })
    await flush()

    expect(secretDialog()).toBeNull()
  })
})

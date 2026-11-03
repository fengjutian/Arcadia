import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'

/**
 * The Space menu is injected into the page by Rust (`browser::space_menu_script`),
 * not rendered by React, so nothing else in the test suite exercises it. These
 * tests pull the template out of the Rust source, run it in the DOM, and check
 * the two things the host depends on: the rows appear, and a choice is emitted
 * back as a `space:<key>` action.
 */
const RUST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../desktop/src-tauri/src')

function menuScript(config: Record<string, unknown>): string {
  const source = readFileSync(path.join(RUST_ROOT, 'browser/mod.rs'), 'utf8')
  const marker = 'const SPACE_MENU_TEMPLATE: &str = r#"'
  const start = source.indexOf(marker)
  if (start < 0) throw new Error('SPACE_MENU_TEMPLATE not found')
  const begin = source.indexOf('r#"', start) + 3
  const end = source.indexOf('"#;', begin)
  const template = source.slice(begin, end)
  // Closed shadow roots are deliberate for the real menu; open it here so the
  // test can look at the rows it produced.
  return template
    .replace('mode: \'closed\'', 'mode: \'open\'')
    .replace('__ARCADIA_SPACE_MENU_CONFIG__', JSON.stringify(config))
}

function run(source: string) {
  // eslint-disable-next-line no-new-func
  new Function(source)()
}

describe('injected Space menu', () => {
  let emitted: { event: string; payload: { action: string; tabLabel: string } }[]

  beforeEach(() => {
    document.body.innerHTML = ''
    emitted = []
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: (_command: string, args: { event: string; payload: { action: string; tabLabel: string } }) => {
        emitted.push(args)
        return Promise.resolve()
      },
    }
  })

  const config = {
    items: [
      { key: 'space:a', label: '研究 · 2' },
      { type: 'divider' },
      { type: 'section', label: '知识范围' },
      { key: 'scope:all', label: '全部知识库', checked: true },
      { key: 'space-color:#3b6fd4', label: '蓝色', checked: true, swatch: '#3b6fd4' },
      { key: 'empty', label: '还没有已保存的 Space', disabled: true },
    ],
    x: 40,
    y: 70,
    theme: 'dark',
    tabLabel: 'browser-tab-1',
  }

  it('renders every row kind inside the page', () => {
    run(menuScript(config))
    const host = document.querySelector('[data-arcadia-space-menu]') as HTMLDivElement | null
    expect(host).not.toBeNull()
    expect(host!.style.left).toBe('40px')
    expect(host!.style.top).toBe('70px')

    const root = host!.shadowRoot!
    expect(root.querySelector('.menu')!.classList.contains('dark')).toBe(true)
    expect(root.querySelectorAll('.sep')).toHaveLength(1)
    expect(root.querySelector('.head')!.textContent).toBe('知识范围')

    const rows = [...root.querySelectorAll('button')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toBe('研究 · 2')
    expect(rows[0].disabled).toBe(false)
    expect(rows[3].disabled).toBe(true)
    expect(root.querySelectorAll('.check')).toHaveLength(2)
    expect((root.querySelector('.dot') as HTMLElement).style.background).toBeTruthy()
  })

  it('emits the row key and disposes itself when a row is clicked', async () => {
    run(menuScript(config))
    const root = document.querySelector('[data-arcadia-space-menu]')!.shadowRoot!
    await new Promise(resolve => setTimeout(resolve, 0))

    const row = [...root.querySelectorAll('button')].find(item => item.querySelector('.label')?.textContent === '全部知识库')!
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()

    expect(emitted).toHaveLength(1)
    expect(emitted[0].payload.action).toBe('space:scope:all')
    expect(emitted[0].payload.tabLabel).toBe('browser-tab-1')
    expect(document.querySelector('[data-arcadia-space-menu]')).toBeNull()
  })

  it('emits a dismissal when closed with Escape', async () => {
    run(menuScript(config))
    await new Promise(resolve => setTimeout(resolve, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await Promise.resolve()

    expect(emitted.at(-1)?.payload.action).toBe('__dismiss__')
    expect(document.querySelector('[data-arcadia-space-menu]')).toBeNull()
  })
})

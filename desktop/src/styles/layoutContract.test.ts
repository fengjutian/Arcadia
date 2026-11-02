import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Layout contract: the window never scrolls, the route frame never scrolls, and
 * exactly one element — the active `.route-view` — owns vertical scrolling.
 * This test reads the real stylesheet so a future rule cannot quietly
 * reintroduce nested scroll containers (the layout bug this contract fixed).
 */
const here = path.dirname(fileURLToPath(import.meta.url))
const compact = fs.readFileSync(path.join(here, 'compact.scss'), 'utf8')
const settings = fs.readFileSync(path.join(here, 'settings.scss'), 'utf8')

function rules(selectorPattern: string): string[] {
  return Array.from(compact.matchAll(new RegExp(`${selectorPattern}[^{]*\\{[^}]*\\}`, 'gm'))).map(match => match[0])
}

function rule(selectorPattern: string, required: RegExp): string {
  const matches = rules(selectorPattern).filter(candidate => required.test(candidate))
  expect(matches.length, `expected a ${selectorPattern} rule matching ${required}`).toBeGreaterThan(0)
  return matches[0]
}

describe('layout scroll ownership', () => {
  it('locks the document to the viewport', () => {
    const html = rule('html,\\s*body', /overflow:\s*hidden/)
    expect(html).toMatch(/height:\s*100%/)
    expect(html).toMatch(/overflow:\s*hidden/)
  })

  it('bounds the app shell to the window height', () => {
    const layout = rule('\\.app-layout', /height:\s*100vh/)
    expect(layout).toMatch(/height:\s*100vh/)
    expect(layout).toMatch(/overflow:\s*hidden/)
    expect(layout).toMatch(/flex-direction:\s*column/)
  })

  it('keeps the content frame from scrolling', () => {
    const content = rule('\\.app-content', /overflow:\s*hidden/)
    expect(content).toMatch(/min-height:\s*0/)
  })

  it('gives vertical scrolling to the active route only', () => {
    const route = rule('\\.route-view:not\\(\\.is-hidden\\)', /overflow-y:\s*auto/)
    expect(route).toMatch(/height:\s*100%/)
    expect(route).toMatch(/overflow-x:\s*hidden/)
    expect(route).toMatch(/min-height:\s*0/)
  })

  it('lets the browser route manage its own inner panes', () => {
    const browser = rule("\\.route-view\\[data-view='browser'\\]", /overflow:\s*hidden/)
    expect(browser).toMatch(/overflow:\s*hidden/)
  })

  // A nested, non-scrollable `overflow-y: auto` box with
  // `overscroll-behavior: contain` swallows wheel input before it can reach the
  // settings pane, which made the whole page look frozen. The theme card must
  // stay a plain block and let the pane scroll.
  it('does not nest a scroll container inside the theme settings card', () => {
    const start = settings.indexOf('.theme-settings {')
    expect(start, 'expected a .theme-settings block in settings.scss').toBeGreaterThan(-1)
    const end = settings.indexOf('\n.theme-settings__heading', start)
    const block = settings.slice(start, end === -1 ? undefined : end)
    const declarations = block.replace(/\/\/[^\n]*/g, '')
    expect(declarations).not.toMatch(/overflow-y:\s*(auto|scroll)/)
    expect(declarations).not.toMatch(/overscroll-behavior:\s*(contain|none)/)
  })
})

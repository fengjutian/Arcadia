import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Dropdown } from './Dropdown'
import { UI_MODAL_OVERLAY_EVENT } from './overlayLifecycle'

// The browser route paints its page in a native child WebView that always sits
// above this document. Every host menu that reaches over the page area has to
// announce itself through the overlay lifecycle, otherwise the native surface
// covers the menu (the Space menu in the left rail was the reported case).
describe('Dropdown overlay lifecycle', () => {
  let container: HTMLDivElement
  let root: Root
  let deltas: number[]
  let onOverlay: (event: Event) => void

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    deltas = []
    onOverlay = event => deltas.push((event as CustomEvent<number>).detail)
    window.addEventListener(UI_MODAL_OVERLAY_EVENT, onOverlay)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.removeEventListener(UI_MODAL_OVERLAY_EVENT, onOverlay)
  })

  function mount(node: ReactNode) {
    act(() => root.render(node))
  }

  function menu() {
    return <Dropdown menu={{ items: [{ key: 'save', label: 'Save' }] }}><button type="button">open</button></Dropdown>
  }

  async function openMenu() {
    const trigger = container.querySelector('button')!
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    })
  }

  it('publishes +1 while the menu is open and -1 when it closes', async () => {
    mount(menu())
    await openMenu()

    expect(deltas).toEqual([1])
    expect(document.querySelector('.ui-dropdown')).not.toBeNull()

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
    })

    expect(deltas).toEqual([1, -1])
    expect(document.querySelector('.ui-dropdown')).toBeNull()
  })

  it('keeps the lifecycle balanced when the menu unmounts while open', async () => {
    mount(menu())
    await openMenu()
    expect(deltas).toEqual([1])

    act(() => root.render(<div/>))
    expect(deltas).toEqual([1, -1])
  })
})

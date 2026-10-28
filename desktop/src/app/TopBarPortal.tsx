import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// The window draws its own title bar (decorations: false). The bar spans the
// whole window width, so the page that owns the browser chrome (the tab strip)
// cannot render it inside its own route — it would sit to the right of the
// navigation rail. Routes publish that chrome through this portal instead.
const TopBarSlotContext = createContext<HTMLElement | null>(null)

export function TopBarPortalProvider({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return <TopBarSlotContext.Provider value={target}>{children}</TopBarSlotContext.Provider>
}

/** Renders chrome into the app's top bar; renders nothing until the bar exists. */
export function TopBarPortal({ children }: { children: ReactNode }) {
  const target = useContext(TopBarSlotContext)
  return target ? createPortal(children, target) : null
}

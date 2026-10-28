import { useEffect, useLayoutEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Avatar, Badge, Layout, Space, Tooltip, Typography } from '../components/ui'
import { SafetyCertificateOutlined, ThunderboltOutlined } from '../components/ui/icons'
import { Bot, BookOpen, Globe2, Minus, Search, Settings, Square, X } from 'lucide-react'
import type { View } from '../types'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { TopBarPortalProvider } from '../app/TopBarPortal'

const items = [{ key: 'browser', icon: <Globe2/>, label: '浏览器' }, { key: 'library', icon: <BookOpen/>, label: '知识库' }, { key: 'search', icon: <Search/>, label: '搜索' }, { key: 'ai', icon: <Bot/>, label: 'AI Research' }] as const

const MIN_SIDER_WIDTH = 64
const MAX_SIDER_WIDTH = 280

export function AppLayout({ view, onViewChange, children }: { view: View; onViewChange: (view: View) => void; children: ReactNode }) {
  const [siderWidth, setSiderWidth] = useState(MIN_SIDER_WIDTH)
  // Set by the top bar's slot element; chrome owned by a route (the browser tab
  // strip) portals into it so the whole title row spans the window width.
  const [topBarSlot, setTopBarSlot] = useState<HTMLDivElement | null>(null)
  const collapsed = siderWidth === MIN_SIDER_WIDTH

  useEffect(() => {
    document.documentElement.style.setProperty('--sider-width', `${siderWidth}px`)
    return () => { document.documentElement.style.removeProperty('--sider-width') }
  }, [siderWidth])

  // Toasts are portalled to `body`, so they can no longer read the active
  // route from their DOM position: the browser route owns an extra chrome row
  // (the toolbar) that the toast stack has to clear. Publish the route on the
  // body element, in a layout effect so the first paint already has it.
  useLayoutEffect(() => {
    document.body.dataset.view = view
    return () => { delete document.body.dataset.view }
  }, [view])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = siderWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const resize = (moveEvent: PointerEvent) => {
      setSiderWidth(Math.min(MAX_SIDER_WIDTH, Math.max(MIN_SIDER_WIDTH, startWidth + moveEvent.clientX - startX)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  function navButton(item: { key: View; icon: ReactNode; label: string }) {
    const button = <button type="button" className={`rail-button${view === item.key ? ' is-active' : ''}`} aria-label={item.label} aria-current={view === item.key ? 'page' : undefined} onClick={() => onViewChange(item.key)}><span className="nav-glyph">{item.icon}</span><span className="rail-button__label">{item.label}</span></button>
    return collapsed ? <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.5}>{button}</Tooltip> : <span key={item.key}>{button}</span>
  }

  return <TopBarPortalProvider target={topBarSlot}>
    <Layout className="app-layout">
      <WindowChrome/>
      {/* `deep` makes the whole bar draggable, not just the pixels of this
          element itself: Tauri's drag script walks the composed path and, for a
          bare attribute, only accepts a click whose target is that exact
          element. The browser tab strip fills the slot with its own divs (the
          empty area right of the tabs is .ant-tabs-nav), so a bare attribute on
          the header never matched there and the window could not be moved.
          Interactive descendants stay clickable because the script stops at the
          first button/link/input. Do not put a bare attribute on descendants:
          it would end the walk with "not the target" before reaching this one.
          Double-click-to-maximize is handled by that same script, so it must not
          also be handled in React or the window would be toggled twice. */}
      <header className={`app-topbar${collapsed ? ' app-topbar--collapsed' : ''}${view === 'browser' ? ' app-topbar--browser' : ''}`} data-tauri-drag-region="deep">
        <div className="brand"><span className="brand__mark"><ThunderboltOutlined /></span><b>Arcadia</b></div>
        <div className="app-topbar__slot" ref={setTopBarSlot}/>
      </header>
      <Layout className="app-body">
        <Layout.Sider width={siderWidth} collapsedWidth={MIN_SIDER_WIDTH} collapsed={collapsed} trigger={null} className={`app-sider${collapsed ? ' app-sider--collapsed' : ''}`}><nav className="rail-nav rail-nav--primary" aria-label="主导航">{items.map(navButton)}</nav><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>保护已开启</b></Space><Typography.Text>已拦截 43 个请求</Typography.Text></div><nav className="rail-nav rail-nav--utility" aria-label="辅助导航">{navButton({ key: 'settings', icon: <Settings/>, label: '设置' })}</nav><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>本地工作区</small></span></div><div className="sider-resizer" role="separator" aria-label="调整左侧栏宽度" aria-orientation="vertical" aria-valuemin={MIN_SIDER_WIDTH} aria-valuemax={MAX_SIDER_WIDTH} aria-valuenow={siderWidth} onPointerDown={startResize}/></Layout.Sider>
        <Layout.Content className="app-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  </TopBarPortalProvider>
}

function WindowChrome() {
  const window = getCurrentWindow()
  return <>
    <div className="window-drag-strip" data-tauri-drag-region/>
    <div className="window-controls" aria-label="窗口控制">
      <button type="button" aria-label="最小化" title="最小化" onClick={() => void window.minimize().catch(() => undefined)}><Minus size={16} strokeWidth={1.5}/></button>
      <button type="button" aria-label="最大化或还原" title="最大化或还原" onClick={() => void window.toggleMaximize().catch(() => undefined)}><Square size={12} strokeWidth={1.5}/></button>
      <button type="button" className="window-controls__close" aria-label="关闭" title="关闭" onClick={() => void window.close().catch(() => undefined)}><X size={16} strokeWidth={1.5}/></button>
    </div>
  </>
}

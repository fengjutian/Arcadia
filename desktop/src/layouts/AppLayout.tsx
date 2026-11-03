import { t } from '@arcadia/i18n'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Avatar, Badge, Dropdown, Layout, Space, Tooltip, Typography, type MenuProps } from '@arcadia/ui'
import { SafetyCertificateOutlined, ThunderboltOutlined } from '@arcadia/ui/icons'
import { BookOpen, Boxes, Globe2, Layers, Minus, PanelLeft, Search, Settings, Sparkles, Square, X } from 'lucide-react'
import type { View } from '../types'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { TopBarPortalProvider } from '../app/TopBarPortal'
import { diagnosticLog } from '../shared/diagnostics'
import { listWorkspaces, type WorkspaceSummary } from '../services/workspaces'
import { listCollections, type Collection } from '../api'
import { SPACE_CHANGED_EVENT, SPACE_MENU_ACTION_EVENT, SPACE_MENU_FALLBACK_EVENT, SPACE_MENU_OPEN_EVENT, SPACE_SCOPE_EVENT, SPACE_SURFACE_EVENT, clearCurrentSpace, dispatchSpaceRestore, dispatchSpaceSave, readCurrentSpace, readSpaceScopes, spaceColorFor, spaceIconFor, writeSpaceIdentity, writeSpaceScope, type CurrentSpace } from '../features/browser/spaces'
import { spaceMenuRows } from '../features/browser/spaceMenu'
import { readShellSettings, SHELL_SETTINGS_EVENT, writeShellSettings, type ShellSettings } from '../features/settings/shell'

const items = [{ key: 'browser', icon: <Globe2/>, label:t("浏览器")},{key:'library',icon:<BookOpen/>,label:t("知识库")},{key:'search',icon:<Search/>,label:t("搜索")},{key:'ai',icon:<Sparkles/>,label:'AI Research'},{key:'mcp',icon:<Boxes/>,label:'MCP'}]as const

const SIDER_WIDTH = 64

export function AppLayout({ view, onViewChange, children }: { view: View; onViewChange: (view: View) => void; children: ReactNode }) {
  // Set by the top bar's slot element; chrome owned by a route (the browser tab
  // strip) portals into it so the whole title row spans the window width.
  const [topBarSlot, setTopBarSlot] = useState<HTMLDivElement | null>(null)
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [currentSpace, setCurrentSpace] = useState<CurrentSpace | null>(() => readCurrentSpace())
  const [identityVersion, setIdentityVersion] = useState(0)
  // True while the browser route has a native page on screen: the page WebView
  // paints above this document, so the Space menu has to be drawn inside the
  // page instead of as a host dropdown.
  const [nativeSurface, setNativeSurface] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const spaceButtonRef = useRef<HTMLButtonElement>(null)
  const collapsed = true
  // The rail can be hidden from Settings → 通用. Kept in state so the title bar
  // and the rail react together, wherever the change comes from.
  const [sidebarVisible, setSidebarVisible] = useState(() => readShellSettings().sidebarVisible)

  async function refreshSpaces() {
    try {
      setSpaces(await listWorkspaces())
    } catch {
      setSpaces([])
    }
  }

  useEffect(() => {
    void refreshSpaces()
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; name?: string } | null>).detail
      if (detail?.id && detail?.name) setCurrentSpace({ id: detail.id, name: detail.name })
      else if (detail === null) setCurrentSpace(null)
      void refreshSpaces()
    }
    window.addEventListener(SPACE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SPACE_CHANGED_EVENT, onChanged)
  }, [])

  useEffect(() => {
    const onShellChange = (event: Event) => {
      const next = (event as CustomEvent<ShellSettings>).detail
      setSidebarVisible(next ? next.sidebarVisible : readShellSettings().sidebarVisible)
    }
    window.addEventListener(SHELL_SETTINGS_EVENT, onShellChange)
    return () => window.removeEventListener(SHELL_SETTINGS_EVENT, onShellChange)
  }, [])

  function showSidebar() {
    setSidebarVisible(writeShellSettings({ ...readShellSettings(), sidebarVisible: true }).sidebarVisible)
  }

  // Toasts are portalled to `body`, so they can no longer read the active
  // route from their DOM position: the browser route owns an extra chrome row
  // (the toolbar) that the toast stack has to clear. Publish the route on the
  // body element, in a layout effect so the first paint already has it.
  useLayoutEffect(() => {
    document.body.dataset.view = view
    return () => { delete document.body.dataset.view }
  }, [view])

  function navButton(item: { key: View; icon: ReactNode; label: string }) {    const button = <button type="button" title={collapsed ? item.label : undefined} className={`rail-button${view === item.key ? ' is-active' : ''}`} aria-label={item.label} aria-current={view === item.key ? 'page' : undefined} onClick={() => onViewChange(item.key)}><span className="nav-glyph">{item.icon}</span><span className="rail-button__label">{item.label}</span></button>
    return collapsed ? <Tooltip key={item.key} title={item.label} placement="right" mouseEnterDelay={0.15}>{button}</Tooltip> : <span key={item.key}>{button}</span>
  }

  const activeScope = currentSpace ? readSpaceScopes()[currentSpace.id] ?? null : null
  const spaceColor = useMemo(
    () => (currentSpace ? spaceColorFor(currentSpace.id) : null),
    // `identityVersion` re-reads storage after a color change.
    [currentSpace, identityVersion],
  )
  const spaceIcon = useMemo(
    () => (currentSpace ? spaceIconFor(currentSpace.id) : null),
    [currentSpace, identityVersion],
  )
  function applyScope(collectionId: string | null) {
    if (!currentSpace) return
    writeSpaceScope(currentSpace.id, collectionId)
    window.dispatchEvent(new CustomEvent(SPACE_SCOPE_EVENT, { detail: { collectionId } }))
    setCollections(current => [...current])
  }
  function runSpaceMenuKey(key: string) {
    if (key.startsWith('space:')) { dispatchSpaceRestore(key.slice('space:'.length)); return }
    if (key.startsWith('scope:')) { applyScope(key === 'scope:all' ? null : key.slice('scope:'.length)); return }
    if (key.startsWith('space-color:')) {
      if (!currentSpace) return
      const value = key.slice('space-color:'.length)
      writeSpaceIdentity(currentSpace.id, { color: value === 'default' ? undefined : value, icon: spaceIcon ?? undefined })
      setIdentityVersion(version => version + 1)
      return
    }
    if (key.startsWith('space-icon:')) {
      if (!currentSpace) return
      const value = key.slice('space-icon:'.length)
      writeSpaceIdentity(currentSpace.id, { color: spaceColor ?? undefined, icon: value === 'default' ? undefined : value })
      setIdentityVersion(version => version + 1)
      return
    }
    if (key === 'save') { dispatchSpaceSave(); return }
    if (key === 'manage') { onViewChange('settings'); return }
    if (key === 'leave') clearCurrentSpace()
  }
  const runSpaceMenuKeyRef = useRef(runSpaceMenuKey)
  runSpaceMenuKeyRef.current = runSpaceMenuKey

  const menuRows = spaceMenuRows({ spaces, collections, currentSpace, scope: activeScope, color: spaceColor, icon: spaceIcon })
  const dropdownItems: MenuProps['items'] = menuRows.map((row, index) => {
    if (row.type === 'divider') return { type: 'divider' as const, key: `divider-${index}` }
    if (row.type === 'section') return { key: `section-${index}`, label: row.label, disabled: true }
    return {
      key: row.key,
      label: `${row.checked ? '✓ ' : ''}${row.label}`,
      disabled: row.disabled,
      icon: row.swatch ? <span className="space-color-swatch" style={{ background: row.swatch }}/> : undefined,
      onClick: () => runSpaceMenuKey(row.key),
    }
  })

  /**
   * Refresh the Space/collection lists, then open the menu. With a native page
   * on screen the rows are handed to the browser route, which asks Rust to draw
   * them inside the page: the page keeps running underneath, nothing is hidden
   * or moved. Everywhere else the ordinary dropdown is used.
   */
  async function openSpaceMenu() {
    let nextSpaces = spaces
    let nextCollections = collections
    try { nextSpaces = await listWorkspaces() } catch { /* keep the cached list */ }
    try { nextCollections = await listCollections() } catch { /* keep the cached list */ }
    setSpaces(nextSpaces)
    setCollections(nextCollections)
    if (!nativeSurface) { setMenuOpen(true); return }
    const scope = currentSpace ? readSpaceScopes()[currentSpace.id] ?? null : null
    const rect = spaceButtonRef.current?.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent(SPACE_MENU_OPEN_EVENT, {
      detail: {
        rows: spaceMenuRows({ spaces: nextSpaces, collections: nextCollections, currentSpace, scope, color: spaceColor, icon: spaceIcon }),
        x: rect ? rect.right + 4 : 24,
        y: rect ? rect.bottom + 6 : 96,
        theme: document.body.dataset.theme === 'dark' ? 'dark' : 'light',
      },
    }))
  }

  useEffect(() => {
    // The browser route may have published its state before this effect ran
    // (child effects run first), so adopt the current value before listening.
    setNativeSurface(document.body.dataset.nativeSurface === '1')
    const onSurface = (event: Event) => setNativeSurface(Boolean((event as CustomEvent<boolean>).detail))
    const onAction = (event: Event) => {
      const key = (event as CustomEvent<{ key?: string }>).detail?.key
      if (key) runSpaceMenuKeyRef.current(key)
    }
    // The in-page menu can fail to attach (a page that cannot be scripted, a
    // torn-down tab); fall back to the host dropdown rather than losing it.
    const onFallback = () => { setNativeSurface(false); setMenuOpen(true) }
    window.addEventListener(SPACE_SURFACE_EVENT, onSurface)
    window.addEventListener(SPACE_MENU_ACTION_EVENT, onAction)
    window.addEventListener(SPACE_MENU_FALLBACK_EVENT, onFallback)
    return () => {
      window.removeEventListener(SPACE_SURFACE_EVENT, onSurface)
      window.removeEventListener(SPACE_MENU_ACTION_EVENT, onAction)
      window.removeEventListener(SPACE_MENU_FALLBACK_EVENT, onFallback)
    }
  }, [])

  const spaceLabel = currentSpace ? t("Space：{value0}", { value0: currentSpace.name }) : t("切换 Space")

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
        {!sidebarVisible && <button type="button" className="app-topbar__reveal" title={t("显示侧边栏")} aria-label={t("显示侧边栏")} onClick={showSidebar}><PanelLeft size={17} strokeWidth={1.6}/></button>}
        <div className="app-topbar__slot" ref={setTopBarSlot}/>
      </header>
      <Layout className="app-body">
        {sidebarVisible && <Layout.Sider width={SIDER_WIDTH} collapsedWidth={SIDER_WIDTH} collapsed={collapsed} trigger={null} className={`app-sider${collapsed ? ' app-sider--collapsed' : ''}`}><div className="space-switch"><Tooltip title={spaceLabel} placement="right" mouseEnterDelay={0.15}>{nativeSurface
          ? <button ref={spaceButtonRef} type="button" className={`space-switch__button${currentSpace ? ' is-active' : ''}`} aria-label={spaceLabel} style={spaceColor ? { borderColor: spaceColor, color: spaceColor } : undefined} onClick={() => void openSpaceMenu()}>{spaceIcon ?? <Layers size={18} strokeWidth={1.6}/>}</button>
          : <Dropdown menu={{ items: dropdownItems }} open={menuOpen} onOpenChange={open => { setMenuOpen(open); if (!open) setNativeSurface(document.body.dataset.nativeSurface === '1') }} placement="bottomLeft"><button ref={spaceButtonRef} type="button" className={`space-switch__button${currentSpace ? ' is-active' : ''}`} aria-label={spaceLabel} style={spaceColor ? { borderColor: spaceColor, color: spaceColor } : undefined}>{spaceIcon ?? <Layers size={18} strokeWidth={1.6}/>}</button></Dropdown>}</Tooltip></div><nav className="rail-nav rail-nav--primary" aria-label={t("主导航")}>{items.map(navButton)}</nav><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>{t("保护已开启")}</b></Space><Typography.Text>{t("已拦截 43 个请求")}</Typography.Text></div><nav className="rail-nav rail-nav--utility" aria-label={t("辅助导航")}>{navButton({key:'settings',icon:<Settings/>,label:t("设置")})}</nav><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>{t("本地工作区")}</small></span></div></Layout.Sider>}
        <Layout.Content className="app-content">{children}</Layout.Content>
      </Layout>
    </Layout>
  </TopBarPortalProvider>
}

function WindowChrome() {
  const stopWindowDrag = (event: PointerEvent<HTMLButtonElement>) => event.stopPropagation()
  const runWindowAction = (action: 'minimize' | 'maximize' | 'close') => {
    diagnosticLog('window.action.requested', 'info', { action })
    const window = getCurrentWindow()
    const request = action === 'minimize'
      ? window.minimize()
      : action === 'maximize'
        ? window.toggleMaximize()
        : window.close()
    void request
      .then(() => diagnosticLog('window.action.completed', 'info', { action }))
      .catch(error => diagnosticLog('window.action.failed', 'error', { action, error }))
  }
  return <>
    <div className="window-drag-strip" data-tauri-drag-region/>
    <div className="window-controls" aria-label={t("窗口控制")}>
      <button type="button" aria-label={t("最小化")} title={t("最小化")} onPointerDown={stopWindowDrag} onClick={()=>runWindowAction('minimize')}><Minus size={16} strokeWidth={1.5}/></button>
      <button type="button" aria-label={t("最大化或还原")} title={t("最大化或还原")} onPointerDown={stopWindowDrag} onClick={()=>runWindowAction('maximize')}><Square size={12} strokeWidth={1.5}/></button>
      <button type="button" className="window-controls__close" aria-label={t("关闭")} title={t("关闭")} onPointerDown={stopWindowDrag} onClick={()=>runWindowAction('close')}><X size={16} strokeWidth={1.5}/></button>
    </div>
  </>
}
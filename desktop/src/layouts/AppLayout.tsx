import { t } from '../i18n'
import { useEffect, useLayoutEffect, useState, type PointerEvent, type ReactNode } from 'react'
import { Avatar, Badge, Dropdown, Layout, Space, Tooltip, Typography } from '../components/ui'
import { SafetyCertificateOutlined, ThunderboltOutlined } from '../components/ui/icons'
import { BookOpen, Boxes, Globe2, Layers, Minus, Search, Settings, Sparkles, Square, X } from 'lucide-react'
import type { View } from '../types'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { TopBarPortalProvider } from '../app/TopBarPortal'
import { diagnosticLog } from '../shared/diagnostics'
import { listWorkspaces, type WorkspaceSummary } from '../services/workspaces'
import { listCollections, type Collection } from '../api'
import { SPACE_CHANGED_EVENT, SPACE_SCOPE_EVENT, dispatchSpaceRestore, dispatchSpaceSave, readCurrentSpace, readSpaceScopes, writeSpaceScope, type CurrentSpace } from '../features/browser/spaces'

const items = [{ key: 'browser', icon: <Globe2/>, label:t("浏览器")},{key:'library',icon:<BookOpen/>,label:t("知识库")},{key:'search',icon:<Search/>,label:t("搜索")},{key:'ai',icon:<Sparkles/>,label:'AI Research'},{key:'mcp',icon:<Boxes/>,label:'MCP'}]as const

const SIDER_WIDTH = 64

export function AppLayout({ view, onViewChange, children }: { view: View; onViewChange: (view: View) => void; children: ReactNode }) {
  // Set by the top bar's slot element; chrome owned by a route (the browser tab
  // strip) portals into it so the whole title row spans the window width.
  const [topBarSlot, setTopBarSlot] = useState<HTMLDivElement | null>(null)
  const [spaces, setSpaces] = useState<WorkspaceSummary[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [currentSpace, setCurrentSpace] = useState<CurrentSpace | null>(() => readCurrentSpace())
  const collapsed = true

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
      const detail = (event as CustomEvent<{ id?: string; name?: string }>).detail
      if (detail?.id && detail?.name) setCurrentSpace({ id: detail.id, name: detail.name })
      void refreshSpaces()
    }
    window.addEventListener(SPACE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(SPACE_CHANGED_EVENT, onChanged)
  }, [])

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

  const spaceItems = spaces.length
    ? spaces.map(space => ({ key: space.id, label: `${space.name} · ${space.tabCount}`, onClick: () => dispatchSpaceRestore(space.id) }))
    : [{ key: 'empty', label: t("还没有已保存的 Space"), disabled: true }]
  const activeScope = currentSpace ? readSpaceScopes()[currentSpace.id] ?? null : null
  function applyScope(collectionId: string | null) {
    if (!currentSpace) return
    writeSpaceScope(currentSpace.id, collectionId)
    window.dispatchEvent(new CustomEvent(SPACE_SCOPE_EVENT, { detail: { collectionId } }))
    setCollections(current => [...current])
  }
  const scopeItems = currentSpace
    ? [
        { key: 'scope:all', label: `${activeScope ? '' : '✓ '}${t("全部知识库")}`, onClick: () => applyScope(null) },
        ...collections.map(collection => ({
          key: `scope:${collection.id}`,
          label: `${activeScope === collection.id ? '✓ ' : ''}${collection.name}`,
          onClick: () => applyScope(collection.id),
        })),
      ]
    : []
  const spaceMenu = {
    items: [
      ...spaceItems,
      { type: 'divider' as const },
      { key: 'save', label: t("保存当前为 Space"), onClick: () => dispatchSpaceSave() },
      { key: 'manage', label: t("管理 Space"), onClick: () => onViewChange('settings') },
      ...(currentSpace ? [{ type: 'divider' as const }, { key: 'scope', label: t("知识范围"), children: scopeItems }] : []),
    ],
  }
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
        <div className="app-topbar__slot" ref={setTopBarSlot}/>
      </header>
      <Layout className="app-body">
        <Layout.Sider width={SIDER_WIDTH} collapsedWidth={SIDER_WIDTH} collapsed={collapsed} trigger={null} className={`app-sider${collapsed ? ' app-sider--collapsed' : ''}`}><div className="space-switch"><Tooltip title={spaceLabel} placement="right" mouseEnterDelay={0.15}><Dropdown menu={spaceMenu} trigger={['click']} placement="bottomLeft" onOpenChange={open => { if (open) { void refreshSpaces(); try { void listCollections().then(setCollections).catch(() => setCollections([])) } catch { setCollections([]) } } }}><button type="button" className={`space-switch__button${currentSpace ? ' is-active' : ''}`} aria-label={spaceLabel}><Layers size={18} strokeWidth={1.6}/></button></Dropdown></Tooltip></div><nav className="rail-nav rail-nav--primary" aria-label={t("主导航")}>{items.map(navButton)}</nav><div className="sider-spacer"/><div className="privacy-status"><Space><SafetyCertificateOutlined/><b>{t("保护已开启")}</b></Space><Typography.Text>{t("已拦截 43 个请求")}</Typography.Text></div><nav className="rail-nav rail-nav--utility" aria-label={t("辅助导航")}>{navButton({key:'settings',icon:<Settings/>,label:t("设置")})}</nav><div className="user-card"><Badge dot color="#65c98b"><Avatar>CF</Avatar></Badge><span><b>Charles</b><small>{t("本地工作区")}</small></span></div></Layout.Sider>
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
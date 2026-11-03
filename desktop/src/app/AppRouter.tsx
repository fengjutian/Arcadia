import { lazy, Suspense, useEffect, useState } from 'react'
import { Spin } from '@arcadia/ui'
import { AppLayout } from '../layouts/AppLayout'
import { takeViewAfterReload } from './returnView'
import { scheduleExtrasSync } from '../features/search/extrasSync'
import { SPACE_CHANGED_EVENT, currentSpaceNamespace } from '@arcadia/browser-core/spaces'
import { listenLittleArcHotkey, openLittleArc } from '../features/littlearc/littleArc'
import type { View } from '../types'

const BrowserPage=lazy(()=>import('../pages/browser/BrowserPage').then(module=>({default:module.BrowserPage})))
const LibraryPage=lazy(()=>import('../pages/library/LibraryPage').then(module=>({default:module.LibraryPage})))
const SearchPage=lazy(()=>import('../pages/search/SearchPage').then(module=>({default:module.SearchPage})))
const AssistantPage=lazy(()=>import('../pages/assistant/AssistantPage').then(module=>({default:module.AssistantPage})))
const McpPage=lazy(()=>import('../pages/mcp/McpPage').then(module=>({default:module.McpPage})))
const SettingsPage=lazy(()=>import('../pages/settings/SettingsPage').then(module=>({default:module.SettingsPage})))

export function AppRouter() {
  const [view, setView] = useState<View>(() => takeViewAfterReload() ?? 'browser')
  const [mountedViews, setMountedViews] = useState<Set<View>>(() => new Set([view]))
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [assistantDraft, setAssistantDraft] = useState('')
  const [assistantDraftNonce, setAssistantDraftNonce] = useState(0)
  const [spaceNamespace, setSpaceNamespace] = useState(() => currentSpaceNamespace())
  // Bring the extra-source vector index up to date once the app has settled.
  useEffect(() => { scheduleExtrasSync(2_000) }, [])
  // AI conversations and their history are scoped to the active Space.
  useEffect(() => {
    const sync = () => setSpaceNamespace(currentSpaceNamespace())
    window.addEventListener(SPACE_CHANGED_EVENT, sync)
    return () => window.removeEventListener(SPACE_CHANGED_EVENT, sync)
  }, [])
  const changeView = (next: View) => {
    setMountedViews(current => {
      if (current.has(next)) return current
      const updated = new Set(current)
      updated.add(next)
      return updated
    })
    setView(next)
  }
  // Cross-view navigation requested by feature panels (e.g. the site panel).
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (next === 'browser' || next === 'library' || next === 'search' || next === 'ai' || next === 'mcp' || next === 'settings') changeView(next)
    }
    window.addEventListener('arcadia-navigate-view', onNavigate)
    return () => window.removeEventListener('arcadia-navigate-view', onNavigate)
  }, [])
  // Global quick-capture hotkey from the Rust side.
  useEffect(() => {
    let dispose: (() => void) | undefined
    void listenLittleArcHotkey(() => { void openLittleArc() }).then(stop => { dispose = stop })
    return () => dispose?.()
  }, [])
  const pages = {
    library: <LibraryPage onOpenBrowser={() => changeView('browser')} />,
    search: <SearchPage initialQuery={knowledgeQuery} onOpenUrl={url => {
      window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url } }))
      changeView('browser')
    }} />,
    ai: <AssistantPage onNavigate={changeView} sessionNamespace={spaceNamespace} initialQuestion={assistantDraft} draftNonce={assistantDraftNonce} />,
    mcp: <McpPage onOpenUrl={url => {
      window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url } }))
      changeView('browser')
    }} onAskAssistant={question => {
      // Bump the nonce so an already mounted assistant re-applies the draft.
      setAssistantDraft(question)
      setAssistantDraftNonce(current => current + 1)
      changeView('ai')
    }} />,
    settings: <SettingsPage onOpenUrl={url => {
      window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url } }))
      changeView('browser')
    }} />,
  }
  const secondaryViews: Exclude<View, 'browser'>[] = ['library', 'search', 'ai', 'mcp', 'settings']
  return <AppLayout view={view} onViewChange={changeView}><Suspense fallback={<div className="route-loading"><Spin size="large"/></div>}>
    <div className={`route-view${view === 'browser' ? '' : ' is-hidden'}`} data-view="browser"><BrowserPage visible={view === 'browser'} onOpenLibrary={() => changeView('library')} onSearchKnowledge={query => { setKnowledgeQuery(query); changeView('search') }}/></div>
    {secondaryViews.map(pageView => mountedViews.has(pageView) && (
      <div key={pageView} className={`route-view${view === pageView ? '' : ' is-hidden'}`} data-view={pageView}>{pages[pageView]}</div>
    ))}
  </Suspense></AppLayout>
}

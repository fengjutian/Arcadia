import { translate } from '../../i18n'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AutoComplete, Badge, Button, Dropdown, Input, message, Modal, Popover, Space, Tabs, Tag, Tooltip, Typography, UI_MODAL_OVERLAY_EVENT, type InputRef, type MenuProps } from '../../components/ui'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, AudioMutedOutlined, BookOutlined, CheckCircleOutlined, CloseCircleOutlined, CloseOutlined, CopyOutlined, DownloadOutlined, FullscreenOutlined, LoadingOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, SoundOutlined, StarFilled, StarOutlined, StopOutlined, ThunderboltOutlined, TranslationOutlined, WarningOutlined } from '../../components/ui/icons'
import { registerToastSink } from '../../components/ui/toastSink'
import { Sparkles as RobotOutlined } from 'lucide-react'
import type { BrowserTab } from '../../types'
import { addBrowserHistory, deleteClosedTab, findDocumentByUrl, getBrowserShortcutsEnabled, getBrowserWorkspace, getDocument, listBrowserHistory, listClosedTabs, listSitePermissions, privacyCapabilityReport, privacyGetSiteSetting, privacyGetStats, privacyListBlockEvents, privacyListBlocklists, privacySetBlocklistEnabled, privacySetSiteSetting, purgeReadingSnapshots, recordReadingActivity, saveBrowserWorkspace, saveClosedTab, saveDocument, saveReadingSnapshot, setSession, toggleStarred, archiveTab } from '../../api'
import { captureNativePage, captureNativeScreenshot, clearNativePageData, closeNativePageToast, closeNativeTab, editNativePage, ensureNativeTab, fillBrowserPassword, findInNativeTab, generateBrowserPassword, hasNativeTab, hideNativeTab, isNativeBrowserAvailable, isNativeTabSuspended, listBrowserPasswords, navigateHistory, onNativeAdBlockUpdate, onNativeAudioState, onNativeNewTab, onNativeProcessFailed, onNativeSiteBlocked, onNativeToolbarMenuAction, onPasswordCandidate, onPasswordFillRequest, openNativeDevtools, openNativeTab, printNativeTab, readNativeState, reloadNativeTab, resizeNativeTab, resumeNativeTab, saveBrowserPassword, scanNativeResources, setNativeMuted, setNativeToolbarMenu, setNativeToolbarPanel, showNativePageToast, showNativeTab, stopNativeTab, suspendNativeTab, zoomNativeTab, type PasswordCandidate, type SavedCredential } from '../../services/nativeBrowser'
import { extractArticle } from '../../features/reader/extractArticle'
import type { ReaderArticle } from '../../features/reader/types'
import { classifySaveError } from '../../features/documents/saveClassifier'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { dedupeHistory, HISTORY_CHANGE_EVENT, parseHistory, removeHistoryEntry, type HistoryEntry } from '../../features/history/dedupeHistory'
import { reorderTabs } from '../../features/browser/reorderTabs'
import { groupTabsByOrigin, idsToCloseForSameDomain } from '../../features/browser/tabGrouping'
import { planLruSweep, type DownloadActivity } from '../../features/browser/lruPolicy'
import { computeResourceStats } from '../../features/browser/resourceStats'
import { mediaKindLabel, normalizeMediaResources, type MediaResourceCandidate } from '../../features/browser/mediaResources'
import { useProcessMemory } from '../../features/browser/useProcessMemory'
import { formatBytes as formatProcessBytes } from '../../services/processMemory'
import { interpretShortcut, readShortcutOverrides } from '../../features/browser/shortcuts'
import { popClosedTab, recordClosedTab, type ClosedTab } from '../../features/browser/closedTabs'
import { archivedTabFromBrowserTab } from '../../features/archive/archive'
import { AssistantPanel } from '../../features/ai/AssistantPanel'
import { closeFloatingAssistant, FLOATING_ASSISTANT_CLOSED_EVENT, FLOATING_ASSISTANT_SAVE_EVENT, openFloatingAssistant } from '../../features/ai/floatingAssistant'
import { listen } from '@tauri-apps/api/event'
import { renderSearchTemplate, resolveNavigationInput } from '../../features/browser/navigation'
import { useDownloads } from '../../features/downloads/useDownloads'
import { useDownloadQueue } from '../../features/downloads/useDownloadQueue'
import { saveWorkspace, snapshotTabsToPayload, getWorkspace, type WorkspaceRecord } from '../../services/workspaces'
import { restoreTabsFromWorkspace } from '../../features/browser/restoreWorkspace'
import { WORKSPACE_RESTORE_EVENT } from '../../features/browser/workspaces'
import { useTabRuntime } from '../../features/browser/useTabRuntime'
import { buildAddressSuggestions } from '../../features/browser/addressSuggestions'
import { DownloadSummary } from '../../features/downloads/DownloadCenter'
import { ContextMenu } from '../../features/browser/ContextMenuView'
import type { ContextMenuAction } from '../../features/browser/contextMenu'
import { startDownload } from '../../services/downloads'
import { classifyDownload } from '../../features/downloads/dangerClassifier'
import { shellOpen } from '../../services/webviewCompat'
import { extractLocalPdf } from '../../services/webviewCompat'
import { classifyShellOpenUrl, describeScheme } from '../../features/browser/externalSchemes'
import { redactUrl } from '../../features/browser/logRedaction'
import { diagnosticLog } from '../../shared/diagnostics'
import { domainFromUrl, recordAdBlock } from '../../features/privacy/adBlockStats'
import { usePermissionPrompt } from '../../features/browser/usePermissionPrompt'
import { PermissionPromptBar } from '../../features/browser/PermissionPromptBar'
import { CertificateErrorBar } from '../../features/browser/CertificateErrorBar'
import { useCertificatePrompt } from '../../features/browser/useCertificatePrompt'
import { TabSearchPalette } from '../../features/browser/TabSearchPalette'
import { CommandPalette } from '../../features/command/CommandPalette'
import { HistorySearchPalette } from '../../features/history/HistorySearchPalette'
import { BookmarkSearchPalette } from '../../features/bookmarks/BookmarkSearchPalette'
import { useBookmarks } from '../../features/bookmarks/useBookmarks'
import { BulkSummaryPalette } from '../../features/ai/BulkSummaryPalette'
import type { BulkProgressEntry } from '../../features/ai/bulkSummary'
import { NotesPanel } from '../../features/notes/NotesPanel'
import { addNote as appendNoteEntry, readNotes as loadStoredNotes, removeNote as dropNoteEntry, updateNote as patchNoteEntry, writeNotes as persistNotes, type NoteEntry } from '../../features/notes/notes'
import { isPrivateTab, makePrivateTab, stripPrivateTabs } from '../../features/browser/privateTabs'
import { readSitePermissions, writeSitePermissions } from '../../features/browser/sitePermissions'
import { shouldRecordHistory } from '../../features/history/historyRecording'
import { LockOutlined } from '../../components/ui/icons'
import { readRecoverySnapshot, restoreFromSnapshot, stripTransientTabStates, writeSnapshot, type SessionSnapshot } from '../../features/browser/sessionStore'
import { TopBarPortal } from '../../app/TopBarPortal'
import { dropSessionLock, getSessionLockState } from '../../services/session'
import { toggleFullscreen as toggleWindowFullscreen } from '../../services/webviewCompat'
import { buildSuggestions, trimSuggestions } from '../../features/browser/suggestionProvider'
import { readSearchEngineConfig, resolveActiveSearchTemplate, SEARCH_ENGINE_PRESETS } from '../../features/browser/searchEngine'
import { evaluateUrlSafety, highestLevel, type SafetyIssue, type SafetyLevel } from '../../features/browser/urlSafety'
import { ADVANCED_SETTINGS_EVENT, readAdvancedSettings, type AdvancedSettings } from '../../features/settings/advanced'
import { cleanTrackingParameters, isTrackingCleanerEnabled, TRACKING_CLEANER_EVENT } from '../../features/plugins/trackingCleaner'
import { AD_BLOCKER_EVENT, isAdBlockerEnabled } from '../../features/plugins/adBlocker'
import { newTab, tabGroupColor } from '../../features/browser/browserUtils'
import { classifyNavigationError, diagnoseNavigationError, safeFileName } from '../../features/browser/navigationErrors'
import { addBlockedSite, findBlockingEntry, hostFromUrl, loadSiteBlacklist, removeBlockedSite, subscribeSiteBlacklist } from '../../features/privacy/siteBlacklist'
import { renderSuggestion } from '../../features/browser/suggestionRenderer'
import { BrowserErrorView } from '../../features/browser/BrowserErrorView'
import { NewTab } from '../../features/browser/NewTabPage'
import { ReaderArticleView } from '../../features/reader/ReaderArticleView'
import { TabFavicon } from '../../features/browser/TabFavicon'
import { SearchComparisonWorkspace, type ComparisonSource } from '../../features/browser/SearchComparisonWorkspace'
import { BROWSER_APPEARANCE_EVENT, readBrowserAppearance, type BrowserAppearanceSettings } from '../../features/settings/browserAppearance'
import { readDownloadSettings } from '../../features/settings/downloadSettings'

const SESSION_KEY = 'browser.tabs'
const SESSION_DEBOUNCE_MS = 500
type ToolbarOverlay = 'downloads' | 'bookmarks' | 'resources' | 'menu' | 'tab-menu'

// Native child WebViews are always composited above the React window on
// Windows. Keep enough room for toolbar popovers instead of hiding the whole
// page (which made opening the browser menu look like a blank-page failure).
const TOOLBAR_OVERLAY_INSET: Partial<Record<ToolbarOverlay, number>> = {}

interface PersistedSession {
  tabs: BrowserTab[]
  activeTabId: string
}

interface ComparisonSession {
  hostTabId: string
  query: string
  sources: ComparisonSource[]
  visibleIds: string[]
}

function parsePersistedSession(raw: string | null): PersistedSession | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<PersistedSession>
    if (!value || !Array.isArray(value.tabs) || value.tabs.length === 0) return null
    if (typeof value.activeTabId !== 'string') return null
    if (!value.tabs.some(tab => tab.id === value.activeTabId)) return null
    return { tabs: value.tabs as BrowserTab[], activeTabId: value.activeTabId }
  } catch { return null }
}

function getSessionLegacy(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function BrowserPage({ visible = true, onSearchKnowledge }: { visible?: boolean; onSearchKnowledge?: (query: string) => void }) {
  const [tabs, setTabs] = useState<BrowserTab[]>([newTab('new')])
  const [activeTabId, setActiveTabId] = useState('new')
  const [address, setAddress] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInitialQuestion, setAiInitialQuestion] = useState('')
  const [aiInitialMode, setAiInitialMode] = useState<'summarize'|'ask'|'translate'|undefined>()
  const [aiTranslationSource, setAiTranslationSource] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [pendingShellOpen, setPendingShellOpen] = useState<string | null>(null)
  const [tabSearchOpen, setTabSearchOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [historySearchOpen, setHistorySearchOpen] = useState(false)
  const [bookmarkPaletteOpen, setBookmarkPaletteOpen] = useState(false)
  const [privacyCap, setPrivacyCap] = useState<Awaited<ReturnType<typeof privacyCapabilityReport>> | null>(null)
  const [privacyStats, setPrivacyStats] = useState<Awaited<ReturnType<typeof privacyGetStats>>>({ blocked: 0, allowed: 0, dropped: 0 })
  const [blockEvents, setBlockEvents] = useState<Awaited<ReturnType<typeof privacyListBlockEvents>>>([])
  const [mediaResources, setMediaResources] = useState<MediaResourceCandidate[]>([])
  const [resourceScanBusy, setResourceScanBusy] = useState(false)
  const [bulkSummaryOpen, setBulkSummaryOpen] = useState(false)
  const [bulkSummaryBusy, setBulkSummaryBusy] = useState(false)
  const [bulkSummaryProgress, setBulkSummaryProgress] = useState<BulkProgressEntry[]>([])
  const [notes, setNotes] = useState<NoteEntry[]>(() => loadStoredNotes())
  const [notesOpen, setNotesOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findStatus, setFindStatus] = useState<'idle' | 'found' | 'missing'>('idle')
  const [zoomLevels, setZoomLevels] = useState<Record<string, number>>({})
  const [browserAppearance, setBrowserAppearance] = useState<BrowserAppearanceSettings>(readBrowserAppearance)
  const { downloads } = useDownloads({
    onUpdate: entry => {
      if (entry.status === 'downloading' && readDownloadSettings().showPanelOnStart) setToolbarOverlay('downloads')
    },
    onTerminal: entry => {
      if (entry.status === 'completed') messageApi.success(translate("\u4E0B\u8F7D\u5B8C\u6210"))
      else if (entry.status === 'failed') messageApi.error(translate("\u4E0B\u8F7D\u5931\u8D25"))
    },
  })
  const downloadQueue = useDownloadQueue({ runningDownloads: downloads })
  const permissionPrompt = usePermissionPrompt()
  const certificatePrompt = useCertificatePrompt()
  const bookmarkActions = useBookmarks()
  const [readerArticle, setReaderArticle] = useState<ReaderArticle | null>(null)
  const [aiArticle, setAiArticle] = useState<ReaderArticle | null>(null)
  const [aiContextPending, setAiContextPending] = useState(false)
  const [aiContextError, setAiContextError] = useState<string | null>(null)
  const [pdfArticle, setPdfArticle] = useState<ReaderArticle | null>(null)
  const [pdfContextError, setPdfContextError] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [closedTabs, setClosedTabs] = useState<ClosedTab[]>([])
  const [starredDocId, setStarredDocId] = useState<string | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [messageApi, contextHolder] = message.useMessage()
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(readAdvancedSettings)
  const [trackingCleanerEnabled, setTrackingCleanerEnabledState] = useState(isTrackingCleanerEnabled)
  const [adBlockerEnabled, setAdBlockerEnabledState] = useState(isAdBlockerEnabled)
  const [blockedAdsByTab, setBlockedAdsByTab] = useState<Record<string, number>>({})
  const [comparison, setComparison] = useState<ComparisonSession | null>(null)
  const [toolbarOverlay, setToolbarOverlay] = useState<ToolbarOverlay | null>(null)
  const [modalOverlayCount, setModalOverlayCount] = useState(0)
  const [sourceView, setSourceView] = useState<{ url: string; html: string } | null>(null)
  const [clearSiteDataOpen, setClearSiteDataOpen] = useState(false)
  const [passwordCandidate, setPasswordCandidate] = useState<(PasswordCandidate & { existingId?: string }) | null>(null)
  const [passwordFillRequest, setPasswordFillRequest] = useState<{ tabLabel: string; origin: string; credentials: SavedCredential[] } | null>(null)
  const [blacklistVersion, setBlacklistVersion] = useState(0)
  const [blockPrompt, setBlockPrompt] = useState<{ url: string; host: string } | null>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<InputRef>(null)
  const previousTab = useRef<string | undefined>(undefined)
  const activeTabIdRef = useRef(activeTabId)
  const tabsRef = useRef(tabs)
  const closedTabsRef = useRef(closedTabs)
  const historyRef = useRef(history)
  const zoomLevelsRef = useRef(zoomLevels)
  const downloadsRef = useRef(downloads)
  const comparisonRef = useRef<ComparisonSession | null>(null)
  const visibleRef = useRef(visible)
  const lastActiveAtRef = useRef(new Map<string, number>([['new', Date.now()]]))
  const lastHistoryUrl = useRef<string>('')
  const shortcutsEnabledRef = useRef(getBrowserShortcutsEnabled())
  const readingSecondsRef = useRef(new Map<string, number>())
  const snapshotAttemptedRef = useRef(new Set<string>())
  const lastAdBlockCountRef = useRef<Record<string, number>>({})
  const lruSweepRunningRef = useRef(false)
  const floatingAssistantOpenedRef = useRef(false)
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const nativeMode = hasNativeTab(active.id)

  useEffect(() => {
    setPasswordCandidate(null)
    setPasswordFillRequest(null)
    setMediaResources([])
  }, [active.id, active.url])

  async function scanCurrentResources() {
    if (!hasNativeTab(active.id)) { messageApi.info(translate("\u8D44\u6E90\u63A2\u6D4B\u9700\u8981\u684C\u9762\u6D4F\u89C8\u5668\u6807\u7B7E\u9875"));return}
    setResourceScanBusy(true)
    try {
      const found = normalizeMediaResources(await scanNativeResources(active.id))
      setMediaResources(found)
      messageApi.info(found.length ?translate("\u53D1\u73B0 {value0} \u4E2A\u5A92\u4F53\u6216\u6587\u6863\u8D44\u6E90",{value0:found.length}):translate("\u5F53\u524D\u9875\u9762\u6682\u672A\u53D1\u73B0\u53EF\u4E0B\u8F7D\u8D44\u6E90"))
    } catch (error) { messageApi.error(translate("\u8D44\u6E90\u626B\u63CF\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setResourceScanBusy(false) }
  }

  async function downloadMediaResource(resource: MediaResourceCandidate) {
    try {
      await startDownload({ id: crypto.randomUUID(), url: resource.url, fileName: resource.fileName,
        dangerType: classifyDownload({ fileName: resource.fileName }),
        sourceOrigin: new URL(active.url || resource.url).origin, sourceTabLabel: active.id })
      messageApi.success(translate("\u8D44\u6E90\u5DF2\u52A0\u5165\u4E0B\u8F7D\u961F\u5217"))
    } catch (error) { messageApi.error(translate("\u4E0B\u8F7D\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
  }

  useEffect(() => {
    const onAppearanceChange = (event: Event) => setBrowserAppearance((event as CustomEvent<BrowserAppearanceSettings>).detail ?? readBrowserAppearance())
    window.addEventListener(BROWSER_APPEARANCE_EVENT, onAppearanceChange)
    return () => window.removeEventListener(BROWSER_APPEARANCE_EVENT, onAppearanceChange)
  }, [])


  useEffect(() => {
    if (!nativeMode || !active.url) return
    void zoomNativeTab(active.id, zoomLevels[active.id] ?? browserAppearance.defaultZoom)
  }, [active.id, active.url, browserAppearance.defaultZoom, nativeMode, zoomLevels])

  useEffect(() => {
    let unlistenClosed: (() => void) | undefined
    let unlistenSave: (() => void) | undefined
    void listen(FLOATING_ASSISTANT_CLOSED_EVENT, () => {
      floatingAssistantOpenedRef.current = false
      setAiOpen(false)
      diagnosticLog('assistant.floating.closed', 'info')
    }).then(fn => { unlistenClosed = fn })
    void listen(FLOATING_ASSISTANT_SAVE_EVENT, () => { void save() }).then(fn => { unlistenSave = fn })
    return () => { unlistenClosed?.(); unlistenSave?.() }
  }, [])

  useEffect(() => {
    if (!aiOpen) return
    if (!nativeMode) {
      if (floatingAssistantOpenedRef.current) {
        floatingAssistantOpenedRef.current = false
        void closeFloatingAssistant()
      }
      return
    }
    const shouldFocus = !floatingAssistantOpenedRef.current
    floatingAssistantOpenedRef.current = true
    void openFloatingAssistant({
      currentUrl: active.url,
      currentTabId: active.id,
      readerArticle: readerArticle ?? aiArticle,
      pageContextPending: aiContextPending,
      pageContextError: aiContextError,
      pdfArticle,
      pdfContextError,
      initialQuestion: aiInitialQuestion,
      initialMode: aiInitialMode,
      translationSource: aiTranslationSource,
    }, shouldFocus).catch(error => {
      floatingAssistantOpenedRef.current = false
      diagnosticLog('assistant.floating.open-failed', 'error', { tabId: active.id, error })
      setAiOpen(false)
    })
  }, [active.id, active.url, aiArticle, aiContextError, aiContextPending, aiInitialMode, aiInitialQuestion, aiOpen, aiTranslationSource, nativeMode, pdfArticle, pdfContextError, readerArticle])

  function toggleAiAssistant() {
    if (aiOpen) {
      setAiOpen(false)
      floatingAssistantOpenedRef.current = false
      diagnosticLog('assistant.floating.close-requested', 'info', { tabId: active.id })
      void closeFloatingAssistant().catch(error => diagnosticLog('assistant.floating.close-failed', 'error', { tabId: active.id, error }))
      return
    }
    diagnosticLog('assistant.floating.open-requested', 'info', { tabId: active.id })
    setAiOpen(true)
  }

  useEffect(() => {
    if (!aiOpen || !nativeMode || readerArticle || pdfArticle || active.loading || active.error || active.crashed || !hasNativeTab(active.id) || !/^https?:\/\//i.test(active.url)) return
    let cancelled = false
    setAiArticle(null)
    setAiContextError(null)
    setAiContextPending(true)
    void captureNativePage(active.id)
      .then(snapshot => extractArticle(snapshot))
      .then(article => {
        if (!cancelled) setAiArticle(article)
      })
      .catch(() => {
        if (!cancelled) setAiContextError(translate("\u65E0\u6CD5\u63D0\u53D6\u6B63\u6587"))
      })
      .finally(() => {
        if (!cancelled) setAiContextPending(false)
      })
    return () => { cancelled = true }
  }, [active.crashed, active.error, active.id, active.loading, active.url, aiOpen, nativeMode, pdfArticle, readerArticle])
  const currentHost = useMemo(() => hostFromUrl(active.url), [active.url])
  // `blacklistVersion` forces a re-match after the list is mutated elsewhere.
  const currentBlock = useMemo(() => findBlockingEntry(active.url), [active.url, blacklistVersion])
  const searchTemplate = useMemo(() => resolveActiveSearchTemplate(readSearchEngineConfig()), [])
  const addressSuggestions = useMemo(() => {
    const built = buildSuggestions({
      query: address,
      openTabs: tabs.map(       (tab                               )=>({url:tab.url,title:tab.title})),
      history,
      bookmarks: [],
      searchTemplate,
    })
    const trimmed = trimSuggestions(built, 8)
    return trimmed.map(        (item


     )                      =>( {value:item.url,label:renderSuggestion(item),}))
  }, [address, history, tabs, searchTemplate])
  const safetyIssues = useMemo<SafetyIssue[]>(() => evaluateUrlSafety(address), [address])
  const safetyLevel: SafetyLevel = highestLevel(safetyIssues)
  const showSafety = advancedSettings.safetyWarnings && safetyLevel !== 'safe' && address.trim().length > 0

  useEffect(() => { comparisonRef.current = comparison }, [comparison])

  useEffect(() => {
    if (comparison && !tabs.some(tab => tab.id === comparison.hostTabId)) closeComparison()
  }, [comparison, tabs])

  function changeToolbarOverlay(kind: ToolbarOverlay, open: boolean) {
    if (open) { setToolbarOverlay(kind); return }
    setToolbarOverlay(current => current === kind ? null : current)
  }

  useEffect(() => {
    let cancelled = false
    if (!hasNativeTab(active.id)) return
    // The native child WebView paints above the React surface, so any error
    // view (site block, crash, load failure) must hide it.
    if (!visible || readerArticle || active.error) {
      void hideNativeTab(active.id)
      return
    }
    if (modalOverlayCount > 0 || toolbarOverlay === 'tab-menu' || toolbarOverlay === 'menu') {
      void hideNativeTab(active.id)
      return
    }
    const next = bounds()
    const inset = toolbarOverlay ? TOOLBAR_OVERLAY_INSET[toolbarOverlay] ?? 0 : 0
    void        (async()=>{
      if (next) await resizeNativeTab(active.id, inset > 0 ? { ...next, width: Math.max(1, next.width - inset) } : next)
      if (cancelled || activeTabIdRef.current !== active.id || !visibleRef.current) return
      await showNativeTab(active.id)
    }            )()
    return () => { cancelled = true }
  }, [active.error, active.id, modalOverlayCount, readerArticle, toolbarOverlay, visible])

  useEffect(() => {
    const onModalOverlayChange = (event: Event) => {
      const delta = Number((event as CustomEvent<number>).detail)
      if (Number.isFinite(delta)) setModalOverlayCount(current => Math.max(0, current + delta))
    }
    window.addEventListener(UI_MODAL_OVERLAY_EVENT, onModalOverlayChange)
    return () => window.removeEventListener(UI_MODAL_OVERLAY_EVENT, onModalOverlayChange)
  }, [])

  useEffect(() => {
    let mounted = true
    void loadSiteBlacklist()
      .then(() => { if (mounted) setBlacklistVersion(value => value + 1) })
      .catch(() => undefined)
    let stop: () => void = () => undefined
    void subscribeSiteBlacklist(() => { if (mounted) setBlacklistVersion(value => value + 1) }).then(unsubscribe => {
      if (mounted) stop = unsubscribe
      else unsubscribe()
    })
    return () => { mounted = false; stop() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeSiteBlocked(payload => {
      const tabId = payload.tabLabel.replace(/^browser-/, '')
      setTabs(current => current.map(tab => tab.id === tabId
        ? {
            ...tab,
            url: payload.url,
            title: payload.host,
            loading: false,
            error: {
              kind: 'site-blocked',
              message:translate("\u8BE5\u7F51\u7AD9\u5DF2\u88AB\u5C01\u6740\uFF08{value0}\uFF09",{value0:payload.ruleHost}),
              host: payload.host,
              ruleHost: payload.ruleHost,
              entryId: payload.entryId,
            },
          }
        : tab))
      if (tabId === activeTabIdRef.current) setAddress(payload.url)
      void hideNativeTab(tabId)
      setBlacklistVersion(value => value + 1)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeProcessFailed(failure => {
      if (disposed || !failure.fatal) return
      const tabId = failure.tabLabel.replace(/^browser-/, '')
      void hideNativeTab(tabId)
      setTabs(current => current.map(tab => tab.id === tabId
        ? {
            ...tab,
            crashed: true,
            loading: false,
            error: {
              kind: 'load-failed',
              message: failure.kind === 'renderer-unresponsive'
                ?translate("\u9875\u9762\u6E32\u67D3\u8FDB\u7A0B\u65E0\u54CD\u5E94\uFF0C\u53EF\u70B9\u51FB\u201C\u91CD\u65B0\u6253\u5F00\u201D\u6062\u590D\u3002")
                :translate("\u9875\u9762\u6E32\u67D3\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u53EF\u70B9\u51FB\u201C\u91CD\u65B0\u6253\u5F00\u201D\u6062\u590D\u3002"),
            },
          }
        : tab))
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    const onAdvancedChange = (event: Event) => setAdvancedSettings((event as CustomEvent<AdvancedSettings>).detail)
    const onCleanerChange = (event: Event) => setTrackingCleanerEnabledState((event as CustomEvent<boolean>).detail)
    const onAdBlockerChange = (event: Event) => setAdBlockerEnabledState((event as CustomEvent<boolean>).detail)
    window.addEventListener(ADVANCED_SETTINGS_EVENT, onAdvancedChange)
    window.addEventListener(TRACKING_CLEANER_EVENT, onCleanerChange)
    window.addEventListener(AD_BLOCKER_EVENT, onAdBlockerChange)
    return () => {
      window.removeEventListener(ADVANCED_SETTINGS_EVENT, onAdvancedChange)
      window.removeEventListener(TRACKING_CLEANER_EVENT, onCleanerChange)
      window.removeEventListener(AD_BLOCKER_EVENT, onAdBlockerChange)
    }
  }, [])

  // Privacy: read the live platform capability + counts once the page mounts.
  // The toolbar panel surfaces network_subresource_blocking so users can see
  // whether the WebResourceRequested handler actually attached.
  useEffect(() => {
    let cancelled = false
    void privacyCapabilityReport().then(cap => { if (!cancelled) setPrivacyCap(cap) }).catch(() => undefined)
    void privacyGetStats().then(stats => { if (!cancelled) setPrivacyStats(stats) }).catch(() => undefined)
    void privacyListBlockEvents(50).then(events => { if (!cancelled) setBlockEvents(events ?? []) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [active.id])

  useEffect(() => {
    let unlisten: () => void = () => undefined
    void onNativeAdBlockUpdate(update => {
      const tabId = update.tabLabel.replace(/^browser-/, '')
      const previousCount = lastAdBlockCountRef.current[tabId] ?? 0
      const delta = update.blockedCount - previousCount
      lastAdBlockCountRef.current[tabId] = update.blockedCount
      if (delta > 0) {
        const tab = tabsRef.current.find(t => t.id === tabId)
        recordAdBlock(domainFromUrl(tab?.url ?? ''), delta)
      }
      setBlockedAdsByTab(           (current                                     )=>({...current,[tabId]:update.blockedCount}))
    }).then(dispose => { unlisten = () => { dispose() } })
    return () => unlisten()
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listBrowserHistory(),
      listClosedTabs(),
      getSessionLockState(),
      getBrowserWorkspace(),
      listSitePermissions(),
    ]).then(([storedHistory, storedClosedTabs, lockState, workspace, permissions]) => {
      if (cancelled) return
      if (permissions.length > 0) writeSitePermissions(permissions)
      else {
        const legacyPermissions = readSitePermissions()
        if (legacyPermissions.length > 0) writeSitePermissions(legacyPermissions)
      }
      setHistory(storedHistory)
      setClosedTabs(storedClosedTabs)
      const crash = lockState?.crashed ?? false
      const snapshot = readRecoverySnapshot()
      const restored = snapshot ? restoreFromSnapshot(snapshot.snapshot) : null
      if (crash && restored && restored.tabs.some(tab => tab.url.trim().length > 0)) {
        // A crash snapshot is authoritative: restore it immediately instead
        // of interrupting startup with a recovery-choice dialog.
        void dropSessionLock().catch(() => undefined)
        const restoredTabs = stripTransientTabStates(restored.tabs)
        const activeId = restoredTabs.find(tab => tab.id === restored.activeTabId)?.id
          ?? restoredTabs[0]?.id
          ?? 'new'
        const activeTab = restoredTabs.find(tab => tab.id === activeId)
        setTabs(restoredTabs)
        setActiveTabId(activeId)
        setAddress(activeTab?.url ?? '')
        setZoomLevels(restored.zoomLevels)
        if (activeTab?.url) lastHistoryUrl.current = activeTab.url
        setHydrated(true)
        void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
          if (cancelled) return
          const nextBounds = bounds()
          if (!nextBounds || !activeTab?.url) return
          try {
            const opened = await ensureNativeTab(activeTab.id, activeTab.url, nextBounds, { private: activeTab.private })
            if (opened) {
              tabRuntime.enqueueScroll(activeTab.id, {
                x: restored.scrollPositions[activeTab.id]?.x ?? 0,
                y: restored.scrollPositions[activeTab.id]?.y ?? 0,
              })
              if (visibleRef.current) await showNativeTab(activeTab.id)
            }
          } catch { /* the restored tab can be retried from its error view */ }
          await enforceLiveTabLimit(activeId)
        })
        return
      }
      const parsed = workspace ?? parsePersistedSession(getSessionLegacy(SESSION_KEY))
      // Errors/crash flags describe the *previous* process' native WebViews.
      // Restoring them verbatim pins the UI on a dead error page even though a
      // fresh WebView is about to be created for the same tab.
      const restoredTabs = parsed ? stripTransientTabStates(parsed.tabs) : []
      if (parsed) {
        setTabs(restoredTabs)
        setActiveTabId(parsed.activeTabId)
        const activeTab = restoredTabs.find(tab => tab.id === parsed.activeTabId)
        setAddress(activeTab?.url ?? '')
        if (activeTab?.url) lastHistoryUrl.current = activeTab.url
      }
      setHistory(storedHistory)
      setClosedTabs(storedClosedTabs)
      setHydrated(true)
      if (parsed) {
        void        (async()=>{
          await new Promise(resolve => requestAnimationFrame(resolve))
          if (cancelled) return
          const nextBounds = bounds()
          if (!nextBounds) return
          await Promise.all(restoredTabs.filter(tab => tab.url &&( !tab.suspended || tab.id === parsed.activeTabId)).map(async tab => {
            try {
              const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
              if (!opened) {
                setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'web-mode-required', message:translate("\u7F51\u9875\u6D4F\u89C8\u4EC5\u5728 Tauri \u684C\u9762\u5E94\u7528\u4E2D\u53EF\u7528\u3002")}}:item))
                return
              }
              if (tab.id === parsed.activeTabId && visibleRef.current) await showNativeTab(tab.id)
              else await hideNativeTab(tab.id)
              // The view is live again → any error carried in from the saved
              // session is stale by definition.
              setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined, crashed: false } : item))
            } catch (error) {
              setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: classifyNavigationError(error) } : item))
            }
          }))
          await enforceLiveTabLimit(parsed.activeTabId)
        }            )()
      }
    })
    return () => { cancelled = true }
  }, [])

  const sessionJson = useDebouncedValue(JSON.stringify({ tabs: stripTransientTabStates(stripPrivateTabs(tabs)), activeTabId }), SESSION_DEBOUNCE_MS)
  useEffect(() => {
    if (!hydrated) return
    // Runtime error/crash state must never be persisted (see
    // `stripTransientTabState`): it cannot be true for the next process.
    const persistableTabs = stripTransientTabStates(stripPrivateTabs(tabs))
    void setSession(SESSION_KEY, sessionJson)
    void saveBrowserWorkspace({ tabs: persistableTabs, activeTabId })
    const snapshot: SessionSnapshot = {
      schemaVersion: 2,
      savedAt: Date.now(),
      windows: [{
        id: 'main',
        tabs: persistableTabs,
        activeTabId,
        scrollPositions: Object.fromEntries(
          tabsRef.current
            .filter(tab => !tab.private && typeof tab.scrollX === 'number' && typeof tab.scrollY === 'number')
            .map(tab => [tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 }])
        ),
        zoomLevels: zoomLevelsRef.current,
      }],
      history: historyRef.current,
      closedTabs: closedTabsRef.current,
    }
    writeSnapshot(snapshot)
  }, [sessionJson, hydrated])

  useEffect(() => {
    const candidate = {
      url: active.url,
      title: active.title,
      loading: active.loading,
      error: active.error,
      private: active.private === true,
    }
    if (!hydrated || !shouldRecordHistory(candidate, lastHistoryUrl.current)) return
    lastHistoryUrl.current = active.url
    const entry = {
      url: redactUrl(active.url),
      title: active.title.trim() || active.url,
      visitedAt: Date.now(),
    }
    setHistory(current => dedupeHistory(current, entry))
    void addBrowserHistory(entry).catch(() => undefined)
  }, [active.url, active.title, active.loading, active.error, active.private, hydrated])

  useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
  useEffect(() => {
    let disposed = false
    if (!/^file:\/\/.*\.pdf(?:$|[?#])/i.test(active.url)) {
      setPdfArticle(null)
      setPdfContextError(null)
      return () => { disposed = true }
    }
    setPdfArticle(null)
    setPdfContextError(null)
    void extractLocalPdf(active.url)
      .then(result => {
        if (disposed) return
        const markdown = result.truncated
          ?translate("{value0}\n\n> PDF \u6587\u672C\u8F83\u957F\uFF0CAI \u4E0A\u4E0B\u6587\u5DF2\u622A\u65AD\u3002",{value0:result.text})
          : result.text
        setPdfArticle({
          title: result.title,
          byline: '',
          excerpt: result.text.slice(0, 240),
          siteName:translate("\u672C\u5730 PDF"),
          language: '',
          contentHtml: '',
          markdown,
          textContent: result.text,
          wordCount: result.wordCount,
        })
      })
      .catch(error => {
        if (!disposed) setPdfContextError(error instanceof Error ? error.message : String(error))
      })
    return () => { disposed = true }
  }, [active.url])
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  useEffect(() => { persistNotes(notes) }, [notes])
  useEffect(() => { closedTabsRef.current = closedTabs }, [closedTabs])
  useEffect(() => { downloadsRef.current = downloads }, [downloads])
  useEffect(() => { historyRef.current = history }, [history])
  useEffect(() => {
    const syncHistory = (event: Event) => setHistory((event as CustomEvent<HistoryEntry[]>).detail)
    window.addEventListener(HISTORY_CHANGE_EVENT, syncHistory)
    return () => window.removeEventListener(HISTORY_CHANGE_EVENT, syncHistory)
  }, [])
  useEffect(() => { zoomLevelsRef.current = zoomLevels }, [zoomLevels])
  useEffect(() => { visibleRef.current = visible }, [visible])

  useEffect(() => {
    const open = (event: Event) => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url
      if (url && /^https?:\/\//.test(url)) openNewTab(url)
    }
    window.addEventListener('arcadia-browser-open-url', open)
    return () => window.removeEventListener('arcadia-browser-open-url', open)
  }, [])

  useEffect(() => {
    if (!visible || active.private || active.loading || !/^https?:\/\//.test(active.url)) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const current = tabsRef.current.find(tab => tab.id === active.id)
      if (!current || current.private || current.loading || !/^https?:\/\//.test(current.url)) return
      void recordReadingActivity({ url: current.url, title: current.title || current.url, activeSeconds: 5, scrollDepth: current.scrollDepth ?? 0 }).catch(() => undefined)
      const seconds = (readingSecondsRef.current.get(current.url) ?? 0) + 5
      readingSecondsRef.current.set(current.url, seconds)
      if (seconds >= 30 && (current.scrollDepth ?? 0) >= .2 && !snapshotAttemptedRef.current.has(current.url)) {
        snapshotAttemptedRef.current.add(current.url)
        void captureNativePage(current.id)
          .then(snapshot => extractArticle(snapshot))
          .then(article => saveReadingSnapshot({ url: current.url, excerpt: article.excerpt, markdown: article.markdown }))
          .then(() => {
            const days = Number(localStorage.getItem('reading.snapshot.retentionDays') || 90)
            const mb = Number(localStorage.getItem('reading.snapshot.maxMb') || 200)
            return purgeReadingSnapshots(Number.isFinite(days) ? days : 90, (Number.isFinite(mb) ? mb : 200) * 1024 * 1024)
          })
          .catch(() => snapshotAttemptedRef.current.delete(current.url))
      }
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [active.id, active.url, active.loading, active.private, visible])

  useEffect(() => {
    const url = active.url
    if (!url) { setStarredDocId(null); return }
    let cancelled = false
    void findDocumentByUrl(url).then(doc => {
      if (cancelled) return
      setStarredDocId(doc?.starred ? doc.id : null)
    }).catch(() => { if (!cancelled) setStarredDocId(null) })
    return () => { cancelled = true }
  }, [active.url])

  const bounds = () => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : undefined
  }

  function closeComparison() {
    const current = comparisonRef.current
    if (current) current.sources.filter(source => source.kind === 'web').forEach(source => { void closeNativeTab(source.id) })
    comparisonRef.current = null
    setComparison(null)
  }

  function startComparison(query: string, engineIds: string[], includeKnowledge: boolean, includeAi = false) {
    closeComparison()
    const sources: ComparisonSource[] = engineIds.flatMap(engineId => {
      const engine = SEARCH_ENGINE_PRESETS.find(item => item.id === engineId)
      if (!engine) return []
      return [{ id: `compare-${crypto.randomUUID()}`, kind: 'web' as const, label: engine.label, engineId: engine.id, url: renderSearchTemplate(engine.template, query) }]
    })
    if (includeAi) sources.push({ id: `compare-${crypto.randomUUID()}`, kind: 'ai', label:translate("AI \u641C\u7D22")})
    if (includeKnowledge) sources.push({ id: `compare-${crypto.randomUUID()}`, kind: 'knowledge', label:translate("\u672C\u5730\u77E5\u8BC6\u5E93")})
    if (sources.length === 0) return
    const next = { hostTabId: activeTabIdRef.current, query, sources, visibleIds: sources.slice(0, 3).map(source => source.id) }
    comparisonRef.current = next
    setComparison(next)
  }

  function showComparisonSource(id: string) {
    setComparison(current => {
      if (!current || current.visibleIds.includes(id)) return current
      if (current.visibleIds.length >= 3) {
        const displacedId = current.visibleIds[2]
        const displaced = current.sources.find(source => source.id === displacedId)
        if (displaced?.kind === 'web') void closeNativeTab(displaced.id)
      }
      const visibleIds = current.visibleIds.length < 3 ? [...current.visibleIds, id] : [...current.visibleIds.slice(0, 2), id]
      const next = { ...current, visibleIds }
      comparisonRef.current = next
      return next
    })
  }

  function searchAgainInComparison(query: string) {
    const current = comparisonRef.current
    if (!current) return
    current.sources.filter(source => source.kind === 'web').forEach(source => { void closeNativeTab(source.id) })
    const idMap = new Map<string, string>()
    const sources = current.sources.map(source => {
      const id = `compare-${crypto.randomUUID()}`
      idMap.set(source.id, id)
      if (source.kind !== 'web') return { ...source, id }
      const engine = SEARCH_ENGINE_PRESETS.find(item => item.id === source.engineId)
        ?? SEARCH_ENGINE_PRESETS.find(item => item.label === source.label)
      return { ...source, id, url: engine ? renderSearchTemplate(engine.template, query) : source.url }
    })
    const next = { ...current, query, sources, visibleIds: current.visibleIds.map(id => idMap.get(id) ?? id) }
    comparisonRef.current = next
    setComparison(next)
  }

  useEffect(() => {
    if (!comparison) return
    let disposed = false
    const sync = () => {
      if (disposed) return
      const canShow = visible && active.id === comparison.hostTabId && modalOverlayCount === 0 && toolbarOverlay !== 'tab-menu'
      comparison.sources.filter(source => source.kind === 'web').forEach(source => {
        const shouldShow = canShow && comparison.visibleIds.includes(source.id)
        const element = surfaceRef.current?.querySelector<HTMLElement>(`[data-comparison-view="${source.id}"]`)
        if (!shouldShow || !element) { void hideNativeTab(source.id); return }
        const rect = element.getBoundingClientRect()
        const nextBounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        if (hasNativeTab(source.id)) {
          void        (async()=>{
            await resizeNativeTab(source.id, nextBounds)
            if (!disposed && comparisonRef.current?.visibleIds.includes(source.id)) await showNativeTab(source.id)
          }            )()
        } else if (source.url) {
          void openNativeTab(source.id, source.url, nextBounds).then(() => showNativeTab(source.id)).catch(() => undefined)
        }
      })
    }
    const frame = requestAnimationFrame(sync)
    const observer = new ResizeObserver(sync)
    if (surfaceRef.current) observer.observe(surfaceRef.current)
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect() }
  }, [active.id, comparison, modalOverlayCount, toolbarOverlay, visible])

  useEffect(() => {
    if (previousTab.current && previousTab.current !== active.id) void hideNativeTab(previousTab.current)
    previousTab.current = active.id
    // Visibility and bounds for the active view are synchronized by the
    // effect above. Showing it here before the next resize briefly paints the
    // previous bounds and causes a visible jump during tab switches.
  }, [active.id])

  const tabRuntime = useTabRuntime({
    tab: active,
    visible,
    enabled: nativeMode && hasNativeTab(active.id) && !active.error,
    onApply: (patch) => {
      // macOS / Linux fallback: no navigation guard, so the polling loop is the
      // only place a redirect into a blacklisted host can be caught.
      const blocked = typeof patch.url === 'string' && !active.error ? findBlockingEntry(patch.url) : null
      if (blocked) void hideNativeTab(active.id)
      setTabs(current => current.map(tab => {
        if (tab.id !== active.id) return tab
        if (!blocked) return { ...tab, ...patch, crashed: false }
        return {
          ...tab,
          ...patch,
          crashed: false,
          loading: false,
          error: {
            kind: 'site-blocked',
            message:translate("\u8BE5\u7F51\u7AD9\u5DF2\u88AB\u5C01\u6740\uFF08{value0}\uFF09",{value0:blocked.host}),
            host: hostFromUrl(patch.url ?? '') ?? blocked.host,
            ruleHost: blocked.host,
            entryId: blocked.id,
          },
        }
      }))
      if (typeof patch.url === 'string') setAddress(patch.url)
    },
    onReopen: () => {
      const tab = tabsRef.current.find(item => item.id === active.id)
      const nextBounds = bounds()
      if (!tab?.url || !nextBounds) return
      tabRuntime.enqueueScroll(tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 })
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, crashed: true, loading: true, error: undefined } : item))
      void openNativeTab(tab.id, tab.url, nextBounds, { private: tab.private }).catch(error => {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, crashed: true, error: classifyNavigationError(error) } : item))
      })
    },
  })

  useEffect(() => {
    if (!surfaceRef.current || !visible) return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        const next = bounds()
        if (!next || modalOverlayCount > 0 || toolbarOverlay === 'tab-menu') return
        const inset = toolbarOverlay ? TOOLBAR_OVERLAY_INSET[toolbarOverlay] ?? 0 : 0
        void resizeNativeTab(active.id, { ...next, width: Math.max(1, next.width - inset) })
      })
    })
    observer.observe(surfaceRef.current)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [active.id, aiOpen, findOpen, modalOverlayCount, toolbarOverlay, visible])

  useEffect(() => () => {
    tabsRef.current.forEach(tab => { void closeNativeTab(tab.id) })
    comparisonRef.current?.sources.filter(source => source.kind === 'web').forEach(source => { void closeNativeTab(source.id) })
  }, [])

  // While a page is actually on screen, messages are painted inside that page
  // (closed shadow root, `position: fixed` top-right) instead of the host layer:
  // the WebView is stacked above the React surface, so a host toast over the
  // page would be invisible, and a host bar above it would have to shrink the
  // view. Every host-rendered surface (new tab, error, reader, an open modal
  // that hides the tab, the tab context menu) keeps the host layer.
  const pageOwnsToasts = visible && nativeMode && !!active.url && !active.error && !active.crashed && !readerArticle && modalOverlayCount === 0 && toolbarOverlay !== 'tab-menu'
  useEffect(() => {
    if (!pageOwnsToasts) return undefined
    const tabId = active.id
    return registerToastSink({
      // A closed tab or a navigation mid-call resolves to `false` and the
      // message layer retries in the host layer, so nothing is lost.
      show: toast => showNativePageToast(tabId, toast).catch(() => false),
      hide: id => { void closeNativePageToast(tabId, id).catch(() => undefined) },
    })
  }, [active.id, pageOwnsToasts])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeNewTab((url, options) => openNewTab(url, options)).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onPasswordCandidate(candidate => {
      void listBrowserPasswords().then(credentials => {
        if (disposed) return
        const existingId = credentials.find(item => item.origin === candidate.origin && item.username === candidate.username)?.id
        setPasswordCandidate({ ...candidate, existingId })
      })
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onPasswordFillRequest(request => {
      void listBrowserPasswords().then(credentials => {
        if (disposed) return
        const matches = credentials.filter(item => item.origin === request.origin)
        if (matches.length) setPasswordFillRequest({ ...request, credentials: matches })
      })
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeAudioState(state => {
      if (disposed) return
      setTabs(current => current.map(tab => tab.id === state.tabId
        ? { ...tab, audible: state.audible, muted: state.muted }
        : tab))
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => {
    if (hasNativeTab(active.id)) void setNativeMuted(active.id, active.muted === true)
  }, [active.id, active.muted])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!visibleRef.current) return
      if (!shortcutsEnabledRef.current) return
      if (event.key === 'F12') {
        event.preventDefault()
        if (readAdvancedSettings().developerToolsEnabled && hasNativeTab(activeTabIdRef.current)) void openNativeDevtools(activeTabIdRef.current)
        return
      }
      const action = interpretShortcut(event, readShortcutOverrides())
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'focusAddress':
          addressRef.current?.focus({ cursor: 'all' })
          return
        case 'newTab':
          openNewTab()
          return
        case 'reopenClosedTab':
          reopenLastClosed()
          return
        case 'closeTab':
          closeTab(activeTabIdRef.current)
          return
        case 'nextTab': {
          const current = tabsRef.current.findIndex(tab => tab.id === activeTabIdRef.current)
          const next = (current + 1 + tabsRef.current.length) % tabsRef.current.length
          activateTab(tabsRef.current[next].id)
          return
        }
        case 'prevTab': {
          const current = tabsRef.current.findIndex(tab => tab.id === activeTabIdRef.current)
          const next = (current - 1 + tabsRef.current.length) % tabsRef.current.length
          activateTab(tabsRef.current[next].id)
          return
        }
        case 'jumpToTab': {
          const requested = event.key === '9' ? tabsRef.current.length - 1 : Number(event.key) - 1
          const selected = tabsRef.current[Math.min(requested, tabsRef.current.length - 1)]
          if (selected) activateTab(selected.id)
          return
        }
        case 'back':
          void navigateHistory(activeTabIdRef.current, -1)
          return
        case 'forward':
          void navigateHistory(activeTabIdRef.current, 1)
          return
        case 'stop':
          if (hasNativeTab(activeTabIdRef.current)) void stopNativeTab(activeTabIdRef.current)
          return
        case 'find':
          setFindOpen(true)
          return
        case 'openCommandBar':
          setCommandOpen(true)
          return
        case 'openTabSearch':
          setTabSearchOpen(true)
          return
        case 'openHistorySearch':
          setHistorySearchOpen(true)
          return
        case 'openBookmarks':
          setBookmarkPaletteOpen(true)
          return
        case 'addBookmark':
          void addCurrentAsBookmark()
          return
        case 'openBulkSummary':
          setBulkSummaryOpen(true)
          return
        case 'toggleNotesPanel':
          setNotesOpen(value => !value)
          return
        case 'saveWorkspace':
          void saveAsWorkspace()
          return
        case 'print':
          if (hasNativeTab(activeTabIdRef.current)) void printNativeTab(activeTabIdRef.current)
          return
        case 'zoomIn':
          changeZoom(activeTabIdRef.current, 0.1)
          return
        case 'zoomOut':
          changeZoom(activeTabIdRef.current, -0.1)
          return
        case 'zoomReset':
          setZoom(activeTabIdRef.current, 1)
          return
        case 'reload':
          if (hasNativeTab(activeTabIdRef.current)) void reloadNativeTab(activeTabIdRef.current)
          return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('arcadia-shortcuts-change', onShortcutsChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('arcadia-shortcuts-change', onShortcutsChange)
    }
  }, [])

  // Workspace restore is requested from the Settings page via a custom event;
  // BrowserPage is the only place that owns the live tab list, so the swap
  // happens here.
  useEffect(() => {
    async function onRestoreWorkspace(event: Event) {
      const detail = (event as CustomEvent<{ id: string }>).detail
      if (!detail?.id) return
      const workspace = await getWorkspace(detail.id)
      if (!workspace) {
        messageApi.error(translate("\u5DE5\u4F5C\u533A\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664"))
        return
      }
      await applyWorkspaceRestore(workspace)
    }
    window.addEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
    return () => window.removeEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
  }, [])

  function onShortcutsChange(event: Event) {
    const detail = (event as CustomEvent<{ enabled: boolean }>).detail
    shortcutsEnabledRef.current = detail.enabled !== false
  }

  function requestBlockCurrentSite() {
    const url = active.url
    const host = hostFromUrl(url)
    if (!url || !host) {
      messageApi.info(translate("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u53EF\u5C01\u6740\u7684\u7F51\u7AD9"))
      return
    }
    setBlockPrompt({ url, host })
  }

  async function confirmBlockCurrentSite() {
    const prompt = blockPrompt
    if (!prompt) return
    const tabId = activeTabIdRef.current
    try {
      const entry = await addBlockedSite(prompt.url, null, 'quick-block')
      setBlockPrompt(null)
      setBlacklistVersion(value => value + 1)
      setTabs(current => current.map(tab => tab.id === tabId
        ? {
            ...tab,
            loading: false,
            error: {
              kind: 'site-blocked',
              message:translate("\u8BE5\u7F51\u7AD9\u5DF2\u88AB\u5C01\u6740\uFF08{value0}\uFF09",{value0:entry.host}),
              host: prompt.host,
              ruleHost: entry.host,
              entryId: entry.id,
            },
          }
        : tab))
      // The page is now blacklisted: close its WebView so no background work
      // or audio survives the block. Reopening happens via `openNativeTab`.
      void closeNativeTab(tabId)
      messageApi.success(translate("\u5DF2\u5C01\u6740 {value0}\uFF0C\u53EF\u5728\u300C\u8BBE\u7F6E \u2192 \u9690\u79C1 \u2192 \u7F51\u7AD9\u5C01\u6740\u300D\u4E2D\u7BA1\u7406",{value0:entry.host}))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  async function unblockAndVisit(entryId: string | undefined, url: string) {
    try {
      if (entryId) await removeBlockedSite(entryId)
      setBlacklistVersion(value => value + 1)
      setTabs(current => current.map(tab => tab.id === activeTabIdRef.current ? { ...tab, error: undefined, loading: true } : tab))
      if (url) await navigate(url)
    } catch (error) {
      messageApi.error(translate("\u89E3\u9664\u5C01\u6740\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function unblockCurrentSite() {
    if (!currentBlock) return
    await unblockAndVisit(currentBlock.id, active.url)
  }

  async function navigate(input: string) {
    const trimmedInput = input.trim()
    const normalizedInput = /^[a-z]:[\\/]/i.test(trimmedInput)
      ? `file:///${trimmedInput.replace(/\\/g, '/')}`
      : trimmedInput
    const resolved = resolveNavigationInput(normalizedInput, { searchTemplate })
    if (!resolved) return
    if (comparisonRef.current?.hostTabId === active.id) closeComparison()
    const url = trackingCleanerEnabled && /^https?:\/\//i.test(resolved) ? cleanTrackingParameters(resolved) : resolved
    const tabId = active.id
    if (!isNativeBrowserAvailable()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      setTabs(current => current.map(tab => tab.id === tabId ? { ...newTab(tab.id), active: true } : tab))
      setAddress('')
      messageApi.info(translate("\u7F51\u9875\u9884\u89C8\u6A21\u5F0F\u4E0B\u5DF2\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00"))
      return
    }
    // Private tabs deny sensitive permissions inside the native/JS guard and
    // never write to the shared site-permission store. This keeps incognito
    // browsing from mutating the "always allow/deny" rules of normal tabs.
    setReaderArticle(null)
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, url, title: input.trim(), loading: true, error: undefined, crashed: false } : tab))
    await new Promise(resolve => requestAnimationFrame(resolve))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      const opened = await openNativeTab(tabId, url, nextBounds, { private: active.private })
      if (!opened) {
        setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: { kind: 'web-mode-required', message:translate("\u7F51\u9875\u6D4F\u89C8\u4EC5\u5728 Tauri \u684C\u9762\u5E94\u7528\u4E2D\u53EF\u7528\u3002")}}:tab))
        return
      }
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, error: undefined } : tab))
      await enforceLiveTabLimit(tabId)
    } catch (error) {
      const diagnosed = await diagnoseNavigationError(url, error)
      setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: diagnosed } : tab))
    }
  }

  async function enforceLiveTabLimit(protectedId: string, suspendIdle = false) {
    if (lruSweepRunningRef.current) return
    lruSweepRunningRef.current = true
    try {
      const tabs = tabsRef.current
      const liveIds = new Set(tabs.filter(tab => hasNativeTab(tab.id) && !isNativeTabSuspended(tab.id)).map(tab => tab.id))
      const currentSettings = readAdvancedSettings()
      const activeDownloads: DownloadActivity[] = downloadsRef.current
        .filter(item => item.status === 'downloading')
        .map(        (item                                                      )=>({status:'downloading',sourceOrigin:item.sourceOrigin}))
      const idleThresholdMs = Math.max(1, currentSettings.idleSuspendMinutes) * 60_000
      const plan = planLruSweep({
        tabs,
        liveIds,
        lastActiveAt: lastActiveAtRef.current,
        activeDownloads,
        protectedId,
        maxLive: currentSettings.maxLiveWebviews,
        idleThresholdMs,
        suspendIdle,
      })
      for (const id of plan.toClose) {
        try {
          const state = await readNativeState(id)
          if (state) setTabs(current => current.map(item => item.id === id ? { ...item, scrollX: Math.round(state.scrollX), scrollY: Math.round(state.scrollY) } : item))
        } catch { /* retain the last observed position */ }
        const retained = await suspendNativeTab(id).catch(() => false)
        if (!retained) await closeNativeTab(id)
        setTabs(current => current.map(item => item.id === id ? { ...item, suspended: true, loading: false } : item))
      }
    } finally {
      lruSweepRunningRef.current = false
    }
  }

  useEffect(() => {
    if (!isNativeBrowserAvailable()) return
    const sweep = () => { void enforceLiveTabLimit(activeTabIdRef.current, true) }
    const timer = window.setInterval(sweep, 60_000)
    return () => window.clearInterval(timer)
  }, [advancedSettings.idleSuspendMinutes, advancedSettings.maxLiveWebviews])

  async function resumeTab(tab: BrowserTab) {
    if (!tab.url) return
    const nextBounds = bounds()
    if (!nextBounds) return
    if (hasNativeTab(tab.id) && isNativeTabSuspended(tab.id)) {
      const resumed = await resumeNativeTab(tab.id).catch(() => false)
      if (resumed) {
        await resizeNativeTab(tab.id, nextBounds)
        if (visibleRef.current && activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, loading: false, error: undefined } : item))
        await enforceLiveTabLimit(tab.id)
        return
      }
      await closeNativeTab(tab.id)
    } else if (hasNativeTab(tab.id)) {
      return
    }
    setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, loading: true, error: undefined } : item))
    try {
      tabRuntime.enqueueScroll(tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 })
      const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
      if (!opened) throw new Error(translate("\u7F51\u9875\u6D4F\u89C8\u4EC5\u5728 Tauri \u684C\u9762\u5E94\u7528\u4E2D\u53EF\u7528\u3002"))
      if (visibleRef.current && activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, error: undefined } : item))
      await enforceLiveTabLimit(tab.id)
    } catch (error) {
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
    }
  }

  function setZoom(tabId: string, scale: number) {
    const next = Math.min(3, Math.max(0.5, Math.round(scale * 10) / 10))
    setZoomLevels(           (current                      )=>({...current,[tabId]:next}))
    if (hasNativeTab(tabId)) void zoomNativeTab(tabId, next)
  }

  function changeZoom(tabId: string, delta: number) {
    setZoomLevels(current => {
      const next = Math.min(3, Math.max(0.5, Math.round( ((current[tabId]?? browserAppearance.defaultZoom) + delta) * 10) / 10))
      if (hasNativeTab(tabId)) void zoomNativeTab(tabId, next)
      return { ...current, [tabId]: next }
    })
  }

  async function runFind(backwards = false) {
    if (!findQuery || !hasNativeTab(active.id)) { setFindStatus('idle'); return }
    try {
      setFindStatus((await findInNativeTab(active.id,findQuery, backwards))? 'found' : 'missing')
    } catch {
      setFindStatus('missing')
    }
  }

  function closeFind() {
    if (hasNativeTab(active.id)) void findInNativeTab(active.id, '')
    setFindOpen(false)
    setFindStatus('idle')
  }

  const [isWindowFullscreen, setIsWindowFullscreen] = useState(false)
  async function handleToggleFullscreen() {
    try {
      const next = await toggleWindowFullscreen()
      setIsWindowFullscreen(next)
    } catch (error) {
      diagnosticLog('window.fullscreen.failed', 'error', { error })
      messageApi.error(translate("\u5207\u6362\u5168\u5C4F\u5931\u8D25"))
    }
  }
  function runBrowserMenuAction(action: string) {
    diagnosticLog('browser.menu.action', 'info', { action, tabId: active.id, url: redactUrl(active.url) })
    switch (action) {
      case 'find': setFindOpen(true); break
      case 'tab-search': setTabSearchOpen(true); break
      case 'history-search': setHistorySearchOpen(true); break
      case 'bookmark-add': void addCurrentAsBookmark(); break
      case 'bookmarks': setBookmarkPaletteOpen(true); break
      case 'bulk-summary': setBulkSummaryOpen(true); break
      case 'toggle-notes': setNotesOpen(value => !value); break
      case 'save-workspace': void saveAsWorkspace(); break
      case 'print':
        diagnosticLog('browser.print.requested', 'info', { tabId: active.id, url: redactUrl(active.url) })
        void printNativeTab(active.id)
          .then(() => diagnosticLog('browser.print.dialog-opened', 'info', { tabId: active.id }))
          .catch(error => diagnosticLog('browser.print.failed', 'error', { tabId: active.id, error }))
        break
      case 'devtools': if (advancedSettings.developerToolsEnabled) void openNativeDevtools(active.id); break
      case 'screenshot-visible': void saveScreenshot(false); break
      case 'screenshot-full': void saveScreenshot(true); break
      case 'translate-page':
        void openReader().then(opened => {
          if (!opened) return
          setAiTranslationSource('')
          setAiInitialMode('translate')
          setAiOpen(true)
        })
        break
      case 'new-private': openNewTab(undefined, { private: true }); break
      case 'fullscreen': void handleToggleFullscreen(); break
      case 'zoom-out': changeZoom(active.id, -0.1); break
      case 'zoom-in': changeZoom(active.id, 0.1); break
      case 'zoom-reset': setZoom(active.id, 1); break
      case 'clear-site-data': setClearSiteDataOpen(true); break
      case 'site-block': requestBlockCurrentSite(); break
      case 'site-unblock': void unblockCurrentSite(); break
    }
  }

  async function saveScreenshot(fullPage: boolean, clip?: {x:number;y:number;width:number;height:number}) {
    diagnosticLog('browser.screenshot.requested', 'info', { tabId: active.id, fullPage, clipped: Boolean(clip), url: redactUrl(active.url) })
    try {
      // Closing the trusted host menu makes the native child WebView visible
      // again. Allow WebView2 to commit that clean frame before capture.
      setToolbarOverlay(null)
      if (hasNativeTab(active.id)) {
        const nextBounds = bounds()
        if (nextBounds) await resizeNativeTab(active.id, nextBounds)
        await showNativeTab(active.id)
        await new Promise(resolve => window.setTimeout(resolve, 160))
      }
      diagnosticLog('browser.screenshot.webview-restored', 'info', { tabId: active.id })
      const data = await captureNativeScreenshot(active.id, fullPage, clip)
      const link = document.createElement('a')
      link.href = `data:image/png;base64,${data}`
      const fileName = `${safeFileName(active.title ||translate("\u7F51\u9875"))}-${clip?translate("\u9009\u533A"):fullPage?translate("\u6574\u9875"):translate("\u53EF\u89C6\u533A\u57DF")}.png`
      link.download = fileName
      document.body.appendChild(link); link.click(); link.remove()
      diagnosticLog('browser.screenshot.completed', 'info', { tabId: active.id, fullPage, clipped: Boolean(clip), encodedBytes: data.length })
      messageApi.success(translate("\u622A\u56FE\u5DF2\u4FDD\u5B58\u5230\u7CFB\u7EDF\u4E0B\u8F7D\u6587\u4EF6\u5939\uFF1A{value0}",{value0:fileName}),5)
    } catch (error) {
      diagnosticLog('browser.screenshot.failed', 'error', { tabId: active.id, fullPage, clipped: Boolean(clip), error })
      messageApi.error(translate("\u622A\u56FE\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    } finally {
      if (hasNativeTab(active.id) && visibleRef.current && activeTabIdRef.current === active.id) {
        const nextBounds = bounds()
        if (nextBounds) await resizeNativeTab(active.id, nextBounds).catch(() => undefined)
        await showNativeTab(active.id).catch(error => diagnosticLog('browser.screenshot.restore-failed', 'error', { tabId: active.id, error }))
      }
    }
  }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onNativeToolbarMenuAction(({ tabId, action, value }) => {
      if (disposed || tabId !== activeTabIdRef.current) return
      if (action === '__dismiss__') setToolbarOverlay(null)
      else if (action === 'bookmark-open' && value && bookmarkActions.bookmarks.some(item => item.url === value)) void navigate(value)
      else if (action === 'resource-scan') void scanCurrentResources()
      else if (action === 'resource-download' && value) {
        const resource = mediaResources.find(item => item.url === value)
        if (resource) void downloadMediaResource(resource)
      }
      else void runBrowserMenuAction(action)
      if (action !== 'resource-scan') setToolbarOverlay(null)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    })
    return () => { disposed = true; unlisten?.() }
  }, [active.id, bookmarkActions.bookmarks, mediaResources])

  const browserMenu: MenuProps['items'] = ([
    { key: 'find', label:translate("\u5728\u9875\u9762\u4E2D\u67E5\u627E"),extra:'Ctrl+F',onClick:()=>runBrowserMenuAction('find')},
    { key: 'tab-search', label:translate("\u641C\u7D22\u6807\u7B7E\u9875"),extra:'Ctrl+K',onClick:()=>runBrowserMenuAction('tab-search')},
    { key: 'history-search', label:translate("\u6D4F\u89C8\u5386\u53F2\u8BB0\u5F55"),extra:'Ctrl+H',onClick:()=>runBrowserMenuAction('history-search')},
    { key: 'bookmark-add', label:translate("\u6536\u85CF\u5F53\u524D\u9875"),extra:'Ctrl+D',onClick:()=>runBrowserMenuAction('bookmark-add')},
    { key: 'bookmarks', label:translate("\u6253\u5F00\u6536\u85CF\u5939"),extra:'Ctrl+Shift+O',onClick:()=>runBrowserMenuAction('bookmarks')},
    { key: 'bulk-summary', label:translate("\u591A\u94FE\u63A5 AI \u6458\u8981"),extra:'Ctrl+Shift+S',onClick:()=>runBrowserMenuAction('bulk-summary')},
    { key: 'toggle-notes', label:translate("\u7F51\u9875\u7B14\u8BB0\u9762\u677F"),extra:'Ctrl+Shift+N',onClick:()=>runBrowserMenuAction('toggle-notes')},
    { key: 'save-workspace', label:translate("\u4FDD\u5B58\u5168\u90E8\u6807\u7B7E\u4E3A\u5DE5\u4F5C\u533A"),extra:'Ctrl+Shift+W',icon:<SaveOutlined/>,disabled:tabs.length===0,onClick:()=>runBrowserMenuAction('save-workspace')},
    { key: 'translate-page', label:translate("\u7FFB\u8BD1\u5F53\u524D\u7F51\u9875"),icon:<TranslationOutlined/>,disabled:!active.url,onClick:()=>runBrowserMenuAction('translate-page')},
    { key: 'print', label:translate("\u6253\u5370 / \u4FDD\u5B58\u4E3A PDF"),icon:<PrinterOutlined/>,extra:'Ctrl+P',disabled:!nativeMode,onClick:()=>runBrowserMenuAction('print')},
    { key: 'devtools', label:translate("\u5F00\u53D1\u8005\u5DE5\u5177"),extra:'F12',disabled:!nativeMode||!advancedSettings.developerToolsEnabled,onClick:()=>runBrowserMenuAction('devtools')},
    { key: 'screenshot-visible', label:translate("\u622A\u53D6\u53EF\u89C6\u533A\u57DF"),disabled:!nativeMode,onClick:()=>runBrowserMenuAction('screenshot-visible')},
    { key: 'screenshot-full', label:translate("\u622A\u53D6\u6574\u4E2A\u7F51\u9875"),disabled:!nativeMode,onClick:()=>runBrowserMenuAction('screenshot-full')},
    { key: 'clear-site-data', label:translate("\u6E05\u9664\u5171\u4EAB\u6D4F\u89C8\u6570\u636E"),disabled:!active.url||!nativeMode,onClick:()=>runBrowserMenuAction('clear-site-data')},
    currentBlock
      ? { key: 'site-unblock', label:translate("\u89E3\u9664\u5C01\u6740\u6B64\u7F51\u7AD9"),icon:<StopOutlined/>,onClick:()=>runBrowserMenuAction('site-unblock')}
      : { key: 'site-block', label:translate("\u5C01\u6740\u6B64\u7F51\u7AD9"),icon:<StopOutlined/>,disabled:!currentHost||!nativeMode,onClick:()=>runBrowserMenuAction('site-block')},
    { type: 'divider' },
    { key: 'new-private', label:translate("\u65B0\u5EFA\u79C1\u5BC6\u7A97\u53E3"),icon:<LockOutlined/>,extra:'Shift+Ctrl+N',onClick:()=>runBrowserMenuAction('new-private')},
    { key: 'fullscreen', label: isWindowFullscreen ?translate("\u9000\u51FA\u5168\u5C4F"):translate("\u8FDB\u5165\u5168\u5C4F"),icon:<FullscreenOutlined/>,extra:'F11',onClick:()=>runBrowserMenuAction('fullscreen')},
    { type: 'divider' },
    { key: 'zoom', label: <Space><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, -0.1) }}>−</Button><span className="browser-zoom-value">{Math.round((zoomLevels[active.id] ?? browserAppearance.defaultZoom) * 100)}%</span><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, 0.1) }}>+</Button></Space> },
    { key: 'zoom-reset', label:translate("\u91CD\u7F6E\u7F29\u653E"),extra:'Ctrl+0',onClick:()=>setZoom(active.id,1)},
  ]) as MenuProps['items']

  const bookmarkBarPanel =(
    <div className="bookmark-bar-panel" role="menu">
      {bookmarkActions.bookmarks.length === 0
        ? <Typography.Text type="secondary">{translate("\u8FD8\u6CA1\u6709\u6536\u85CF\uFF0CCtrl+D \u6536\u85CF\u5F53\u524D\u9875")}</Typography.Text>
        : <ul>
            {bookmarkActions.bookmarks.slice(0, 8).map(            (bookmark






            )                                                   =>(<li key={bookmark.id}>
                <button type="button" title={bookmark.url} onClick={() => void navigate(bookmark.url)}>
                  <span className="bookmark-bar-panel__title">{bookmark.title}</span>
                  <Typography.Text type="secondary" className="bookmark-bar-panel__url">{bookmark.url}</Typography.Text>
                </button>
              </li>))}
            {bookmarkActions.bookmarks.length > 8 && <li><button type="button" onClick={() => setBookmarkPaletteOpen(true)}>{translate("\u67E5\u770B\u5168\u90E8")} {bookmarkActions.bookmarks.length} {translate("\u6761\u2026")}</button></li>}
          </ul>}
    </div>);const downloadPanel=(<DownloadSummary feed={downloads.map((item             )=>({...item,targetPath:item.targetPath??item.path}))}
      inFlight={downloads.filter(item => item.status === 'downloading').length}
      pendingCount={downloadQueue.pending.length}
      maxConcurrent={downloadQueue.maxConcurrent}
    />)


  const resourceStats = useMemo(() => {
    const liveIds = new Set(tabs.filter(tab => hasNativeTab(tab.id) && !isNativeTabSuspended(tab.id)).map(tab => tab.id))
    const downloadingOrigins = new Set(downloads.filter(item => item.status === 'downloading').map(item => item.sourceOrigin).filter((value): value is string => !!value))
    return computeResourceStats({ tabs, liveIds, downloadingOrigins, lastActiveAt: lastActiveAtRef.current })
  }, [tabs, downloads])

  const processMemory = useProcessMemory({ enabled: nativeMode })
  const memory = processMemory.snapshot

  const nativePanelPayloads = useMemo(() =>( {
    bookmarks: {
      total: bookmarkActions.bookmarks.length,
      items: bookmarkActions.bookmarks.slice(0, 8).map(            (bookmark                                    )=>({title:bookmark.title,url:bookmark.url})),
    },
    downloads: {
      subtitle: downloads.some(item => item.status === 'downloading')
        ?translate("{value0} \u4E2A\u6B63\u5728\u4E0B\u8F7D / \u4E0A\u9650 {value1}",{value0:downloads.filter(item=>item.status==='downloading').length,value1:downloadQueue.maxConcurrent})
        : downloadQueue.pending.length > 0 ?translate("{value0} \u4E2A\u6392\u961F\u4E2D",{value0:downloadQueue.pending.length}):translate("\u6682\u65E0\u6D3B\u52A8"),
      items: downloads.slice(0, 5).map(        (item





       )                                    =>( {name:item.fileName||item.url.split('/').pop()||translate("\u4E0B\u8F7D\u6587\u4EF6"),status:item.status,detail:item.totalBytes?`${item.status} · ${Math.min(100,Math.round(((item.receivedBytes??0)/item.totalBytes)*100))}%`:item.status,})),
    },
    resources: {
      subtitle: mediaResources.length ?translate("\u53D1\u73B0 {value0} \u9879",{value0:mediaResources.length}):translate("\u624B\u52A8\u626B\u63CF\u5F53\u524D\u9875"),
      sections: [
        { title:translate("\u5A92\u4F53\u8D44\u6E90"),items:mediaResources.slice(0,10).map((item                                                                                                               )=>({label:`${mediaKindLabel[item.kind]} · ${item.fileName}`,value:item.size?formatProcessBytes(item.size):translate("\u672A\u77E5\u5927\u5C0F"),url:item.url}))},
        { title:translate("\u6807\u7B7E\u9875"),items:[
          { label:translate("\u603B\u6807\u7B7E\u9875"),value:resourceStats.totalTabs},
          { label:translate("\u6D3B\u8DC3 WebView"),value:resourceStats.liveTabs},
          { label:translate("\u5DF2\u4F11\u7720"),value:resourceStats.suspendedTabs},
          { label:translate("\u56FA\u5B9A"),value:resourceStats.pinnedTabs},
          { label:translate("\u64AD\u653E\u97F3\u9891"),value:resourceStats.audibleTabs},
          { label:translate("\u4E0B\u8F7D\u4E2D"),value:resourceStats.downloadingTabs},
          { label:translate("\u6700\u4E45\u672A\u6D3B\u8DC3"),value:translate("{value0} \u5206\u949F",{value0:resourceStats.idleMinutes})},
        ]},
        { title:translate("\u8FDB\u7A0B\u5185\u5B58"),items:[
          { label:translate("\u5DE5\u4F5C\u96C6"),value:formatProcessBytes(memory?.workingSetBytes)},
          { label:translate("\u63D0\u4EA4\u5927\u5C0F"),value:formatProcessBytes(memory?.commitBytes)},
          { label:translate("\u5CF0\u503C"),value:formatProcessBytes(memory?.peakWorkingSetBytes)},
          { label:translate("\u7F3A\u9875\u4E2D\u65AD"),value:memory?.pageFaultCount==null?'—':memory.pageFaultCount.toLocaleString('zh-CN')},
        ]},
      ],
      canScan: nativeMode,
      hint:translate("LRU \u9608\u503C {value0} \u4E2A WebView\uFF1B\u7A7A\u95F2 {value1} \u5206\u949F\u81EA\u52A8\u4F11\u7720\u3002",{value0:advancedSettings.maxLiveWebviews,value1:advancedSettings.idleSuspendMinutes}),
    },
  }), [advancedSettings.idleSuspendMinutes, advancedSettings.maxLiveWebviews, bookmarkActions.bookmarks, downloadQueue.maxConcurrent, downloadQueue.pending.length, downloads, mediaResources, memory, nativeMode, resourceStats])

  useEffect(() => {
    // Always intercept the desktop toolbar button before the React Dropdown
    // sees it. Keying this off `nativeMode` caused a race while a child
    // WebView was registering: the host menu opened underneath the native
    // page, so its left side was visually covered.
    if (!isNativeBrowserAvailable()) return
    const triggerKinds: Record<string, 'downloads' | 'bookmarks' | 'resources'> = {
      下载: 'downloads',
      收藏夹: 'bookmarks',
      资源面板: 'resources',
    }
    const kindFor = (event: Event) => {
      if (!(event.target instanceof Element)) return undefined
      const button = event.target.closest<HTMLButtonElement>('button[aria-label]')
      return button ? triggerKinds[button.getAttribute('aria-label') ?? ''] : undefined
    }
    const stopPointerDown = (event: Event) => { if (kindFor(event)) event.stopImmediatePropagation() }
    const interceptClick = (event: Event) => {
      const kind = kindFor(event)
      if (!kind) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const open = toolbarOverlay !== kind
      setToolbarOverlay(open ? kind : null)
      void setNativeToolbarPanel(active.id, open, kind, nativePanelPayloads[kind]).catch(() => {
        setToolbarOverlay(null)
        messageApi.error(translate("\u6D6E\u5C42\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u542F\u684C\u9762\u5E94\u7528\u540E\u91CD\u8BD5"))
      })
    }
    document.addEventListener('pointerdown', stopPointerDown, true)
    document.addEventListener('click', interceptClick, true)
    return () => {
      document.removeEventListener('pointerdown', stopPointerDown, true)
      document.removeEventListener('click', interceptClick, true)
    }
  }, [active.id, nativeMode, nativePanelPayloads, toolbarOverlay])

  useEffect(() => {
    if (!nativeMode || !toolbarOverlay || toolbarOverlay === 'menu' || toolbarOverlay === 'tab-menu') return
    void setNativeToolbarPanel(active.id, true, toolbarOverlay, nativePanelPayloads[toolbarOverlay])
  }, [active.id, nativeMode, nativePanelPayloads, toolbarOverlay])

  useEffect(() => {
    if (!nativeMode) return
    const openNativeMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const trigger = event.target.closest<HTMLButtonElement>(translate("button[aria-label=\"\u6D4F\u89C8\u5668\u83DC\u5355\"]"))
      if (!trigger) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const zoomPercent = Math.round((zoomLevelsRef.current[active.id] ?? browserAppearance.defaultZoom) * 100)
      const fullBounds = bounds()
      const restore = fullBounds ? resizeNativeTab(active.id, fullBounds) : Promise.resolve()
      void restore.then(() => setNativeToolbarMenu(active.id, true, zoomPercent)).catch(error => {
        diagnosticLog('browser.toolbar-menu.open-failed', 'error', { tabId: active.id, error })
        messageApi.error(translate("\u6D4F\u89C8\u5668\u83DC\u5355\u6253\u5F00\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
      })
    }
    document.addEventListener('click', openNativeMenu, true)
    return () => document.removeEventListener('click', openNativeMenu, true)
  }, [active.id, browserAppearance.defaultZoom, messageApi])

  const resourcePanel =(
    <div className="resource-panel" role="status">
      <div className="resource-panel__header"><Typography.Text type="secondary" className="resource-panel__title">{translate("\u5A92\u4F53\u8D44\u6E90")}</Typography.Text><Button size="small"loading={resourceScanBusy}onClick={()=>void scanCurrentResources()}>{translate("\u626B\u63CF\u5F53\u524D\u9875")}</Button></div>
      <ul className="resource-panel__media">
        {mediaResources.slice(0, 20).map(resource => <li key={resource.url} className="resource-panel__media-item"><div><Tag>{mediaKindLabel[resource.kind]}</Tag><b title={resource.url}>{resource.fileName}</b><small>{resource.size ? formatProcessBytes(resource.size) :translate("\u672A\u77E5\u5927\u5C0F")}</small></div><Space size={2}><Button type="text"size="small"icon={<CopyOutlined/>}aria-label={translate("\u590D\u5236\u8D44\u6E90\u94FE\u63A5")}onClick={()=>void navigator.clipboard.writeText(resource.url)}/><Button type="text"size="small"icon={<DownloadOutlined/>}aria-label={translate("\u4E0B\u8F7D\u8D44\u6E90")}onClick={()=>void downloadMediaResource(resource)}/></Space></li>)}
        {!mediaResources.length && <li className="resource-panel__empty">{translate("\u626B\u63CF\u9875\u9762\u4E2D\u5DF2\u52A0\u8F7D\u7684\u89C6\u9891\u3001\u97F3\u9891\u3001\u6E05\u5355\u3001\u5B57\u5E55\u4E0E\u6587\u6863\u3002")}</li>}
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("\u6027\u80FD\u4E0E\u9690\u79C1")}</Typography.Text>
      <ul>
        <li><span>{translate("\u603B\u6807\u7B7E\u9875")}</span><b>{resourceStats.totalTabs}</b></li>
        <li><span>{translate("\u6D3B\u8DC3 WebView")}</span><b>{resourceStats.liveTabs}</b></li>
        <li><span>{translate("\u5DF2\u4F11\u7720")}</span><b>{resourceStats.suspendedTabs}</b></li>
        <li><span>{translate("\u56FA\u5B9A")}</span><b>{resourceStats.pinnedTabs}</b></li>
        <li><span>{translate("\u64AD\u653E\u97F3\u9891")}</span><b>{resourceStats.audibleTabs}</b></li>
        <li><span>{translate("\u4E0B\u8F7D\u4E2D")}</span><b>{resourceStats.downloadingTabs}</b></li>
        <li><span>{translate("\u6700\u4E45\u672A\u6D3B\u8DC3")}</span><b>{resourceStats.idleMinutes} {translate("\u5206\u949F")}</b></li>
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("\u9690\u79C1\u62E6\u622A")}</Typography.Text>
      <ul className="resource-panel__privacy">
        <li><span>{translate("\u5B50\u8D44\u6E90\u62E6\u622A")}</span><b>{privacyCap?.networkSubresourceBlocking?translate("\u5DF2\u5F00\u542F"):translate("\u672A\u542F\u7528")}</b></li>
        <li><span>{translate("\u5DF2\u963B\u65AD\u8BF7\u6C42")}</span><b>{privacyStats.blocked}</b></li>
        <li><span>{translate("\u5DF2\u653E\u884C\u8BF7\u6C42")}</span><b>{privacyStats.allowed}</b></li>
        <li><span>{translate("\u79C1\u5BC6\u6807\u7B7E")}</span><b>{active.private?translate("\u662F"):translate("\u5426")}</b></li>
        {blockEvents.slice(0, 5).map(         (event




        )                                  =>(<li key={event.id}className="resource-panel__privacy-item">
            <span>{event.resourceType}</span>
            <b title={event.requestHost}>{event.requestHost}</b>
          </li>))}
        {blockEvents.length === 0 &&(<li className="resource-panel__privacy-item"><span>{translate("\u6700\u8FD1\u65E0\u963B\u65AD")}</span><b>—</b></li>)}
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("\u8FDB\u7A0B\u5185\u5B58")}</Typography.Text>
      <ul className="resource-panel__memory">
        <li><span>{translate("\u5DE5\u4F5C\u96C6")}</span><b>{formatProcessBytes(memory?.workingSetBytes)}</b></li>
        <li><span>{translate("\u63D0\u4EA4\u5927\u5C0F")}</span><b>{formatProcessBytes(memory?.commitBytes)}</b></li>
        <li><span>{translate("\u5CF0\u503C")}</span><b>{formatProcessBytes(memory?.peakWorkingSetBytes)}</b></li>
        <li>
          <span>{translate("\u7F3A\u9875\u4E2D\u65AD")}</span>
          <b>{memory?.pageFaultCount == null ? '—' : memory.pageFaultCount.toLocaleString('zh-CN')}</b>
        </li>
      </ul>
      {processMemory.unsupported &&(<Typography.Paragraph type="secondary"className="resource-panel__hint">{translate("\u5F53\u524D\u5E73\u53F0\u672A\u63D0\u4F9B\u8FDB\u7A0B\u5185\u5B58\u67E5\u8BE2")} 

        </Typography.Paragraph>)
       }
      <Typography.Paragraph type="secondary" className="resource-panel__hint">{translate("LRU \u9608\u503C")} 
               {advancedSettings.maxLiveWebviews} {translate("\u4E2A WebView\uFF1B\u7A7A\u95F2")} {advancedSettings.idleSuspendMinutes} {translate("\u5206\u949F\u81EA\u52A8\u4F11\u7720\uFF1B\u8FDB\u7A0B\u5185\u5B58\u6BCF 5 \u79D2\u5237\u65B0\u3002")} 
      </Typography.Paragraph>
    </div>)


  async function retryActive() {
    const url = active.url
    if (!url) return
    await navigate(url)
  }

  const [saveWorkspaceOpen, setSaveWorkspaceOpen] = useState(false)
  const [saveWorkspaceName, setSaveWorkspaceName] = useState('')
  const [saveWorkspaceDescription, setSaveWorkspaceDescription] = useState('')

  function openSaveWorkspaceDialog() {
    if (tabs.length === 0) {
      messageApi.warning(translate("\u5F53\u524D\u6CA1\u6709\u53EF\u4FDD\u5B58\u7684\u6807\u7B7E\u9875"))
      return
    }
    const stamp = new Date()
    const stampLabel = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
    setSaveWorkspaceName(translate("\u5DE5\u4F5C\u533A {value0}",{value0:stampLabel}))
    setSaveWorkspaceDescription('')
    setSaveWorkspaceOpen(true)
  }

  async function saveAsWorkspace() {
    openSaveWorkspaceDialog()
  }

  async function confirmSaveWorkspace() {
    const name = saveWorkspaceName.trim()
    if (!name) {
      messageApi.warning(translate("\u8BF7\u586B\u5199\u5DE5\u4F5C\u533A\u540D\u79F0"))
      return
    }
    if (name.length > 80) {
      messageApi.warning(translate("\u540D\u79F0\u6700\u591A 80 \u4E2A\u5B57\u7B26"))
      return
    }
    try {
      const summary = await saveWorkspace({
        name,
        description: saveWorkspaceDescription.trim(),
        payload: snapshotTabsToPayload(tabs),
      })
      messageApi.success(translate("\u5DF2\u4FDD\u5B58\u5DE5\u4F5C\u533A\u300C{value0}\u300D({value1} \u4E2A\u6807\u7B7E)",{value0:summary.name,value1:summary.tabCount}))
      setSaveWorkspaceOpen(false)
    } catch (error) {
      messageApi.error(translate("\u4FDD\u5B58\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function applyWorkspaceRestore(workspace: WorkspaceRecord) {
    const result = restoreTabsFromWorkspace(tabs, workspace)
    if (result.tabs.length === 0) {
      messageApi.warning(translate("\u5DE5\u4F5C\u533A\u4E3A\u7A7A"))
      return
    }
    setTabs(result.tabs)
    setActiveTabId(result.activeTabId)
    // Re-create native tabs for the entries that did not previously exist
    // (i.e. those marked loading=true by the restore) so WebView2 actually
    // opens them. Existing tabs keep their native handles.
    const newOnes = result.tabs.filter(tab => tab.loading && tab.url && !hasNativeTab(tab.id))
    const nextBounds = bounds()
    if (nextBounds) {
      await Promise.all(newOnes.map(async tab => {
        try {
          const opened = await openNativeTab(tab.id, tab.url!, nextBounds, { private: tab.private })
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message:translate("\u7F51\u9875\u6D4F\u89C8\u4EC5\u5728 Tauri \u684C\u9762\u5E94\u7528\u4E2D\u53EF\u7528\u3002")}}:item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: undefined } : item))
        } catch (error) {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, crashed: true, error: classifyNavigationError(error) } : item))
        }
      }))
    } else {
      setTabs(current => current.map(item => item.loading ? { ...item, loading: false } : item))
    }
    void enforceLiveTabLimit(result.activeTabId)
    messageApi.success(translate("\u5DF2\u6062\u590D\u5DE5\u4F5C\u533A\uFF08+{value0} / \u2212{value1}\uFF09",{value0:result.addedCount,value1:result.removedCount}))
  }

  async function retryTab(id: string) {
    const target = tabsRef.current.find(item => item.id === id)
    if (!target?.url) return
    setTabs(current => current.map(item => item.id === id ? { ...item, crashed: false, loading: true, error: undefined } : item))
    const nextBounds = bounds()
    if (!nextBounds) return
    try {
      await openNativeTab(target.id, target.url, nextBounds, { private: target.private })
      await enforceLiveTabLimit(target.id)
    } catch (error) {
      setTabs(current => current.map(item => item.id === id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
    }
  }

  async function copyUrl() {
    const url = active.url
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      messageApi.success(translate("\u5DF2\u590D\u5236\u94FE\u63A5"))
    } catch {
      messageApi.error(translate("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u590D\u5236"))
    }
  }

  async function writeClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      messageApi.success(translate("\u5DF2\u590D\u5236{value0}",{value0:label}))
    } catch {
      messageApi.error(translate("\u590D\u5236{value0}\u5931\u8D25",{value0:label}))
    }
  }

  async function handleContextAction(action: ContextMenuAction, request: { linkUrl: string | null; imageUrl: string | null; selectionText: string; selectionRect?: {x:number;y:number;width:number;height:number}|null }) {
  if (action === 'add-to-notes') {
    const text = request.selectionText?.trim()
    if (!text) { messageApi.info(translate("\u8BF7\u5148\u9009\u4E2D\u6587\u672C"));return}
    const entry: Omit<NoteEntry, 'id' | 'createdAt'> = {
      url: active.url ?? '',
      title: active.title ?? active.url ??translate("\u672A\u547D\u540D\u9875\u9762"),
      text,
      comment: '',
    }
    setNotes(current => appendNoteEntry(current, entry))
    setNotesOpen(true)
    messageApi.success(translate("\u5DF2\u52A0\u5165\u7B14\u8BB0"),2)
    return
  }
    switch (action) {
      case 'back': void navigateHistory(active.id, -1); return
      case 'forward': void navigateHistory(active.id, 1); return
      case 'reload': if (hasNativeTab(active.id)) void reloadNativeTab(active.id); return
      case 'stop': if (hasNativeTab(active.id)) void stopNativeTab(active.id); return
      case 'print': if (hasNativeTab(active.id)) void printNativeTab(active.id); return
      case 'view-source':
        try { setSourceView(await captureNativePage(active.id)) }
        catch (error) { messageApi.error(translate("\u65E0\u6CD5\u8BFB\u53D6\u9875\u9762\u6E90\u4EE3\u7801\uFF1A{value0}",{value0:String(error)}))}
        return
      case 'copy': await writeClipboard(request.selectionText ?? '',translate("\u9009\u533A"));return
      case 'cut':
      case 'paste':
      case 'select-all':
        try { await editNativePage(active.id, action) }
        catch (error) { messageApi.error(translate("\u7F16\u8F91\u64CD\u4F5C\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
        return
      case 'search-selection': if (request.selectionText) void navigate(`https://www.google.com/search?q=${encodeURIComponent(request.selectionText)}`); return
      case 'ask-ai':
        await openReader()
        setAiInitialQuestion(request.selectionText ?translate("\u8BF7\u89E3\u91CA\u8FD9\u6BB5\u5185\u5BB9\uFF1A\n\n{value0}",{value0:request.selectionText}):'')
        setAiInitialMode('ask')
        setAiTranslationSource('')
        setAiOpen(true)
        return
      case 'translate-selection':
        setAiInitialQuestion('')
        setAiTranslationSource(request.selectionText || '')
        setAiInitialMode('translate')
        setAiOpen(true)
        return
      case 'screenshot-selection':
        if (request.selectionRect) await saveScreenshot(false, request.selectionRect)
        return
      case 'open-link-current': if (request.linkUrl) void navigate(request.linkUrl); return
      case 'open-link-new': if (request.linkUrl) openNewTab(request.linkUrl); return
      case 'open-link-external': if (request.linkUrl) {
        const verdict = classifyShellOpenUrl(request.linkUrl)
        if (verdict.shellOpenable) setPendingShellOpen(request.linkUrl)
        else if (!verdict.irreversible) openNewTab(request.linkUrl)
      }
      return
      case 'copy-link': if (request.linkUrl) await writeClipboard(request.linkUrl,translate("\u94FE\u63A5"));return
      case 'open-image-new': if (request.imageUrl) openNewTab(request.imageUrl); return
      case 'copy-image': if (request.imageUrl) await writeClipboard(request.imageUrl,translate("\u56FE\u7247\u5730\u5740"));return
      case 'save-image':
        if (request.imageUrl) {
          try {
            const derivedName =  (()=> {
              try { return new URL(request.imageUrl!).pathname.split('/').pop() || 'image' }
              catch { return 'image' }
            }                     )()
            await startDownload({
              id: crypto.randomUUID(),
              url: request.imageUrl,
              fileName: derivedName,
              mimeType: undefined,
              dangerType: classifyDownload({ fileName: derivedName }),
              sourceOrigin: request.imageUrl ? new URL(request.imageUrl).origin : undefined,
              sourceTabLabel: active.id,
            })
            messageApi.success(translate("\u56FE\u7247\u52A0\u5165\u4E0B\u8F7D\u961F\u5217"))
          } catch (error) {
            messageApi.error(translate("\u4FDD\u5B58\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
          }
        }
        return
    }
  }

  function openNewTab(url?: string, options: { private?: boolean } = {}) {
    if (url && !isNativeBrowserAvailable()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      messageApi.info(translate("\u7F51\u9875\u9884\u89C8\u6A21\u5F0F\u4E0B\u5DF2\u4F7F\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00"))
      return
    }
    const tab = options.private ? makePrivateTab() : newTab()
    const currentId = activeTabIdRef.current
    if (currentId) void hideNativeTab(currentId)
    if (url) { tab.url = url; tab.title =translate("\u6B63\u5728\u52A0\u8F7D\u2026");tab.loading=true}
    setTabs(current => {
      const next = current.map(        (item                      )=>({...item,active:false}))
      return [...next, tab]
    })
    activeTabIdRef.current = tab.id
    lastActiveAtRef.current.set(tab.id, Date.now())
    setActiveTabId(tab.id)
    setAddress(url ?? '')
    setReaderArticle(null)
    if (url) {
      void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
        const nextBounds = bounds()
        if (!nextBounds) return
        try {
          const opened = await openNativeTab(tab.id, url, nextBounds, { private: tab.private })
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message:translate("\u7F51\u9875\u6D4F\u89C8\u4EC5\u5728 Tauri \u684C\u9762\u5E94\u7528\u4E2D\u53EF\u7528\u3002")}}:item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined } : item))
          await enforceLiveTabLimit(tab.id)
        } catch (error) {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
        }
      })
    }
  }

  function activateTab(id: string) {
    if (id === activeTabIdRef.current) return
    const selected = tabs.find(tab => tab.id === id)
    const currentId = activeTabIdRef.current
    if (currentId) void hideNativeTab(currentId)
    setTabs(current => current.map(       (tab                              )=>({...tab,active:tab.id===id})))
    setActiveTabId(id)
    activeTabIdRef.current = id
    lastActiveAtRef.current.set(id, Date.now())
    setAddress(selected?.url ?? '')
    setReaderArticle(null)
    if (selected?.suspended ||( selected?.url && !hasNativeTab(id))) void resumeTab(selected)
  }

  function duplicateTab(tab: BrowserTab) {
    openNewTab(tab.url || undefined)
  }

  function togglePinned(id: string) {
    setTabs(current => {
      const updated = current.map(tab => tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)
      return [...updated.filter(tab => tab.pinned), ...updated.filter(tab => !tab.pinned)]
    })
  }

  function toggleMuted(id: string) {
    const target = tabsRef.current.find(tab => tab.id === id)
    if (!target) return
    const nextMuted = !target.muted
    setTabs(current => current.map(tab => tab.id === id
      ? { ...tab, muted: nextMuted, audible: nextMuted ? false : tab.audible }
      : tab))
    void setNativeMuted(id, nextMuted).catch(() => {
      setTabs(current => current.map(tab => tab.id === id ? { ...tab, muted: target.muted } : tab))
      messageApi.error(translate("\u65E0\u6CD5\u4FEE\u6539\u7F51\u9875\u97F3\u9891\u72B6\u6001"))
    })
  }

  function closeDomain(anchorId: string) {
    const targets = idsToCloseForSameDomain(tabs, anchorId)
    if (!targets.length) return
    closeTabs(targets)
  }

  function closeTabs(ids: string[]) {
    const targets = new Set(ids)
    ids.forEach(id => { void closeNativeTab(id) })
    setTabs(current => {
      const remaining = current.filter(tab => !targets.has(tab.id))
      if (!remaining.length) {
        const replacement = newTab()
        activeTabIdRef.current = replacement.id
        setActiveTabId(replacement.id)
        setAddress('')
        return [replacement]
      }
      if (targets.has(activeTabIdRef.current)) {
        const next = remaining[0]
        activeTabIdRef.current = next.id
        setActiveTabId(next.id)
        setAddress(next.url)
        return remaining.map(       (tab                                   )=>({...tab,active:tab.id===next.id}))
      }
      return remaining
    })
  }

  function tabMenu(tab: BrowserTab, index: number): MenuProps['items'] {
    const sameDomainCount = idsToCloseForSameDomain(tabs, tab.id).length
    const items: NonNullable<MenuProps['items']> = [
      { key: 'reload', label:translate("\u91CD\u65B0\u52A0\u8F7D"),disabled:!hasNativeTab(tab.id),onClick:()=>void reloadNativeTab(tab.id)},
      { key: 'duplicate', label:translate("\u590D\u5236\u6807\u7B7E\u9875"),disabled:!tab.url,onClick:()=>duplicateTab(tab)},
      { key: 'pin', label: tab.pinned ?translate("\u53D6\u6D88\u56FA\u5B9A"):translate("\u56FA\u5B9A\u6807\u7B7E\u9875"),onClick:()=>togglePinned(tab.id)},
      { key: 'archive', label:translate("\u5F52\u6863\u6807\u7B7E\u9875"),disabled:!tab.url||tab.private,onClick:()=>{void archiveTabToStore(tab)}},
      { key: 'mute', label: tab.muted ?translate("\u53D6\u6D88\u9759\u97F3\u6B64\u6807\u7B7E\u9875"):translate("\u9759\u97F3\u6B64\u6807\u7B7E\u9875"),onClick:()=>toggleMuted(tab.id)},
      { type: 'divider' },
      { key: 'close', label:translate("\u5173\u95ED\u6807\u7B7E\u9875"),disabled:tab.pinned,onClick:()=>closeTab(tab.id)},
      { key: 'close-others', label:translate("\u5173\u95ED\u5176\u4ED6\u6807\u7B7E\u9875"),disabled:tabs.length<2,onClick:()=>closeTabs(tabs.filter(item=>item.id!==tab.id&&!item.pinned).map(item=>item.id))},
      { key: 'close-right', label:translate("\u5173\u95ED\u53F3\u4FA7\u6807\u7B7E\u9875"),disabled:index===tabs.length-1,onClick:()=>closeTabs(tabs.slice(index+1).filter(item=>!item.pinned).map(item=>item.id))},
      { key: 'close-domain', label: sameDomainCount > 0 ?translate("\u5173\u95ED\u540C\u57DF\u6807\u7B7E\u9875\uFF08{value0} \u4E2A\uFF09",{value0:sameDomainCount}):translate("\u5173\u95ED\u540C\u57DF\u6807\u7B7E\u9875"),disabled:sameDomainCount===0,onClick:()=>closeDomain(tab.id)},
    ]
    if (tab.crashed) {
      items.unshift({ key: 'reopen', label:translate("\u91CD\u65B0\u6253\u5F00\u5D29\u6E83\u7684\u6807\u7B7E\u9875"),onClick:()=>void retryTab(tab.id)})
      items.splice(1, 0, { type: 'divider', key: 'crashed-divider' })
    }
    if (tab.private) {
      const insertAt = items.findIndex(item => item && 'key' in item && item.key === 'close-domain')
      const dividerAt = insertAt > 0 ? insertAt + 1 : items.length
      items.splice(dividerAt, 0, { type: 'divider', key: 'private-divider' })
      items.push({ key: 'private-info', label:translate("\u79C1\u5BC6\u7A97\u53E3\uFF1A\u4E0D\u4F1A\u5199\u5165\u5386\u53F2\u4E0E\u4F1A\u8BDD"),disabled:true})
    }
    return items
  }

  function onTabDragStart(index: number) {
    return (event: React.DragEvent) => {
      setDraggingIndex(index)
      event.dataTransfer.effectAllowed = 'move'
    }
  }
  function onTabDragOver(index: number) {
    return (event: React.DragEvent) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOverIndex !== index) setDragOverIndex(index)
    }
  }
  function onTabDrop(toIndex: number) {
    return (event: React.DragEvent) => {
      event.preventDefault()
      const from = draggingIndex
      setDraggingIndex(null)
      setDragOverIndex(null)
      if (from === null || from === toIndex) return
      setTabs(current => reorderTabs(current, from, toIndex))
    }
  }
  function onTabDragEnd() {
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  function closeTab(id: string) {
    void closeNativeTab(id)
    lastActiveAtRef.current.delete(id)
    const closing = tabs.find(tab => tab.id === id)
    const wasPrivate = isPrivateTab(closing)
    if (closing && closing.url && !wasPrivate) {
      const entry: ClosedTab = { id: closing.id, url: closing.url, title: closing.title, favicon: closing.favicon, closedAt: Date.now() }
      setClosedTabs(current => recordClosedTab(current, entry))
      void saveClosedTab(entry)
    }
    const closedIndex = tabs.findIndex(tab => tab.id === id)
    const remaining = tabs.filter(tab => tab.id !== id)
    if (!remaining.length) {
      const replacement = newTab()
      setTabs([replacement])
      setActiveTabId(replacement.id)
      activeTabIdRef.current = replacement.id
      setAddress('')
      return
    }
    if (id === activeTabIdRef.current) {
      const next = remaining[Math.min(closedIndex, remaining.length - 1)]
      setTabs(remaining.map(       (tab                                   )=>({...tab,active:tab.id===next.id})))
      setActiveTabId(next.id)
      activeTabIdRef.current = next.id
      setAddress(next.url)
      return
    }
    setTabs(remaining)
  }

  async function addCurrentAsBookmark() {
    const url = active.url
    if (!url) { messageApi.warning(translate("\u5F53\u524D\u6807\u7B7E\u9875\u6CA1\u6709\u53EF\u6536\u85CF\u7684\u7F51\u5740"));return}
    try {
      await bookmarkActions.add({
        id: crypto.randomUUID(),
        url,
        title: active.title || url,
        favicon: active.favicon ?? null,
      })
      messageApi.success(translate("\u5DF2\u52A0\u5165\u6536\u85CF\u5939"),2)
    } catch (error) {
      messageApi.error(translate("\u52A0\u5165\u6536\u85CF\u5939\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  /** Move a tab out of the tab strip and into the searchable archive. */
  async function archiveTabToStore(target: BrowserTab) {
    const entry = archivedTabFromBrowserTab(target)
    if (!entry) {
      messageApi.warning(translate("\u5F53\u524D\u9875\u9762\u65E0\u6CD5\u5F52\u6863\uFF08\u4EC5\u652F\u6301 http/https\uFF0C\u79C1\u5BC6\u6807\u7B7E\u4E0D\u5F52\u6863\uFF09"))
      return
    }
    try {
      await archiveTab(entry)
      messageApi.success(translate("\u5DF2\u5F52\u6863\uFF0C\u53EF\u5728\u77E5\u8BC6\u5E93\u300C\u5F52\u6863\u300D\u4E2D\u627E\u56DE"),2)
      closeTab(target.id)
    } catch (error) {
      messageApi.error(translate("\u5F52\u6863\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function runBulkSummary(urls: string[], kind: 'one-sentence' | 'short' | 'detailed' | 'key-points') {
    const { aiChat: sendChat } = await import('../../api')
    const { extractArticle } = await import('../../features/reader/extractArticle')
    const { buildSummaryPrompt } = await import('../../features/ai/summarize')
    const { listAIProviders } = await import('../../api')
    const providers = await listAIProviders().catch(() => [])
    const providerId = providers[0]?.id
    if (!providerId) { messageApi.error(translate("\u5C1A\u672A\u914D\u7F6E AI Provider"));return[]}
    const entries: Array<{ index: number; total: number; url: string; title: string; status: 'fetched' | 'summarised' | 'skipped' | 'failed'; documentId?: string; message?: string }> = []
    const titles: string[] = []
    const partials: string[] = []
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index]!
      try {
        const response = await fetch(url, { mode: 'cors' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const html = await response.text()
        const article = extractArticle({ url, html })
        if (!article.markdown?.trim()) {
          entries.push({ index, total: urls.length, url, title: url, status: 'skipped', message:translate("\u6B63\u6587\u4E3A\u7A7A")})
          continue
        }
        const request = buildSummaryPrompt(article.markdown, kind, article.title)
        const summaryResponse = await sendChat(providerId, request)
        const summary = summaryResponse.content
        const saved = await saveDocument({ title:translate("\u6458\u8981\uFF1A{value0}",{value0:article.title||url}),url,markdown:translate("# {value0}\n\n\u6765\u6E90\uFF1A{value1}\n\n## \u6458\u8981\n\n{value2}\n\n## \u6B63\u6587\n\n{value3}",{value0:article.title,value1:url,value2:summary,value3:article.markdown}),tags:['bulk-summary',kind]})
        entries.push({ index, total: urls.length, url, title: article.title, status: 'summarised', documentId: saved.id })
        titles.push(article.title)
        partials.push(summary)
      } catch (error) {
        entries.push({ index, total: urls.length, url, title: url, status: 'failed', message: String(error) })
      }
    }
    if (titles.length > 1) {
      try {
        const crossPrompt = {
          messages: [
            { role: 'system', content: 'You merge multiple article summaries into one coherent cross-article summary. Never invent facts. Respond in the documents\' primary language.' },
            { role: 'user', content: `Articles:\n\n${titles.map((title, i) => `## ${title}\n\n${partials[i] ?? ''}`).join('\n\n---\n\n')}\n\n---\n\nWrite a structured cross-article summary that links the topics together. Use markdown headings.` },
          ],
          temperature: 0.2,
        }
        const cross = await sendChat(providerId, crossPrompt)
        const aggregated =translate("# \u591A\u94FE\u63A5\u7EFC\u8FF0\uFF08{value0} \u6761\uFF09\n\n{value1}\n\n## \u5404\u7BC7\u6458\u8981\n\n{value2}",{value0:titles.length,value1:cross.content,value2:titles.map((title,i)=>`### ${title}\n\n${partials[i]??''}`).join('\n\n')})
        const saved = await saveDocument({ title: aggregatedTitleFor(titles), url: urls[0] ?? '', markdown: aggregated, tags: ['multi-summary', kind] })
        messageApi.success(translate("\u591A\u94FE\u63A5\u7EFC\u8FF0\u5DF2\u5B58\u5165\u77E5\u8BC6\u5E93\uFF08{value0} \u6761\uFF09",{value0:titles.length}),3)
        void saved
      } catch (error) {
        messageApi.warning(translate("\u4EA4\u53C9\u7EFC\u8FF0\u751F\u6210\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
      }
    } else if (titles.length === 1) {
      messageApi.success(translate("\u5DF2\u5B58\u5165 1 \u6761\u6458\u8981"),2)
    }
    return entries
  }

  function aggregatedTitleFor(titles: string[]) {
    return titles.length > 1 ?translate("\u591A\u94FE\u63A5\u7EFC\u8FF0\uFF08{value0} \u6761\uFF09",{value0:titles.length}):titles[0]??translate("\u591A\u94FE\u63A5\u7EFC\u8FF0")
  }

  function reopenLastClosed() {
    const result = popClosedTab(closedTabsRef.current)
    if (!result) return
    setClosedTabs(result.remaining)
    const restored = result.popped
    void deleteClosedTab(restored.id)
    const tab: BrowserTab = {
      id: crypto.randomUUID(),
      url: restored.url,
      title: restored.title ||translate("\u6B63\u5728\u52A0\u8F7D\u2026"),
      favicon: restored.favicon,
      loading: true,
      active: true,
      pinned: false,
    }
    setTabs(current => {
      const next = current.map(        (item                      )=>({...item,active:false}))
      return [...next, tab]
    })
    activeTabIdRef.current = tab.id
    setActiveTabId(tab.id)
    setAddress(restored.url)
    setReaderArticle(null)
    void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
      const nextBounds = bounds()
      if (!nextBounds) return
      try {
        await ensureNativeTab(tab.id, restored.url, nextBounds, { private: tab.private })
        if (activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined } : item))
        await enforceLiveTabLimit(tab.id)
      } catch (error) {
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
      }
    })
  }

  async function save() {
    const key = 'save-document'
    try {
      messageApi.open({ key, type: 'loading', content:translate("\u6B63\u5728\u4FDD\u5B58\u5E76\u63D0\u53D6\u2026"),duration:0})
      let article = readerArticle ?? aiArticle
      if (!article && hasNativeTab(active.id)) article = extractArticle(await captureNativePage(active.id))
      if (!article?.markdown?.trim()) throw new Error('reader_content_not_found')
      const created = await saveDocument({ title: article.title || active.title, url: active.url || 'about:blank', markdown: article.markdown, tags: ['Inbox'] })
      setStarredDocId(created.id)
      for (let attempt = 0; attempt < 30; attempt++) {
        const document = await getDocument(created.id)
        if (document.status === 'READY') { messageApi.open({ key, type: 'success', content:translate("\u5DF2\u6536\u85CF\u5E76\u5B8C\u6210\u7D22\u5F15")});return}
        if (document.status === 'FAILED') throw new Error('processing failed')
        await new Promise(resolve => window.setTimeout(resolve, 200))
      }
      messageApi.open({ key, type: 'info', content:translate("\u5DF2\u6536\u85CF\uFF0C\u540E\u53F0\u4ECD\u5728\u5904\u7406\u4E2D")})
    } catch (error) {
      const kind = classifySaveError(error)
      const contentEmpty = kind === 'reader_content_not_found'
      messageApi.open({ key, type: contentEmpty ? 'error' : 'warning', content: contentEmpty ?translate("\u65E0\u6CD5\u8BC6\u522B\u8BE5\u9875\u9762\u6B63\u6587\uFF0C\u5DF2\u53D6\u6D88\u4FDD\u5B58"):translate("\u540E\u7AEF\u79BB\u7EBF\u6216\u5904\u7406\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")})
    }
  }

  async function toggleStarCurrent() {
    const url = active.url
    if (!url) return
    const key = 'star-toggle'
    if (starredDocId) {
      try {
        await toggleStarred(starredDocId, false)
        setStarredDocId(null)
        messageApi.open({ key, type: 'success', content:translate("\u5DF2\u53D6\u6D88\u6536\u85CF"),duration:2})
      } catch {
        messageApi.open({ key, type: 'error', content:translate("\u53D6\u6D88\u6536\u85CF\u5931\u8D25"),duration:2})
      }
      return
    }
    await save()
  }

  async function openReader() {
    if (!hasNativeTab(active.id)) { messageApi.info(translate("\u8BF7\u5148\u5728\u684C\u9762\u5E94\u7528\u4E2D\u6253\u5F00\u4E00\u4E2A\u7F51\u9875"));return false}
    const key = 'reader'
    try {
      messageApi.open({ key, type: 'loading', content:translate("\u6B63\u5728\u63D0\u53D6\u6B63\u6587\u2026"),duration:0})
      const article = extractArticle(await captureNativePage(active.id))
      await hideNativeTab(active.id)
      setReaderArticle(article)
      setAiArticle(article)
      messageApi.open({ key, type: 'success', content:translate("\u5DF2\u63D0\u53D6 {value0} \u5B57\u8BCD",{value0:article.wordCount})})
      return true
    } catch {
      messageApi.open({ key, type: 'error', content:translate("\u65E0\u6CD5\u8BC6\u522B\u8BE5\u9875\u9762\u6B63\u6587")})
      return false
    }
  }

  const nativeSurfaceVisible = nativeMode
    && !(comparison && comparison.hostTabId === active.id)
    && !readerArticle
    && !active.crashed
    && !active.error

  return <div className={`browser-page${active.private ? ' browser-page--private' : ''}`}>{contextHolder}
    <TopBarPortal><div className="browser-tabs" style={{ '--tab-count': tabs.length } as CSSProperties}><Tabs type="editable-card" items={ (()=> {
          const groupDecisions = groupTabsByOrigin(tabs)
          return tabs.map((tab, index) => {
          const isDragging = draggingIndex === index
          const isDropTarget = dragOverIndex === index && draggingIndex !== null && draggingIndex !== index
          const group = groupDecisions[index]
          const groupColor = tabGroupColor(group.groupId)
          return {
            key: tab.id,
            label: <Dropdown menu={{ items: tabMenu(tab, index) }} trigger={['contextMenu']} onOpenChange={open => changeToolbarOverlay('tab-menu', open)}>
              <Tooltip title={tab.title || tab.url ||( tab.private ?translate("\u65B0\u79C1\u5BC6\u7A97\u53E3"):translate("\u65B0\u6807\u7B7E\u9875"))}mouseEnterDelay={0.6}>
              <span
                draggable
                onAuxClick={event => { if (event.button === 1 && !tab.pinned) closeTab(tab.id) }}
                onDragStart={onTabDragStart(index)}
                onDragOver={onTabDragOver(index)}
                onDrop={onTabDrop(index)}
                onDragEnd={onTabDragEnd}
                className={`browser-tab-title${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}${tab.private ? ' browser-tab-title--private' : ''}`}
              >{tab.crashed ? <WarningOutlined aria-label={translate("\u6807\u7B7E\u9875\u5D29\u6E83")}className="browser-tab-crash"/>:tab.loading?<span className="browser-tab-loading"role="status"aria-label={translate("\u6B63\u5728\u52A0\u8F7D")}/>:tab.private?<LockOutlined/>:<TabFavicon key={tab.favicon??tab.url}favicon={tab.favicon}pageUrl={tab.url}/>} {tab.muted?<Tooltip title={translate("\u5DF2\u9759\u97F3")}mouseEnterDelay={0.6}><AudioMutedOutlined aria-label={translate("\u5DF2\u9759\u97F3")}className="browser-tab-audio"/></Tooltip>:tab.audible?<Tooltip title={translate("\u6B63\u5728\u64AD\u653E\u97F3\u9891")}mouseEnterDelay={0.6}><SoundOutlined aria-label={translate("\u6B63\u5728\u64AD\u653E\u97F3\u9891")}className="browser-tab-audio"/></Tooltip>:null}<span>{tab.title}</span></span>
              </Tooltip>
            </Dropdown>,
            style: group.groupId ?( { '--tab-group-color': groupColor } as CSSProperties) : undefined,
            className: `${tab.pinned ? 'browser-tab--pinned ' : ''}${tab.suspended ? 'browser-tab--suspended' : ''}${tab.private ? ' browser-tab--private' : ''}${tab.muted ? ' browser-tab--muted' : ''}${tab.crashed ? ' browser-tab--crashed' : ''}${group.groupId ? ' browser-tab--grouped' : ''}`.trim() || undefined,
            closable: tabs.length > 1 && !tab.pinned,
          }
        })}                                                                                                                                 )()}activeKey={activeTabId}onChange={activateTab}addIcon={<Tooltip title={translate("\u65B0\u5EFA\u6807\u7B7E\u9875 (Ctrl+T)")}><PlusOutlined aria-label={translate("\u65B0\u5EFA\u6807\u7B7E\u9875")}/></Tooltip>}onEdit={(target,action)=>action==='add'?openNewTab():closeTab(String(target))}/></div></TopBarPortal>
    <div className="browser-toolbar"><Space><Button type="text" aria-label={translate("\u540E\u9000")}title={translate("\u540E\u9000 (Alt+\u2190)")}icon={<ArrowLeftOutlined/>}disabled={!nativeMode||!active.canGoBack}onClick={()=>void navigateHistory(active.id,-1)}/><Button type="text"aria-label={translate("\u524D\u8FDB")}title={translate("\u524D\u8FDB (Alt+\u2192)")}icon={<ArrowRightOutlined/>}disabled={!nativeMode||!active.canGoForward}onClick={()=>void navigateHistory(active.id,1)}/><Button type="text"aria-label={active.loading?translate("\u505C\u6B62\u52A0\u8F7D"):translate("\u91CD\u65B0\u52A0\u8F7D")}title={active.loading?translate("\u505C\u6B62\u52A0\u8F7D (Esc)"):translate("\u91CD\u65B0\u52A0\u8F7D (F5)")}icon={active.loading?<CloseOutlined/>:<ReloadOutlined/>}disabled={!nativeMode}onClick={()=>void(active.loading?stopNativeTab(active.id):reloadNativeTab(active.id))}/>{browserAppearance.toolbar.reader&&<Button type="text"icon={<BookOutlined/>}onClick={()=>void openReader()}>{translate("\u9605\u8BFB\u6A21\u5F0F")}</Button>}</Space><form onSubmit={event=>{event.preventDefault();void navigate(address)}}><AutoComplete value={address}options={addressSuggestions}onChange={setAddress}onSelect={value=>void navigate(value)}><Input ref={addressRef}prefix={<SafetyCertificateOutlined/>}suffix={<button type="button"className={`browser-star${starredDocId?' is-active':''}`}disabled={!active.url}aria-label={starredDocId?translate("\u53D6\u6D88\u6536\u85CF"):translate("\u6536\u85CF\u5F53\u524D\u9875")}title={starredDocId?translate("\u53D6\u6D88\u6536\u85CF\u5F53\u524D\u9875"):translate("\u6536\u85CF\u5F53\u524D\u9875")}onClick={event=>{event.preventDefault();event.stopPropagation();void toggleStarCurrent()}}><StarOutlined/></button>}onFocus={event=>event.currentTarget.select()}placeholder={translate("\u641C\u7D22\u6216\u8F93\u5165\u7F51\u5740")}/></AutoComplete></form>{browserAppearance.toolbar.adBlock&&<Tooltip title={adBlockerEnabled?translate("\u5E7F\u544A\u8FC7\u6EE4\u5DF2\u5F00\u542F\uFF0C\u672C\u6807\u7B7E\u5DF2\u8FC7\u6EE4 {value0} \u9879",{value0:blockedAdsByTab[active.id]??0}):translate("\u5E7F\u544A\u8FC7\u6EE4\u5DF2\u5173\u95ED")}><Tag icon={<SafetyCertificateOutlined/>}color={adBlockerEnabled?'green':'default'}>{blockedAdsByTab[active.id]??0}</Tag></Tooltip>}{browserAppearance.toolbar.ai&&<Button type={aiOpen?'primary':'text'}ghost={aiOpen}icon={<RobotOutlined/>}onClick={toggleAiAssistant}/>} {browserAppearance.toolbar.downloads&&<Popover trigger="click"placement="bottomRight"content={downloadPanel}open={toolbarOverlay==='downloads'}onOpenChange={open=>void changeToolbarOverlay('downloads',open)}><Badge size="small"count={downloads.filter(item=>item.status==='downloading').length}><Button type="text"aria-label={translate("\u4E0B\u8F7D")}icon={<DownloadOutlined/>}/></Badge></Popover>}{browserAppearance.toolbar.bookmarks&&<Popover trigger="click"placement="bottomRight"content={bookmarkBarPanel}open={toolbarOverlay==='bookmarks'}onOpenChange={open=>void changeToolbarOverlay('bookmarks',open)}><Button type="text"aria-label={translate("\u6536\u85CF\u5939")}title={translate("{value0} \u6761\u6536\u85CF (Ctrl+Shift+O)",{value0:bookmarkActions.bookmarks.length})}icon={<StarFilled style={{color:bookmarkActions.bookmarks.length?'#d49a26':undefined}}/>}/></Popover>}{browserAppearance.toolbar.resources&&<Popover trigger="click"placement="bottomRight"content={resourcePanel}open={toolbarOverlay==='resources'}onOpenChange={open=>void changeToolbarOverlay('resources',open)}><Button type="text"aria-label={translate("\u8D44\u6E90\u9762\u677F")}icon={<ThunderboltOutlined/>}title={translate("{value0} \u4E2A WebView / {value1} \u6807\u7B7E",{value0:resourceStats.liveTabs,value1:resourceStats.totalTabs})}/></Popover>}<Dropdown menu={{items:browserMenu}}trigger={['click']}open={!nativeMode&&toolbarOverlay==='menu'}onOpenChange={open=>{if(nativeMode){if(open)void setNativeToolbarMenu(active.id,true,Math.round((zoomLevels[active.id]??browserAppearance.defaultZoom)*100));return}changeToolbarOverlay('menu',open)}}><Button type="text"aria-label={translate("\u6D4F\u89C8\u5668\u83DC\u5355")}icon={<MoreOutlined/>}/></Dropdown></div>
    {active.private&&<div className="browser-private-bar"><LockOutlined/><strong>{translate("\u79C1\u5BC6\u6D4F\u89C8")}</strong><span>{translate("\u4E0D\u4F1A\u4FDD\u5B58\u5386\u53F2\u8BB0\u5F55\u3001\u5173\u95ED\u8BB0\u5F55\u4E0E\u7AD9\u70B9\u6743\u9650")}</span></div>}
    {findOpen&&<div className="browser-find"><Input autoFocus allowClear prefix={<SearchOutlined/>} value={findQuery} status={findStatus==='missing'?'error':undefined} placeholder={translate("\u5728\u9875\u9762\u4E2D\u67E5\u627E")}onChange={event=>{setFindQuery(event.target.value);setFindStatus('idle')}}onPressEnter={event=>void runFind(event.shiftKey)}/><Typography.Text type={findStatus==='missing'?'danger':'secondary'}>{findStatus==='missing'?translate("\u672A\u627E\u5230"):findStatus==='found'?translate("\u5DF2\u5B9A\u4F4D"):''}</Typography.Text><Button type="text"aria-label={translate("\u4E0A\u4E00\u4E2A\u5339\u914D\u9879")}icon={<ArrowUpOutlined/>}onClick={()=>void runFind(true)}/><Button type="text"aria-label={translate("\u4E0B\u4E00\u4E2A\u5339\u914D\u9879")}icon={<ArrowDownOutlined/>}onClick={()=>void runFind(false)}/><Button type="text"aria-label={translate("\u5173\u95ED\u67E5\u627E")}icon={<CloseOutlined/>}onClick={closeFind}/></div>}
    <PermissionPromptBar prompt={permissionPrompt} />
    <CommandPalette
      open={commandOpen}
      onClose={() => setCommandOpen(false)}
      tabs={tabs}
      activeId={activeTabId}
      history={history}
      bookmarks={bookmarkActions.bookmarks}
      onActivateTab={id => activateTab(id)}
      onCloseTab={id => closeTab(id)}
      onNavigate={url => void navigate(url)}
      onAskAi={question => {
        setAiInitialQuestion(question)
        setAiInitialMode('ask')
        setAiTranslationSource('')
        setAiOpen(true)
      }}
      onNewTab={() => openNewTab()}
      onSavePage={() => void save()}
      onBookmarkPage={() => void addCurrentAsBookmark()}
      onArchiveTab={() => void archiveTabToStore(active)}
      onToggleAi={toggleAiAssistant}
      onToggleNotes={() => setNotesOpen(value => !value)}
      onBulkSummary={() => setBulkSummaryOpen(true)}
      onSaveWorkspace={() => void saveAsWorkspace()}
    />
    <TabSearchPalette
      open={tabSearchOpen}
      tabs={tabs}
      activeId={activeTabId}
      onClose={() => setTabSearchOpen(false)}
      onPick={id => activateTab(id)}
      onCloseTab={id => closeTab(id)}
    />
    <HistorySearchPalette
      open={historySearchOpen}
      history={history}
      onClose={() => setHistorySearchOpen(false)}
      onOpen={entry => void navigate(entry.url)}
      onRemove={entry => setHistory(current => removeHistoryEntry(current, entry.url).remaining)}
      onClear={() => setHistory([])}
    />
    <BookmarkSearchPalette
      open={bookmarkPaletteOpen}
      bookmarks={bookmarkActions.bookmarks}
      onClose={() => setBookmarkPaletteOpen(false)}
      onOpen={bookmark => void navigate(bookmark.url)}
      onRemove={bookmark => void bookmarkActions.remove(bookmark.id)}
      onUpdate={(bookmark, patch) => { void bookmarkActions.update(bookmark.id, patch) }}
    />
    <BulkSummaryPalette
      open={bulkSummaryOpen}
      busy={bulkSummaryBusy}
      progress={bulkSummaryProgress}
      onClose={() => { setBulkSummaryOpen(false); setBulkSummaryProgress([]) }}
      onRun={async (urls, kind) => {
        setBulkSummaryBusy(true)
        setBulkSummaryProgress([])
        try {
          const result = await runBulkSummary(urls, kind)
          setBulkSummaryProgress(result)
          return result
        } finally {
          setBulkSummaryBusy(false)
        }
      }}
    />
    <NotesPanel
      open={notesOpen}
      notes={notes}
      onToggle={() => setNotesOpen(value => !value)}
      onRemove={id => setNotes(current => dropNoteEntry(current, id))}
      onUpdate={(id, patch) => setNotes(current => patchNoteEntry(current, id, patch))}
    />
    <Modal
      title={translate("\u4FDD\u5B58\u5DE5\u4F5C\u533A")}
      open={saveWorkspaceOpen}
      onCancel={() => setSaveWorkspaceOpen(false)}
      onOk={() => void confirmSaveWorkspace()}
      okText={translate("\u4FDD\u5B58")}
      cancelText={translate("\u53D6\u6D88")}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{translate("\u5DE5\u4F5C\u533A\u4F1A\u8BB0\u4F4F\u5F53\u524D\u6240\u6709\u6807\u7B7E\u9875\u7684 URL\u3001\u6807\u9898\u3001\u56FA\u5B9A/\u9759\u97F3\u72B6\u6001\u3002\u70B9\u51FB\u4FDD\u5B58\u540E\u53EF\u5728\u300C\u8BBE\u7F6E \u2192 \u6D4F\u89C8\u5668 \u2192 \u5DE5\u4F5C\u533A\u300D\u4E2D\u6062\u590D\u6216\u5220\u9664\u3002")}</Typography.Paragraph>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <Typography.Text strong>{translate("\u540D\u79F0")}</Typography.Text>
          <Input
            value={saveWorkspaceName}
            onChange={event => setSaveWorkspaceName(event.target.value)}
            maxLength={80}
            placeholder={translate("\u4F8B\u5982\uFF1A\u5DE5\u4F5C\u65E5\u4E0A\u5348")}
            autoFocus
          />
        </label>
        <label>
          <Typography.Text strong>{translate("\u63CF\u8FF0\uFF08\u53EF\u9009\uFF09")}</Typography.Text>
          <Input.TextArea
            value={saveWorkspaceDescription}
            onChange={event => setSaveWorkspaceDescription(event.target.value)}
            maxLength={240}
            rows={3}
            placeholder={translate("\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u7528\u6765\u505A\u4EC0\u4E48\uFF1F")}
          />
        </label>
      </div>
    </Modal>
    {certificatePrompt.prompt && <CertificateErrorBar payload={certificatePrompt.prompt} onRespond={allow => void certificatePrompt.respond(allow)} />}
    {showSafety &&(
      <div className={`browser-safety-warn browser-safety-warn--${safetyLevel}`} role="status">
        <SafetyCertificateOutlined />
        <span>
          {safetyLevel === 'dangerous' ?translate("\u5371\u9669\uFF1A"):translate("\u6CE8\u610F\uFF1A")}
          {safetyIssues.map(issue => issue.message).join(' / ')}
        </span>
      </div>)
     }
    <div className="browser-content"><div className={`web-surface${nativeSurfaceVisible ? ' web-surface--native' : ''}`} ref={surfaceRef}>{comparison && comparison.hostTabId === active.id
      ? <SearchComparisonWorkspace query={comparison.query} sources={comparison.sources} visibleIds={comparison.visibleIds} onShow={showComparisonSource} onSearch={searchAgainInComparison} onClose={closeComparison}/>
      : readerArticle
      ? <ReaderArticleView article={readerArticle}/>
      : active.crashed
        ? <BrowserErrorView tab={{...active, error:{kind:'load-failed',message:translate("\u6B64\u6807\u7B7E\u9875\u7684\u5E95\u5C42\u89C6\u56FE\u5DF2\u505C\u6B62\u54CD\u5E94\uFF0C\u53EF\u70B9\u51FB\"\u91CD\u65B0\u6253\u5F00\"\u6062\u590D\u3002")}}}onRetry={retryActive}onNewTab={openNewTab}onCopy={copyUrl}/>
        : active.error
          ? <BrowserErrorView tab={active} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl} onUnblock={active.error.kind === 'site-blocked' ? () => void unblockAndVisit(active.error?.entryId, active.url) : undefined}/>
        : nativeMode
          ? null
          : active.loading
            ? <div className="web-surface__loading"><LoadingOutlined spin/></div>
            : active.url
              ? <BrowserErrorView tab={{...active, error:{kind:'web-mode-required',message:translate("\u5F53\u524D\u73AF\u5883\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\u6B64\u7F51\u9875\u3002")}}}onRetry={retryActive}onNewTab={openNewTab}onCopy={copyUrl}/>
              : <NewTab address={address} setAddress={setAddress} navigate={navigate} onCompareSearch={startComparison}/>}</div>{aiOpen&&!nativeMode&&<AssistantPanel close={()=>setAiOpen(false)} saveToLibrary={save} currentUrl={active.url} currentTabId={active.id} readerArticle={readerArticle ?? aiArticle} pageContextPending={aiContextPending} pageContextError={aiContextError} pdfArticle={pdfArticle} pdfContextError={pdfContextError} initialQuestion={aiInitialQuestion} initialMode={aiInitialMode} translationSource={aiTranslationSource}/>}</div>
    <ContextMenu
      surfaceRef={surfaceRef}
      capabilities={{
        canGoBack: !!active.canGoBack,
        canGoForward: !!active.canGoForward,
        canPrint: nativeMode,
        canAskAi: true,
      }}
      onAction={handleContextAction}
    />
    <Modal
      open={clearSiteDataOpen}
      title={translate("\u6E05\u9664\u5171\u4EAB\u6D4F\u89C8\u6570\u636E")}
      okText={translate("\u6E05\u9664\u5E76\u91CD\u65B0\u52A0\u8F7D")}
      cancelText={translate("\u53D6\u6D88")}
      okButtonProps={{ danger: true }}
      onCancel={() => setClearSiteDataOpen(false)}
      onOk={async () => {
        try {
          await clearNativePageData(active.id)
          setClearSiteDataOpen(false)
          await reloadNativeTab(active.id)
          messageApi.success(translate("\u5DF2\u6E05\u9664 HTTP-only Cookie\u3001\u78C1\u76D8\u7F13\u5B58\u548C\u5F53\u524D\u7F51\u9875\u5B58\u50A8"))
        } catch (error) { messageApi.error(translate("\u6E05\u9664\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
      }}
    >
      <Typography.Paragraph>{translate("\u5C06\u6E05\u9664 WebView2 Profile \u4E2D\u7684\u5168\u90E8 Cookie\uFF08\u5305\u62EC HTTP-only Cookie\uFF09\u3001\u78C1\u76D8\u7F13\u5B58\u3001Cache Storage \u4E0E Service Worker\uFF0C\u5E76\u6E05\u9664\u5F53\u524D\u7F51\u9875\u7684\u672C\u5730\u5B58\u50A8\u3001\u4F1A\u8BDD\u5B58\u50A8\u548C IndexedDB\u3002")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{translate("Cookie \u4E0E\u78C1\u76D8\u7F13\u5B58\u7531\u540C\u4E00\u6D4F\u89C8\u5668 Profile \u5171\u4EAB\uFF0C\u56E0\u6B64\u5176\u4ED6\u5DF2\u6253\u5F00\u7F51\u7AD9\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u767B\u5F55\u6216\u91CD\u65B0\u52A0\u8F7D\u3002")}</Typography.Paragraph>
    </Modal>
    <Modal
      open={blockPrompt !== null}
      title={translate("\u5C01\u6740 {value0}\uFF1F",{value0:blockPrompt?.host??translate("\u6B64\u7F51\u7AD9")})}
      okText={translate("\u5C01\u6740")}
      cancelText={translate("\u53D6\u6D88")}
      okButtonProps={{ danger: true }}
      onCancel={() => setBlockPrompt(null)}
      onOk={() => void confirmBlockCurrentSite()}
    >
      <Typography.Paragraph>{translate("\u5C01\u6740\u540E\uFF0C\u547D\u4E2D\u540D\u5355\u7684\u9875\u9762\u4F1A\u5728\u53D1\u51FA\u8BF7\u6C42\u524D\u88AB\u53D6\u6D88\uFF1B\u5F00\u5173\u5F00\u542F\u65F6\uFF0C\u5176\u4ED6\u7AD9\u70B9\u5D4C\u5165\u8BE5\u7AD9\u70B9\u7684\u811A\u672C\u3001\u56FE\u7247\u4E0E iframe \u4E5F\u4F1A\u88AB\u963B\u65AD\u3002")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{translate("\u53EF\u968F\u65F6\u5728\u300C\u8BBE\u7F6E \u2192 \u9690\u79C1 \u2192 \u7F51\u7AD9\u5C01\u6740\u300D\u4E2D\u89E3\u9664\uFF0C\u6216\u4F7F\u7528\u83DC\u5355\u91CC\u7684\u300C\u89E3\u9664\u5C01\u6740\u6B64\u7F51\u7AD9\u300D\u3002")}</Typography.Paragraph>
      <Typography.Text code>{blockPrompt?.url}</Typography.Text>
    </Modal>
    <Modal
      open={passwordFillRequest !== null}
      title={translate("\u9009\u62E9\u8981\u586B\u5145\u7684\u8D26\u53F7")}
      footer={null}
      onCancel={() => setPasswordFillRequest(null)}
      destroyOnHidden
    >
      {passwordFillRequest && <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text type="secondary">{translate("\u4EC5\u5728\u4F60\u9009\u62E9\u8D26\u53F7\u540E\u624D\u4F1A\u5411\u5F53\u524D HTTPS \u9875\u9762\u586B\u5165\u5BC6\u7801\u3002")}</Typography.Text>
        <Typography.Text code>{passwordFillRequest.origin}</Typography.Text>
        {passwordFillRequest.credentials.map(credential => <Button key={credential.id} block onClick={async () => {
          const request = passwordFillRequest
          setPasswordFillRequest(null)
          try {
            await fillBrowserPassword(request.tabLabel, credential.id)
            messageApi.success(translate("\u5DF2\u586B\u5145\u8D26\u53F7 {value0}",{value0:credential.username}))
          } catch (error) { messageApi.error(translate("\u586B\u5145\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
        }}>{credential.username}</Button>)}
      </Space>}
    </Modal>
    <Modal
      open={passwordCandidate !== null}
      title={passwordCandidate?.existingId ?translate("\u66F4\u65B0\u5BC6\u7801"):translate("\u4FDD\u5B58\u5BC6\u7801")}
      okText={passwordCandidate?.existingId ?translate("\u66F4\u65B0\u7CFB\u7EDF\u5BC6\u7801\u5E93"):translate("\u4FDD\u5B58\u5230\u7CFB\u7EDF\u5BC6\u7801\u5E93")}
      cancelText={translate("\u6682\u4E0D\u4FDD\u5B58")}
      onCancel={() => setPasswordCandidate(null)}
      onOk={async () => {
        if (!passwordCandidate) return
        try {
          await saveBrowserPassword(passwordCandidate)
          setPasswordCandidate(null)
          messageApi.success(passwordCandidate.existingId ?translate("\u5BC6\u7801\u5DF2\u5B89\u5168\u66F4\u65B0"):translate("\u5BC6\u7801\u5DF2\u5B89\u5168\u4FDD\u5B58\uFF0C\u70B9\u51FB\u5BC6\u7801\u6846\u5373\u53EF\u9009\u62E9\u586B\u5145"))
        } catch (error) {
          setPasswordCandidate(null)
          messageApi.error(translate("\u4FDD\u5B58\u5BC6\u7801\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
        }
      }}
    >
      {passwordCandidate && <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text type="secondary">{translate("\u4EC5\u4E3A HTTPS \u7F51\u7AD9\u4FDD\u5B58\uFF1B\u5BC6\u7801\u6B63\u6587\u5199\u5165\u64CD\u4F5C\u7CFB\u7EDF\u51ED\u636E\u4FDD\u9669\u5E93\uFF0C\u6570\u636E\u5E93\u53EA\u4FDD\u5B58\u7F51\u7AD9\u548C\u7528\u6237\u540D\u3002")}</Typography.Text>
        <Typography.Text copyable>{passwordCandidate.origin}</Typography.Text>
        <Input value={passwordCandidate.username} onChange={event => setPasswordCandidate(current => current ? {...current, username:event.target.value} : current)} placeholder={translate("\u7528\u6237\u540D")}/>
        <Input.Password value={passwordCandidate.password} onChange={event => setPasswordCandidate(current => current ? {...current, password:event.target.value} : current)} placeholder={translate("\u5BC6\u7801")}/>
        <Button onClick={async () => {
          const password = await generateBrowserPassword(20)
          setPasswordCandidate(current => current ? {...current, password} : current)
          await navigator.clipboard.writeText(password).catch(() => undefined)
          messageApi.success(translate("\u5DF2\u751F\u6210\u5F3A\u5BC6\u7801\u5E76\u590D\u5236\uFF0C\u53EF\u7C98\u8D34\u5230\u7F51\u9875\u5BC6\u7801\u6846"))
        }}>{translate("\u751F\u6210\u5F3A\u5BC6\u7801\u5E76\u590D\u5236")}</Button>
      </Space>}
    </Modal>
    <Modal
      open={sourceView !== null}
      title={translate("\u9875\u9762\u6E90\u4EE3\u7801")}
      footer={null}
      width="min(1100px, 92vw)"
      onCancel={() => setSourceView(null)}
      destroyOnHidden
    >
      {sourceView && <><Typography.Paragraph type="secondary" copyable>{sourceView.url}</Typography.Paragraph><pre style={{maxHeight:'70vh',overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',padding:12,background:'#f6f8fa',borderRadius:8}}><code>{sourceView.html}</code></pre></>}
    </Modal>
    <Modal
      open={pendingShellOpen !== null}
      title={translate("\u6253\u5F00\u5916\u90E8\u5E94\u7528")}
      okText={translate("\u5728\u7CFB\u7EDF\u5E94\u7528\u4E2D\u6253\u5F00")}
      cancelText={translate("\u53D6\u6D88")}
      onCancel={() => setPendingShellOpen(null)}
      onOk={async () => {
        const url = pendingShellOpen
        setPendingShellOpen(null)
        if (!url) return
        try { await shellOpen(url) } catch (error) { messageApi.error(translate("\u65E0\u6CD5\u542F\u52A8\u5916\u90E8\u5E94\u7528\uFF1A{value0}",{value0:String(error)}))}
      }}
    >
      {pendingShellOpen &&  (()=> {
        const verdict = classifyShellOpenUrl(pendingShellOpen)
        return <>
            <Typography.Paragraph>{translate("\u5373\u5C06\u79BB\u5F00\u6D4F\u89C8\u5668\uFF0C\u7531")} <b>{describeScheme(verdict.scheme)}</b> {translate("\u5904\u7406\uFF1A")}</Typography.Paragraph>
            <Typography.Text code className="browser-error__url">{pendingShellOpen}</Typography.Text>
          </>
      }                      )()}
    </Modal>
  </div>
}
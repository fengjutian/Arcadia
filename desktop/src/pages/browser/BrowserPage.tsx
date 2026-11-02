import { translate } from '../../i18n'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AutoComplete, Badge, Button, Dropdown, Input, message, Modal, Popover, Select, Space, Switch, Tabs, Tag, Tooltip, Typography, UI_MODAL_OVERLAY_EVENT, type InputRef, type MenuProps } from '../../components/ui'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, AudioMutedOutlined, BookOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, CloseOutlined, CopyOutlined, DownloadOutlined, FullscreenOutlined, LoadingOutlined, MoonOutlined, MoreOutlined, PlusOutlined, PrinterOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, SoundOutlined, StarFilled, StarOutlined, StopOutlined, ThunderboltOutlined, TranslationOutlined, WarningOutlined } from '../../components/ui/icons'
import { registerToastSink } from '../../components/ui/toastSink'
import { Sparkles as RobotOutlined } from 'lucide-react'
import type { BrowserTab } from '../../types'
import { addBrowserHistory, deleteClosedTab, findDocumentByUrl, getBrowserShortcutsEnabled, getBrowserWorkspace, getDocument, listBrowserHistory, listClosedTabs, listSitePermissions, privacyCapabilityReport, privacyGetSiteSetting, privacyGetStats, privacyListBlockEvents, privacyListBlocklists, privacySetBlocklistEnabled, privacySetSiteSetting, purgeReadingSnapshots, recordReadingActivity, saveBrowserWorkspace, saveClosedTab, saveDocument, saveReadingSnapshot, setSession, toggleStarred, archiveTab, addToReadingQueue, saveClip, listReadingQueue, removeFromReadingQueue, addToCollection, listCollections } from '../../api'
import { captureNativePage, captureNativeScreenshot, clearNativePageData, closeNativePageToast, closeNativeTab, editNativePage, ensureNativeTab, fillBrowserPassword, findInNativeTab, generateBrowserPassword, hasNativeTab, hideNativeTab, injectSiteCss, isNativeBrowserAvailable, isNativeTabSuspended, listBrowserPasswords, navigateHistory, onNativeAdBlockUpdate, onNativeAudioState, onNativeNewTab, onNativeProcessFailed, onNativeSiteBlocked, onNativeToolbarMenuAction, onPasswordCandidate, onPasswordFillRequest, openNativeDevtools, openNativeTab, printNativeTab, readNativeState, reloadNativeTab, resizeNativeTab, resumeNativeTab, saveBrowserPassword, scanNativeResources, setNativeAdBlocking, setNativeMuted, setNativeToolbarMenu, setNativeToolbarPanel, showNativePageToast, showNativeTab, stopNativeTab, suspendNativeTab, zoomNativeTab, type PasswordCandidate, type SavedCredential } from '../../services/nativeBrowser'
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
import { planAutoArchive } from '../../features/archive/autoArchive'
import { idleMsFor, readAutoArchiveSettings } from '../../features/archive/archiveSettings'
import { readingQueueEntryFromTab } from '../../features/reading-queue/readingQueue'
import { normalizeSleepHost, readSleepExceptions, toggleSleepException, writeSleepExceptions, isSleepExcluded } from '../../features/browser/sleepSettings'
import { isAutoReaderSite, normalizeReaderHost, readReaderSites, toggleReaderSite, writeReaderSites, READER_FONT_SIZES, READER_WIDTHS, READER_THEMES, clampReaderFontSize, clampReaderWidth, readerStyleFor, writeReaderSiteStyle, normalizeHideSelectors, liveHideCssFor } from '../../features/browser/siteReaderPrefs'
import { matchSiteRoute, readSiteRoutes, upsertSiteRoute, writeSiteRoutes, type SiteRoute } from '../../features/browser/siteRoutes'
import { emitLittleArcResult, listenLittleArcCapture, listenLittleArcOpenMain, openLittleArc } from '../../features/littlearc/littleArc'
import { clipFromImage, clipFromLink, clipFromPage, clipFromSelection } from '../../features/clips/clips'
import { scheduleExtrasSync } from '../../features/search/extrasSync'
import { AssistantPanel } from '../../features/ai/AssistantPanel'
import { closeFloatingAssistant, FLOATING_ASSISTANT_CLOSED_EVENT, FLOATING_ASSISTANT_SAVE_EVENT, openFloatingAssistant } from '../../features/ai/floatingAssistant'
import { listen } from '@tauri-apps/api/event'
import { renderSearchTemplate, resolveNavigationInput } from '../../features/browser/navigation'
import { useDownloads } from '../../features/downloads/useDownloads'
import { useDownloadQueue } from '../../features/downloads/useDownloadQueue'
import { saveWorkspace, snapshotTabsToPayload, getWorkspace, listWorkspaces, type WorkspaceRecord } from '../../services/workspaces'
import { restoreTabsFromWorkspace } from '../../features/browser/restoreWorkspace'
import { WORKSPACE_RESTORE_EVENT } from '../../features/browser/workspaces'
import { SPACE_CHANGED_EVENT, SPACE_MENU_ACTION_EVENT, SPACE_MENU_FALLBACK_EVENT, SPACE_MENU_OPEN_EVENT, SPACE_RESTORE_EVENT, SPACE_SAVE_EVENT, SPACE_SURFACE_EVENT, autoSpaceName, autoSavedSnapshotId, dispatchSpaceRestore, readCurrentSpace, rememberAutoSavedSnapshot, tabSnapshotSignature, writeCurrentSpace } from '../../features/browser/spaces'
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
import { CommandPalette } from '../../features/command/CommandPalette'
import { useBookmarks } from '../../features/bookmarks/useBookmarks'
import { BulkSummaryPalette } from '../../features/ai/BulkSummaryPalette'
import type { BulkProgressEntry } from '../../features/ai/bulkSummary'
import { NotesPanel } from '../../features/notes/NotesPanel'
import type { NoteEntry } from '../../features/notes/notes'
import { loadPageNotes, persistPageNote, removePageNote } from '../../features/notes/noteStore'
import { isPrivateTab, makePrivateTab, stripPrivateTabs } from '../../features/browser/privateTabs'
import { readSitePermissions, writeSitePermissions, normalizeOrigin, setKind, type SitePermissionKind, type SitePermissionValue } from '../../features/browser/sitePermissions'
import { SitePanel } from '../../features/browser/SitePanel'
import { SiteRulesDialog } from '../../features/browser/SiteRulesDialog'
import { DocumentSplitPane } from '../../features/documents/DocumentSplitPane'
import { DocumentPairView } from '../../features/documents/DocumentPairView'
import { listDocuments } from '../../api'
import type { Document as KnowledgeDocument } from '../../types'
import { SPLIT_MIN_WIDTH, splitBounds } from '../../features/browser/splitView'
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
import { AD_BLOCKER_EVENT, isAdBlockerEnabled, setAdBlockerEnabled } from '../../features/plugins/adBlocker'
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
type ToolbarOverlay = 'downloads' | 'bookmarks' | 'resources' | 'menu' | 'tab-menu' | 'space'

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

export function BrowserPage({ visible = true, onSearchKnowledge, onOpenLibrary }: { visible?: boolean; onSearchKnowledge?: (query: string) => void; onOpenLibrary?: () => void }) {
  const [tabs, setTabs] = useState<BrowserTab[]>([newTab('new')])
  const [activeTabId, setActiveTabId] = useState('new')
  const [address, setAddress] = useState('')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiInitialQuestion, setAiInitialQuestion] = useState('')
  const [aiInitialMode, setAiInitialMode] = useState<'summarize'|'ask'|'translate'|undefined>()
  const [aiTranslationSource, setAiTranslationSource] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [pendingShellOpen, setPendingShellOpen] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [sleepExceptions, setSleepExceptions] = useState<string[]>(readSleepExceptions)
  const sleepExceptionsRef = useRef<string[]>(sleepExceptions)
  const [readerSites, setReaderSites] = useState<string[]>(readReaderSites)
  const readerSitesRef = useRef<string[]>(readerSites)
  const [siteRoutes, setSiteRoutes] = useState<SiteRoute[]>(readSiteRoutes)
  const siteRoutesRef = useRef<SiteRoute[]>(siteRoutes)
  const [routeCollections, setRouteCollections] = useState<Array<{ id: string; name: string }>>([])
  const [spaceOptions, setSpaceOptions] = useState<Array<{ id: string; name: string }>>([])
  const [dismissedSpaceRoute, setDismissedSpaceRoute] = useState('')
  const autoReaderAttemptsRef = useRef<Set<string>>(new Set())
  const [privacyCap, setPrivacyCap] = useState<Awaited<ReturnType<typeof privacyCapabilityReport>> | null>(null)
  const [privacyStats, setPrivacyStats] = useState<Awaited<ReturnType<typeof privacyGetStats>>>({ blocked: 0, allowed: 0, dropped: 0 })
  const [blockEvents, setBlockEvents] = useState<Awaited<ReturnType<typeof privacyListBlockEvents>>>([])
  const [mediaResources, setMediaResources] = useState<MediaResourceCandidate[]>([])
  const [resourceScanBusy, setResourceScanBusy] = useState(false)
  const [bulkSummaryOpen, setBulkSummaryOpen] = useState(false)
  const [bulkSummaryBusy, setBulkSummaryBusy] = useState(false)
  const [bulkSummaryProgress, setBulkSummaryProgress] = useState<BulkProgressEntry[]>([])
  const [notes, setNotes] = useState<NoteEntry[]>([])
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
      if (entry.status === 'completed') messageApi.success(translate("下载完成"))
      else if (entry.status === 'failed') messageApi.error(translate("下载失败"))
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
  const autoArchiveCheckedRef = useRef(false)
  const lastHistoryUrl = useRef<string>('')
  const shortcutsEnabledRef = useRef(getBrowserShortcutsEnabled())
  const readingSecondsRef = useRef(new Map<string, number>())
  const snapshotAttemptedRef = useRef(new Set<string>())
  const lastAdBlockCountRef = useRef<Record<string, number>>({})
  const lruSweepRunningRef = useRef(false)
  const floatingAssistantOpenedRef = useRef(false)
  const active = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const [readerStyleVersion, setReaderStyleVersion] = useState(0)
  const readerSiteStyle = useMemo(() => readerStyleFor(active.url), [active.url, readerArticle, readerStyleVersion])
  const [permissionVersion, setPermissionVersion] = useState(0)
  const [sitePanelOpen, setSitePanelOpen] = useState(false)
  const [siteRulesOpen, setSiteRulesOpen] = useState(false)
  const [splitTabId, setSplitTabId] = useState<string | null>(null)
  const splitTabIdRef = useRef<string | null>(null)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [splitDocument, setSplitDocument] = useState<KnowledgeDocument | null>(null)
  const [splitChat, setSplitChat] = useState(false)
  const [documentPickerOpen, setDocumentPickerOpen] = useState(false)
  const [documentPickerMode, setDocumentPickerMode] = useState<'split' | 'pair'>('split')
  const [pairSelection, setPairSelection] = useState<string[]>([])
  const [docPair, setDocPair] = useState<{ left: KnowledgeDocument; right: KnowledgeDocument } | null>(null)
  const [pickerDocuments, setPickerDocuments] = useState<KnowledgeDocument[]>([])
  const [pickerQuery, setPickerQuery] = useState('')
  const [hideEditorOpen, setHideEditorOpen] = useState(false)
  const [hideDraft, setHideDraft] = useState('')
  const [hideLiveDraft, setHideLiveDraft] = useState(false)
  const [renameTabId, setRenameTabId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [depositPulse, setDepositPulse] = useState(false)

  useEffect(() => {
    if (!documentPickerOpen) return
    let disposed = false
    void listDocuments()
      .then(items => { if (!disposed) setPickerDocuments(items.filter(item => item.status !== 'ARCHIVED')) })
      .catch(() => { if (!disposed) setPickerDocuments([]) })
    return () => { disposed = true }
  }, [documentPickerOpen])

  useEffect(() => {
    if (!isNativeBrowserAvailable() || (!splitDocument && !splitChat)) return
    const apply = () => {
      const rect = bounds()
      if (!rect) return
      const panes = splitBounds(rect, splitRatio, 8)
      if (!panes) return
      void resizeNativeTab(active.id, panes.left).catch(() => undefined)
      void showNativeTab(active.id).catch(() => undefined)
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    if (observer && surfaceRef.current) observer.observe(surfaceRef.current)
    window.addEventListener('resize', apply)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitDocument, splitChat, active.id, splitRatio])

  function closeDocumentSplit() {
    setSplitDocument(null)
    setSplitChat(false)
    const rect = bounds()
    if (rect) void resizeNativeTab(active.id, rect).catch(() => undefined)
  }

  function closeDocPair() {
    setDocPair(null)
    void showNativeTab(active.id).catch(() => undefined)
  }

  function startSplitDrag(event: { preventDefault: () => void; clientX: number }) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      setSplitRatio(Math.min(0.7, Math.max(0.3, (moveEvent.clientX - rect.left) / rect.width)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const siteOrigin = useMemo(() => normalizeOrigin(active.url || ''), [active.url])
  const siteRule = useMemo(
    () => (siteOrigin ? readSitePermissions().find(rule => rule.origin === siteOrigin) ?? null : null),
    // `permissionVersion` re-reads storage after an inline permission change.
    [siteOrigin, permissionVersion],
  )
  const activeSiteRoute = useMemo(() => matchSiteRoute(siteRoutes, active.url), [siteRoutes, active.url])
  const nativeMode = hasNativeTab(active.id)
  // A live native page covers the content area and paints above the host
  // document; the shell needs to know so its Space menu is drawn in-page.
  const nativePageOnScreen = nativeMode
    && visible
    && !(comparison && comparison.hostTabId === active.id)
    && !readerArticle
    && !active.crashed
    && !active.error

  useEffect(() => {
    // `data-native-surface` lets the shell sync on mount even if it subscribes
    // after this effect has already run.
    document.body.dataset.nativeSurface = nativePageOnScreen ? '1' : '0'
    window.dispatchEvent(new CustomEvent(SPACE_SURFACE_EVENT, { detail: nativePageOnScreen }))
  }, [nativePageOnScreen])
  useEffect(() => () => {
    document.body.dataset.nativeSurface = '0'
    window.dispatchEvent(new CustomEvent(SPACE_SURFACE_EVENT, { detail: false }))
  }, [])

  // The shell asks for the Space menu; draw it inside the page so the page
  // stays visible and interactive underneath (a host menu would be cut in half
  // by the native WebView).
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ rows?: unknown[]; x?: number; y?: number; theme?: string }>).detail
      if (!detail) return
      if (!nativePageOnScreen) {
        window.dispatchEvent(new CustomEvent(SPACE_MENU_FALLBACK_EVENT))
        return
      }
      if (toolbarOverlay === 'space') {
        setToolbarOverlay(null)
        void setNativeToolbarPanel(active.id, false, 'space', {})
        return
      }
      const surface = surfaceRef.current?.getBoundingClientRect()
      const x = Math.max(8, (detail.x ?? 0) - (surface?.left ?? 0))
      const y = Math.max(8, (detail.y ?? 0) - (surface?.top ?? 0))
      setToolbarOverlay('space')
      void setNativeToolbarPanel(active.id, true, 'space', {
        items: detail.rows ?? [],
        x,
        y,
        theme: detail.theme === 'dark' ? 'dark' : 'light',
      }).catch(error => {
        diagnosticLog('browser.space-menu.open-failed', 'error', { tabId: active.id, error })
        setToolbarOverlay(null)
        window.dispatchEvent(new CustomEvent(SPACE_MENU_FALLBACK_EVENT))
      })
    }
    window.addEventListener(SPACE_MENU_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(SPACE_MENU_OPEN_EVENT, onOpen)
  }, [active.id, nativePageOnScreen, toolbarOverlay])

  useEffect(() => {
    setPasswordCandidate(null)
    setPasswordFillRequest(null)
    setMediaResources([])
    // An in-page Space menu dies with the document on navigation; drop the
    // overlay state too so the next click opens instead of toggling nothing.
    setToolbarOverlay(current => current === 'space' ? null : current)
  }, [active.id, active.url])

  // Leaving browser mode (or losing the native page) hides the page but leaves
  // the injected menu in the document; close it so it is gone on return.
  useEffect(() => {
    if (nativePageOnScreen || toolbarOverlay !== 'space') return
    setToolbarOverlay(null)
    if (hasNativeTab(active.id)) void setNativeToolbarPanel(active.id, false, 'space', {})
  }, [active.id, nativePageOnScreen, toolbarOverlay])

  // A click anywhere in the host chrome is outside the page, so the in-page
  // menu never sees it. Dismiss on those clicks, except on the rail button
  // itself, which toggles the menu through its own handler.
  useEffect(() => {
    if (toolbarOverlay !== 'space') return
    const onHostPointerDown = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.space-switch')) return
      setToolbarOverlay(null)
      if (hasNativeTab(active.id)) void setNativeToolbarPanel(active.id, false, 'space', {})
    }
    document.addEventListener('pointerdown', onHostPointerDown, true)
    return () => document.removeEventListener('pointerdown', onHostPointerDown, true)
  }, [active.id, toolbarOverlay])

  async function scanCurrentResources() {
    if (!hasNativeTab(active.id)) { messageApi.info(translate("资源探测需要桌面浏览器标签页"));return}
    setResourceScanBusy(true)
    try {
      const found = normalizeMediaResources(await scanNativeResources(active.id))
      setMediaResources(found)
      messageApi.info(found.length ?translate("发现 {value0} 个媒体或文档资源",{value0:found.length}):translate("当前页面暂未发现可下载资源"))
    } catch (error) { messageApi.error(translate("资源扫描失败：{value0}",{value0:String(error)}))}
    finally { setResourceScanBusy(false) }
  }

  async function downloadMediaResource(resource: MediaResourceCandidate) {
    try {
      await startDownload({ id: crypto.randomUUID(), url: resource.url, fileName: resource.fileName,
        dangerType: classifyDownload({ fileName: resource.fileName }),
        sourceOrigin: new URL(active.url || resource.url).origin, sourceTabLabel: active.id })
      messageApi.success(translate("资源已加入下载队列"))
    } catch (error) { messageApi.error(translate("下载失败：{value0}",{value0:String(error)}))}
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
        if (!cancelled) setAiContextError(translate("无法提取正文"))
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
    // Host overlays (tab menu, legacy toolbar menu, selects, dialogs) cannot
    // paint over the native page, so it has to be hidden while they are open.
    // The Space menu is not here: it is drawn inside the page by Rust.
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
              message:translate("该网站已被封杀（{value0}）",{value0:payload.ruleHost}),
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
                ?translate("页面渲染进程无响应，可点击\u201C重新打开\u201D恢复。")
                :translate("页面渲染进程已退出，可点击\u201C重新打开\u201D恢复。"),
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
                setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: { kind: 'web-mode-required', message:translate("网页浏览仅在 Tauri 桌面应用中可用。")}}:item))
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
          ?translate("{value0}\n\n> PDF 文本较长，AI 上下文已截断。",{value0:result.text})
          : result.text
        setPdfArticle({
          title: result.title,
          byline: '',
          excerpt: result.text.slice(0, 240),
          siteName:translate("本地 PDF"),
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
  // One startup sweep: tabs untouched for AUTO_ARCHIVE_IDLE_MS leave the strip
  // and become searchable archive entries instead of silently disappearing.
  useEffect(() => {
    if (!hydrated || autoArchiveCheckedRef.current) return
    autoArchiveCheckedRef.current = true
    if (!isNativeBrowserAvailable()) return
    const settings = readAutoArchiveSettings()
    if (!settings.enabled) return
    const dueIds = planAutoArchive(tabsRef.current, activeTabIdRef.current, Date.now(), idleMsFor(settings))
    if (dueIds.length === 0) return
    void (async () => {
      let archived = 0
      for (const id of dueIds) {
        const target = tabsRef.current.find(tab => tab.id === id)
        if (!target) continue
        const entry = archivedTabFromBrowserTab(target, 'auto')
        if (!entry) continue
        try {
          await archiveTab(entry, settings.retention)
          archived += 1
          closeTab(id)
        } catch { /* keep the tab when the archive write fails */ }
      }
      if (archived > 0) {
        messageApi.info(translate("已自动归档 {value0} 个空闲标签，可在知识库「归档」中找回", { value0: archived }), 5)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])
  useEffect(() => {
    let disposed = false
    void loadPageNotes()
      .then(items => { if (!disposed) setNotes(items) })
      .catch(() => { /* notes stay usable in memory if the store is unavailable */ })
    return () => { disposed = true }
  }, [])
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
    let disposed = false
    let unlistenCapture: (() => void) | undefined
    let unlistenOpenMain: (() => void) | undefined
    void listenLittleArcCapture(request => { if (!disposed) void captureUrlInLittleArc(request) }).then(stop => { if (disposed) stop(); else unlistenCapture = stop })
    void listenLittleArcOpenMain(url => { if (!disposed && url) openNewTab(url) }).then(stop => { if (disposed) stop(); else unlistenOpenMain = stop })
    return () => { disposed = true; unlistenCapture?.(); unlistenOpenMain?.() }
    // Capture helpers read tabs/routes through refs, so one subscription is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  function openSplit(id: string) {
    const rect = bounds()
    if (rect && rect.width < SPLIT_MIN_WIDTH) {
      messageApi.warning(translate("窗口太窄，无法并排显示"))
      return
    }
    setSplitTabId(id)
  }

  function closeSplit() {
    const id = splitTabId
    setSplitTabId(null)
    if (id) void hideNativeTab(id).catch(() => undefined)
    const rect = bounds()
    if (rect) void resizeNativeTab(active.id, rect).catch(() => undefined)
  }

  useEffect(() => { splitTabIdRef.current = splitTabId }, [splitTabId])

  useEffect(() => {
    if (!nativeMode || !splitTabId) return
    if (!tabsRef.current.some(tab => tab.id === splitTabId)) {
      setSplitTabId(null)
      return
    }
    if (active.id === splitTabId) {
      setSplitTabId(null)
      return
    }
    const apply = () => {
      const rect = bounds()
      if (!rect) return
      const panes = splitBounds(rect, splitRatio, 8)
      if (!panes) return
      void resizeNativeTab(active.id, panes.left).catch(() => undefined)
      // Leave a 30px DOM strip above the right pane for its title/close chrome.
      void resizeNativeTab(splitTabId, { ...panes.right, y: panes.right.y + 30, height: Math.max(120, panes.right.height - 30) }).catch(() => undefined)
      void showNativeTab(active.id).catch(() => undefined)
      void showNativeTab(splitTabId).catch(() => undefined)
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    if (observer && surfaceRef.current) observer.observe(surfaceRef.current)
    window.addEventListener('resize', apply)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeMode, splitTabId, active.id, tabs.length, splitRatio])

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
    if (includeAi) sources.push({ id: `compare-${crypto.randomUUID()}`, kind: 'ai', label:translate("AI 搜索")})
    if (includeKnowledge) sources.push({ id: `compare-${crypto.randomUUID()}`, kind: 'knowledge', label:translate("本地知识库")})
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
        if (!blocked) return { ...tab, ...patch, ...(tab.titleLocked ? { title: tab.title } : {}), crashed: false }
        return {
          ...tab,
          ...patch,
          crashed: false,
          loading: false,
          error: {
            kind: 'site-blocked',
            message:translate("该网站已被封杀（{value0}）",{value0:blocked.host}),
            host: hostFromUrl(patch.url ?? '') ?? blocked.host,
            ruleHost: blocked.host,
            entryId: blocked.id,
          },
        }
      }))
      if (typeof patch.url === 'string') setAddress(patch.url)
      // Site-level Reader preference: open Reader once per URL after the page
      // finishes loading, never for private tabs and never twice.
      if (typeof patch.url === 'string' && patch.loading === false && !patch.error
        && !readerArticle && !autoReaderAttemptsRef.current.has(patch.url)
        && (matchSiteRoute(siteRoutesRef.current, patch.url)?.autoReader || isAutoReaderSite(patch.url, readerSitesRef.current))) {
        autoReaderAttemptsRef.current.add(patch.url)
        void openReader()
      }
      // Local-only site CSS (user-authored) applied after each load.
      if (typeof patch.url === 'string' && patch.loading === false && !patch.error) {
        const css = liveHideCssFor(readerStyleFor(patch.url))
        if (css) void injectSiteCss(active.id, css).catch(() => undefined)
      }
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
      if ((event.ctrlKey || event.metaKey) && event.altKey && splitTabIdRef.current && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const left = activeTabIdRef.current
        const right = splitTabIdRef.current
        activateTab(right)
        setSplitTabId(left)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        const current = tabsRef.current.find(tab => tab.id === activeTabIdRef.current)
        void openLittleArc(/^https?:/i.test(current?.url ?? '') ? current!.url : '')
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
        messageApi.error(translate("工作区不存在或已删除"))
        return
      }
      await applyWorkspaceRestore(workspace)
    }
    async function restoreSpace(id: string) {
      // Already in this Space: restoring the same snapshot would only close and
      // reopen the same tabs, and it used to add an empty auto-save row.
      if (readCurrentSpace()?.id === id) return
      const workspace = await getWorkspace(id)
      if (!workspace) {
        messageApi.error(translate("工作区不存在或已删除"))
        return
      }
      const current = tabsRef.current.filter(tab => !tab.private && tab.url)
      const payload = snapshotTabsToPayload(current)
      const signature = tabSnapshotSignature(payload)
      // Never store the same tab set twice: this is what filled the Space menu
      // with rows like "自动保存 11-02 16:16" repeated a dozen times. The index
      // is only trusted while the workspace it points at still exists, so
      // deleting an auto-save in Settings re-arms the safety snapshot.
      const knownId = autoSavedSnapshotId(signature)
      let alreadySaved = false
      if (knownId) {
        try {
          alreadySaved = (await listWorkspaces()).some(item => item.id === knownId)
        } catch {
          alreadySaved = false
        }
      }
      if (current.length > 0 && !alreadySaved) {
        try {
          const saved = await saveWorkspace({
            name: autoSpaceName(new Date()),
            description: translate("切换 Space 前自动保存"),
            payload,
          })
          rememberAutoSavedSnapshot(signature, saved.id)
        } catch (error) {
          messageApi.warning(translate("自动保存当前标签失败：{value0}", { value0: String(error) }))
        }
      }
      await applyWorkspaceRestore(workspace)
      writeCurrentSpace({ id: workspace.id, name: workspace.name })
      window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { id: workspace.id, name: workspace.name } }))
    }
    function onRestoreSpace(event: Event) {
      const detail = (event as CustomEvent<{ id: string }>).detail
      if (detail?.id) void restoreSpace(detail.id)
    }
    function onSaveSpace() {
      openSaveWorkspaceDialog()
    }
    window.addEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
    window.addEventListener(SPACE_RESTORE_EVENT, onRestoreSpace)
    window.addEventListener(SPACE_SAVE_EVENT, onSaveSpace)
    return () => {
      window.removeEventListener(WORKSPACE_RESTORE_EVENT, onRestoreWorkspace)
      window.removeEventListener(SPACE_RESTORE_EVENT, onRestoreSpace)
      window.removeEventListener(SPACE_SAVE_EVENT, onSaveSpace)
    }
  }, [])

  function onShortcutsChange(event: Event) {
    const detail = (event as CustomEvent<{ enabled: boolean }>).detail
    shortcutsEnabledRef.current = detail.enabled !== false
  }

  function requestBlockCurrentSite() {
    const url = active.url
    const host = hostFromUrl(url)
    if (!url || !host) {
      messageApi.info(translate("当前页面没有可封杀的网站"))
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
              message:translate("该网站已被封杀（{value0}）",{value0:entry.host}),
              host: prompt.host,
              ruleHost: entry.host,
              entryId: entry.id,
            },
          }
        : tab))
      // The page is now blacklisted: close its WebView so no background work
      // or audio survives the block. Reopening happens via `openNativeTab`.
      void closeNativeTab(tabId)
      messageApi.success(translate("已封杀 {value0}，可在「设置 \u2192 隐私 \u2192 网站封杀」中管理",{value0:entry.host}))
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
      messageApi.error(translate("解除封杀失败：{value0}",{value0:String(error)}))
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
      messageApi.info(translate("网页预览模式下已使用系统浏览器打开"))
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
        setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, loading: false, error: { kind: 'web-mode-required', message:translate("网页浏览仅在 Tauri 桌面应用中可用。")}}:tab))
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
        excludedHosts: new Set(sleepExceptionsRef.current),
      })
      for (const id of plan.toClose) {
        try {
          const state = await readNativeState(id)
          if (state) setTabs(current => current.map(item => item.id === id ? { ...item, scrollX: Math.round(state.scrollX), scrollY: Math.round(state.scrollY) } : item))
        } catch { /* retain the last observed position */ }
        const retained = await suspendNativeTab(id).catch(() => false)
        if (!retained) await closeNativeTab(id)
        setTabs(current => current.map(item => item.id === id ? { ...item, suspended: true, suspendedReason: 'lru', loading: false } : item))
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
    const wasSuspended = Boolean(tab.suspended)
    const nextBounds = bounds()
    if (!nextBounds) return
    if (hasNativeTab(tab.id) && isNativeTabSuspended(tab.id)) {
      const resumed = await resumeNativeTab(tab.id).catch(() => false)
      if (resumed) {
        await resizeNativeTab(tab.id, nextBounds)
        if (visibleRef.current && activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
        setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, suspendedReason: undefined, loading: false, error: undefined } : item))
        if (wasSuspended) messageApi.info(translate("已唤醒，滚动位置已恢复"), 2)
        await enforceLiveTabLimit(tab.id)
        return
      }
      await closeNativeTab(tab.id)
    } else if (hasNativeTab(tab.id)) {
      return
    }
    setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, suspendedReason: undefined, loading: true, error: undefined } : item))
    try {
      tabRuntime.enqueueScroll(tab.id, { x: tab.scrollX ?? 0, y: tab.scrollY ?? 0 })
      const opened = await ensureNativeTab(tab.id, tab.url, nextBounds, { private: tab.private })
      if (!opened) throw new Error(translate("网页浏览仅在 Tauri 桌面应用中可用。"))
      if (visibleRef.current && activeTabIdRef.current === tab.id) await showNativeTab(tab.id)
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: false, suspendedReason: undefined, error: undefined } : item))
      if (wasSuspended) messageApi.info(translate("已唤醒，滚动位置已恢复"), 2)
      await enforceLiveTabLimit(tab.id)
    } catch (error) {
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
    }
  }

  function updateSleepExceptions(next: string[]) {
    sleepExceptionsRef.current = next
    setSleepExceptions(next)
    writeSleepExceptions(next)
  }

  function updateReaderSites(next: string[]) {
    readerSitesRef.current = next
    setReaderSites(next)
    writeReaderSites(next)
  }

  function updateSiteRoutes(next: SiteRoute[]) {
    siteRoutesRef.current = next
    setSiteRoutes(next)
    writeSiteRoutes(next)
  }

  function changeSitePermission(kind: SitePermissionKind, value: SitePermissionValue) {
    if (!siteOrigin) return
    writeSitePermissions(setKind(siteOrigin, kind, value))
    setPermissionVersion(version => version + 1)
  }

  /** Explicit "sleep this tab now": keep the record, release the WebView. */
  async function suspendTabNow(tab: BrowserTab) {
    if (!hasNativeTab(tab.id) || isNativeTabSuspended(tab.id)) return
    try {
      const state = await readNativeState(tab.id).catch(() => null)
      if (state) {
        setTabs(current => current.map(item => item.id === tab.id
          ? { ...item, scrollX: Math.round(state.scrollX), scrollY: Math.round(state.scrollY) }
          : item))
      }
      const retained = await suspendNativeTab(tab.id).catch(() => false)
      if (!retained) await closeNativeTab(tab.id)
      setTabs(current => current.map(item => item.id === tab.id ? { ...item, suspended: true, suspendedReason: 'manual', loading: false } : item))
      messageApi.info(retained
        ? translate("标签页已休眠，点击可恢复")
        : translate("当前平台不支持挂起，已释放该标签页，点击时会重新加载"), 3)
    } catch (error) {
      messageApi.error(translate("休眠失败：{value0}", { value0: String(error) }))
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
      messageApi.error(translate("切换全屏失败"))
    }
  }
  function runBrowserMenuAction(action: string) {
    diagnosticLog('browser.menu.action', 'info', { action, tabId: active.id, url: redactUrl(active.url) })
    switch (action) {
      case 'find': setFindOpen(true); break
      case 'tab-search': setCommandOpen(true); break
      case 'history-search': setCommandOpen(true); break
      case 'bookmark-add': void addCurrentAsBookmark(); break
      case 'bookmarks': onOpenLibrary?.(); break
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
      const fileName = `${safeFileName(active.title ||translate("网页"))}-${clip?translate("选区"):fullPage?translate("整页"):translate("可视区域")}.png`
      link.download = fileName
      document.body.appendChild(link); link.click(); link.remove()
      diagnosticLog('browser.screenshot.completed', 'info', { tabId: active.id, fullPage, clipped: Boolean(clip), encodedBytes: data.length })
      messageApi.success(translate("截图已保存到系统下载文件夹：{value0}",{value0:fileName}),5)
    } catch (error) {
      diagnosticLog('browser.screenshot.failed', 'error', { tabId: active.id, fullPage, clipped: Boolean(clip), error })
      messageApi.error(translate("截图失败：{value0}",{value0:String(error)}))
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
      else if (action.startsWith('space:')) {
        // The in-page Space menu was drawn by Rust; the shell owns what each
        // row means, so hand the key back instead of interpreting it here.
        window.dispatchEvent(new CustomEvent(SPACE_MENU_ACTION_EVENT, { detail: { key: action.slice('space:'.length) } }))
      }
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

  const browserMenu: MenuProps['items'] = (() => {
    const activeRoute = matchSiteRoute(siteRoutes, active.url)
    return ([
    { key: 'find', label:translate("在页面中查找"),extra:'Ctrl+F',onClick:()=>runBrowserMenuAction('find')},
    { key: 'reader-auto', label: isAutoReaderSite(active.url, readerSites) ? translate("取消此站点自动阅读") : translate("此站点自动进入阅读模式"), disabled: !normalizeReaderHost(active.url), onClick: () => updateReaderSites(toggleReaderSite(readerSites, active.url)) },
    { key: 'site-route', label: translate("此站点保存到集合"), disabled: !normalizeReaderHost(active.url), children: [
      { key: 'site-route:none', label: `${translate("不自动归入")}${activeRoute?.collectionId ? '' : ' ✓'}`, onClick: () => updateSiteRoutes(upsertSiteRoute(siteRoutes, active.url, { collectionId: null })) },
      ...routeCollections.map(collection => ({ key: `site-route:${collection.id}`, label: `${collection.name}${activeRoute?.collectionId === collection.id ? ' ✓' : ''}`, onClick: () => updateSiteRoutes(upsertSiteRoute(siteRoutes, active.url, { collectionId: collection.id })) })),
    ] },
    { key: 'tab-search', label:translate("命令栏"),extra:'Ctrl+K',onClick:()=>runBrowserMenuAction('tab-search')},
    { key: 'little-arc', label: translate("随手收（小窗，Ctrl+Shift+L）"), onClick: () => { void openLittleArc(/^https?:/i.test(active.url) ? active.url : '') } },
    { key: 'history-search', label:translate("查找历史与收藏"),onClick:()=>runBrowserMenuAction('history-search')},
    { key: 'bookmark-add', label:translate("收藏当前页"),extra:'Ctrl+D',onClick:()=>runBrowserMenuAction('bookmark-add')},
    { key: 'bookmarks', label:translate("在知识库中管理收藏"),onClick:()=>runBrowserMenuAction('bookmarks')},
    { key: 'bulk-summary', label:translate("多链接 AI 摘要"),extra:'Ctrl+Shift+S',onClick:()=>runBrowserMenuAction('bulk-summary')},
    { key: 'toggle-notes', label:translate("网页笔记面板"),extra:'Ctrl+Shift+N',onClick:()=>runBrowserMenuAction('toggle-notes')},
    { key: 'save-workspace', label:translate("保存全部标签为工作区"),extra:'Ctrl+Shift+W',icon:<SaveOutlined/>,disabled:tabs.length===0,onClick:()=>runBrowserMenuAction('save-workspace')},
    { key: 'translate-page', label:translate("翻译当前网页"),icon:<TranslationOutlined/>,disabled:!active.url,onClick:()=>runBrowserMenuAction('translate-page')},
    { key: 'print', label:translate("打印 / 保存为 PDF"),icon:<PrinterOutlined/>,extra:'Ctrl+P',disabled:!nativeMode,onClick:()=>runBrowserMenuAction('print')},
    { key: 'devtools', label:translate("开发者工具"),extra:'F12',disabled:!nativeMode||!advancedSettings.developerToolsEnabled,onClick:()=>runBrowserMenuAction('devtools')},
    { key: 'screenshot-visible', label:translate("截取可视区域"),disabled:!nativeMode,onClick:()=>runBrowserMenuAction('screenshot-visible')},
    { key: 'screenshot-full', label:translate("截取整个网页"),disabled:!nativeMode,onClick:()=>runBrowserMenuAction('screenshot-full')},
    { key: 'site-panel', label: translate("站点面板"), disabled: !active.url, onClick: () => setSitePanelOpen(true) },
    { key: 'site-rules', label: translate("站点规则"), onClick: () => setSiteRulesOpen(true) },
    { key: 'clear-site-data', label:translate("清除共享浏览数据"),disabled:!active.url||!nativeMode,onClick:()=>runBrowserMenuAction('clear-site-data')},
    currentBlock
      ? { key: 'site-unblock', label:translate("解除封杀此网站"),icon:<StopOutlined/>,onClick:()=>runBrowserMenuAction('site-unblock')}
      : { key: 'site-block', label:translate("封杀此网站"),icon:<StopOutlined/>,disabled:!currentHost||!nativeMode,onClick:()=>runBrowserMenuAction('site-block')},
    { type: 'divider' },
    { key: 'new-private', label:translate("新建私密窗口"),icon:<LockOutlined/>,extra:'Shift+Ctrl+N',onClick:()=>runBrowserMenuAction('new-private')},
    { key: 'fullscreen', label: isWindowFullscreen ?translate("退出全屏"):translate("进入全屏"),icon:<FullscreenOutlined/>,extra:'F11',onClick:()=>runBrowserMenuAction('fullscreen')},
    { type: 'divider' },
    { key: 'zoom', label: <Space><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, -0.1) }}>−</Button><span className="browser-zoom-value">{Math.round((zoomLevels[active.id] ?? browserAppearance.defaultZoom) * 100)}%</span><Button size="small" onClick={event => { event.stopPropagation(); changeZoom(active.id, 0.1) }}>+</Button></Space> },
    { key: 'zoom-reset', label:translate("重置缩放"),extra:'Ctrl+0',onClick:()=>setZoom(active.id,1)},
  ]) as MenuProps['items']
  })()

  useEffect(() => {
    void listCollections().then(items => setRouteCollections(items.map(item => ({ id: item.id, name: item.name })))).catch(() => setRouteCollections([]))
    void listWorkspaces().then(items => setSpaceOptions(items.map(item => ({ id: item.id, name: item.name })))).catch(() => setSpaceOptions([]))
  }, [])
  const bookmarkBarPanel =(
    <div className="bookmark-bar-panel" role="menu">
      {bookmarkActions.bookmarks.length === 0
        ? <Typography.Text type="secondary">{translate("还没有收藏，Ctrl+D 收藏当前页")}</Typography.Text>
        : <ul>
            {bookmarkActions.bookmarks.slice(0, 8).map(            (bookmark






            )                                                   =>(<li key={bookmark.id}>
                <button type="button" title={bookmark.url} onClick={() => void navigate(bookmark.url)}>
                  <span className="bookmark-bar-panel__title">{bookmark.title}</span>
                  <Typography.Text type="secondary" className="bookmark-bar-panel__url">{bookmark.url}</Typography.Text>
                </button>
              </li>))}
            {bookmarkActions.bookmarks.length > 8 && <li><button type="button" onClick={() => onOpenLibrary?.()}>{translate("查看全部")} {bookmarkActions.bookmarks.length} {translate("条\u2026")}</button></li>}
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
        ?translate("{value0} 个正在下载 / 上限 {value1}",{value0:downloads.filter(item=>item.status==='downloading').length,value1:downloadQueue.maxConcurrent})
        : downloadQueue.pending.length > 0 ?translate("{value0} 个排队中",{value0:downloadQueue.pending.length}):translate("暂无活动"),
      items: downloads.slice(0, 5).map(        (item





       )                                    =>( {name:item.fileName||item.url.split('/').pop()||translate("下载文件"),status:item.status,detail:item.totalBytes?`${item.status} · ${Math.min(100,Math.round(((item.receivedBytes??0)/item.totalBytes)*100))}%`:item.status,})),
    },
    resources: {
      subtitle: mediaResources.length ?translate("发现 {value0} 项",{value0:mediaResources.length}):translate("手动扫描当前页"),
      sections: [
        { title:translate("媒体资源"),items:mediaResources.slice(0,10).map((item                                                                                                               )=>({label:`${mediaKindLabel[item.kind]} · ${item.fileName}`,value:item.size?formatProcessBytes(item.size):translate("未知大小"),url:item.url}))},
        { title:translate("标签页"),items:[
          { label:translate("总标签页"),value:resourceStats.totalTabs},
          { label:translate("活跃 WebView"),value:resourceStats.liveTabs},
          { label:translate("已休眠"),value:resourceStats.suspendedTabs},
          { label:translate("固定"),value:resourceStats.pinnedTabs},
          { label:translate("播放音频"),value:resourceStats.audibleTabs},
          { label:translate("下载中"),value:resourceStats.downloadingTabs},
          { label:translate("最久未活跃"),value:translate("{value0} 分钟",{value0:resourceStats.idleMinutes})},
        ]},
        { title:translate("进程内存"),items:[
          { label:translate("工作集"),value:formatProcessBytes(memory?.workingSetBytes)},
          { label:translate("提交大小"),value:formatProcessBytes(memory?.commitBytes)},
          { label:translate("峰值"),value:formatProcessBytes(memory?.peakWorkingSetBytes)},
          { label:translate("缺页中断"),value:memory?.pageFaultCount==null?'—':memory.pageFaultCount.toLocaleString('zh-CN')},
        ]},
      ],
      canScan: nativeMode,
      hint:translate("LRU 阈值 {value0} 个 WebView；空闲 {value1} 分钟自动休眠。",{value0:advancedSettings.maxLiveWebviews,value1:advancedSettings.idleSuspendMinutes}),
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
        messageApi.error(translate("浮层加载失败，请重启桌面应用后重试"))
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
    if (!nativeMode || !toolbarOverlay || toolbarOverlay === 'menu' || toolbarOverlay === 'tab-menu' || toolbarOverlay === 'space') return
    void setNativeToolbarPanel(active.id, true, toolbarOverlay, nativePanelPayloads[toolbarOverlay])
  }, [active.id, nativeMode, nativePanelPayloads, toolbarOverlay])

  useEffect(() => {
    if (!nativeMode) return
    const openNativeMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const trigger = event.target.closest<HTMLButtonElement>(translate("button[aria-label=\"浏览器菜单\"]"))
      if (!trigger) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const zoomPercent = Math.round((zoomLevelsRef.current[active.id] ?? browserAppearance.defaultZoom) * 100)
      const fullBounds = bounds()
      const restore = fullBounds ? resizeNativeTab(active.id, fullBounds) : Promise.resolve()
      void restore.then(() => setNativeToolbarMenu(active.id, true, zoomPercent)).catch(error => {
        diagnosticLog('browser.toolbar-menu.open-failed', 'error', { tabId: active.id, error })
        messageApi.error(translate("浏览器菜单打开失败：{value0}",{value0:String(error)}))
      })
    }
    document.addEventListener('click', openNativeMenu, true)
    return () => document.removeEventListener('click', openNativeMenu, true)
  }, [active.id, browserAppearance.defaultZoom, messageApi])

  const resourcePanel =(
    <div className="resource-panel" role="status">
      <div className="resource-panel__header"><Typography.Text type="secondary" className="resource-panel__title">{translate("媒体资源")}</Typography.Text><Button size="small" loading={resourceScanBusy} onClick={()=>void scanCurrentResources()}>{translate("扫描当前页")}</Button></div>
      <ul className="resource-panel__media">
        {mediaResources.slice(0, 20).map(resource => <li key={resource.url} className="resource-panel__media-item"><div><Tag>{mediaKindLabel[resource.kind]}</Tag><b title={resource.url}>{resource.fileName}</b><small>{resource.size ? formatProcessBytes(resource.size) :translate("未知大小")}</small></div><Space size={2}><Button type="text" size="small" icon={<CopyOutlined/>} aria-label={translate("复制资源链接")} onClick={()=>void navigator.clipboard.writeText(resource.url)}/><Button type="text" size="small" icon={<DownloadOutlined/>} aria-label={translate("下载资源")} onClick={()=>void downloadMediaResource(resource)}/></Space></li>)}
        {!mediaResources.length && <li className="resource-panel__empty">{translate("扫描页面中已加载的视频、音频、清单、字幕与文档。")}</li>}
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("性能与隐私")}</Typography.Text>
      <ul>
        <li><span>{translate("总标签页")}</span><b>{resourceStats.totalTabs}</b></li>
        <li><span>{translate("活跃 WebView")}</span><b>{resourceStats.liveTabs}</b></li>
        <li><span>{translate("已休眠")}</span><b>{resourceStats.suspendedTabs}</b></li>
        <li><span>{translate("固定")}</span><b>{resourceStats.pinnedTabs}</b></li>
        <li><span>{translate("播放音频")}</span><b>{resourceStats.audibleTabs}</b></li>
        <li><span>{translate("下载中")}</span><b>{resourceStats.downloadingTabs}</b></li>
        <li><span>{translate("最久未活跃")}</span><b>{resourceStats.idleMinutes} {translate("分钟")}</b></li>
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("隐私拦截")}</Typography.Text>
      <ul className="resource-panel__privacy">
        <li><span>{translate("子资源拦截")}</span><b>{privacyCap?.networkSubresourceBlocking?translate("已开启"):translate("未启用")}</b></li>
        <li><span>{translate("已阻断请求")}</span><b>{privacyStats.blocked}</b></li>
        <li><span>{translate("已放行请求")}</span><b>{privacyStats.allowed}</b></li>
        <li><span>{translate("私密标签")}</span><b>{active.private?translate("是"):translate("否")}</b></li>
        {blockEvents.slice(0, 5).map(         (event




        )                                  =>(<li key={event.id} className="resource-panel__privacy-item">
            <span>{event.resourceType}</span>
            <b title={event.requestHost}>{event.requestHost}</b>
          </li>))}
        {blockEvents.length === 0 &&(<li className="resource-panel__privacy-item"><span>{translate("最近无阻断")}</span><b>—</b></li>)}
      </ul>
      <Typography.Text type="secondary" className="resource-panel__title resource-panel__title--sub">{translate("进程内存")}</Typography.Text>
      <ul className="resource-panel__memory">
        <li><span>{translate("工作集")}</span><b>{formatProcessBytes(memory?.workingSetBytes)}</b></li>
        <li><span>{translate("提交大小")}</span><b>{formatProcessBytes(memory?.commitBytes)}</b></li>
        <li><span>{translate("峰值")}</span><b>{formatProcessBytes(memory?.peakWorkingSetBytes)}</b></li>
        <li>
          <span>{translate("缺页中断")}</span>
          <b>{memory?.pageFaultCount == null ? '—' : memory.pageFaultCount.toLocaleString('zh-CN')}</b>
        </li>
      </ul>
      {processMemory.unsupported &&(<Typography.Paragraph type="secondary" className="resource-panel__hint">{translate("当前平台未提供进程内存查询")} 

        </Typography.Paragraph>)
       }
      <Typography.Paragraph type="secondary" className="resource-panel__hint">{translate("LRU 阈值")} 
               {advancedSettings.maxLiveWebviews} {translate("个 WebView；空闲")} {advancedSettings.idleSuspendMinutes} {translate("分钟自动休眠；进程内存每 5 秒刷新。")} 
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
      messageApi.warning(translate("当前没有可保存的标签页"))
      return
    }
    const stamp = new Date()
    const stampLabel = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')} ${String(stamp.getHours()).padStart(2, '0')}:${String(stamp.getMinutes()).padStart(2, '0')}`
    setSaveWorkspaceName(translate("工作区 {value0}",{value0:stampLabel}))
    setSaveWorkspaceDescription('')
    setSaveWorkspaceOpen(true)
  }

  async function saveAsWorkspace() {
    openSaveWorkspaceDialog()
  }

  async function confirmSaveWorkspace() {
    const name = saveWorkspaceName.trim()
    if (!name) {
      messageApi.warning(translate("请填写工作区名称"))
      return
    }
    if (name.length > 80) {
      messageApi.warning(translate("名称最多 80 个字符"))
      return
    }
    try {
      const summary = await saveWorkspace({
        name,
        description: saveWorkspaceDescription.trim(),
        payload: snapshotTabsToPayload(tabs),
      })
      messageApi.success(translate("已保存工作区「{value0}」({value1} 个标签)",{value0:summary.name,value1:summary.tabCount}))
      writeCurrentSpace({ id: summary.id, name: summary.name })
      window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { id: summary.id, name: summary.name } }))
      setSaveWorkspaceOpen(false)
    } catch (error) {
      messageApi.error(translate("保存失败：{value0}",{value0:String(error)}))
    }
  }

  async function applyWorkspaceRestore(workspace: WorkspaceRecord) {
    // Read the live tab list, not this render's snapshot: restoring is often
    // triggered from a long-lived event listener.
    const current = tabsRef.current
    const result = restoreTabsFromWorkspace(current, workspace)
    if (result.tabs.length === 0) {
      messageApi.warning(translate("工作区为空"))
      return
    }
    const kept = new Set(result.tabs.map(tab => tab.id))
    const previousActive = activeTabIdRef.current
    // Tabs the workspace does not contain are dropped from the strip, but their
    // native WebViews would keep painting above the restored page. Close them,
    // and hide the previous tab when it is kept but no longer active.
    for (const tab of current) {
      if (!kept.has(tab.id) && hasNativeTab(tab.id)) void closeNativeTab(tab.id)
    }
    if (previousActive && previousActive !== result.activeTabId && kept.has(previousActive) && hasNativeTab(previousActive)) {
      void hideNativeTab(previousActive)
    }
    // The visibility effect compares against the ref, which only syncs after a
    // render; without this the restored active tab never gets shown.
    activeTabIdRef.current = result.activeTabId
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
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message:translate("网页浏览仅在 Tauri 桌面应用中可用。")}}:item))
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
    // The restored active tab may be a brand-new WebView; the visibility effect
    // does not re-run when only the handle appears, so show it explicitly.
    if (visibleRef.current && activeTabIdRef.current === result.activeTabId && hasNativeTab(result.activeTabId)) {
      await showNativeTab(result.activeTabId).catch(() => undefined)
    }
    void enforceLiveTabLimit(result.activeTabId)
    messageApi.success(translate("已恢复工作区（+{value0} / \u2212{value1}）",{value0:result.addedCount,value1:result.removedCount}))
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
      messageApi.success(translate("已复制链接"))
    } catch {
      messageApi.error(translate("复制失败，请手动复制"))
    }
  }

  async function writeClipboard(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value)
      messageApi.success(translate("已复制{value0}",{value0:label}))
    } catch {
      messageApi.error(translate("复制{value0}失败",{value0:label}))
    }
  }

  async function handleContextAction(action: ContextMenuAction, request: { linkUrl: string | null; imageUrl: string | null; selectionText: string; selectionRect?: {x:number;y:number;width:number;height:number}|null }) {
  if (action === 'add-to-notes') {
    const text = request.selectionText?.trim()
    if (!text) { messageApi.info(translate("请先选中文本"));return}
    const entry: NoteEntry = {
      id: crypto.randomUUID(),
      url: active.url ?? '',
      title: active.title ?? active.url ??translate("未命名页面"),
      text,
      comment: '',
      createdAt: Date.now(),
      color: 'yellow',
    }
    setNotes(current => [entry, ...current])
    void persistPageNote(entry).then(() => scheduleExtrasSync()).catch(error => messageApi.error(translate("笔记保存失败：{value0}",{value0:String(error)})))
    setNotesOpen(true)
    messageApi.success(translate("已加入笔记"),2)
    return
  }

  if (action === 'clip-selection' || action === 'clip-link' || action === 'clip-image') {
    const context = { url: active.url, title: active.title }
    const clip = action === 'clip-selection'
      ? clipFromSelection(request.selectionText ?? '', context)
      : action === 'clip-link'
        ? clipFromLink(request.linkUrl ?? '', context)
        : clipFromImage(request.imageUrl ?? '', context)
    if (!clip) {
      messageApi.warning(translate("没有可剪藏的内容"))
      return
    }
    try {
      await saveClip(clip)
      scheduleExtrasSync()
      messageApi.success(translate("已剪藏，可在知识库「剪藏」中查看"), 2)
    } catch (error) {
      messageApi.error(translate("剪藏失败：{value0}", { value0: String(error) }))
    }
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
        catch (error) { messageApi.error(translate("无法读取页面源代码：{value0}",{value0:String(error)}))}
        return
      case 'copy': await writeClipboard(request.selectionText ?? '',translate("选区"));return
      case 'cut':
      case 'paste':
      case 'select-all':
        try { await editNativePage(active.id, action) }
        catch (error) { messageApi.error(translate("编辑操作失败：{value0}",{value0:String(error)}))}
        return
      case 'search-selection': if (request.selectionText) void navigate(`https://www.google.com/search?q=${encodeURIComponent(request.selectionText)}`); return
      case 'ask-ai':
        await openReader()
        setAiInitialQuestion(request.selectionText ?translate("请解释这段内容：\n\n{value0}",{value0:request.selectionText}):'')
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
      case 'clip-page': await clipCurrentPage(); return
      case 'open-link-current': if (request.linkUrl) void navigate(request.linkUrl); return
      case 'open-link-new': if (request.linkUrl) openNewTab(request.linkUrl); return
      case 'open-link-external': if (request.linkUrl) {
        const verdict = classifyShellOpenUrl(request.linkUrl)
        if (verdict.shellOpenable) setPendingShellOpen(request.linkUrl)
        else if (!verdict.irreversible) openNewTab(request.linkUrl)
      }
      return
      case 'copy-link': if (request.linkUrl) await writeClipboard(request.linkUrl,translate("链接"));return
      case 'open-image-new': if (request.imageUrl) openNewTab(request.imageUrl); return
      case 'copy-image': if (request.imageUrl) await writeClipboard(request.imageUrl,translate("图片地址"));return
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
            messageApi.success(translate("图片加入下载队列"))
          } catch (error) {
            messageApi.error(translate("保存失败：{value0}",{value0:String(error)}))
          }
        }
        return
    }
  }

  function openNewTab(url?: string, options: { private?: boolean; background?: boolean } = {}): string | undefined {
    if (url && !isNativeBrowserAvailable()) {
      window.open(url, '_blank', 'noopener,noreferrer')
      messageApi.info(translate("网页预览模式下已使用系统浏览器打开"))
      return undefined
    }
    const background = options.background === true
    const tab = options.private ? makePrivateTab() : newTab()
    tab.lastActiveAt = Date.now()
    const currentId = activeTabIdRef.current
    if (!background && currentId) void hideNativeTab(currentId)
    if (url) { tab.url = url; tab.title =translate("正在加载\u2026");tab.loading=true}
    setTabs(current => {
      const next = current.map(        (item                      )=>({...item,active:false}))
      return [...next, tab]
    })
    if (!background) {
      activeTabIdRef.current = tab.id
      lastActiveAtRef.current.set(tab.id, Date.now())
      setActiveTabId(tab.id)
      setAddress(url ?? '')
      setReaderArticle(null)
    }
    if (url) {
      void new Promise(resolve => requestAnimationFrame(resolve)).then(async () => {
        const nextBounds = bounds()
        if (!nextBounds) return
        try {
          const opened = await openNativeTab(tab.id, url, nextBounds, { private: tab.private })
          if (!opened) {
            setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: { kind: 'web-mode-required', message:translate("网页浏览仅在 Tauri 桌面应用中可用。")}}:item))
            return
          }
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, error: undefined } : item))
          // A background capture tab must never cover the page the user is on.
          if (background) {
            await hideNativeTab(tab.id)
            return
          }
          await enforceLiveTabLimit(tab.id)
        } catch (error) {
          setTabs(current => current.map(item => item.id === tab.id ? { ...item, loading: false, error: classifyNavigationError(error) } : item))
        }
      })
    }
    return tab.id
  }

  /** Capture a URL for the Little Arc window without touching the active tab. */
  async function captureUrlInLittleArc(request: { url: string; requestId: string; collectionId?: string | null }) {
    let tabId: string | undefined
    try {
      if (!isNativeBrowserAvailable()) throw new Error(translate("网页浏览仅在 Tauri 桌面应用中可用。"))
      tabId = openNewTab(request.url, { background: true })
      if (!tabId) throw new Error(translate("无法打开该网址"))
      const deadline = Date.now() + 25_000
      let tab = tabsRef.current.find(item => item.id === tabId)
      while (Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 300))
        tab = tabsRef.current.find(item => item.id === tabId)
        if (!tab) throw new Error(translate("标签页已关闭"))
        if (tab.error) throw new Error(tab.error.message)
        if (!tab.loading) break
      }
      if (!tab) throw new Error(translate("标签页已关闭"))
      if (tab.loading) throw new Error(translate("页面加载超时"))
      const snapshot = await captureNativePage(tabId)
      const article = extractArticle(snapshot)
      if (!article.markdown.trim()) throw new Error(translate("无法识别该页面正文"))
      const created = await saveDocument({
        title: article.title || tab.title || request.url,
        url: request.url,
        markdown: article.markdown,
        tags: ['Inbox'],
      })
      const route = matchSiteRoute(siteRoutesRef.current, request.url)
      const collectionId = request.collectionId ?? route?.collectionId ?? null
      if (collectionId) await addToCollection(collectionId, created.id).catch(() => undefined)
      await emitLittleArcResult({ requestId: request.requestId, ok: true, title: created.title })
    } catch (error) {
      await emitLittleArcResult({ requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (tabId) {
        if (hasNativeTab(tabId)) await closeNativeTab(tabId).catch(() => undefined)
        setTabs(current => current.filter(item => item.id !== tabId))
      }
    }
  }

  function activateTab(id: string) {
    if (id === activeTabIdRef.current) return
    const selected = tabs.find(tab => tab.id === id)
    const currentId = activeTabIdRef.current
    if (currentId) void hideNativeTab(currentId)
    setTabs(current => current.map(       (tab                              )=>({...tab,active:tab.id===id,lastActiveAt:tab.id===id?Date.now():tab.lastActiveAt})))
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
      messageApi.error(translate("无法修改网页音频状态"))
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
    const sleepHost = normalizeSleepHost(tab.url ?? '')
    const sameDomainCount = idsToCloseForSameDomain(tabs, tab.id).length
    const items: NonNullable<MenuProps['items']> = [
      { key: 'reload', label:translate("重新加载"),disabled:!hasNativeTab(tab.id),onClick:()=>void reloadNativeTab(tab.id)},
      { key: 'duplicate', label:translate("复制标签页"),disabled:!tab.url,onClick:()=>duplicateTab(tab)},
      { key: 'pin', label: tab.pinned ?translate("取消固定"):translate("固定标签页"),onClick:()=>togglePinned(tab.id)},
      { key: 'sleep', label: tab.suspended ? translate("唤醒标签页") : translate("立即休眠"), disabled: tab.pinned || tab.id === activeTabId, onClick: () => { if (tab.suspended) void resumeTab(tab); else void suspendTabNow(tab) } },
      { key: 'sleep-site', label: sleepHost && sleepExceptions.includes(sleepHost) ? translate("恢复此站点自动休眠") : translate("此站点不再自动休眠"), disabled: !sleepHost, onClick: () => updateSleepExceptions(toggleSleepException(sleepExceptions, tab.url ?? '')) },
      { key: 'archive', label:translate("归档标签页"),disabled:!tab.url||tab.private,onClick:()=>{void archiveTabToStore(tab)}},
      tab.id !== active.id
        ? { key: 'split-with-active', label: translate("与当前标签并排"), disabled: !nativeMode || tab.private || !tab.url, onClick: () => openSplit(tab.id) }
        : splitTabId
          ? { key: 'split-close', label: translate("取消分屏"), onClick: closeSplit }
          : { key: 'split-next', label: translate("与下一个标签并排"), disabled: !nativeMode || !tabs.some(item => item.id !== tab.id && !item.private && Boolean(item.url)), onClick: () => { const next = tabs.find(item => item.id !== tab.id && !item.private && Boolean(item.url)); if (next) openSplit(next.id) } },
      ...(tab.id === active.id ? [{ key: 'split-document', label: translate("与文档并排"), disabled: !nativeMode, onClick: () => { setSplitTabId(null); setSplitChat(false); setDocumentPickerMode('split'); setDocumentPickerOpen(true) } }] : []),
      ...(tab.id === active.id ? [{ key: 'split-chat', label: translate("与 AI 对话并排"), disabled: !nativeMode, onClick: () => { setSplitTabId(null); setSplitDocument(null); setSplitChat(true) } }] : []),
      ...(tab.id === active.id ? [{ key: 'document-pair', label: translate("两个文档对比"), onClick: () => { setDocumentPickerMode('pair'); setPairSelection([]); setDocumentPickerOpen(true) } }] : []),
      { key: 'rename-tab', label: translate("重命名标签页"), onClick: () => { setRenameTabId(tab.id); setRenameDraft(tab.title) } },
      { key: 'queue', label:translate("稍后读"),disabled:!tab.url||tab.private,onClick:()=>{void queueTabForLater(tab)}},
      { key: 'mute', label: tab.muted ?translate("取消静音此标签页"):translate("静音此标签页"),onClick:()=>toggleMuted(tab.id)},
      { type: 'divider' },
      { key: 'close', label:translate("关闭标签页"),disabled:tab.pinned,onClick:()=>closeTab(tab.id)},
      { key: 'close-others', label:translate("关闭其他标签页"),disabled:tabs.length<2,onClick:()=>closeTabs(tabs.filter(item=>item.id!==tab.id&&!item.pinned).map(item=>item.id))},
      { key: 'close-right', label:translate("关闭右侧标签页"),disabled:index===tabs.length-1,onClick:()=>closeTabs(tabs.slice(index+1).filter(item=>!item.pinned).map(item=>item.id))},
      { key: 'close-domain', label: sameDomainCount > 0 ?translate("关闭同域标签页（{value0} 个）",{value0:sameDomainCount}):translate("关闭同域标签页"),disabled:sameDomainCount===0,onClick:()=>closeDomain(tab.id)},
    ]
    if (tab.crashed) {
      items.unshift({ key: 'reopen', label:translate("重新打开崩溃的标签页"),onClick:()=>void retryTab(tab.id)})
      items.splice(1, 0, { type: 'divider', key: 'crashed-divider' })
    }
    if (tab.private) {
      const insertAt = items.findIndex(item => item && 'key' in item && item.key === 'close-domain')
      const dividerAt = insertAt > 0 ? insertAt + 1 : items.length
      items.splice(dividerAt, 0, { type: 'divider', key: 'private-divider' })
      items.push({ key: 'private-info', label:translate("私密窗口：不会写入历史与会话"),disabled:true})
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
    if (!url) { messageApi.warning(translate("当前标签页没有可收藏的网址"));return}
    try {
      await bookmarkActions.add({
        id: crypto.randomUUID(),
        url,
        title: active.title || url,
        favicon: active.favicon ?? null,
      })
      messageApi.success(translate("已加入收藏夹"),2)
    } catch (error) {
      messageApi.error(translate("加入收藏夹失败：{value0}",{value0:String(error)}))
    }
  }

  /** Move a tab out of the tab strip and into the searchable archive. */
  async function archiveTabToStore(target: BrowserTab) {
    const entry = archivedTabFromBrowserTab(target)
    if (!entry) {
      messageApi.warning(translate("当前页面无法归档（仅支持 http/https，私密标签不归档）"))
      return
    }
    try {
      await archiveTab(entry, readAutoArchiveSettings().retention)
      void dequeueUrl(target.url)
      scheduleExtrasSync()
      messageApi.success(translate("已归档，可在知识库「归档」中找回"),2)
      closeTab(target.id)
    } catch (error) {
      messageApi.error(translate("归档失败：{value0}",{value0:String(error)}))
    }
  }

  /** A saved or archived page is no longer "read later". */
  async function dequeueUrl(url: string) {
    if (!url) return
    try {
      const queue = await listReadingQueue()
      const entry = queue.find(item => item.url === url)
      if (entry) await removeFromReadingQueue(entry.id)
    } catch { /* queue cleanup must never fail the main action */ }
  }

  /** Put a tab on the read-later queue without saving it to the knowledge base. */
  async function queueTabForLater(target: BrowserTab) {
    const entry = readingQueueEntryFromTab(target)
    if (!entry) {
      messageApi.warning(translate("当前页面无法加入待读（仅支持 http/https，私密标签不加入）"))
      return
    }
    try {
      await addToReadingQueue(entry)
      messageApi.success(translate("已加入待读，可在知识库「待读」中查看"), 2)
    } catch (error) {
      messageApi.error(translate("加入待读失败：{value0}",{value0:String(error)}))
    }
  }

  async function clipCurrentPage() {
    if (!hasNativeTab(active.id)) {
      messageApi.warning(translate("当前页面无法剪藏（仅 Tauri 桌面模式可用）"))
      return
    }
    try {
      const snapshot = await captureNativePage(active.id)
      const article = extractArticle(snapshot)
      const clip = clipFromPage(article.markdown ?? '', { url: active.url, title: active.title })
      if (!clip) {
        messageApi.warning(translate("当前页面没有可剪藏的正文"))
        return
      }
      await saveClip(clip)
      scheduleExtrasSync()
      messageApi.success(translate("已剪藏整页，可在知识库「剪藏」中查看"), 2)
    } catch (error) {
      messageApi.error(translate("剪藏失败：{value0}", { value0: String(error) }))
    }
  }

  async function runBulkSummary(urls: string[], kind: 'one-sentence' | 'short' | 'detailed' | 'key-points') {
    const { aiChat: sendChat } = await import('../../api')
    const { extractArticle } = await import('../../features/reader/extractArticle')
    const { buildSummaryPrompt } = await import('../../features/ai/summarize')
    const { listAIProviders } = await import('../../api')
    const providers = await listAIProviders().catch(() => [])
    const providerId = providers[0]?.id
    if (!providerId) { messageApi.error(translate("尚未配置 AI Provider"));return[]}
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
          entries.push({ index, total: urls.length, url, title: url, status: 'skipped', message:translate("正文为空")})
          continue
        }
        const request = buildSummaryPrompt(article.markdown, kind, article.title)
        const summaryResponse = await sendChat(providerId, request)
        const summary = summaryResponse.content
        const saved = await saveDocument({ title:translate("摘要：{value0}",{value0:article.title||url}),url,markdown:translate("# {value0}\n\n来源：{value1}\n\n## 摘要\n\n{value2}\n\n## 正文\n\n{value3}",{value0:article.title,value1:url,value2:summary,value3:article.markdown}),tags:['bulk-summary',kind]})
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
        const aggregated =translate("# 多链接综述（{value0} 条）\n\n{value1}\n\n## 各篇摘要\n\n{value2}",{value0:titles.length,value1:cross.content,value2:titles.map((title,i)=>`### ${title}\n\n${partials[i]??''}`).join('\n\n')})
        const saved = await saveDocument({ title: aggregatedTitleFor(titles), url: urls[0] ?? '', markdown: aggregated, tags: ['multi-summary', kind] })
        messageApi.success(translate("多链接综述已存入知识库（{value0} 条）",{value0:titles.length}),3)
        void saved
      } catch (error) {
        messageApi.warning(translate("交叉综述生成失败：{value0}",{value0:String(error)}))
      }
    } else if (titles.length === 1) {
      messageApi.success(translate("已存入 1 条摘要"),2)
    }
    return entries
  }

  function aggregatedTitleFor(titles: string[]) {
    return titles.length > 1 ?translate("多链接综述（{value0} 条）",{value0:titles.length}):titles[0]??translate("多链接综述")
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
      title: restored.title ||translate("正在加载\u2026"),
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
      messageApi.open({ key, type: 'loading', content:translate("正在保存并提取\u2026"),duration:0})
      let article = readerArticle ?? aiArticle
      if (!article && hasNativeTab(active.id)) article = extractArticle(await captureNativePage(active.id))
      if (!article?.markdown?.trim()) throw new Error('reader_content_not_found')
      const created = await saveDocument({ title: article.title || active.title, url: active.url || 'about:blank', markdown: article.markdown, tags: ['Inbox'] })
      setStarredDocId(created.id)
      setDepositPulse(true)
      window.setTimeout(() => setDepositPulse(false), 900)
      const route = matchSiteRoute(siteRoutesRef.current, active.url)
      if (route?.collectionId) void addToCollection(route.collectionId, created.id).catch(() => undefined)
      void dequeueUrl(active.url)
      for (let attempt = 0; attempt < 30; attempt++) {
        const document = await getDocument(created.id)
        if (document.status === 'READY') { messageApi.open({ key, type: 'success', content:translate("已收藏并完成索引")});return}
        if (document.status === 'FAILED') throw new Error('processing failed')
        await new Promise(resolve => window.setTimeout(resolve, 200))
      }
      messageApi.open({ key, type: 'info', content:translate("已收藏，后台仍在处理中")})
    } catch (error) {
      const kind = classifySaveError(error)
      const contentEmpty = kind === 'reader_content_not_found'
      messageApi.open({ key, type: contentEmpty ? 'error' : 'warning', content: contentEmpty ?translate("无法识别该页面正文，已取消保存"):translate("后端离线或处理失败，请稍后重试")})
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
        messageApi.open({ key, type: 'success', content:translate("已取消收藏"),duration:2})
      } catch {
        messageApi.open({ key, type: 'error', content:translate("取消收藏失败"),duration:2})
      }
      return
    }
    await save()
  }

  async function openReader() {
    if (!hasNativeTab(active.id)) { messageApi.info(translate("请先在桌面应用中打开一个网页"));return false}
    const key = 'reader'
    try {
      messageApi.open({ key, type: 'loading', content:translate("正在提取正文\u2026"),duration:0})
      const article = extractArticle(await captureNativePage(active.id))
      await hideNativeTab(active.id)
      setReaderArticle(article)
      setAiArticle(article)
      messageApi.open({ key, type: 'success', content:translate("已提取 {value0} 字词",{value0:article.wordCount})})
      return true
    } catch {
      messageApi.open({ key, type: 'error', content:translate("无法识别该页面正文")})
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
              <Tooltip title={tab.title || tab.url ||( tab.private ?translate("新私密窗口"):translate("新标签页"))} mouseEnterDelay={0.6}>
              <span
                draggable
                onAuxClick={event => { if (event.button === 1 && !tab.pinned) closeTab(tab.id) }}
                onDragStart={onTabDragStart(index)}
                onDragOver={onTabDragOver(index)}
                onDrop={onTabDrop(index)}
                onDragEnd={onTabDragEnd}
                className={`browser-tab-title${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}${tab.private ? ' browser-tab-title--private' : ''}`}
              >{tab.crashed ? <WarningOutlined aria-label={translate("标签页崩溃")} className="browser-tab-crash"/>:tab.loading?<span className="browser-tab-loading" role="status" aria-label={translate("正在加载")}/>:tab.suspended?<Tooltip title={tab.suspendedReason === 'lru' ? translate("已休眠（自动回收），点击可恢复") : translate("已休眠，点击可恢复")} mouseEnterDelay={0.4}><MoonOutlined aria-label={translate("已休眠")} className="browser-tab-sleep"/></Tooltip>:tab.private?<LockOutlined/>:<TabFavicon key={tab.favicon??tab.url} favicon={tab.favicon} pageUrl={tab.url}/>} {tab.muted?<Tooltip title={translate("已静音")} mouseEnterDelay={0.6}><AudioMutedOutlined aria-label={translate("已静音")} className="browser-tab-audio"/></Tooltip>:tab.audible?<Tooltip title={translate("正在播放音频")} mouseEnterDelay={0.6}><SoundOutlined aria-label={translate("正在播放音频")} className="browser-tab-audio"/></Tooltip>:null}<span>{tab.title}</span></span>
              </Tooltip>
            </Dropdown>,
            style: group.groupId ?( { '--tab-group-color': groupColor } as CSSProperties) : undefined,
            className: `${tab.pinned ? 'browser-tab--pinned ' : ''}${tab.suspended ? 'browser-tab--suspended' : ''}${tab.private ? ' browser-tab--private' : ''}${tab.muted ? ' browser-tab--muted' : ''}${tab.crashed ? ' browser-tab--crashed' : ''}${group.groupId ? ' browser-tab--grouped' : ''}`.trim() || undefined,
            closable: tabs.length > 1 && !tab.pinned,
          }
        })}                                                                                                                                 )()} activeKey={activeTabId} onChange={activateTab} addIcon={<Tooltip title={translate("新建标签页 (Ctrl+T)")}><PlusOutlined aria-label={translate("新建标签页")}/></Tooltip>} onEdit={(target,action)=>action==='add'?openNewTab():closeTab(String(target))}/></div></TopBarPortal>
    <div className="browser-toolbar"><Space><Button type="text" aria-label={translate("后退")} title={translate("后退 (Alt+\u2190)")} icon={<ArrowLeftOutlined/>} disabled={!nativeMode||!active.canGoBack} onClick={()=>void navigateHistory(active.id,-1)}/><Button type="text" aria-label={translate("前进")} title={translate("前进 (Alt+\u2192)")} icon={<ArrowRightOutlined/>} disabled={!nativeMode||!active.canGoForward} onClick={()=>void navigateHistory(active.id,1)}/><Button type="text" aria-label={active.loading?translate("停止加载"):translate("重新加载")} title={active.loading?translate("停止加载 (Esc)"):translate("重新加载 (F5)")} icon={active.loading?<CloseOutlined/>:<ReloadOutlined/>} disabled={!nativeMode} onClick={()=>void(active.loading?stopNativeTab(active.id):reloadNativeTab(active.id))}/>{browserAppearance.toolbar.reader&&<Button type="text" icon={<BookOutlined/>} onClick={()=>void openReader()}>{translate("阅读模式")}</Button>}<Button type="text" aria-label={translate("加入待读")} title={translate("加入待读")} icon={<ClockCircleOutlined/>} disabled={!active.url} onClick={()=>void queueTabForLater(active)}/></Space><form onSubmit={event=>{event.preventDefault();void navigate(address)}}><AutoComplete value={address} options={addressSuggestions} onChange={setAddress} onSelect={value=>void navigate(value)}><Input ref={addressRef} prefix={<SafetyCertificateOutlined/>} suffix={<button type="button" className={`browser-star${starredDocId?' is-active':''}${depositPulse?' is-depositing':''}`} disabled={!active.url} aria-label={starredDocId?translate("取消收藏"):translate("收藏当前页")} title={starredDocId?translate("取消收藏当前页"):translate("收藏当前页")} onClick={event=>{event.preventDefault();event.stopPropagation();void toggleStarCurrent()}}><StarOutlined/></button>} onFocus={event=>event.currentTarget.select()} placeholder={translate("搜索或输入网址")}/></AutoComplete></form>{browserAppearance.toolbar.adBlock&&<Tooltip title={adBlockerEnabled?translate("广告过滤已开启，本标签已过滤 {value0} 项",{value0:blockedAdsByTab[active.id]??0}):translate("广告过滤已关闭")}><Tag icon={<SafetyCertificateOutlined/>} color={adBlockerEnabled?'green':'default'}>{blockedAdsByTab[active.id]??0}</Tag></Tooltip>}{browserAppearance.toolbar.ai&&<Button type={aiOpen?'primary':'text'} ghost={aiOpen} icon={<RobotOutlined/>} onClick={toggleAiAssistant}/>} {browserAppearance.toolbar.downloads&&<Popover trigger="click" placement="bottomRight" content={downloadPanel} open={toolbarOverlay==='downloads'} onOpenChange={open=>void changeToolbarOverlay('downloads',open)}><Badge size="small" count={downloads.filter(item=>item.status==='downloading').length}><Button type="text" aria-label={translate("下载")} icon={<DownloadOutlined/>}/></Badge></Popover>}{browserAppearance.toolbar.bookmarks&&<Popover trigger="click" placement="bottomRight" content={bookmarkBarPanel} open={toolbarOverlay==='bookmarks'} onOpenChange={open=>void changeToolbarOverlay('bookmarks',open)}><Button type="text" aria-label={translate("收藏夹")} title={translate("{value0} 条收藏 (Ctrl+Shift+O)",{value0:bookmarkActions.bookmarks.length})} icon={<StarFilled style={{color:bookmarkActions.bookmarks.length?'#d49a26':undefined}}/>}/></Popover>}{browserAppearance.toolbar.resources&&<Popover trigger="click" placement="bottomRight" content={resourcePanel} open={toolbarOverlay==='resources'} onOpenChange={open=>void changeToolbarOverlay('resources',open)}><Button type="text" aria-label={translate("资源面板")} icon={<ThunderboltOutlined/>} title={translate("{value0} 个 WebView / {value1} 标签",{value0:resourceStats.liveTabs,value1:resourceStats.totalTabs})}/></Popover>}<Dropdown menu={{items:browserMenu}} trigger={['click']} open={!nativeMode&&toolbarOverlay==='menu'} onOpenChange={open=>{if(nativeMode){if(open)void setNativeToolbarMenu(active.id,true,Math.round((zoomLevels[active.id]??browserAppearance.defaultZoom)*100));return}changeToolbarOverlay('menu',open)}}><Button type="text" aria-label={translate("浏览器菜单")} icon={<MoreOutlined/>}/></Dropdown></div>
    {active.private&&<div className="browser-private-bar"><LockOutlined/><strong>{translate("私密浏览")}</strong><span>{translate("不会保存历史记录、关闭记录与站点权限")}</span></div>}
    {findOpen&&<div className="browser-find"><Input autoFocus allowClear prefix={<SearchOutlined/>} value={findQuery} status={findStatus==='missing'?'error':undefined} placeholder={translate("在页面中查找")} onChange={event=>{setFindQuery(event.target.value);setFindStatus('idle')}} onPressEnter={event=>void runFind(event.shiftKey)}/><Typography.Text type={findStatus==='missing'?'danger':'secondary'}>{findStatus==='missing'?translate("未找到"):findStatus==='found'?translate("已定位"):''}</Typography.Text><Button type="text" aria-label={translate("上一个匹配项")} icon={<ArrowUpOutlined/>} onClick={()=>void runFind(true)}/><Button type="text" aria-label={translate("下一个匹配项")} icon={<ArrowDownOutlined/>} onClick={()=>void runFind(false)}/><Button type="text" aria-label={translate("关闭查找")} icon={<CloseOutlined/>} onClick={closeFind}/></div>}
    <PermissionPromptBar prompt={permissionPrompt} />
    {(splitTabId || splitDocument || splitChat) && <div className="split-status">
      <span>{translate("分屏")}：{active.title} ｜ {splitTabId ? tabs.find(tab => tab.id === splitTabId)?.title ?? '' : splitDocument ? splitDocument.title : translate("AI 对话")}</span>
      <Space>
        <Button size="small" type="text" disabled={!splitTabId} onClick={() => { if (!splitTabId) return; const left = active.id; activateTab(splitTabId); setSplitTabId(left) }}>{translate("交换")}</Button>
        <Button size="small" type="text" onClick={() => { closeSplit(); closeDocumentSplit(); setSplitChat(false) }}>{translate("关闭分屏")}</Button>
      </Space>
    </div>}
    {activeSiteRoute?.spaceId && activeSiteRoute.spaceId !== readCurrentSpace()?.id && dismissedSpaceRoute !== activeSiteRoute.host && (
      <div className="space-route-bar">
        <span>{translate("此站点属于 Space「{value0}」", { value0: spaceOptions.find(space => space.id === activeSiteRoute.spaceId)?.name ?? activeSiteRoute.spaceId })}</span>
        <Button size="small" type="primary" onClick={() => { dispatchSpaceRestore(activeSiteRoute.spaceId!); setDismissedSpaceRoute(activeSiteRoute.host) }}>{translate("切换 Space")}</Button>
        <Button size="small" type="text" onClick={() => setDismissedSpaceRoute(activeSiteRoute.host)}>{translate("忽略")}</Button>
      </div>
    )}
    <SitePanel
      open={sitePanelOpen}
      onClose={() => setSitePanelOpen(false)}
      url={active.url}
      adBlockEnabled={adBlockerEnabled}
      blockedAds={blockedAdsByTab[active.id] ?? 0}
      onToggleAdBlock={enabled => { setAdBlockerEnabled(enabled); void setNativeAdBlocking(enabled).catch(() => undefined) }}
      blockedBy={currentBlock?.host ?? null}
      permissionRule={siteRule}
      onChangePermission={changeSitePermission}
      sleepExcluded={isSleepExcluded(active.url, sleepExceptions)}
      onToggleSleep={() => updateSleepExceptions(toggleSleepException(sleepExceptions, active.url))}
      autoReader={isAutoReaderSite(active.url, readerSites) || Boolean(activeSiteRoute?.autoReader)}
      onToggleReader={() => updateReaderSites(toggleReaderSite(readerSites, active.url))}
      readerStyle={readerSiteStyle}
      onResetReaderStyle={() => { writeReaderSiteStyle(active.url, null); setReaderStyleVersion(version => version + 1) }}
      routeCollectionName={activeSiteRoute?.collectionId ? routeCollections.find(collection => collection.id === activeSiteRoute.collectionId)?.name ?? null : null}
      onClearRoute={() => updateSiteRoutes(upsertSiteRoute(siteRoutes, active.url, { collectionId: null }))}
      onClearSiteData={() => runBrowserMenuAction('clear-site-data')}
      onUnblock={() => runBrowserMenuAction('site-unblock')}
    />
    <SiteRulesDialog
      open={siteRulesOpen}
      onClose={() => setSiteRulesOpen(false)}
      routes={siteRoutes}
      collectionNames={new Map(routeCollections.map(collection => [collection.id, collection.name]))}
      spaces={spaceOptions}
      onChange={updateSiteRoutes}
    />
    <Modal open={documentPickerOpen} title={documentPickerMode === 'pair' ? translate("选择两篇文档") : translate("选择文档")} onCancel={() => setDocumentPickerOpen(false)} footer={null}>      <Input value={pickerQuery} allowClear placeholder={translate("搜索文档")} onChange={event => setPickerQuery(event.target.value)}/>
      <div className="document-picker-list">
        {pickerDocuments
          .filter(document => !pickerQuery.trim() || document.title.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
          .slice(0, 30)
          .map(document => <button key={document.id} type="button" className={pairSelection.includes(document.id) ? 'is-selected' : undefined} onClick={() => {
            if (documentPickerMode === 'pair') {
              setPairSelection(current => current.includes(document.id) ? current.filter(id => id !== document.id) : [...current, document.id].slice(-2))
              return
            }
            setSplitDocument(document)
            setDocumentPickerOpen(false)
          }}>{pairSelection.includes(document.id) ? '✓ ' : ''}{document.title}</button>)}
        {pickerDocuments.filter(document => !pickerQuery.trim() || document.title.toLowerCase().includes(pickerQuery.trim().toLowerCase())).length === 0 && <Typography.Text type="secondary">{translate("没有可并排的文档")}</Typography.Text>}
      </div>
      {documentPickerMode === 'pair' && <div className="document-pair-confirm"><Button type="primary" disabled={pairSelection.length !== 2} onClick={() => {
        const chosen = pairSelection.map(id => pickerDocuments.find(document => document.id === id)).filter((document): document is KnowledgeDocument => Boolean(document))
        if (chosen.length !== 2) return
        setDocPair({ left: chosen[0], right: chosen[1] })
        setSplitDocument(null)
        setSplitChat(false)
        setSplitTabId(null)
        void hideNativeTab(active.id).catch(() => undefined)
        setDocumentPickerOpen(false)
      }}>{translate("开始对比")}</Button></div>}
    </Modal>
    <Modal
      open={hideEditorOpen}
      title={translate("隐藏元素")}
      onCancel={() => setHideEditorOpen(false)}
      okText={translate("保存")}
      onOk={() => {
        const nextStyle = { ...readerSiteStyle, hide: normalizeHideSelectors(hideDraft) || undefined, hideLive: hideLiveDraft && Boolean(normalizeHideSelectors(hideDraft)) }
        writeReaderSiteStyle(active.url, nextStyle)
        setReaderStyleVersion(version => version + 1)
        const liveCss = liveHideCssFor(nextStyle)
        if (liveCss) void injectSiteCss(active.id, liveCss).catch(() => undefined)
        setHideEditorOpen(false)
      }}
    >
      <Typography.Paragraph type="secondary">{translate("只对阅读模式生效；只接受简单 CSS 选择器，不执行任何脚本。")}</Typography.Paragraph>
      <Input value={hideDraft} onChange={event => setHideDraft(event.target.value)} placeholder={translate("隐藏元素选择器（逗号分隔）")}/>
      <label className="reader-hide-live">
        <Switch checked={hideLiveDraft} onChange={setHideLiveDraft}/>
        <span>{translate("同时应用到网页（仅本地 CSS）")}</span>
      </label>
    </Modal>
    <Modal
      open={Boolean(renameTabId)}
      title={translate("重命名标签页")}
      onCancel={() => setRenameTabId(null)}
      okText={translate("保存")}
      onOk={() => {
        const name = renameDraft.trim()
        if (!name || !renameTabId) return
        setTabs(current => current.map(tab => tab.id === renameTabId ? { ...tab, title: name, titleLocked: true } : tab))
        setRenameTabId(null)
      }}
    >
      <Input autoFocus value={renameDraft} maxLength={120} onChange={event => setRenameDraft(event.target.value)} placeholder={translate("标签页名称")}/>
    </Modal>
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
      onQueueTab={() => void queueTabForLater(active)}
      onClipPage={() => void clipCurrentPage()}
      onOpenUrlInNewTab={url => openNewTab(url)}
      onToggleAi={toggleAiAssistant}
      onToggleNotes={() => setNotesOpen(value => !value)}
      onBulkSummary={() => setBulkSummaryOpen(true)}
      onSaveWorkspace={() => void saveAsWorkspace()}
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
      onRemove={id => {
        setNotes(current => current.filter(note => note.id !== id))
        void removePageNote(id).catch(() => { /* already gone from the UI */ })
      }}
      onUpdate={(id, patch) => {
        const target = notes.find(note => note.id === id)
        if (!target) return
        const next = { ...target, ...patch }
        setNotes(current => current.map(note => note.id === id ? next : note))
        void persistPageNote(next).catch(error => messageApi.error(translate("笔记保存失败：{value0}",{value0:String(error)})))
      }}
    />
    <Modal
      title={translate("保存工作区")}
      open={saveWorkspaceOpen}
      onCancel={() => setSaveWorkspaceOpen(false)}
      onOk={() => void confirmSaveWorkspace()}
      okText={translate("保存")}
      cancelText={translate("取消")}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">{translate("工作区会记住当前所有标签页的 URL、标题、固定/静音状态。点击保存后可在「设置 \u2192 浏览器 \u2192 工作区」中恢复或删除。")}</Typography.Paragraph>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label>
          <Typography.Text strong>{translate("名称")}</Typography.Text>
          <Input
            value={saveWorkspaceName}
            onChange={event => setSaveWorkspaceName(event.target.value)}
            maxLength={80}
            placeholder={translate("例如：工作日上午")}
            autoFocus
          />
        </label>
        <label>
          <Typography.Text strong>{translate("描述（可选）")}</Typography.Text>
          <Input.TextArea
            value={saveWorkspaceDescription}
            onChange={event => setSaveWorkspaceDescription(event.target.value)}
            maxLength={240}
            rows={3}
            placeholder={translate("这个工作区用来做什么？")}
          />
        </label>
      </div>
    </Modal>
    {certificatePrompt.prompt && <CertificateErrorBar payload={certificatePrompt.prompt} onRespond={allow => void certificatePrompt.respond(allow)} />}
    {showSafety &&(
      <div className={`browser-safety-warn browser-safety-warn--${safetyLevel}`} role="status">
        <SafetyCertificateOutlined />
        <span>
          {safetyLevel === 'dangerous' ?translate("危险："):translate("注意：")}
          {safetyIssues.map(issue => issue.message).join(' / ')}
        </span>
      </div>)
     }
    <div className="browser-content"><div className={`web-surface${nativeSurfaceVisible ? ' web-surface--native' : ''}`} ref={surfaceRef}>{comparison && comparison.hostTabId === active.id
      ? <SearchComparisonWorkspace query={comparison.query} sources={comparison.sources} visibleIds={comparison.visibleIds} onShow={showComparisonSource} onSearch={searchAgainInComparison} onClose={closeComparison}/>
      : readerArticle
      ? <>
          <div className="reader-site-controls">
            <span>{translate("阅读字号")}</span>
            <Select<number> size="small" value={readerSiteStyle?.fontSize ?? 18} options={READER_FONT_SIZES.map(size => ({ label: String(size), value: size }))} onChange={value => { writeReaderSiteStyle(active.url, { ...readerSiteStyle, fontSize: clampReaderFontSize(Number(value)) }); setReaderStyleVersion(version => version + 1) }}/>
            <span>{translate("阅读宽度")}</span>
            <Select<number> size="small" value={readerSiteStyle?.width ?? 760} options={READER_WIDTHS.map(width => ({ label: String(width), value: width }))} onChange={value => { writeReaderSiteStyle(active.url, { ...readerSiteStyle, width: clampReaderWidth(Number(value)) }); setReaderStyleVersion(version => version + 1) }}/>
            <span>{translate("阅读主题")}</span>
            <Select size="small" value={readerSiteStyle?.theme ?? 'light'} options={READER_THEMES.map(theme => ({ label: theme.value === 'light' ? translate("浅色") : theme.value === 'sepia' ? translate("护眼") : translate("深色"), value: theme.value }))} onChange={value => { writeReaderSiteStyle(active.url, { ...readerSiteStyle, theme: value as 'light' | 'sepia' | 'dark' }); setReaderStyleVersion(version => version + 1) }}/>
            <Button size="small" type="text" onClick={() => { setHideDraft(readerSiteStyle?.hide ?? ''); setHideLiveDraft(readerSiteStyle?.hideLive === true); setHideEditorOpen(true) }}>{translate("隐藏元素")}</Button>
            <Button size="small" type="text" onClick={() => { writeReaderSiteStyle(active.url, null); setReaderStyleVersion(version => version + 1) }}>{translate("重置")}</Button>
          </div>
          <ReaderArticleView article={readerArticle} style={readerSiteStyle}/>
        </>
      : active.crashed
        ? <BrowserErrorView tab={{...active, error:{kind:'load-failed',message:translate("此标签页的底层视图已停止响应，可点击\"重新打开\"恢复。")}}} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
        : active.error
          ? <BrowserErrorView tab={active} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl} onUnblock={active.error.kind === 'site-blocked' ? () => void unblockAndVisit(active.error?.entryId, active.url) : undefined}/>
        : nativeMode
          ? null
          : active.loading
            ? <div className="web-surface__loading"><LoadingOutlined spin/></div>
            : active.url
              ? <BrowserErrorView tab={{...active, error:{kind:'web-mode-required',message:translate("当前环境暂时无法打开此网页。")}}} onRetry={retryActive} onNewTab={openNewTab} onCopy={copyUrl}/>
              : <NewTab address={address} setAddress={setAddress} navigate={navigate} onCompareSearch={startComparison} onOpenLibrary={onOpenLibrary}/>}
      {splitDocument && <DocumentSplitPane document={splitDocument} onClose={closeDocumentSplit} ratio={splitRatio}/>}
      {splitTabId && <div className="split-pane-head" style={{ left: `${splitRatio * 100}%`, width: `${(1 - splitRatio) * 100}%` }}>
        <Dropdown menu={{ items: tabs.filter(tab => tab.id !== active.id && !tab.private).slice(0, 12).map(tab => ({ key: tab.id, label: tab.title || tab.url, onClick: () => setSplitTabId(tab.id) })) }} trigger={['click']}>
          <button type="button" className="split-pane-title" title={translate("切换右侧标签")}>{tabs.find(tab => tab.id === splitTabId)?.title ?? ''} ▾</button>
        </Dropdown>
        <Button size="small" type="text" onClick={closeSplit}>{translate("关闭分屏")}</Button>
      </div>}
      {splitChat && <div className="split-chat-pane" style={{ width: `${Math.round((1 - splitRatio) * 100)}%` }}>
        <AssistantPanel close={() => setSplitChat(false)} saveToLibrary={save} currentUrl={active.url} currentTabId={active.id} readerArticle={readerArticle ?? aiArticle} pageContextPending={aiContextPending} pageContextError={aiContextError} pdfArticle={pdfArticle} pdfContextError={pdfContextError} initialQuestion={aiInitialQuestion} initialMode={aiInitialMode} translationSource={aiTranslationSource}/>
      </div>}
      {(splitTabId || splitDocument || splitChat) && <div className="split-divider" style={{ left: `${splitRatio * 100}%` }} onPointerDown={startSplitDrag}/>}
      {docPair && <DocumentPairView left={docPair.left} right={docPair.right} onClose={closeDocPair}/>}</div>{aiOpen&&!nativeMode&&<AssistantPanel close={()=>setAiOpen(false)} saveToLibrary={save} currentUrl={active.url} currentTabId={active.id} readerArticle={readerArticle ?? aiArticle} pageContextPending={aiContextPending} pageContextError={aiContextError} pdfArticle={pdfArticle} pdfContextError={pdfContextError} initialQuestion={aiInitialQuestion} initialMode={aiInitialMode} translationSource={aiTranslationSource}/>}</div>
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
      title={translate("清除共享浏览数据")}
      okText={translate("清除并重新加载")}
      cancelText={translate("取消")}
      okButtonProps={{ danger: true }}
      onCancel={() => setClearSiteDataOpen(false)}
      onOk={async () => {
        try {
          await clearNativePageData(active.id)
          setClearSiteDataOpen(false)
          await reloadNativeTab(active.id)
          messageApi.success(translate("已清除 HTTP-only Cookie、磁盘缓存和当前网页存储"))
        } catch (error) { messageApi.error(translate("清除失败：{value0}",{value0:String(error)}))}
      }}
    >
      <Typography.Paragraph>{translate("将清除 WebView2 Profile 中的全部 Cookie（包括 HTTP-only Cookie）、磁盘缓存、Cache Storage 与 Service Worker，并清除当前网页的本地存储、会话存储和 IndexedDB。")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{translate("Cookie 与磁盘缓存由同一浏览器 Profile 共享，因此其他已打开网站可能需要重新登录或重新加载。")}</Typography.Paragraph>
    </Modal>
    <Modal
      open={blockPrompt !== null}
      title={translate("封杀 {value0}？",{value0:blockPrompt?.host??translate("此网站")})}
      okText={translate("封杀")}
      cancelText={translate("取消")}
      okButtonProps={{ danger: true }}
      onCancel={() => setBlockPrompt(null)}
      onOk={() => void confirmBlockCurrentSite()}
    >
      <Typography.Paragraph>{translate("封杀后，命中名单的页面会在发出请求前被取消；开关开启时，其他站点嵌入该站点的脚本、图片与 iframe 也会被阻断。")}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{translate("可随时在「设置 \u2192 隐私 \u2192 网站封杀」中解除，或使用菜单里的「解除封杀此网站」。")}</Typography.Paragraph>
      <Typography.Text code>{blockPrompt?.url}</Typography.Text>
    </Modal>
    <Modal
      open={passwordFillRequest !== null}
      title={translate("选择要填充的账号")}
      footer={null}
      onCancel={() => setPasswordFillRequest(null)}
      destroyOnHidden
    >
      {passwordFillRequest && <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text type="secondary">{translate("仅在你选择账号后才会向当前 HTTPS 页面填入密码。")}</Typography.Text>
        <Typography.Text code>{passwordFillRequest.origin}</Typography.Text>
        {passwordFillRequest.credentials.map(credential => <Button key={credential.id} block onClick={async () => {
          const request = passwordFillRequest
          setPasswordFillRequest(null)
          try {
            await fillBrowserPassword(request.tabLabel, credential.id)
            messageApi.success(translate("已填充账号 {value0}",{value0:credential.username}))
          } catch (error) { messageApi.error(translate("填充失败：{value0}",{value0:String(error)}))}
        }}>{credential.username}</Button>)}
      </Space>}
    </Modal>
    <Modal
      open={passwordCandidate !== null}
      title={passwordCandidate?.existingId ?translate("更新密码"):translate("保存密码")}
      okText={passwordCandidate?.existingId ?translate("更新系统密码库"):translate("保存到系统密码库")}
      cancelText={translate("暂不保存")}
      onCancel={() => setPasswordCandidate(null)}
      onOk={async () => {
        if (!passwordCandidate) return
        try {
          await saveBrowserPassword(passwordCandidate)
          setPasswordCandidate(null)
          messageApi.success(passwordCandidate.existingId ?translate("密码已安全更新"):translate("密码已安全保存，点击密码框即可选择填充"))
        } catch (error) {
          setPasswordCandidate(null)
          messageApi.error(translate("保存密码失败：{value0}",{value0:String(error)}))
        }
      }}
    >
      {passwordCandidate && <Space direction="vertical" style={{width:'100%'}}>
        <Typography.Text type="secondary">{translate("仅为 HTTPS 网站保存；密码正文写入操作系统凭据保险库，数据库只保存网站和用户名。")}</Typography.Text>
        <Typography.Text copyable>{passwordCandidate.origin}</Typography.Text>
        <Input value={passwordCandidate.username} onChange={event => setPasswordCandidate(current => current ? {...current, username:event.target.value} : current)} placeholder={translate("用户名")}/>
        <Input.Password value={passwordCandidate.password} onChange={event => setPasswordCandidate(current => current ? {...current, password:event.target.value} : current)} placeholder={translate("密码")}/>
        <Button onClick={async () => {
          const password = await generateBrowserPassword(20)
          setPasswordCandidate(current => current ? {...current, password} : current)
          await navigator.clipboard.writeText(password).catch(() => undefined)
          messageApi.success(translate("已生成强密码并复制，可粘贴到网页密码框"))
        }}>{translate("生成强密码并复制")}</Button>
      </Space>}
    </Modal>
    <Modal
      open={sourceView !== null}
      title={translate("页面源代码")}
      footer={null}
      width="min(1100px, 92vw)"
      onCancel={() => setSourceView(null)}
      destroyOnHidden
    >
      {sourceView && <><Typography.Paragraph type="secondary" copyable>{sourceView.url}</Typography.Paragraph><pre style={{maxHeight:'70vh',overflow:'auto',whiteSpace:'pre-wrap',wordBreak:'break-word',padding:12,background:'#f6f8fa',borderRadius:8}}><code>{sourceView.html}</code></pre></>}
    </Modal>
    <Modal
      open={pendingShellOpen !== null}
      title={translate("打开外部应用")}
      okText={translate("在系统应用中打开")}
      cancelText={translate("取消")}
      onCancel={() => setPendingShellOpen(null)}
      onOk={async () => {
        const url = pendingShellOpen
        setPendingShellOpen(null)
        if (!url) return
        try { await shellOpen(url) } catch (error) { messageApi.error(translate("无法启动外部应用：{value0}",{value0:String(error)}))}
      }}
    >
      {pendingShellOpen &&  (()=> {
        const verdict = classifyShellOpenUrl(pendingShellOpen)
        return <>
            <Typography.Paragraph>{translate("即将离开浏览器，由")} <b>{describeScheme(verdict.scheme)}</b> {translate("处理：")}</Typography.Paragraph>
            <Typography.Text code className="browser-error__url">{pendingShellOpen}</Typography.Text>
          </>
      }                      )()}
    </Modal>
  </div>
}
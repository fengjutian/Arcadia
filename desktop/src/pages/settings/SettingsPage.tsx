import { t } from '../../i18n'
import { Alert, Button, Card, Descriptions, Drawer, Form, Input, InputNumber, List, message, Popconfirm, Segmented, Select, Space, Spin, Statistic, Switch, Tabs, Tag, Typography } from '../../components/ui'
import { BgColorsOutlined, CheckCircleOutlined, DeleteOutlined, KeyOutlined, MoonOutlined, PictureOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, SunOutlined, ThunderboltOutlined } from '../../components/ui/icons'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import appLogo from '../../assets/app-logo-humanist.png'
import { PageHeader } from '../../shared/components/PageHeader'
import { callMcpTool, clearBrowserHistory, clearClosedTabs as clearClosedTabsInDb, clearReadingSnapshots, deleteAIProvider, deleteMcpServer, discoverMcpServer, dispatchPluginEvent, exportBackup, getAIProvider, getBrowserShortcutsEnabled, getReadingSnapshotStats, importBackup, installPlugin, listAIProviders, listBrowserHistory, listBrowserHistoryPage, listMcpResources, listMcpServers, listMcpTools, listPluginAudit, listPlugins, privacyCapabilityReport, privacyGetStats, privacyListBlocklists, privacyListBlockEvents, privacySetBlocklistEnabled, purgeReadingSnapshots, ragCancelJob, ragEnqueueAll, ragIndexStatus, ragListJobs, ragRebuildIndex, ragRetryJob, replaceSitePermissions, saveAIProvider, saveMcpServer, aiTestProvider, setBrowserShortcutsEnabled, setPluginEnabled, setPluginPermission, uninstallPlugin, type AIProviderInput, type InstalledPlugin, type McpServer, type McpTransport, type PluginAuditEntry, type PluginPermission, type ReadingSnapshotStats } from '../../api'
import type { AIProvider, AIProviderType } from '../../types'
import { normalizeOrigin, readSitePermissions, writeSitePermissions, type SitePermissionKind, type SitePermissionRule } from '../../features/browser/sitePermissions'
import { KnowledgeBaseStatusPanel } from '../../features/settings/KnowledgeBaseStatusPanel'
import { TaskPanel } from '../../features/tasks/TaskPanel'
import { SiteBlacklistPanel } from '../../features/privacy/SiteBlacklistPanel'
import { readThemePreference, writeThemePreference, type ThemePreference } from '../../features/settings/theme'
import { IMAGE_THEMES, readAppearancePreference, readImageTheme, readThemeKind, writeAppearancePreference, writeImageTheme, writeThemeKind, type AppearancePreference, type ImageThemeId, type ThemeKind } from '../../features/settings/visualTheme'
import { loadBingDailyImage, readBingDailyRefresh, readCachedBingDailyImage, writeBingDailyRefresh, type BingDailyImage } from '../../features/settings/bingDailyTheme'
import { readSearchEngineConfig, resolveActiveSearchTemplate, SEARCH_ENGINE_PRESETS, writeSearchEngineConfig } from '../../features/browser/searchEngine'
import { isSearchTemplateValid } from '../../features/browser/navigation'
import { HISTORY_CHANGE_EVENT, type HistoryEntry } from '../../features/history/dedupeHistory'
import { buildVisitStats, buildVisitTrend, filterVisitsByRange, type VisitTimeRange } from '../../features/history/visitStats'
import { DEFAULT_ADVANCED_SETTINGS, readAdvancedSettings, writeAdvancedSettings, type AdvancedSettings } from '../../features/settings/advanced'
import { DEFAULT_TYPOGRAPHY_SETTINGS, FONT_SIZE_MAX, FONT_SIZE_MIN, TYPOGRAPHY_FONTS, readTypographySettings, typographyFont, writeTypographySettings, type TypographySettings } from '../../features/settings/typography'
import { isTrackingCleanerEnabled, setTrackingCleanerEnabled } from '../../features/plugins/trackingCleaner'
import { isAdBlockerEnabled, setAdBlockerEnabled } from '../../features/plugins/adBlocker'
import { deleteBrowserPassword, listBrowserPasswords, setNativeAdBlocking, type SavedCredential } from '../../services/nativeBrowser'
import { pickFiles } from '../../services/webviewCompat'
import { PrivacyExportPanel } from '../../features/privacy/PrivacyExportPanel'
import { getAdBlockStats, onAdBlockStatsChange, resetAdBlockStats, resetSessionAdBlockStats, type AdBlockStatsSnapshot } from '../../features/privacy/adBlockStats'
import { formatStringMap, parseArguments, parseStringMap } from '../../features/mcp/config'
import {
  bindingToDisplay,
  clearShortcutOverride,
  isOverridden,
  readShortcutOverrides,
  resetAllShortcutOverrides,
  SHORTCUT_DEFINITIONS,
  SHORTCUT_OVERRIDES_EVENT,
  writeShortcutOverrides,
  type ShortcutAction,
  type ShortcutOverrides,
} from '../../features/browser/shortcuts'
import { deleteWorkspace, listWorkspaces, saveWorkspace, validateWorkspaceDescription, validateWorkspaceName, decorateSummaries, relativeUpdatedAt, type WorkspaceDisplayRow, WORKSPACE_RESTORE_EVENT } from '../../features/browser/workspaces'
import { getWorkspace } from '../../services/workspaces'
import { addSearchAlias, deleteSearchAlias, getSearchIndexStatus, listSearchAliases, rebuildSearchIndex, type SearchAlias, type SearchIndexStatus } from '../../api'
import { DEFAULT_BROWSER_APPEARANCE, readBrowserAppearance, writeBrowserAppearance, type BrowserAppearanceSettings, type OptionalToolbarItem } from '../../features/settings/browserAppearance'
import { readDownloadSettings, writeDownloadSettings, type DownloadSettings } from '../../features/settings/downloadSettings'
import { getDefaultDownloadDirectory } from '../../services/downloads'
import { resetBrowserPreferences } from '../../features/settings/resetSettings'

const PROVIDER_OPTIONS: { label: string; value: AIProviderType }[] = [
  { label:t("OpenAI \u517C\u5BB9\uFF08API Key\uFF09"),value:'openai-compatible'},
  { label:t("Ollama\uFF08\u672C\u5730\uFF09"),value:'ollama'},
  { label: 'DeepSeek', value: 'deepseek' },
  { label:t("Qwen\uFF08\u901A\u4E49\u5343\u95EE\uFF09"),value:'qwen'},
  { label: 'Kimi（Moonshot）', value: 'kimi' },
  { label: 'MiniMax', value: 'minimax' },
]

const PROVIDER_PRESETS: Record<AIProviderType, { baseUrl: string; defaultModel: string; placeholderModel: string; embeddingModel?: string; embeddingPlaceholder: string }> = {
  'openai-compatible': { baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen3.6-27B', placeholderModel: 'Qwen/Qwen3.6-27B', embeddingModel: 'BAAI/bge-m3', embeddingPlaceholder: 'BAAI/bge-m3' },
  ollama: { baseUrl: 'http://localhost:11434', defaultModel: 'llama3.1', placeholderModel: 'llama3.1', embeddingModel: 'nomic-embed-text', embeddingPlaceholder: 'nomic-embed-text' },
  deepseek: { baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash', placeholderModel: 'deepseek-flash', embeddingPlaceholder:t("\u8BE5 Provider \u6682\u65E0\u901A\u7528 Embedding \u9ED8\u8BA4\u503C")},
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', placeholderModel: 'qwen-plus', embeddingModel: 'text-embedding-v3', embeddingPlaceholder: 'text-embedding-v3' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', placeholderModel: 'moonshot-v1-8k', embeddingPlaceholder:t("\u8BE5 Provider \u6682\u65E0\u901A\u7528 Embedding \u9ED8\u8BA4\u503C")},
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', defaultModel: 'MiniMax-M3', placeholderModel: 'MiniMax-M3', embeddingPlaceholder:t("MiniMax \u6682\u65E0\u901A\u7528 Embedding \u9ED8\u8BA4\u503C")},
}

const MINIMAX_MODEL_OPTIONS = [
  { label:t("MiniMax M3\uFF08\u6700\u65B0\uFF09"),value:'MiniMax-M3'},
  { label: 'MiniMax M2.7', value: 'MiniMax-M2.7' },
]

const PROVIDER_TAG_COLOR: Record<AIProviderType, string> = {
  'openai-compatible': 'purple',
  ollama: 'geekblue',
  deepseek: 'cyan',
  qwen: 'magenta',
  kimi: 'volcano',
  minimax: 'gold',
}

interface ProviderFormValues {
  id?: string
  type: AIProviderType
  baseUrl: string
  model: string
  embeddingModel?: string
  timeoutSeconds: number
  apiKey?: string
}

const THEME_OPTIONS: Array<{
  value: ThemePreference
  label: string
  description: string
  swatch: [string, string]
}> = [
  { value: 'green', label:t("\u81EA\u7136\u7EFF"),description:t("\u67D4\u548C\u3001\u4E13\u6CE8\u7684\u9ED8\u8BA4\u5916\u89C2"),swatch:['#dce8df','#347851']},
  { value: 'beige', label:t("\u6696\u7C73\u8272"),description:t("\u9002\u5408\u957F\u65F6\u95F4\u9605\u8BFB"),swatch:['#eee2d1','#8a6846']},
  { value: 'light', label:t("\u7ECF\u5178\u6D45\u8272"),description:t("\u6E05\u723D\u7684\u4E2D\u6027\u754C\u9762"),swatch:['#e7ece9','#3f6f5a']},
  { value: 'github', label: 'GitHub', description:t("\u719F\u6089\u7684\u84DD\u8272\u5F00\u53D1\u8005\u98CE\u683C"),swatch:['#ddf4ff','#0969da']},
  { value: 'ocean', label:t("\u6D77\u6D0B\u84DD"),description:t("\u6C89\u7A33\u6E05\u6670\u7684\u84DD\u8272\u754C\u9762"),swatch:['#dbeaf8','#2563a8']},
  { value: 'cyan', label:t("\u9752\u84DD"),description:t("\u6E05\u900F\u73B0\u4EE3\u7684\u9752\u8272\u754C\u9762"),swatch:['#d7eff1','#087f8c']},
  { value: 'mint', label:t("\u8584\u8377"),description:t("\u8F7B\u76C8\u8212\u7F13\u7684\u8584\u8377\u7EFF\u8272"),swatch:['#dcefe7','#2f7d68']},
  { value: 'amber', label:t("\u7425\u73C0"),description:t("\u6E29\u6696\u9192\u76EE\u7684\u91D1\u8272\u754C\u9762"),swatch:['#f4e8c7','#9a6a00']},
  { value: 'coral', label:t("\u73CA\u745A"),description:t("\u67D4\u548C\u800C\u6709\u6D3B\u529B\u7684\u6A59\u7EA2\u8272"),swatch:['#f3ded4','#b4512f']},
  { value: 'rose', label:t("\u73AB\u7470"),description:t("\u4F18\u96C5\u67D4\u548C\u7684\u73AB\u7470\u8272\u754C\u9762"),swatch:['#f1dce3','#ad4968']},
  { value: 'violet', label:t("\u7D2B\u7F57\u5170"),description:t("\u7CBE\u81F4\u6C89\u9759\u7684\u7D2B\u8272\u754C\u9762"),swatch:['#e7def3','#7352ad']},
]

function GeneralSettings() {
  const initialTheme = readThemePreference()
  const [theme, setTheme] = useState<ThemePreference>(initialTheme === 'dark' || initialTheme === 'system' ? 'green' : initialTheme)
  const [appearance, setAppearance] = useState<AppearancePreference>(readAppearancePreference)
  const [themeKind, setThemeKind] = useState<ThemeKind>(readThemeKind)
  const [imageTheme, setImageTheme] = useState<ImageThemeId>(readImageTheme)
  const [bingImage, setBingImage] = useState<BingDailyImage | null>(readCachedBingDailyImage)
  const [bingLoading, setBingLoading] = useState(false)
  const [bingDailyRefresh, setBingDailyRefresh] = useState(readBingDailyRefresh)

  useEffect(() => {
    if (themeKind !== 'image') return
    void loadBingDailyImage().then(image => { if (image) setBingImage(image) })
  }, [themeKind])

  function changeTheme(next: string | number) {
    const preference = next as ThemePreference
    setTheme(preference)
    setThemeKind('color')
    writeThemePreference(preference)
    writeThemeKind('color')
  }

  function changeAppearance(next: string | number) {
    const value = next as AppearancePreference
    setAppearance(value)
    writeAppearancePreference(value)
  }

  function changeThemeKind(value: ThemeKind) {
    setThemeKind(value)
    writeThemeKind(value)
  }

  function changeImageTheme(value: ImageThemeId) {
    setImageTheme(value)
    setThemeKind('image')
    writeImageTheme(value)
    if (value !== 'bing' && bingDailyRefresh) {
      setBingDailyRefresh(false)
      writeBingDailyRefresh(false)
    }
  }

  async function selectBingTheme(force = false) {
    setBingLoading(true)
    const image = await loadBingDailyImage(force)
    setBingLoading(false)
    if (image) setBingImage(image)
    changeImageTheme('bing')
  }

  function changeBingDailyRefresh(enabled: boolean) {
    setBingDailyRefresh(enabled)
    writeBingDailyRefresh(enabled)
    if (enabled) void selectBingTheme(true)
  }

  function restoreDefaults() {
    setTheme('green')
    setAppearance('system')
    setThemeKind('color')
    writeThemePreference('green')
    writeAppearancePreference('system')
    writeThemeKind('color')
  }

  const selected = THEME_OPTIONS.find(option => option.value === theme) ?? THEME_OPTIONS[0]
  const selectedImage = IMAGE_THEMES.find(item => item.id === imageTheme) ?? IMAGE_THEMES[0]
  const selectedImageUrl = imageTheme === 'bing' && bingImage ? bingImage.url : selectedImage.url
  const selectedImageLabel = imageTheme === 'bing' ?( bingImage?.title ??t("Bing \u6BCF\u65E5\u4E00\u56FE")):selectedImage.label

  return <Card title={t("\u5916\u89C2")}className="settings-card theme-settings">
    <div className="theme-settings__heading">
      <div>
        <Typography.Title level={5}>{t("\u4E3B\u9898")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("\u9009\u62E9\u559C\u6B22\u7684\u989C\u8272\u4E3B\u9898\u3002\u66F4\u6539\u4F1A\u7ACB\u5373\u751F\u6548\uFF0C\u5E76\u81EA\u52A8\u4FDD\u5B58\u3002")}</Typography.Paragraph>
      </div>
      <Button icon={<ReloadOutlined/>} disabled={theme === 'green' && appearance === 'system' && themeKind === 'color'} onClick={restoreDefaults}>{t("\u6062\u590D\u9ED8\u8BA4\u503C")}</Button>
    </div>

    <section className="appearance-setting">
      <div className="appearance-setting__copy"><span>◐</span><div><strong>{t("\u6574\u4F53\u5916\u89C2")}</strong><small>{t("\u5E94\u7528\u4E8E\u6807\u7B7E\u9875\u3001\u9875\u9762\u3001\u5BF9\u8BDD\u6846\u548C\u5176\u4ED6\u83DC\u5355\u3002")}</small></div></div>
      <Segmented value={appearance} onChange={changeAppearance} options={[
        { label:t("\u25B0 \u7CFB\u7EDF"),value:'system'},
        { label: <Space><SunOutlined/>{t("\u6D45\u8272")}</Space>,value:'light'},
        { label: <Space><MoonOutlined/>{t("\u6DF1\u8272")}</Space>,value:'dark'},
      ]}/>
    </section>

    <div className="theme-mode-tabs" aria-label={t("\u4E3B\u9898\u7C7B\u578B")}>
      <button type="button" className={themeKind === 'color' ? 'is-active' : ''} onClick={() => changeThemeKind('color')}><BgColorsOutlined/>{t("\u989C\u8272\u4E3B\u9898")}</button>
      <button type="button" className={themeKind === 'image' ? 'is-active' : ''} onClick={() => changeThemeKind('image')}><PictureOutlined/>{t("\u56FE\u50CF\u4E3B\u9898")}</button>
    </div>

    {themeKind === 'color' ? <div className="theme-palette" role="radiogroup" aria-label={t("\u9009\u62E9\u989C\u8272\u4E3B\u9898")}>
      {THEME_OPTIONS.map(option => <button
        key={option.value}
        type="button"
        role="radio"
        aria-checked={theme === option.value}
        aria-label={`${option.label}：${option.description}`}
        title={option.label}
        className={`theme-swatch${theme === option.value ? ' is-selected' : ''}`}
        onClick={() => changeTheme(option.value)}
        style={{ '--theme-swatch-soft': option.swatch[0], '--theme-swatch-accent': option.swatch[1] } as CSSProperties}
      ><span/><small>{option.label}</small></button>)}
    </div> : <div className="image-theme-panel">
      <div className="image-theme-toolbar"><span>{t("\u5E94\u7528\u7684\u4E3B\u9898\uFF1A")}<strong>{selectedImageLabel}</strong></span></div>
      <section className="image-theme-section image-theme-section--daily">
        <div className="image-theme-section__heading">
          <div><strong>{t("\u6BCF\u65E5\u4E00\u56FE")}</strong><small>{t("\u8054\u7F51\u83B7\u53D6 Bing \u5F53\u65E5\u58C1\u7EB8\uFF0C\u6BCF\u5929\u81EA\u52A8\u66F4\u65B0\u3002")}</small></div>
          <label title={t("\u6BCF\u5929\u81EA\u52A8\u83B7\u53D6 Bing \u5F53\u65E5\u58C1\u7EB8")}>{t("\u81EA\u52A8\u66F4\u65B0")} <Switch checked={bingDailyRefresh}onChange={changeBingDailyRefresh}/></label>
        </div>
        <div className="image-theme-daily-row">
          <button
            type="button"
            role="radio"
            aria-checked={imageTheme === 'bing'}
            className={`image-theme-card${imageTheme === 'bing' ? ' is-selected' : ''}`}
            onClick={() => void selectBingTheme()}
          >{bingImage ? <img src={bingImage.url} alt=""/> : <span className="image-theme-card__placeholder"><PictureOutlined/></span>}<span><strong>{bingLoading ?t("\u6B63\u5728\u83B7\u53D6\u2026"):bingImage?.title??t("Bing \u6BCF\u65E5\u4E00\u56FE")}</strong><small>{bingImage?.copyright??t("\u8054\u7F51\u540E\u81EA\u52A8\u83B7\u53D6 Bing \u5F53\u65E5\u58C1\u7EB8")}</small></span></button>
          <div className="image-theme-daily-copy"><span>{t("\u56FE\u7247\u6765\u6E90\uFF1ABing")}</span><span>{bingImage?.date?t("\u58C1\u7EB8\u65E5\u671F\uFF1A{value0}",{value0:bingImage.date}):t("\u5C1A\u672A\u83B7\u53D6\u4ECA\u65E5\u56FE\u7247")}</span><Button size="small"loading={bingLoading}onClick={()=>void selectBingTheme(true)}>{t("\u7ACB\u5373\u5237\u65B0")}</Button></div>
        </div>
      </section>
      <section className="image-theme-section">
        <div className="image-theme-section__heading"><div><strong>{t("\u9ED8\u8BA4\u56FE\u7247")}</strong><small>{t("\u5185\u7F6E\u4E8E\u5E94\u7528\uFF0C\u4E0D\u4F1A\u968F\u65E5\u671F\u53D8\u5316\u3002")}</small></div></div>
        <div className="image-theme-grid" role="radiogroup" aria-label={t("\u9009\u62E9\u9ED8\u8BA4\u56FE\u7247")}>
          {IMAGE_THEMES.map(option => <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={imageTheme === option.id}
            className={`image-theme-card${imageTheme === option.id ? ' is-selected' : ''}`}
            onClick={() => changeImageTheme(option.id)}
          ><img src={option.url} alt=""/><span><strong>{option.label}</strong><small>{option.description}</small></span></button>)}
        </div>
      </section>
    </div>}

    <div
      className={`theme-preview theme-preview--${theme}${themeKind === 'image' ? ' is-image-theme' : ''}`}
      style={themeKind === 'image' ?( { '--theme-image': `url("${selectedImageUrl}")` } as CSSProperties) : undefined}
      aria-label={themeKind === 'image' ?t("\u56FE\u50CF\u4E3B\u9898\u9884\u89C8"):t("{value0}\u4E3B\u9898\u9884\u89C8",{value0:selected.label})}
    >
      <div className="theme-preview__chrome">
        <span className="theme-preview__tab">{t("\u65B0\u6807\u7B7E\u9875")}</span>
        <i/><i/><i/>
      </div>
      <div className="theme-preview__toolbar"><span/><b/></div>
      <div className="theme-preview__body">
        <aside><i/><i className="is-active"/><i/><i/></aside>
        <main><strong>{themeKind === 'image' ? selectedImageLabel : selected.label}</strong><small>{themeKind === 'image' ?t("\u56FE\u50CF\u4E3B\u9898\u5DF2\u5E94\u7528\u5230\u6D4F\u89C8\u5668\u6807\u7B7E\u533A\u548C\u65B0\u6807\u7B7E\u9875"):selected.description}</small><div><span/><span/><span/></div></main>
      </div>
    </div>
  </Card>
}

const SHORTCUTS_EVENT = 'arcadia-shortcuts-change'

function WorkspacesEditor() {
  const [messageApi, contextHolder] = message.useMessage()
  const [rows, setRows] = useState<WorkspaceDisplayRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

  async function refresh() {
    if (!('__TAURI_INTERNALS__' in window)) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const items = await listWorkspaces()
      setRows(decorateSummaries(items))
    } catch (error) {
      messageApi.error(t("\u8BFB\u53D6\u5DE5\u4F5C\u533A\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  function startEdit(row: WorkspaceDisplayRow) {
    setEditingId(row.id)
    setDraftName(row.name)
    setDraftDescription(row.description)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftName('')
    setDraftDescription('')
  }

  async function saveEdit(row: WorkspaceDisplayRow) {
    const nameCheck = validateWorkspaceName(draftName)
    if (!nameCheck.ok) {
      messageApi.warning(nameCheck.reason ??t("\u540D\u79F0\u65E0\u6548"))
      return
    }
    const descCheck = validateWorkspaceDescription(draftDescription)
    if (!descCheck.ok) {
      messageApi.warning(descCheck.reason ??t("\u63CF\u8FF0\u65E0\u6548"))
      return
    }
    try {
      const payload = await getWorkspace(row.id)
      const summary = await saveWorkspace({
        id: row.id,
        name: nameCheck.reason ? row.name : draftName.trim(),
        description: draftDescription.trim(),
        payload: payload?.payload ?? { tabs: [], activeTabId: '' },
      })
      messageApi.success(t("\u5DF2\u66F4\u65B0\u5DE5\u4F5C\u533A\u300C{value0}\u300D",{value0:summary.name}))
      cancelEdit()
      await refresh()
    } catch (error) {
      messageApi.error(t("\u66F4\u65B0\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function overwrite(row: WorkspaceDisplayRow) {
    try {
      const payload = await getWorkspace(row.id)
      if (!payload) return
      const summary = await saveWorkspace({
        id: row.id,
        name: row.name,
        description: row.description,
        payload: { ...payload.payload, refreshedAt: new Date().toISOString() },
      })
      messageApi.success(t("\u5DF2\u5237\u65B0\u300C{value0}\u300D\u65F6\u95F4\u6233",{value0:summary.name}))
      await refresh()
    } catch (error) {
      messageApi.error(t("\u5237\u65B0\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function remove(row: WorkspaceDisplayRow) {
    try {
      await deleteWorkspace(row.id)
      messageApi.success(t("\u5DF2\u5220\u9664\u5DE5\u4F5C\u533A\u300C{value0}\u300D",{value0:row.name}))
      if (editingId === row.id) cancelEdit()
      await refresh()
    } catch (error) {
      messageApi.error(t("\u5220\u9664\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  async function restore(row: WorkspaceDisplayRow) {
    try {
      window.dispatchEvent(new CustomEvent(WORKSPACE_RESTORE_EVENT, { detail: { id: row.id } }))
      messageApi.info(t("\u6B63\u5728\u6062\u590D\u300C{value0}\u300D\u2026",{value0:row.name}),1.5)
    } catch (error) {
      messageApi.error(t("\u6062\u590D\u8BF7\u6C42\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))
    }
  }

  return <>{contextHolder}<div className="workspaces-editor">
    <div className="workspaces-editor__header">
      <Typography.Paragraph type="secondary">{t("\u4ECE\u6D4F\u89C8\u5668\u5DE5\u5177\u680F\u7684\u300C\u22EF\u300D\u2192\u300C\u4FDD\u5B58\u5F53\u524D\u6807\u7B7E\u4E3A\u5DE5\u4F5C\u533A\u300D\u53EF\u4FDD\u5B58\u5FEB\u7167\uFF1B\u8FD9\u91CC\u53EF\u4EE5\u6539\u540D\u3001\u5237\u65B0\u65F6\u95F4\u6233\u6216\u5220\u9664\u3002")}</Typography.Paragraph>
    </div>
    {rows.length === 0
      ? <Typography.Text type="secondary">{loading ?t("\u8BFB\u53D6\u4E2D\u2026"):t("\u8FD8\u6CA1\u6709\u4FDD\u5B58\u8FC7\u5DE5\u4F5C\u533A")}</Typography.Text>
      : <ul className="workspaces-editor__list">
          {rows.map(row => {
              const isEditing = editingId === row.id
              return <li key={row.id} className={`workspaces-editor__row${isEditing ? ' is-editing' : ''}`}>
                {isEditing ? <>
                  <Space.Compact block>
                    <Input value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={80} placeholder={t("\u540D\u79F0")}/>
                  </Space.Compact>
                  <Input.TextArea value={draftDescription} onChange={event => setDraftDescription(event.target.value)} maxLength={240} rows={2} placeholder={t("\u63CF\u8FF0")}/>
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => void saveEdit(row)}>{t("\u4FDD\u5B58")}</Button>
                    <Button size="small" onClick={cancelEdit}>{t("\u53D6\u6D88")}</Button>
                  </Space>
                </> : <>
                  <span className="workspaces-editor__name">{row.name}</span>
                  <span className="workspaces-editor__meta">{row.tabCount} {t("\u4E2A\u6807\u7B7E \xB7")} {row.relativeUpdated}</span>
                  {row.description ? <Typography.Paragraph type="secondary" ellipsis={{ rows: 2, tooltip: row.description }} className="workspaces-editor__desc">{row.description}</Typography.Paragraph> : <span/>}
                  <Space size={4}>
                    <Button size="small" onClick={() => void restore(row)} disabled={row.isEmpty}>{t("\u6062\u590D")}</Button>
                    <Button size="small" onClick={() => startEdit(row)}>{t("\u7F16\u8F91")}</Button>
                    <Button size="small" onClick={() => void overwrite(row)}>{t("\u5237\u65B0\u65F6\u95F4\u6233")}</Button>
                    <Popconfirm title={t("\u5220\u9664\u5DE5\u4F5C\u533A\u300C{value0}\u300D\uFF1F",{value0:row.name})}description={t("\u4EC5\u79FB\u9664\u6570\u636E\u5E93\u4E2D\u7684\u5DE5\u4F5C\u533A\u8BB0\u5F55\uFF0C\u4E0D\u5F71\u54CD\u5DF2\u6253\u5F00\u7684\u6807\u7B7E\u9875\u3002")}okText={t("\u5220\u9664")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>void remove(row)}>
                      <Button size="small" danger icon={<DeleteOutlined/>}/>
                    </Popconfirm>
                  </Space>
                </>}
              </li>
            })}
        </ul>}
  </div></>
}

function BrowserSettings() {
  const [enabled, setEnabled] = useState<boolean>(() => getBrowserShortcutsEnabled())
  const [messageApi, contextHolder] = message.useMessage()
  const [overrides, setOverrides] = useState<ShortcutOverrides>(() => readShortcutOverrides())
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  const [appearance, setAppearance] = useState<BrowserAppearanceSettings>(readBrowserAppearance)

  function updateAppearance(next: BrowserAppearanceSettings) {
    setAppearance(writeBrowserAppearance(next))
  }

  function toggleToolbarItem(item: OptionalToolbarItem, checked: boolean) {
    updateAppearance({ ...appearance, toolbar: { ...appearance.toolbar, [item]: checked } })
  }

  useEffect(() => {
    function onChange(event: Event) {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail
      setEnabled(detail.enabled)
    }
    window.addEventListener(SHORTCUTS_EVENT, onChange)
    return () => window.removeEventListener(SHORTCUTS_EVENT, onChange)
  }, [])

  useEffect(() => {
    function onOverrides(event: Event) {
      const detail = (event as CustomEvent<ShortcutOverrides>).detail
      setOverrides(detail ?? readShortcutOverrides())
    }
    window.addEventListener(SHORTCUT_OVERRIDES_EVENT, onOverrides)
    return () => window.removeEventListener(SHORTCUT_OVERRIDES_EVENT, onOverrides)
  }, [])

  function recordBinding(action: ShortcutAction, event: React.KeyboardEvent<HTMLLIElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape' && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      setRecording(null)
      return
    }
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return
    const next: ShortcutOverrides = {
      ...readShortcutOverrides(),
      [action]: {
        key: event.key,
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      },
    }
    writeShortcutOverrides(next)
    setOverrides(next)
    setRecording(null)
  }

  function resetOne(action: ShortcutAction) {
    clearShortcutOverride(action)
    setOverrides(readShortcutOverrides())
  }

  function resetAll() {
    resetAllShortcutOverrides()
    setOverrides({})
  }

  function toggle(next: boolean) {
    setEnabled(next)
    setBrowserShortcutsEnabled(next)
  }

  return <>{contextHolder}<Card title={t("\u6D4F\u89C8\u5668")}className="settings-card browser-settings-card">
    <Tabs className="browser-settings-tabs privacy-section-tabs" tabPosition="top" defaultActiveKey="shortcuts" destroyOnHidden={false} items={[
      { key: 'appearance', label:t("\u5916\u89C2"),children:<div className="browser-appearance-settings">
        <Typography.Title level={5}>{t("\u9875\u9762\u7F29\u653E")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("\u8BBE\u7F6E\u6240\u6709\u65B0\u9875\u9762\u7684\u9ED8\u8BA4\u7F29\u653E\u7EA7\u522B\u3002\u5F53\u524D\u6807\u7B7E\u4ECD\u53EF\u901A\u8FC7 Ctrl/\u2318 + \u52A0\u53F7\u6216\u51CF\u53F7\u5355\u72EC\u8C03\u6574\u3002")}</Typography.Paragraph>
        <div className="browser-setting-row">
          <div><Typography.Text strong>{t("\u9ED8\u8BA4\u9875\u9762\u7F29\u653E")}</Typography.Text><Typography.Text type="secondary">{t("\u65B0\u6253\u5F00\u7684\u7F51\u9875\u5C06\u4F7F\u7528\u6B64\u6BD4\u4F8B")}</Typography.Text></div>
          <Select value={appearance.defaultZoom} style={{ width: 120 }} options={[0.5,0.75,0.8,0.9,1,1.1,1.25,1.5,1.75,2,2.5,3].map(         (value                                          )=>({value,label:`${Math.round(value*100)}%`}))}onChange={value=>updateAppearance({...appearance,defaultZoom:value})}/>
        </div>
        <Typography.Title level={5}>{t("\u5DE5\u5177\u680F")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("\u9009\u62E9\u5730\u5740\u680F\u4E24\u4FA7\u663E\u793A\u7684\u529F\u80FD\u3002\u5BFC\u822A\u6309\u94AE\u3001\u5730\u5740\u680F\u548C\u4E3B\u83DC\u5355\u59CB\u7EC8\u663E\u793A\u3002")}</Typography.Paragraph>
        <div className="toolbar-settings-list">
          {([
            ['reader',t("\u9605\u8BFB\u6A21\u5F0F"),t("\u5C06\u5F53\u524D\u7F51\u9875\u8F6C\u6362\u4E3A\u4E13\u6CE8\u9605\u8BFB\u89C6\u56FE")],
            ['adBlock',t("\u5E7F\u544A\u8FC7\u6EE4\u72B6\u6001"),t("\u663E\u793A\u5F53\u524D\u6807\u7B7E\u62E6\u622A\u7684\u5E7F\u544A\u6570\u91CF")],
            ['ai',t("AI \u52A9\u624B"),t("\u5FEB\u901F\u6253\u5F00\u5F53\u524D\u9875\u9762\u7684 AI \u52A9\u624B")],
            ['downloads',t("\u4E0B\u8F7D"),t("\u67E5\u770B\u6B63\u5728\u8FDB\u884C\u548C\u6700\u8FD1\u5B8C\u6210\u7684\u4E0B\u8F7D")],
            ['bookmarks',t("\u6536\u85CF\u5939"),t("\u5FEB\u901F\u8BBF\u95EE\u5DF2\u6536\u85CF\u7684\u9875\u9762")],
            ['resources',t("\u8D44\u6E90\u9762\u677F"),t("\u67E5\u770B\u6807\u7B7E\u9875\u548C WebView \u8D44\u6E90\u72B6\u6001")],
          ] as Array<[OptionalToolbarItem, string, string]>).map(([key, label, description]) => <div className="browser-setting-row" key={key}>
            <div><Typography.Text strong>{label}</Typography.Text><Typography.Text type="secondary">{description}</Typography.Text></div>
            <Switch checked={appearance.toolbar[key]} onChange={checked => toggleToolbarItem(key, checked)}/>
          </div>)}
        </div>
        <Button onClick={() => updateAppearance(DEFAULT_BROWSER_APPEARANCE)} disabled={JSON.stringify(appearance) === JSON.stringify(DEFAULT_BROWSER_APPEARANCE)}>{t("\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E")}</Button>
      </div> },
      { key: 'shortcuts', label:t("\u952E\u76D8\u5FEB\u6377\u952E"),children:<>
    <Typography.Title level={5}>{t("\u952E\u76D8\u5FEB\u6377\u952E")}</Typography.Title>
    <Typography.Paragraph type="secondary">{t("\u5173\u95ED\u540E,\u6D4F\u89C8\u5668\u89C6\u56FE\u4E0D\u518D\u62E6\u622A Ctrl/Cmd + T\u3001W\u3001Tab\u30011-9\u3001Alt + \u2190/\u2192 \u7B49\u5168\u5C40\u5FEB\u6377\u952E,\u6539\u7531\u5404 WebView \u81EA\u884C\u5904\u7406\u3002")}</Typography.Paragraph>
    <Space>
      <Switch checked={enabled} onChange={toggle} />
      <Typography.Text>{enabled ?t("\u5DF2\u542F\u7528"):t("\u5DF2\u7981\u7528")}</Typography.Text>
    </Space>
    <div className="shortcut-editor">
      <div className="shortcut-editor__header">
        <Typography.Paragraph type="secondary">{t("\u70B9\u51FB\u300C\u4FEE\u6539\u300D\u540E\u6309\u4E0B\u4EFB\u610F\u7EC4\u5408\u952E\u5373\u53EF\u7ED1\u5B9A\uFF1BEsc \u6682\u505C\u5373\u53D6\u6D88\u5F55\u5236\u3002Ctrl \u4E0E \u2318 \u89C6\u4E3A\u540C\u4E00\u4E2A\u4E3B\u6309\u94AE\u3002")}</Typography.Paragraph>
        <Button size="small" disabled={Object.keys(overrides).length === 0} onClick={resetAll}>{t("\u91CD\u7F6E\u5168\u90E8")}</Button>
      </div>
      <ul className="shortcut-editor__list">
        {SHORTCUT_DEFINITIONS.map(def => {
          const binding = overrides[def.action] ?? def.default
          const recordingThis = recording === def.action
          const customised = isOverridden(def.action, overrides)
          return <li key={def.action} className={`shortcut-editor__row${recordingThis ? ' is-recording' : ''}${customised ? ' is-overridden' : ''}`} tabIndex={recordingThis ? 0 : -1} onKeyDown={recordingThis ? event => recordBinding(def.action, event) : undefined}>
            <span className="shortcut-editor__label">{def.label}</span>
            <span className="shortcut-editor__hint">{def.hint}</span>
            <Tag className="shortcut-editor__binding">{recordingThis ?t("\u6309\u4E0B\u65B0\u7EC4\u5408\u952E\u2026"):bindingToDisplay(binding)}{!customised&&def.extras?.length?<Typography.Text type="secondary"style={{marginLeft:6}}>/ {def.extras.map(bindingToDisplay).join(' / ')}</Typography.Text>:null}{customised&&!recordingThis?<Tag color="orange"style={{marginLeft:6}}>{t("\u5DF2\u81EA\u5B9A\u4E49")}</Tag>:null}</Tag>
            <Space size={4}>
              <Button size="small" onClick={() => setRecording(recordingThis ? null : def.action)}>{recordingThis ?t("\u53D6\u6D88"):t("\u4FEE\u6539")}</Button>
              <Button size="small" disabled={!customised} onClick={() => resetOne(def.action)}>{t("\u8FD8\u539F")}</Button>
            </Space>
          </li>
        })}
      </ul>
    </div>
      </> },
      { key: 'workspaces', label:t("\u5DE5\u4F5C\u533A"),children:<WorkspacesEditor/>},
    ]}/>
  </Card></>
}

function DownloadSettingsPanel() {
  const [settings, setSettings] = useState<DownloadSettings>(readDownloadSettings)
  const [defaultDirectory, setDefaultDirectory] = useState(t("\u6B63\u5728\u8BFB\u53D6\u2026"))
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    void getDefaultDownloadDirectory().then(setDefaultDirectory).catch(() => setDefaultDirectory(t("\u7CFB\u7EDF\u9ED8\u8BA4\u4E0B\u8F7D\u6587\u4EF6\u5939")))
  }, [])

  function update(patch: Partial<DownloadSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    writeDownloadSettings(next)
  }

  async function chooseDirectory() {
    try {
      const result = await pickFiles({ title:t("\u9009\u62E9\u4E0B\u8F7D\u6587\u4EF6\u5939"),directory:true})
      if (result.paths[0]) update({ directory: result.paths[0] })
    } catch (error) {
      messageApi.error(t("\u65E0\u6CD5\u9009\u62E9\u4E0B\u8F7D\u6587\u4EF6\u5939\uFF1A{value0}",{value0:String(error)}))
    }
  }

  return <>{contextHolder}<Card title={t("\u4E0B\u8F7D")}className="settings-card download-settings-card">
    <div className="download-location-setting">
      <div><Typography.Text strong>{t("\u4F4D\u7F6E")}</Typography.Text><Typography.Text type="secondary"ellipsis={{tooltip:settings.directory||defaultDirectory}}>{settings.directory||defaultDirectory}</Typography.Text></div>
      <Space><Button onClick={() => void chooseDirectory()}>{t("\u66F4\u6539")}</Button>{settings.directory&&<Button type="text"onClick={()=>update({directory:''})}>{t("\u4F7F\u7528\u9ED8\u8BA4\u4F4D\u7F6E")}</Button>}</Space>
    </div>
    <div className="download-settings-list">
      <div className="browser-setting-row"><div><Typography.Text strong>{t("\u5728\u4E0B\u8F7D\u4E4B\u524D\u8BE2\u95EE\u6BCF\u4E2A\u6587\u4EF6\u7684\u4FDD\u5B58\u4F4D\u7F6E")}</Typography.Text><Typography.Text type="secondary">{t("\u4E0B\u8F7D\u4EFB\u52A1\u5F00\u59CB\u524D\u9009\u62E9\u4FDD\u5B58\u6587\u4EF6\u5939")}</Typography.Text></div><Switch checked={settings.askWhereToSave}onChange={value=>update({askWhereToSave:value})}/></div>
      <div className="browser-setting-row"><div><Typography.Text strong>{t("\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00 Office \u6587\u4EF6")}</Typography.Text><Typography.Text type="secondary">{t("\u652F\u6301\u7684\u7F51\u7AD9\u53EF\u76F4\u63A5\u9884\u89C8\u6F14\u793A\u6587\u7A3F\u3001\u7535\u5B50\u8868\u683C\u548C\u6587\u6863")}</Typography.Text></div><Switch checked={settings.openOfficeInBrowser}onChange={value=>update({openOfficeInBrowser:value})}/></div>
      <div className="browser-setting-row"><div><Typography.Text strong>{t("\u4E0B\u8F7D\u5F00\u59CB\u65F6\u663E\u793A\u4E0B\u8F7D\u83DC\u5355")}</Typography.Text><Typography.Text type="secondary">{t("\u65B0\u4E0B\u8F7D\u5F00\u59CB\u540E\u81EA\u52A8\u5C55\u5F00\u5DE5\u5177\u680F\u4E2D\u7684\u4E0B\u8F7D\u9762\u677F")}</Typography.Text></div><Switch checked={settings.showPanelOnStart}onChange={value=>update({showPanelOnStart:value})}/></div>
    </div>
    <Alert type="info" showIcon message={t("\u4FDD\u5B58\u4F4D\u7F6E\u8BF4\u660E")}description={t("\u7F51\u9875\u81EA\u8EAB\u89E6\u53D1\u7684\u539F\u751F\u4E0B\u8F7D\u53EF\u80FD\u7531\u7CFB\u7EDF WebView \u51B3\u5B9A\u6700\u7EC8\u4F4D\u7F6E\uFF1B\u6D4F\u89C8\u5668\u63A5\u7BA1\u7684\u4E0B\u8F7D\u4F1A\u4F7F\u7528\u8FD9\u91CC\u9009\u62E9\u7684\u4F4D\u7F6E\u3002")}/>
  </Card></>
}

function AboutSettingsPanel() {
  const [version, setVersion] = useState('0.6.0')
  const [messageApi, contextHolder] = message.useMessage()

  useEffect(() => {
    if ('__TAURI_INTERNALS__' in window) void getVersion().then(setVersion).catch(() => undefined)
  }, [])

  const diagnostic = [
    `Arcadia ${version}`,
    `Platform ${navigator.platform || 'unknown'}`,
  ].join('\n')

  async function copyDiagnostic() {
    try {
      await navigator.clipboard.writeText(diagnostic)
      messageApi.success(t("\u8BCA\u65AD\u4FE1\u606F\u5DF2\u590D\u5236"))
    } catch { messageApi.error(t("\u65E0\u6CD5\u590D\u5236\u8BCA\u65AD\u4FE1\u606F"))}
  }

  return <>{contextHolder}<Card title={t("\u5173\u4E8E")}className="settings-card about-settings-card">
    <div className="about-product">
      <img src={appLogo} alt="Arcadia"/>
      <div><Typography.Title level={3}>Arcadia</Typography.Title><Typography.Paragraph type="secondary">{t("\u672C\u5730\u4F18\u5148\u7684 AI \u77E5\u8BC6\u6D4F\u89C8\u5668")}</Typography.Paragraph><Tag color="green">{t("\u7248\u672C")} {version}</Tag></div>
    </div>
    <Alert type="success" showIcon message={t("\u5F53\u524D\u7248\u672C\u4FE1\u606F\u5DF2\u52A0\u8F7D")}description={t("Arcadia \u4F1A\u6301\u7EED\u6539\u8FDB\u6D4F\u89C8\u3001\u9605\u8BFB\u3001\u77E5\u8BC6\u7BA1\u7406\u548C AI \u8F85\u52A9\u4F53\u9A8C\u3002\u516C\u5F00\u7248\u672C\u53EF\u524D\u5F80\u9879\u76EE\u53D1\u5E03\u9875\u83B7\u53D6\u3002")}/>
    <Descriptions className="about-runtime" size="small" bordered column={2} items={[
      { key: 'version', label:t("\u5E94\u7528\u7248\u672C"),children:version},
      { key: 'identifier', label:t("\u5E94\u7528\u6807\u8BC6"),children:'com.arcadia.knowledge-browser'},
    ]}/>
    <div className="about-links">
      <a href="https://arcadia-browser.netlify.app" target="_blank" rel="noreferrer">{t("\u4EA7\u54C1\u4E3B\u9875")}</a>
      <a href="https://github.com/fengjutian/browser" target="_blank" rel="noreferrer">{t("\u5F00\u6E90\u9879\u76EE")}</a>
      <a href="https://github.com/fengjutian/browser/releases" target="_blank" rel="noreferrer">{t("\u7248\u672C\u53D1\u5E03")}</a>
      <Button size="small" onClick={() => void copyDiagnostic()}>{t("\u590D\u5236\u8BCA\u65AD\u4FE1\u606F")}</Button>
    </div>
    <Typography.Paragraph type="secondary" className="about-copyright">© {new Date().getFullYear()} Arcadia contributors.</Typography.Paragraph>
  </Card></>
}

const OPEN_SOURCE_COMPONENTS = [
  { name: 'Tauri', category:t("\u684C\u9762\u5E94\u7528\u6846\u67B6"),description:t("\u8FDE\u63A5\u7F51\u9875\u754C\u9762\u4E0E\u539F\u751F\u7CFB\u7EDF\u80FD\u529B\u3002"),license:'MIT / Apache-2.0',url:'https://tauri.app'},
  { name: 'React', category:t("\u7528\u6237\u754C\u9762"),description:t("\u6784\u5EFA\u8BBE\u7F6E\u3001\u6D4F\u89C8\u5668\u548C\u77E5\u8BC6\u7BA1\u7406\u754C\u9762\u3002"),license:'MIT',url:'https://react.dev'},
  { name: 'Base UI', category:t("\u65E0\u6837\u5F0F\u7EC4\u4EF6"),description:t("\u63D0\u4F9B\u53EF\u8BBF\u95EE\u7684\u57FA\u7840\u4EA4\u4E92\u7EC4\u4EF6\u3002"),license:'MIT',url:'https://base-ui.com'},
  { name: 'Lucide', category:t("\u56FE\u6807"),description:t("\u5E94\u7528\u754C\u9762\u4F7F\u7528\u7684\u5F00\u6E90\u56FE\u6807\u5E93\u3002"),license:'ISC',url:'https://lucide.dev'},
  { name: 'Mozilla Readability', category:t("\u9605\u8BFB\u6A21\u5F0F"),description:t("\u4ECE\u7F51\u9875\u4E2D\u63D0\u53D6\u9002\u5408\u9605\u8BFB\u7684\u6B63\u6587\u5185\u5BB9\u3002"),license:'Apache-2.0',url:'https://github.com/mozilla/readability'},
  { name: 'PDF.js', category:t("PDF \u9605\u8BFB"),description:t("\u89E3\u6790\u5E76\u5448\u73B0 PDF \u6587\u6863\u3002"),license:'Apache-2.0',url:'https://mozilla.github.io/pdf.js'},
  { name: 'Mammoth', category:t("\u6587\u6863\u89E3\u6790"),description:t("\u5C06 DOCX \u6587\u6863\u8F6C\u6362\u4E3A\u53EF\u9605\u8BFB\u5185\u5BB9\u3002"),license:'BSD-2-Clause',url:'https://github.com/mwilliamson/mammoth.js'},
  { name: 'SQLite', category:t("\u672C\u5730\u6570\u636E"),description:t("\u4FDD\u5B58\u6D4F\u89C8\u3001\u77E5\u8BC6\u5E93\u53CA\u5E94\u7528\u6570\u636E\u3002"),license:'Public Domain',url:'https://sqlite.org'},
  { name: 'Wasmtime', category:t("\u63D2\u4EF6\u8FD0\u884C\u65F6"),description:t("\u4E3A WebAssembly \u63D2\u4EF6\u63D0\u4F9B\u9694\u79BB\u8FD0\u884C\u73AF\u5883\u3002"),license:'Apache-2.0',url:'https://wasmtime.dev'},
  { name: 'Vite', category:t("\u6784\u5EFA\u5DE5\u5177"),description:t("\u5F00\u53D1\u548C\u6784\u5EFA\u5E94\u7528\u524D\u7AEF\u8D44\u6E90\u3002"),license:'MIT',url:'https://vite.dev'},
]

function OpenSourceSettingsPanel() {
  return <Card title={t("\u5F00\u6E90\u7EC4\u4EF6")}className="settings-card open-source-settings-card">
    <Typography.Paragraph type="secondary">{t("Arcadia \u57FA\u4E8E\u4F18\u79C0\u7684\u5F00\u6E90\u9879\u76EE\u6784\u5EFA\u3002\u4EE5\u4E0B\u5217\u51FA\u5E94\u7528\u4F7F\u7528\u7684\u4E3B\u8981\u5F00\u6E90\u6280\u672F\u3002")}</Typography.Paragraph>
    <div className="open-source-grid">
      {OPEN_SOURCE_COMPONENTS.map(component => <a key={component.name} className="open-source-item" href={component.url} target="_blank" rel="noreferrer">
        <div><strong>{component.name}</strong><Tag>{component.category}</Tag></div>
        <p>{component.description}</p>
        <span className="open-source-item__url">{component.url}</span>
        <small>{component.license}</small>
      </a>)}
    </div>
    <Typography.Paragraph type="secondary" className="open-source-note">{t("\u5B8C\u6574\u4F9D\u8D56\u53CA\u8BB8\u53EF\u8BC1\u4FE1\u606F\u4EE5\u9879\u76EE\u6E90\u4EE3\u7801\u548C\u53D1\u884C\u5305\u5185\u6587\u4EF6\u4E3A\u51C6\u3002")}</Typography.Paragraph>
  </Card>
}

function ResetSettingsPanel() {
  const [messageApi, contextHolder] = message.useMessage()
  const [resetting, setResetting] = useState(false)

  async function resetSettings() {
    setResetting(true)
    try {
      resetBrowserPreferences()
      setBrowserShortcutsEnabled(true)
      await setNativeAdBlocking(true)
      messageApi.success(t("\u8BBE\u7F6E\u5DF2\u6062\u590D\u4E3A\u9ED8\u8BA4\u503C"))
    } catch (error) {
      messageApi.error(t("\u90E8\u5206\u8BBE\u7F6E\u672A\u80FD\u91CD\u7F6E\uFF1A{value0}",{value0:String(error)}))
    } finally { setResetting(false) }
  }

  return <>{contextHolder}<Card title={t("\u91CD\u7F6E\u8BBE\u7F6E")}className="settings-card reset-settings-card">
    <div className="reset-settings-hero"><ReloadOutlined/><div><Typography.Title level={4}>{t("\u5C06\u8BBE\u7F6E\u8FD8\u539F\u4E3A\u9ED8\u8BA4\u503C")}</Typography.Title><Typography.Paragraph type="secondary">{t("\u6062\u590D\u5916\u89C2\u3001\u5DE5\u5177\u680F\u3001\u7F29\u653E\u3001\u4E0B\u8F7D\u3001\u5B57\u4F53\u3001\u641C\u7D22\u5F15\u64CE\u3001\u5FEB\u6377\u952E\u3001\u7CFB\u7EDF\u548C\u6027\u80FD\u53CA\u5185\u7F6E\u63D2\u4EF6\u8BBE\u7F6E\u3002")}</Typography.Paragraph></div></div>
    <Alert type="info" showIcon message={t("\u4F60\u7684\u4E2A\u4EBA\u6570\u636E\u4E0D\u4F1A\u88AB\u5220\u9664")}description={t("\u4E66\u7B7E\u3001\u6D4F\u89C8\u5386\u53F2\u3001\u4E0B\u8F7D\u6587\u4EF6\u3001\u77E5\u8BC6\u5E93\u6587\u6863\u3001\u7B14\u8BB0\u3001\u5DE5\u4F5C\u533A\u3001\u5DF2\u4FDD\u5B58\u5BC6\u7801\u3001AI Provider \u548C MCP \u914D\u7F6E\u90FD\u4F1A\u4FDD\u7559\u3002")}/>
    <div className="reset-settings-actions">
      <Popconfirm title={t("\u5C06\u6240\u6709\u8BBE\u7F6E\u6062\u590D\u4E3A\u9ED8\u8BA4\u503C\uFF1F")}description={t("\u504F\u597D\u8BBE\u7F6E\u5C06\u7ACB\u5373\u91CD\u7F6E\uFF0C\u6B64\u64CD\u4F5C\u4E0D\u4F1A\u5220\u9664\u4E2A\u4EBA\u6570\u636E\u3002")}okText={t("\u786E\u8BA4\u91CD\u7F6E")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>void resetSettings()}>
        <Button danger loading={resetting} icon={<ReloadOutlined/>}>{t("\u6062\u590D\u9ED8\u8BA4\u8BBE\u7F6E")}</Button>
      </Popconfirm>
    </div>
  </Card></>
}

function SearchEngineSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [config, setConfig] = useState(() => readSearchEngineConfig())
  const [customTemplate, setCustomTemplate] = useState(() => readSearchEngineConfig().customTemplate ?? '')
  const engineColors: Record<string, string> = {
    google: '#4285f4', bing: '#008373', baidu: '#2932e1', duckduckgo: '#de5833',
    sogou: '#f45b35', so360: '#17a05d', brave: '#fb542b', startpage: '#6573ff',
    ecosia: '#36a96b', yandex: '#fc3f1d', custom: '#8b7355',
  }

  function pickPreset(presetId: string) {
    if (presetId === 'custom') {
      setConfig(           (current                                                                         )=>({presetId:'custom',customTemplate:current.customTemplate??customTemplate}))
      return
    }
    try {
      const next = writeSearchEngineConfig({ presetId })
      setConfig(next)
      messageApi.success(t("\u641C\u7D22\u5F15\u64CE\u5DF2\u5207\u6362\u4E3A {value0}",{value0:SEARCH_ENGINE_PRESETS.find(item=>item.id===presetId)?.label??presetId}))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  function saveCustom() {
    try {
      const next = writeSearchEngineConfig({ presetId: 'custom', customTemplate })
      setConfig(next)
      messageApi.success(t("\u81EA\u5B9A\u4E49\u641C\u7D22\u5F15\u64CE\u5DF2\u4FDD\u5B58"))
    } catch (error) {
      messageApi.error(String(error))
    }
  }

  return <>{contextHolder}<Card title={t("\u641C\u7D22\u5F15\u64CE")}className="settings-card search-engine-settings">
    <Typography.Title level={5}>{t("\u9ED8\u8BA4\u641C\u7D22\u5F15\u64CE")}</Typography.Title>
    <Typography.Paragraph type="secondary">{t("\u5730\u5740\u680F\u4E2D\u975E URL \u8F93\u5165\u4F1A\u4F5C\u4E3A\u641C\u7D22\u8BCD\u63D0\u4EA4\uFF1B\u81EA\u5B9A\u4E49\u6A21\u677F\u5FC5\u987B\u5305\u542B")} <code>{'{query}'}</code> {t("\u5360\u4F4D\u7B26\u3002")}</Typography.Paragraph>
    <div className="search-engine-settings__presets" role="radiogroup" aria-label={t("\u9ED8\u8BA4\u641C\u7D22\u5F15\u64CE")}>
      {[...SEARCH_ENGINE_PRESETS, { id: 'custom', label:t("\u81EA\u5B9A\u4E49"),template:'',iconUrl:''}].map(item=>{
        const active = config.presetId === item.id
        return <button
          key={item.id}
          type="button"
          role="radio"
          aria-checked={active}
          className={active ? 'is-active' : ''}
          onClick={() => pickPreset(item.id)}
        >
          <span className="search-engine-settings__mark" style={{ background: engineColors[item.id] }}>
            {item.id === 'custom' ? <SearchOutlined/> : <><span>{item.label.slice(0, 1)}</span><img src={item.iconUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }}/></>}
          </span>
          <span className="search-engine-settings__name">{item.label}</span>
          {active && <CheckCircleOutlined className="search-engine-settings__check"/>}
        </button>
      })}
    </div>
    {config.presetId === 'custom' && <Space.Compact block style={{ marginTop: 16 }}>
      <Input
        value={customTemplate}
        placeholder="https://example.com/search?q={query}"
        onChange={event => setCustomTemplate(event.target.value)}
      />
      <Button type="primary" onClick={saveCustom} disabled={!isSearchTemplateValid(customTemplate)}>{t("\u4FDD\u5B58")}</Button>
    </Space.Compact>}
    <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>{t("\u5F53\u524D\u6A21\u677F\uFF1A")}
           <Typography.Text code>{resolveActiveSearchTemplate(config)}</Typography.Text>
    </Typography.Paragraph>
  </Card></>
}

function AIProviderSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [form] = Form.useForm<ProviderFormValues>()
  const activeType: AIProviderType | undefined = Form.useWatch('type', form)
  const editingId = Form.useWatch('id', form)

  async function refresh() { setProviders(await listAIProviders()) }

  useEffect(() => { void refresh() }, [])

  // When the user switches provider type on a *new* (non-editing) form, prefill
  // the Base URL with the vendor's default endpoint and seed the model field
  // with the vendor's recommended default. We skip this when editing an existing
  // provider so we never overwrite saved values.
  useEffect(() => {
    if (!activeType || editingId) return
    const preset = PROVIDER_PRESETS[activeType]
    const current = form.getFieldsValue(['baseUrl', 'model'])
    form.setFieldsValue({
      baseUrl: current.baseUrl?.trim() ? current.baseUrl : preset.baseUrl,
      model: current.model?.trim() ? current.model : preset.defaultModel,
      embeddingModel: preset.embeddingModel,
    })
  }, [activeType, editingId, form])

  function handleProviderTypeChange(type: AIProviderType) {
    const preset = PROVIDER_PRESETS[type]
    form.setFieldsValue({
      type,
      baseUrl: preset.baseUrl,
      model: preset.defaultModel,
      embeddingModel: preset.embeddingModel,
    })
    form.validateFields(['baseUrl', 'model']).catch(() => undefined)
  }

  async function handleEdit(provider: AIProvider) {
    form.setFieldsValue({
      id: provider.id,
      type: provider.type,
      baseUrl: provider.baseUrl,
      model: provider.model,
      embeddingModel: provider.embeddingModel,
      timeoutSeconds: provider.timeoutSeconds,
      apiKey: '',
    })
  }

  async function handleDelete(provider: AIProvider) {
    try {
      await deleteAIProvider(provider.id)
      messageApi.success(t("Provider \u5DF2\u5220\u9664"))
      if (form.getFieldValue('id') === provider.id) form.resetFields()
      await refresh()
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u5220\u9664\u5931\u8D25"))
    }
  }

  async function handleTest(provider: AIProvider) {
    const key = `test-${provider.id}`
    messageApi.open({ key, type: 'loading', content:t("\u6B63\u5728\u6D4B\u8BD5\u8FDE\u63A5\u2026"),duration:0})
    try {
      const result = await aiTestProvider(provider.id)
      if (result.ok) {
        messageApi.open({ key, type: 'success', content: `${result.message}（${result.endpoint}）`, duration: 3 })
      } else {
        messageApi.open({ key, type: 'error', content: result.message, duration: 3 })
      }
    } catch (error) {
      messageApi.open({ key, type: 'error', content: error instanceof Error ? error.message :t("\u6D4B\u8BD5\u5931\u8D25"),duration:3})
    }
  }

  async function handleSubmit(values: ProviderFormValues) {
    setSaving(true)
    try {
      const payload: AIProviderInput = {
        id: values.id,
        type: values.type,
        baseUrl: values.baseUrl.trim(),
        model: values.model.trim(),
        embeddingModel: values.embeddingModel?.trim() || undefined,
        timeoutSeconds: values.timeoutSeconds,
        apiKey: values.apiKey?.trim() || undefined,
        clearApiKey: values.id ? !values.apiKey?.trim() : false,
      }
      const saved = await saveAIProvider(payload)
      messageApi.success(t("\u5DF2\u4FDD\u5B58\u300C{value0}\u300D",{value0:saved.model}))
      form.resetFields()
      form.setFieldsValue({ type: values.type, timeoutSeconds: values.timeoutSeconds })
      await refresh()
      const fresh = await getAIProvider(saved.id)
      if (fresh) form.setFieldsValue({ id: fresh.id })
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u4FDD\u5B58\u5931\u8D25"))
    } finally {
      setSaving(false)
    }
  }

  async function handleTestCurrent() {
    setTesting(true)
    const key = 'test-current-provider'
    try {
      const values = await form.validateFields()
      messageApi.open({ key, type: 'loading', content:t("\u6B63\u5728\u4FDD\u5B58\u5E76\u6D4B\u8BD5\u8FDE\u63A5\u2026"),duration:0})
      const saved = await saveAIProvider({
        id: values.id,
        type: values.type,
        baseUrl: values.baseUrl.trim(),
        model: values.model.trim(),
        embeddingModel: values.embeddingModel?.trim() || undefined,
        timeoutSeconds: values.timeoutSeconds,
        apiKey: values.apiKey?.trim() || undefined,
        clearApiKey: false,
      })
      form.setFieldValue('id', saved.id)
      await refresh()
      const result = await aiTestProvider(saved.id)
      messageApi.open({
        key,
        type: result.ok ? 'success' : 'error',
        content: result.ok ? `${result.message}（${result.endpoint}）` : result.message,
        duration: 4,
      })
    } catch (error) {
      messageApi.open({ key, type: 'error', content: error instanceof Error ? error.message :t("\u6D4B\u8BD5\u5931\u8D25"),duration:4})
    } finally {
      setTesting(false)
    }
  }

  return <>{contextHolder}<Card title="AI Provider" className="settings-card provider-settings-card"><Typography.Paragraph type="secondary">{t("\u8FDE\u63A5\u517C\u5BB9 Provider\uFF0C\u7528\u4E8E\u6458\u8981\u3001\u7FFB\u8BD1\u548C\u77E5\u8BC6\u95EE\u7B54\u3002\u666E\u901A\u914D\u7F6E\u5199\u5165\u672C\u5730 SQLite\uFF0CAPI Key \u901A\u8FC7\u64CD\u4F5C\u7CFB\u7EDF\u5BC6\u94A5\u73AF\u4FDD\u5B58\uFF1B\u524D\u7AEF\u4E0D\u4F1A\u56DE\u663E Key \u660E\u6587\u3002")}</Typography.Paragraph>
    <Form form={form} layout="vertical" initialValues={{type:'openai-compatible',timeoutSeconds:60}} onFinish={handleSubmit}>
      <div className="provider-form-grid">
        <Form.Item name="type" label={t("Provider \u7C7B\u578B")}rules={[{required:true}]}><Select options={PROVIDER_OPTIONS}onChange={handleProviderTypeChange}/></Form.Item>
        <Form.Item name="baseUrl" label="Base URL" rules={[{required:true,message:t("\u8BF7\u8F93\u5165 Base URL")},{type:'url',message:t("\u9700\u4E3A\u6709\u6548 http(s) URL")}]}><Input placeholder="https://api.example.com/v1"/></Form.Item>
        <Form.Item name="model" label={t("\u6A21\u578B")}rules={[{required:true,message:t("\u8BF7\u8F93\u5165\u6A21\u578B\u540D\u79F0")}]}>
          {activeType === 'minimax'
            ? <Select options={MINIMAX_MODEL_OPTIONS}/>
            : <Input placeholder={activeType ? PROVIDER_PRESETS[activeType].placeholderModel : 'Qwen/Qwen3.6-27B'}/>}
        </Form.Item>
        <Form.Item name="embeddingModel" label={t("Embedding \u6A21\u578B\uFF08\u53EF\u9009\uFF09")}><Input placeholder={activeType?PROVIDER_PRESETS[activeType].embeddingPlaceholder:'text-embedding-3-small'}/></Form.Item>
        <Form.Item name="timeoutSeconds" label={t("\u8D85\u65F6\uFF08\u79D2\uFF09")}rules={[{type:'number',min:1,max:600,message:t("\u8303\u56F4 1-600")}]}><InputNumber min={1}max={600}/></Form.Item>
        <Form.Item name="apiKey" label={activeType === 'ollama' ?t("API Key\uFF08\u53EF\u9009\uFF09"):'API Key'}tooltip={t("\u5DF2\u4FDD\u5B58\u7684 Key \u4E0D\u4F1A\u56DE\u663E\uFF0C\u7559\u7A7A\u8868\u793A\u4E0D\u6E05\u9664")}><Input.Password prefix={<KeyOutlined/>}placeholder={activeType==='ollama'?t("\u672C\u5730\u670D\u52A1\u901A\u5E38\u4E0D\u9700\u8981"):'sk-...'}autoComplete="off"/></Form.Item>
      </div>
      <Space className="provider-form-actions">
        <Button type="primary" htmlType="submit" icon={<SaveOutlined/>} loading={saving}>{t("\u4FDD\u5B58\u5230\u5BC6\u94A5\u73AF")}</Button>
        <Button icon={<ThunderboltOutlined/>} loading={testing} onClick={() => void handleTestCurrent()}>{t("\u6D4B\u8BD5\u8FDE\u63A5")}</Button>
        <Button onClick={()=>form.resetFields()}>{t("\u6E05\u7A7A")}</Button>
      </Space>
    </Form>
    <Typography.Title level={4} style={{marginTop:24}}>{t("\u5DF2\u914D\u7F6E Provider")}</Typography.Title>
    {providers.length === 0
      ? <Typography.Text type="secondary">{t("\u5C1A\u672A\u914D\u7F6E\u3002")}</Typography.Text>
      : <List size="small" dataSource={providers} renderItem={provider => <List.Item key={provider.id} actions={[<Button size="small" icon={<ThunderboltOutlined/>} onClick={()=>void handleTest(provider)}>{t("\u6D4B\u8BD5\u8FDE\u63A5")}</Button>,<Button size="small"onClick={()=>void handleEdit(provider)}>{t("\u7F16\u8F91")}</Button>,<Button size="small"danger icon={<DeleteOutlined/>}onClick={()=>void handleDelete(provider)}>{t("\u5220\u9664")}</Button>]}>
          <List.Item.Meta title={<Space><Tag color={PROVIDER_TAG_COLOR[provider.type]}>{provider.type}</Tag><span>{provider.model}</span><Tag>{provider.baseUrl}</Tag>{provider.hasApiKey && <Tag color="green" icon={<KeyOutlined/>}>{t("\u5BC6\u94A5\u5DF2\u914D\u7F6E")}</Tag>}</Space>}description={t("\u8D85\u65F6 {value0}s{value1} \xB7 \u66F4\u65B0\u4E8E {value2}",{value0:provider.timeoutSeconds,value1:provider.embeddingModel?` · embedding ${provider.embeddingModel}`:'',value2:new Date(provider.updatedAt).toLocaleString()})}/>
        </List.Item>}/>}
    <Alert className="security-alert" icon={<SafetyCertificateOutlined/>} showIcon type="success" message={t("\u5BC6\u94A5\u53EA\u4FDD\u5B58\u5728\u672C\u673A")}description={t("\u51ED\u636E\u7531\u64CD\u4F5C\u7CFB\u7EDF\u5B89\u5168\u5B58\u50A8\uFF0C\u4E0D\u4F1A\u5199\u5165\u5E94\u7528\u65E5\u5FD7\u6216\u6570\u636E\u5E93\u3002")}/>
  </Card></>
}

function KnowledgeBaseSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [aliases, setAliases] = useState<SearchAlias[]>([])
  const [indexStatus, setIndexStatus] = useState<SearchIndexStatus | null>(null)
  const [term, setTerm] = useState('')
  const [alias, setAlias] = useState('')
  const [rebuilding, setRebuilding] = useState(false)

  const refreshSearchSettings = async () => {
    const [nextAliases, status] = await Promise.all([listSearchAliases(), getSearchIndexStatus()])
    setAliases(nextAliases)
    setIndexStatus(status)
  }

  useEffect(() => { void refreshSearchSettings().catch(() => undefined) }, [])

  async function addAlias() {
    try {
      const created = await addSearchAlias(term, alias)
      setAliases(items => [...items, created].sort((a, b) => a.term.localeCompare(b.term, 'zh-CN')))
      setTerm('')
      setAlias('')
      messageApi.success(t("\u641C\u7D22\u522B\u540D\u5DF2\u6DFB\u52A0"))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : String(error))
    }
  }

  async function removeAlias(id: number) {
    await deleteSearchAlias(id)
    setAliases(items => items.filter(item => item.id !== id))
  }

  async function rebuildIndex() {
    setRebuilding(true)
    try {
      const status = await rebuildSearchIndex()
      setIndexStatus(status)
      messageApi.success(t("\u5DF2\u91CD\u5EFA {value0} \u7BC7\u6587\u6863\u7684\u641C\u7D22\u7D22\u5F15",{value0:status.indexedDocumentCount}))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u7D22\u5F15\u91CD\u5EFA\u5931\u8D25"))
    } finally {
      setRebuilding(false)
    }
  }
  function doExport() {
    void        (async()=>{
      try {
        const backup = await exportBackup()
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `arcadia-knowledge-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        link.click()
        link.remove()
        URL.revokeObjectURL(url)
        messageApi.success(t("\u5DF2\u5BFC\u51FA {value0} \u7BC7\u6587\u6863\u3001{value1} \u6761\u4F1A\u8BDD\u72B6\u6001",{value0:backup.documents.length,value1:backup.session.length}))
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message :t("\u5BFC\u51FA\u5931\u8D25"))
      }
    }            )()
  }
  function doImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      void        (async()=>{
        const file = input.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const backup = JSON.parse(text) as Parameters<typeof importBackup>[0]
          const summary = await importBackup(backup)
          messageApi.success(t("\u5BFC\u5165 {value0} \u7BC7\u6587\u6863\u3001{value1} \u6761\u4F1A\u8BDD",{value0:summary.documentsInserted,value1:summary.sessionInserted}))
        } catch (error) {
          messageApi.error(error instanceof Error ? error.message :t("\u5BFC\u5165\u5931\u8D25"))
        }
      }            )()
    }
    input.click()
  }
  return <>{contextHolder}
    <Card title={t("\u77E5\u8BC6\u5E93\u7BA1\u7406")}className="settings-card knowledge-settings-card">
      <Tabs
        className="knowledge-settings-tabs"
        defaultActiveKey="index"
        destroyOnHidden={false}
        items={[
          {
            key: 'index',
            label:t("\u641C\u7D22\u7D22\u5F15"),
            children: <section className="privacy-section">
              <Descriptions size="small" column={3} items={[
                { key: 'version', label:t("\u7D22\u5F15\u7248\u672C"),children:indexStatus?.schemaVersion??'—'},
                { key: 'documents', label:t("\u77E5\u8BC6\u5E93\u6587\u6863"),children:indexStatus?.documentCount??'—'},
                { key: 'indexed', label:t("\u5DF2\u5EFA\u7ACB\u7D22\u5F15"),children:indexStatus?.indexedDocumentCount??'—'},
              ]}/>
              <Typography.Paragraph type="secondary" style={{marginTop:12}}>{t("\u641C\u7D22\u5F02\u5E38\u6216\u8FC1\u79FB\u4E2D\u65AD\u65F6\u53EF\u4EE5\u91CD\u65B0\u5EFA\u7ACB\u6D3E\u751F\u7D22\u5F15\uFF0C\u4E0D\u4F1A\u5220\u9664\u77E5\u8BC6\u5E93\u539F\u6587\u3002")}</Typography.Paragraph>
              <Button loading={rebuilding} onClick={() => void rebuildIndex()}>{t("\u91CD\u65B0\u5EFA\u7ACB\u641C\u7D22\u7D22\u5F15")}</Button>
            </section>,
          },
          {
            key: 'aliases',
            label:t("\u641C\u7D22\u522B\u540D{value0}",{value0:aliases.length>0?` (${aliases.length})`:''}),
            children: <section className="privacy-section">
              <Typography.Paragraph type="secondary">{t("\u53CC\u5411\u6269\u5C55\u67E5\u8BE2\uFF0C\u4F8B\u5982\u641C\u7D22\u201C\u91D1\u9675\u201D\u4E5F\u80FD\u627E\u5230\u201C\u5357\u4EAC\u201D\u3002\u522B\u540D\u4EC5\u4FDD\u5B58\u5728\u672C\u673A\u3002")}</Typography.Paragraph>
              <Space.Compact style={{width:'100%'}}><Input value={term} maxLength={80} placeholder={t("\u8BCD\u6761\uFF0C\u4F8B\u5982\uFF1A\u5357\u4EAC")}onChange={event=>setTerm(event.target.value)}/><Input value={alias}maxLength={80}placeholder={t("\u522B\u540D\uFF0C\u4F8B\u5982\uFF1A\u91D1\u9675")}onChange={event=>setAlias(event.target.value)}onPressEnter={()=>void addAlias()}/><Button type="primary"disabled={!term.trim()||!alias.trim()}onClick={()=>void addAlias()}>{t("\u6DFB\u52A0")}</Button></Space.Compact>
              <List size="small" style={{marginTop:12}} dataSource={aliases} locale={{emptyText:t("\u5C1A\u672A\u6DFB\u52A0\u641C\u7D22\u522B\u540D")}}renderItem={item=><List.Item actions={[<Button key="delete"type="text"danger onClick={()=>void removeAlias(item.id)}>{t("\u5220\u9664")}</Button>]}><Typography.Text>{item.term} <span aria-hidden="true">↔</span> {item.alias}</Typography.Text></List.Item>}/>
            </section>,
          },
          {
            key: 'backup',
            label:t("\u5907\u4EFD\u4E0E\u6062\u590D"),
            children: <section className="privacy-section">
              <Typography.Paragraph type="secondary">{t("\u5BFC\u51FA\u672C\u5730\u6587\u6863\u548C\u4F1A\u8BDD\u72B6\u6001\u4E3A JSON \u6587\u4EF6\uFF1B\u6062\u590D\u65F6\u4F1A\u4EE5\u6587\u6863 id \u505A upsert\uFF0C\u5DF2\u5B58\u5728\u7684\u6761\u76EE\u4F1A\u88AB\u8986\u76D6\u3002")}</Typography.Paragraph>
              <Space><Button type="primary" onClick={doExport}>{t("\u5BFC\u51FA\u5907\u4EFD")}</Button><Button onClick={doImport}>{t("\u4ECE\u6587\u4EF6\u6062\u590D")}</Button></Space>
            </section>,
          },
          {
            key: 'tasks',
            label:t("\u4EFB\u52A1\u961F\u5217"),
            children: <TaskPanel/>,
          },
        ]}
      />
    </Card>
  </>
}

const PERMISSION_LABELS: Record<SitePermissionKind, string> = {
  camera:t("\u6444\u50CF\u5934"),
  microphone:t("\u9EA6\u514B\u98CE"),
  location:t("\u4F4D\u7F6E"),
  notifications:t("\u901A\u77E5"),
  clipboard:t("\u8BFB\u53D6\u526A\u8D34\u677F"),
}

function PrivacySettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [historyPageEntries, setHistoryPageEntries] = useState<HistoryEntry[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(20)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPageLoading, setHistoryPageLoading] = useState(false)
  const [privacyCap, setPrivacyCap] = useState<Awaited<ReturnType<typeof privacyCapabilityReport>> | null>(null)
  const [privacyStats, setPrivacyStats] = useState<Awaited<ReturnType<typeof privacyGetStats>>>({ blocked: 0, allowed: 0, dropped: 0 })
  const [blocklists, setBlocklists] = useState<Awaited<ReturnType<typeof privacyListBlocklists>>>([])
  const [recentBlocks, setRecentBlocks] = useState<Awaited<ReturnType<typeof privacyListBlockEvents>>>([])
  const [cleanupOnExit, setCleanupOnExit] = useState<boolean>(() => readCleanupOnExitPreference())
  const [snapshotStats, setSnapshotStats] = useState<ReadingSnapshotStats>({ count: 0, bytes: 0 })
  const [snapshotRetentionDays, setSnapshotRetentionDays] = useState(() => Number(localStorage.getItem('reading.snapshot.retentionDays') || 90))
  const [snapshotMaxMb, setSnapshotMaxMb] = useState(() => Number(localStorage.getItem('reading.snapshot.maxMb') || 200))
  const [visitTimeRange, setVisitTimeRange] = useState<VisitTimeRange>('7d')
  const rangedVisits = useMemo(() => filterVisitsByRange(historyEntries, visitTimeRange), [historyEntries, visitTimeRange])
  const visitStats = useMemo(() => buildVisitStats(rangedVisits), [rangedVisits])
  const visitTrend = useMemo(() => buildVisitTrend(historyEntries, visitTimeRange), [historyEntries, visitTimeRange])

  useEffect(() => {
    let active = true
    void listBrowserHistory().then(entries => {
      if (active) setHistoryEntries(entries)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setHistoryPageLoading(true)
    void listBrowserHistoryPage(historyPage, historyPageSize)
      .then(result => {
        if (!active) return
        const lastPage = Math.max(1, Math.ceil(result.total / historyPageSize))
        if (historyPage > lastPage) {
          setHistoryPage(lastPage)
          return
        }
        setHistoryPageEntries(result.items)
        setHistoryTotal(result.total)
      })
      .finally(() => { if (active) setHistoryPageLoading(false) })
    return () => { active = false }
  }, [historyPage, historyPageSize])

  useEffect(() => { void getReadingSnapshotStats().then(setSnapshotStats) }, [])

  useEffect(() => {
    let cancelled = false
    void privacyCapabilityReport().then(cap => { if (!cancelled) setPrivacyCap(cap) }).catch(() => undefined)
    void privacyGetStats().then(s => { if (!cancelled) setPrivacyStats(s) }).catch(() => undefined)
    void privacyListBlocklists().then(lists => { if (!cancelled) setBlocklists(lists ?? []) }).catch(() => undefined)
    void privacyListBlockEvents(20).then(events => { if (!cancelled) setRecentBlocks(events ?? []) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  async function toggleBlocklist(id: string, enabled: boolean) {
    await privacySetBlocklistEnabled(id, enabled)
    setBlocklists(current => current.map(item => item.id === id ? { ...item, enabled } : item))
    messageApi.success(enabled ?t("\u5DF2\u542F\u7528\u89C4\u5219\u96C6"):t("\u5DF2\u7981\u7528\u89C4\u5219\u96C6"))
  }

  async function applySnapshotPolicy() {
    const days = Math.max(1, Math.min(3650, Math.round(snapshotRetentionDays)))
    const mb = Math.max(1, Math.min(10240, Math.round(snapshotMaxMb)))
    localStorage.setItem('reading.snapshot.retentionDays', String(days))
    localStorage.setItem('reading.snapshot.maxMb', String(mb))
    const stats = await purgeReadingSnapshots(days, mb * 1024 * 1024)
    setSnapshotRetentionDays(days); setSnapshotMaxMb(mb); setSnapshotStats(stats)
    messageApi.success(t("\u9605\u8BFB\u5FEB\u7167\u7B56\u7565\u5DF2\u5E94\u7528"))
  }

  async function clearHistory(scope: 'hour' | 'day' | 'week' | 'all') {
    const all = historyEntries
    if (scope === 'all') {
      await clearBrowserHistory()
      setHistoryEntries([])
      setHistoryPageEntries([])
      setHistoryTotal(0)
      setHistoryPage(1)
      window.dispatchEvent(new CustomEvent<HistoryEntry[]>(HISTORY_CHANGE_EVENT, { detail: [] }))
      messageApi.success(t("\u5DF2\u6E05\u7406\u5168\u90E8 {value0} \u6761\u6D4F\u89C8\u8BB0\u5F55",{value0:all.length}))
      return
    }
    const cutoff = cutoffForScope(scope)
    const next = all.filter(item => item.visitedAt < cutoff)
    await clearBrowserHistory(cutoff)
    setHistoryEntries(next)
    const firstPage = await listBrowserHistoryPage(1, historyPageSize)
    setHistoryPageEntries(firstPage.items)
    setHistoryTotal(firstPage.total)
    setHistoryPage(1)
    window.dispatchEvent(new CustomEvent<HistoryEntry[]>(HISTORY_CHANGE_EVENT, { detail: next }))
    messageApi.success(t("\u5DF2\u6E05\u7406 {value0} \u6761\u6D4F\u89C8\u8BB0\u5F55",{value0:all.length-next.length}))
  }

  function clearDownloads() {
    try {
      localStorage.removeItem('browser.downloads.v1')
    } catch { /* ignore */ }
    messageApi.success(t("\u5DF2\u6E05\u7A7A\u4E0B\u8F7D\u8BB0\u5F55\uFF08\u78C1\u76D8\u6587\u4EF6\u672A\u5220\u9664\uFF09"))
  }

  function clearClosedTabs() {
    try {
      localStorage.removeItem('browser.closed')
    } catch { /* ignore */ }
    void clearClosedTabsInDb()
    messageApi.success(t("\u5DF2\u6E05\u7A7A\u6700\u8FD1\u5173\u95ED\u5217\u8868"))
  }

  function clearAllPermissions() {
    try {
      localStorage.removeItem('browser.sitePermissions.v2')
    } catch { /* ignore */ }
    void replaceSitePermissions([])
    messageApi.success(t("\u5DF2\u91CD\u7F6E\u6240\u6709\u7AD9\u70B9\u6743\u9650\u89C4\u5219"))
  }

  function toggleCleanupOnExit(next: boolean) {
    setCleanupOnExit(next)
    writeCleanupOnExitPreference(next)
    messageApi.success(next ?t("\u9000\u51FA\u65F6\u5C06\u81EA\u52A8\u6E05\u7406\u6D4F\u89C8\u75D5\u8FF9"):t("\u5DF2\u5173\u95ED\u9000\u51FA\u6E05\u7406"))
  }

  const privateContent = <div className="privacy-section">
    <Alert type="info" showIcon message={t("\u79C1\u5BC6\u6807\u7B7E\u5DF2\u5C31\u7EEA")}description={t("\u901A\u8FC7\u5DE5\u5177\u680F\u300C\u22EF \u2192 \u65B0\u5EFA\u79C1\u5BC6\u7A97\u53E3\u300D\u6253\u5F00\uFF1B\u79C1\u5BC6\u7A97\u53E3\u4E0D\u4F1A\u5199\u5165\u5386\u53F2\u3001\u5173\u95ED\u5217\u8868\u6216\u4E0B\u8F7D\u6570\u636E\u5E93\u3002")}/>
    <Typography.Paragraph type="secondary">{t("\u79C1\u5BC6\u6807\u7B7E\u5173\u95ED\u540E\u4E0D\u4F1A\u51FA\u73B0\u5728\u6700\u8FD1\u5173\u95ED\u5217\u8868\uFF0C\u4E5F\u4E0D\u4F1A\u53C2\u4E0E\u4F1A\u8BDD\u6062\u590D\u3002")}</Typography.Paragraph>
  </div>

  const historyPageCount = Math.max(1, Math.ceil(historyTotal / historyPageSize))
  const historyPageNumbers = Array.from({ length: Math.min(7, historyPageCount) }, (_, index) => {
    const start = Math.max(1, Math.min(historyPage - 3, historyPageCount - 6))
    return start + index
  })

  const historyContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("\u6309\u65F6\u95F4\u8303\u56F4\u6E05\u7406\u6D4F\u89C8\u5386\u53F2\uFF08\u53EA\u5220\u6570\u636E\uFF0C\u4E0D\u4F1A\u5220\u9664\u5DF2\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93\u7684\u6587\u6863\uFF09\u3002")}</Typography.Paragraph>
    <Space wrap>
      <Button onClick={() => void clearHistory('hour')}>{t("\u6700\u8FD1 1 \u5C0F\u65F6")}</Button>
      <Button onClick={() => void clearHistory('day')}>{t("\u6700\u8FD1 24 \u5C0F\u65F6")}</Button>
      <Button onClick={() => void clearHistory('week')}>{t("\u6700\u8FD1 7 \u5929")}</Button>
      <Button danger onClick={() => void clearHistory('all')}>{t("\u6E05\u7A7A\u5168\u90E8")}</Button>
    </Space>
    <div className="privacy-history-head"><Typography.Text strong>{t("\u5168\u90E8\u8BB0\u5F55")}</Typography.Text><Typography.Text type="secondary">{t("\u5171")} {historyTotal} {t("\u6761")}</Typography.Text></div>
    <List loading={historyPageLoading} className="privacy-history-list" size="small" dataSource={historyPageEntries} locale={{ emptyText:t("\u6682\u65E0\u6D4F\u89C8\u5386\u53F2")}}renderItem={item=><List.Item key={`${item.url}-${item.visitedAt}`}><List.Item.Meta title={item.title||item.url}description={<><Typography.Text type="secondary">{new Date(item.visitedAt).toLocaleString()}</Typography.Text><Typography.Text className="privacy-history-url"copyable={{text:item.url}}>{item.url}</Typography.Text></>}/></List.Item>}/>
    {historyTotal > 0 && <div className="privacy-history-pagination" aria-label={t("\u6D4F\u89C8\u5386\u53F2\u5206\u9875")}>
      <Typography.Text type="secondary">{t("\u7B2C")} {(historyPage-1)*historyPageSize+1}–{Math.min(historyPage*historyPageSize,historyTotal)} {t("\u6761")}</Typography.Text>
      <div className="privacy-history-pagination__pages">
        <Button size="small" disabled={historyPage === 1 || historyPageLoading} onClick={() => setHistoryPage(page => page - 1)}>{t("\u4E0A\u4E00\u9875")}</Button>
        {historyPageNumbers.map(page => <Button key={page} size="small" type={page === historyPage ? 'primary' : 'default'} disabled={historyPageLoading} onClick={() => setHistoryPage(page)}>{page}</Button>)}
        <Button size="small" disabled={historyPage === historyPageCount || historyPageLoading} onClick={() => setHistoryPage(page => page + 1)}>{t("\u4E0B\u4E00\u9875")}</Button>
      </div>
      <Select<number> className="privacy-history-page-size" ariaLabel={t("\u6BCF\u9875\u6761\u6570")}value={historyPageSize}options={[10,20,50,100].map((value                )=>({label:t("{value0} \u6761/\u9875",{value0:value}),value}))}onChange={value=>{setHistoryPageSize(value);setHistoryPage(1)}}/>
    </div>}
  </div>

  const categoryColors: Record<string, string> = { '开发技术':'#1677ff', '视频娱乐':'#9254de', '社交社区':'#13a8a8', '搜索工具':'#52c41a', '购物':'#fa8c16', '其他':'#8c8c8c' }
  const maxSiteVisits = Math.max(1, ...visitStats.sites.map(item => item.count))
  const maxTrendVisits = Math.max(1, ...visitTrend.map(item => item.count))
  const statisticsContent = <div className="privacy-section visit-statistics">
    <div className="visit-statistics__toolbar"><Typography.Text strong>{t("\u7EDF\u8BA1\u65F6\u95F4")}</Typography.Text><Segmented size="small"value={visitTimeRange}onChange={value=>setVisitTimeRange(value as VisitTimeRange)}options={[{label:t("\u4ECA\u5929"),value:'today'},{label:t("\u6700\u8FD1 7 \u5929"),value:'7d'},{label:t("\u6700\u8FD1 30 \u5929"),value:'30d'},{label:t("\u5168\u90E8"),value:'all'}]}/></div>
    <div className="visit-statistics__summary">
      <div><b>{visitStats.totalVisits}</b><span>{t("\u6240\u9009\u65F6\u95F4\u5185\u8BBF\u95EE")}</span></div>
      <div><b>{visitStats.uniqueSites}</b><span>{t("\u4E0D\u540C\u7F51\u7AD9")}</span></div>
      <div><b>{visitStats.sites[0]?.label ?? '—'}</b><span>{t("\u6700\u5E38\u8BBF\u95EE")}</span></div>
    </div>
    {visitStats.totalVisits === 0 ? <Alert type="info" showIcon message={t("\u6682\u65E0\u53EF\u7EDF\u8BA1\u7684\u6D4F\u89C8\u5386\u53F2")}/>:<div className="visit-statistics__charts">
      <section className="visit-chart visit-chart--trend" aria-label={t("\u8BBF\u95EE\u6B21\u6570\u65F6\u95F4\u8D8B\u52BF")}>
        <Typography.Title level={5}>{t("\u8BBF\u95EE\u8D8B\u52BF")}</Typography.Title>
        <Typography.Paragraph type="secondary">{visitTimeRange === 'today' ?t("\u6309\u5C0F\u65F6\u7EDF\u8BA1\u4ECA\u5929\u7684\u8BBF\u95EE\u6B21\u6570\u3002"):visitTimeRange==='all'?t("\u5168\u90E8\u8303\u56F4\u7684\u8D8B\u52BF\u56FE\u5C55\u793A\u6700\u8FD1 30 \u5929\u3002"):t("\u6309\u5929\u7EDF\u8BA1\u6240\u9009\u65F6\u95F4\u8303\u56F4\u7684\u8BBF\u95EE\u6B21\u6570\u3002")}</Typography.Paragraph>
        <div className="visit-trend">{visitTrend.map((item, index) => <div className="visit-trend__column" key={item.key} title={t("{value0}\uFF1A{value1} \u6B21",{value0:item.label,value1:item.count})}>
          <span>{item.count || ''}</span><i style={{height:`${item.count ? Math.max(6, item.count / maxTrendVisits * 100) : 2}%`}}/><small>{(visitTrend.length <= 7 || index % Math.ceil(visitTrend.length / 7) === 0 || index === visitTrend.length - 1) ? item.label : ''}</small>
        </div>)}</div>
      </section>
      <section className="visit-chart" aria-label={t("\u7F51\u7AD9\u8BBF\u95EE\u6B21\u6570\u6392\u884C")}>
        <Typography.Title level={5}>{t("\u7F51\u7AD9\u8BBF\u95EE\u6B21\u6570")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("\u6309\u57DF\u540D\u5408\u5E76\uFF0C\u663E\u793A\u8BBF\u95EE\u6B21\u6570\u6700\u591A\u7684 10 \u4E2A\u7F51\u7AD9\u3002")}</Typography.Paragraph>
        <div className="visit-bars">{visitStats.sites.map(item => <div className="visit-bar" key={item.key} title={t("{value0}\uFF1A{value1} \u6B21",{value0:item.label,value1:item.count})}>
          <span className="visit-bar__label">{item.label}</span>
          <span className="visit-bar__track"><i style={{width:`${Math.max(4, item.count / maxSiteVisits * 100)}%`}}/></span>
          <b>{item.count}</b>
        </div>)}</div>
      </section>
      <section className="visit-chart" aria-label={t("\u7F51\u7AD9\u7C7B\u578B\u5206\u5E03")}>
        <Typography.Title level={5}>{t("\u7F51\u7AD9\u7C7B\u578B\u5206\u5E03")}</Typography.Title>
        <Typography.Paragraph type="secondary">{t("\u4F9D\u636E\u57DF\u540D\u5728\u672C\u5730\u5F52\u7C7B\uFF0C\u4E0D\u4F1A\u4E0A\u4F20\u6D4F\u89C8\u8BB0\u5F55\u3002")}</Typography.Paragraph>
        <div className="visit-category-chart">{visitStats.categories.map(item => <div className="visit-category" key={item.key}>
          <span className="visit-category__name"><i style={{background:categoryColors[item.label] ?? '#8c8c8c'}}/>{item.label}</span>
          <span className="visit-category__track"><i style={{width:`${item.percentage}%`,background:categoryColors[item.label] ?? '#8c8c8c'}}/></span>
          <b>{item.count} {t("\u6B21")}</b><small>{item.percentage.toFixed(1)}%</small>
        </div>)}</div>
      </section>
    </div>}
  </div>

  const cleanupContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("\u6E05\u7406\u6D4F\u89C8\u5668\u751F\u6210\u7684\u8F85\u52A9\u6570\u636E\uFF0C\u4E0D\u4F1A\u5220\u9664\u77E5\u8BC6\u5E93\u6587\u6863\u6216\u78C1\u76D8\u4E2D\u7684\u4E0B\u8F7D\u6587\u4EF6\u3002")}</Typography.Paragraph>
    <Space wrap>
      <Button onClick={clearClosedTabs}>{t("\u6E05\u7A7A\u6700\u8FD1\u5173\u95ED")}</Button>
      <Button onClick={clearDownloads}>{t("\u6E05\u7A7A\u4E0B\u8F7D\u8BB0\u5F55")}</Button>
      <Button onClick={clearAllPermissions}>{t("\u91CD\u7F6E\u6240\u6709\u7AD9\u70B9\u6743\u9650")}</Button>
    </Space>
  </div>

  const snapshotContent = <div className="privacy-section">
    <Typography.Paragraph>{t("\u5F53\u524D\u4FDD\u5B58")} <b>{snapshotStats.count}</b> {t("\u4E2A\u6B63\u6587\u5FEB\u7167\uFF0C\u5360\u7528")} <b>{formatSnapshotBytes(snapshotStats.bytes)}</b>{t("\u3002\u6E05\u7406\u5FEB\u7167\u4E0D\u4F1A\u5220\u9664\u9605\u8BFB\u65F6\u95F4\u3001\u6EDA\u52A8\u6DF1\u5EA6\u6216\u6D4F\u89C8\u5386\u53F2\u3002")}</Typography.Paragraph>
    <Space wrap align="end">
      <label><Typography.Text type="secondary">{t("\u4FDD\u7559\u5929\u6570")}</Typography.Text><InputNumber min={1}max={3650}value={snapshotRetentionDays}onChange={value=>setSnapshotRetentionDays(value??90)}/></label>
      <label><Typography.Text type="secondary">{t("\u5BB9\u91CF\u4E0A\u9650\uFF08MB\uFF09")}</Typography.Text><InputNumber min={1}max={10240}value={snapshotMaxMb}onChange={value=>setSnapshotMaxMb(value??200)}/></label>
      <Button type="primary" onClick={()=>void applySnapshotPolicy()}>{t("\u5E94\u7528\u5E76\u7ACB\u5373\u6E05\u7406")}</Button>
      <Popconfirm title={t("\u6E05\u7A7A\u5168\u90E8\u9605\u8BFB\u6B63\u6587\u5FEB\u7167\uFF1F")}description={t("\u57FA\u7840\u9605\u8BFB\u8BB0\u5F55\u4F1A\u4FDD\u7559\u3002")}onConfirm={()=>void clearReadingSnapshots().then(stats=>{setSnapshotStats(stats);messageApi.success(t("\u5DF2\u6E05\u7A7A\u5168\u90E8\u9605\u8BFB\u5FEB\u7167"))})}><Button danger>{t("\u6E05\u7A7A\u5168\u90E8\u5FEB\u7167")}</Button></Popconfirm>
    </Space>
    <Typography.Paragraph type="secondary" style={{marginTop:12}}>{t("\u8D85\u8FC7\u4FDD\u7559\u671F\u9650\u6216\u5BB9\u91CF\u4E0A\u9650\u65F6\uFF0C\u4F18\u5148\u5220\u9664\u6700\u65E9\u91C7\u96C6\u7684\u6B63\u6587\u5FEB\u7167\u3002")}</Typography.Paragraph>
  </div>

  const exportContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("\u628A\u5386\u53F2 / \u6536\u85CF / \u5173\u95ED\u7684\u6807\u7B7E / \u4E0B\u8F7D\u8BB0\u5F55 / \u7AD9\u70B9\u6743\u9650\u6253\u5305\u6210 AES-GCM \u52A0\u5BC6 JSON\u3002\u5BFC\u5165\u4F1A\u6309 URL \u5408\u5E76\uFF0C\u4E0D\u8986\u76D6\u73B0\u6709\u6761\u76EE\u3002")}</Typography.Paragraph>
    <PrivacyExportPanel />
  </div>

  const [adStats, setAdStats] = useState<AdBlockStatsSnapshot>(getAdBlockStats)

  useEffect(() => onAdBlockStatsChange(stats => setAdStats({ ...stats, domainEntries: Object.entries(stats.byDomain).map(([domain, count]) =>( { domain, count })).sort((a, b) => b.count - a.count) })), [])

  const adBlockContent = <div className="privacy-section">
    <div className="adblock-stats__summary">
      <Statistic title={t("\u603B\u4F1A\u8BDD\u62E6\u622A")}value={adStats.sessionBlocked}suffix={t("\u9879")}/>
      <Statistic title={t("\u5386\u53F2\u603B\u62E6\u622A")}value={adStats.totalBlocked}suffix={t("\u9879")}/>
    </div>
    {adStats.lastUpdated > 0 && <Typography.Paragraph type="secondary">{t("\u6700\u540E\u62E6\u622A\uFF1A")}{new Date(adStats.lastUpdated).toLocaleString()}</Typography.Paragraph>}
    {adStats.domainEntries.length > 0
      ? <><Typography.Title level={5}>{t("\u6309\u7AD9\u70B9\u62E6\u622A\u6392\u884C")}</Typography.Title>
        <List size="small" dataSource={adStats.domainEntries.slice(0, 20)} renderItem={entry => <List.Item><Typography.Text>{entry.domain}</Typography.Text><Tag>{entry.count}</Tag></List.Item>} />
      </>
      : <Alert type="info" showIcon message={t("\u5C1A\u65E0\u62E6\u622A\u8BB0\u5F55")}description={t("\u5E7F\u544A\u8FC7\u6EE4\u542F\u7528\u540E\uFF0C\u6BCF\u4E2A\u7AD9\u70B9\u7684\u62E6\u622A\u6570\u91CF\u4F1A\u5B9E\u65F6\u663E\u793A\u5728\u8FD9\u91CC\u3002")}/>
    }
    <Space style={{ marginTop: 16 }}>
      <Button onClick={() => { resetSessionAdBlockStats(); messageApi.success(t("\u5DF2\u91CD\u7F6E\u4F1A\u8BDD\u7EDF\u8BA1"))}}>{t("\u91CD\u7F6E\u4F1A\u8BDD\u7EDF\u8BA1")}</Button>
      <Popconfirm title={t("\u6E05\u7A7A\u5168\u90E8\u5E7F\u544A\u62E6\u622A\u7EDF\u8BA1\uFF1F")}description={t("\u5386\u53F2\u603B\u62E6\u622A\u548C\u6309\u7AD9\u70B9\u6570\u636E\u90FD\u4F1A\u88AB\u6E05\u9664\u3002")}okText={t("\u6E05\u7A7A")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>{resetAdBlockStats();messageApi.success(t("\u5DF2\u6E05\u7A7A\u5168\u90E8\u62E6\u622A\u7EDF\u8BA1"))}}>
        <Button danger>{t("\u6E05\u7A7A\u5168\u90E8\u7EDF\u8BA1")}</Button>
      </Popconfirm>
    </Space>
  </div>

  const exitContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("\u63A7\u5236\u5E94\u7528\u6B63\u5E38\u9000\u51FA\u65F6\u662F\u5426\u81EA\u52A8\u6E05\u7406\u672C\u5730\u6D4F\u89C8\u75D5\u8FF9\u3002")}</Typography.Paragraph>
    <Space align="start">
      <Switch checked={cleanupOnExit} onChange={toggleCleanupOnExit} />
      <Typography.Text>{t("\u9000\u51FA\u65F6\u6E05\u7A7A\u6D4F\u89C8\u5386\u53F2 / \u6700\u8FD1\u5173\u95ED / \u4E0B\u8F7D\u8BB0\u5F55\uFF08\u4FDD\u7559\u79C1\u5BC6\u7A97\u53E3\u672A\u5173\u95ED\u65F6\u5DF2\u6301\u4E45\u5316\u7684\u5185\u5BB9\uFF09")}</Typography.Text>
    </Space>
  </div>

  const ruleListContent = <div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("Rust \u7AEF\u7684\u9690\u79C1\u62E6\u622A\u80FD\u529B\uFF0C\u89C4\u5219\u96C6\u542F\u7528/\u7981\u7528\u7ACB\u5373\u751F\u6548\uFF1B\u66F4\u65B0\u89C4\u5219\u8BF7\u524D\u5F80\u9690\u79C1\u4E2D\u5FC3\u540E\u53F0\u4EFB\u52A1\u3002")}</Typography.Paragraph>
    <div className="privacy-rules">
      <div className="privacy-rules__row privacy-rules__row--header">
        <span>{t("\u89C4\u5219\u96C6")}</span><span>{t("\u89C4\u5219\u6570")}</span><span>{t("\u72B6\u6001")}</span><span>{t("\u6700\u8FD1\u9519\u8BEF")}</span><span>{t("\u64CD\u4F5C")}</span>
      </div>
      {blocklists.length === 0 && <Typography.Paragraph type="secondary">{t("\u6682\u65E0\u89C4\u5219\u96C6")}</Typography.Paragraph>}
      {blocklists.map(        (list











      )                    =>(<div key={list.id}className="privacy-rules__row">
          <span title={list.id}>{list.name ?? list.id}</span>
          <span>{list.ruleCount}</span>
          <span><Tag color={list.enabled ? 'green' : 'default'}>{list.enabled ?t("\u542F\u7528"):t("\u7981\u7528")}</Tag></span>
          <span title={list.lastError ?? ''}>{list.lastError ?? '—'}</span>
          <span>
            <Button size="small" onClick={() => void toggleBlocklist(list.id, !list.enabled)}>
              {list.enabled ?t("\u7981\u7528"):t("\u542F\u7528")}
            </Button>
          </span>
        </div>))}
    </div>
    <Space style={{ marginTop: 12 }}>
      <Tag color={privacyCap?.networkSubresourceBlocking ? 'green' : 'red'}>{t("\u5B50\u8D44\u6E90\u62E6\u622A:")} {privacyCap?.networkSubresourceBlocking?t("\u5DF2\u5F00\u542F"):t("\u672A\u542F\u7528")}
      </Tag>
      <Tag>{t("\u5DF2\u963B\u65AD")} {privacyStats.blocked}</Tag>
      <Tag>{t("\u5DF2\u653E\u884C")} {privacyStats.allowed}</Tag>
    </Space>
  </div>;const recentBlocksContent=<div className="privacy-section">
    <Typography.Paragraph type="secondary">{t("\u6700\u8FD1 20 \u6761\u5B50\u8D44\u6E90\u62E6\u622A\u8BB0\u5F55\u3002\u79C1\u5BC6\u6807\u7B7E\u4E0D\u5199\u5165\u6B64\u8868\u3002")}</Typography.Paragraph>
    {recentBlocks.length === 0?<Typography.Paragraph type="secondary">{t("\u6682\u65E0\u62E6\u622A\u8BB0\u5F55")}</Typography.Paragraph>:<ul className="privacy-recent">
          {recentBlocks.map(         (event

          )                       =>(<li key={event.id}>
              <span>{new Date(event.blockedAt * 1000).toLocaleString()}</span>
              <span>{event.resourceType}</span>
              <span title={event.requestHost}>{event.requestHost}</span>
              <span>{event.topLevelOrigin || '—'}</span>
            </li>))}
        </ul>}
  </div>;return<>{contextHolder}<Card title={t("\u9690\u79C1\u4E0E\u7AD9\u70B9\u6570\u636E")}className="settings-card privacy-settings-card"><Tabs className="privacy-section-tabs"tabPosition="left"defaultActiveKey="history"destroyOnHidden={false}items={[{key:'private',label:t("\u79C1\u5BC6\u6D4F\u89C8"),children:privateContent},{key:'history',label:t("\u6D4F\u89C8\u5386\u53F2 {value0}",{value0:historyEntries.length}),children:<div className="privacy-section privacy-history-workspace"><Tabs className="history-data-tabs"defaultActiveKey="statistics"destroyOnHidden={false}items={[{key:'statistics',label:t("\u7EDF\u8BA1\u5206\u6790"),children:statisticsContent},
      { key: 'records', label:t("\u539F\u59CB\u6570\u636E {value0}",{value0:historyTotal}),children:historyContent},
    ]}/></div> },
    { key: 'adblock', label:t("\u5E7F\u544A\u62E6\u622A {value0}",{value0:adStats.totalBlocked}),children:adBlockContent},
    { key: 'site-blacklist', label:t("\u7F51\u7AD9\u5C01\u6740"),children:<SiteBlacklistPanel/>},
    { key: 'rules', label:t("\u89C4\u5219\u96C6 {value0}",{value0:blocklists.length}),children:ruleListContent},
    { key: 'blocks', label:t("\u6700\u8FD1\u62E6\u622A {value0}",{value0:recentBlocks.length}),children:recentBlocksContent},
    { key: 'cleanup', label:t("\u6570\u636E\u6E05\u7406"),children:cleanupContent},
    { key: 'knowledge-base', label:t("\u77E5\u8BC6\u5E93"),children:<KnowledgeBaseStatusPanel/>},
    { key: 'snapshots', label:t("\u9605\u8BFB\u5FEB\u7167 {value0}",{value0:snapshotStats.count}),children:snapshotContent},
    { key: 'export', label:t("\u5BFC\u5165/\u5BFC\u51FA"),children:exportContent},
    { key: 'exit', label:t("\u9000\u51FA\u65F6"),children:exitContent},
  ]}/></Card></>
}

function formatSnapshotBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const CLEANUP_ON_EXIT_KEY = 'browser.cleanupOnExit.v1'

function readCleanupOnExitPreference(): boolean {
  try {
    return localStorage.getItem(CLEANUP_ON_EXIT_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCleanupOnExitPreference(value: boolean): void {
  try {
    localStorage.setItem(CLEANUP_ON_EXIT_KEY, value ? 'true' : 'false')
  } catch { /* ignore */ }
}

function cutoffForScope(scope: 'hour' | 'day' | 'week'): number {
  const now = Date.now()
  if (scope === 'hour') return now - 60 * 60 * 1000
  if (scope === 'day') return now - 24 * 60 * 60 * 1000
  return now - 7 * 24 * 60 * 60 * 1000
}

function PluginSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [enabled, setEnabled] = useState(isTrackingCleanerEnabled)
  const [adBlockEnabled, setAdBlockEnabledState] = useState(isAdBlockerEnabled)
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [auditPlugin, setAuditPlugin] = useState<InstalledPlugin>()
  const [auditEntries, setAuditEntries] = useState<PluginAuditEntry[]>([])
  const [busy, setBusy] = useState(false)
  const reloadPlugins=()=>void listPlugins().then(setInstalled).catch(error=>messageApi.error(String(error)))
  useEffect(reloadPlugins,[])

  async function addPlugin(){const picked=await pickFiles({title:t("\u5B89\u88C5 Arcadia \u63D2\u4EF6"),filters:[{label:t("Arcadia \u63D2\u4EF6"),extensions:['arcadia-plugin','zip']}]});if(!picked.paths[0])return;setBusy(true);try{await installPlugin(picked.paths[0]);messageApi.success(t("\u63D2\u4EF6\u5DF2\u5B89\u88C5\uFF0C\u9ED8\u8BA4\u4FDD\u6301\u505C\u7528"));reloadPlugins()}catch(error){messageApi.error(t("\u5B89\u88C5\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}finally{setBusy(false)}}
  async function grant(plugin:InstalledPlugin,permission:PluginPermission,value:boolean){try{if(plugin.enabled)await setPluginEnabled(plugin.id,false);await setPluginPermission(plugin.id,permission,value);messageApi.success(t("\u6743\u9650\u5DF2\u66F4\u65B0\uFF1B\u63D2\u4EF6\u4FDD\u6301\u505C\u7528\uFF0C\u9700\u91CD\u65B0\u542F\u7528"));reloadPlugins()}catch(error){messageApi.error(String(error))}}
  async function toggleThirdParty(plugin:InstalledPlugin,value:boolean){setBusy(true);try{await setPluginEnabled(plugin.id,value);reloadPlugins()}catch(error){messageApi.error(t("\u63D2\u4EF6\u542F\u52A8\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}finally{setBusy(false)}}
  async function showAudit(plugin:InstalledPlugin){setAuditPlugin(plugin);try{setAuditEntries(await listPluginAudit(plugin.id))}catch(error){messageApi.error(String(error))}}
  async function runUiCommand(plugin:InstalledPlugin,commandId:string){try{const result=await dispatchPluginEvent(plugin.id,'ui.command',JSON.stringify({commandId}));messageApi.success(result||t("\u547D\u4EE4\u5DF2\u5B8C\u6210"))}catch(error){messageApi.error(String(error))}}

  function toggle(next: boolean) {
    setEnabled(next)
    setTrackingCleanerEnabled(next)
  }

  function toggleAdBlock(next: boolean) {
    setAdBlockEnabledState(next)
    setAdBlockerEnabled(next)
    void setNativeAdBlocking(next).catch(() => undefined)
  }

  return <>{contextHolder}<Card title={t("\u63D2\u4EF6")}extra={<Button type="primary"loading={busy}onClick={()=>void addPlugin()}>{t("\u5B89\u88C5\u63D2\u4EF6")}</Button>}className="settings-card plugin-settings">
    <Alert type="info" showIcon message={t("\u5185\u7F6E\u793A\u4F8B\u63D2\u4EF6")}description={t("\u8BE5\u63D2\u4EF6\u7528\u4E8E\u6F14\u793A\u63D2\u4EF6\u7684\u72B6\u6001\u3001\u6743\u9650\u548C\u542F\u505C\u6D41\u7A0B\uFF1B\u5F00\u5173\u4F1A\u771F\u5B9E\u5F71\u54CD\u6D4F\u89C8\u5668\u5BFC\u822A\u3002")}/>
    <List className="plugin-list" itemLayout="horizontal" dataSource={[{ id: 'com.arcadia.tracking-cleaner', name:t("\u94FE\u63A5\u51C0\u5316\u5668"),version:'0.1.0'}]}renderItem={plugin=><List.Item actions={[<Switch key="enabled"checked={enabled}onChange={toggle}/>]}><List.Item.Meta title={<Space><Typography.Text strong>{plugin.name}</Typography.Text><Tag color="blue">{t("\u793A\u4F8B")}</Tag><Tag>{enabled?t("\u5DF2\u542F\u7528"):t("\u5DF2\u505C\u7528")}</Tag></Space>}description={<div className="plugin-description"><Typography.Paragraph>{t("\u6253\u5F00\u7F51\u9875\u524D\u81EA\u52A8\u79FB\u9664 utm_*\u3001fbclid\u3001gclid \u7B49\u5E38\u89C1\u8DDF\u8E2A\u53C2\u6570\uFF0C\u540C\u65F6\u4FDD\u7559\u9875\u9762\u6B63\u5E38\u67E5\u8BE2\u53C2\u6570\u3002")}</Typography.Paragraph><Space wrap><Typography.Text type="secondary">{plugin.id} · v{plugin.version}</Typography.Text><Tag>{t("\u8BFB\u53D6\u5BFC\u822A\u5730\u5740")}</Tag><Tag>{t("\u4FEE\u6539\u5BFC\u822A\u5730\u5740")}</Tag></Space></div>}/></List.Item>}/>
    <List className="plugin-list" itemLayout="horizontal" dataSource={[{ id: 'com.arcadia.ad-blocker', name:t("\u5E7F\u544A\u8FC7\u6EE4\u5668"),version:'0.1.0'}]}renderItem={plugin=><List.Item actions={[<Switch key="enabled"checked={adBlockEnabled}onChange={toggleAdBlock}/>]}><List.Item.Meta title={<Space><Typography.Text strong>{plugin.name}</Typography.Text><Tag color="green">{t("\u5185\u7F6E")}</Tag><Tag>{adBlockEnabled?t("\u5DF2\u542F\u7528"):t("\u5DF2\u505C\u7528")}</Tag></Space>}description={<div className="plugin-description"><Typography.Paragraph>{t("\u8FC7\u6EE4\u5E38\u89C1\u5E7F\u544A\u57DF\u540D\u548C\u5E7F\u544A\u5143\u7D20\uFF1B\u5DE5\u5177\u680F\u76FE\u724C\u663E\u793A\u5F53\u524D\u4F1A\u8BDD\u5B9E\u9645\u8FC7\u6EE4\u6570\u91CF\u3002\u5173\u95ED\u540E\u7ACB\u5373\u505C\u6B62\u9875\u9762\u8FC7\u6EE4\u3002")}</Typography.Paragraph><Space wrap><Typography.Text type="secondary">{plugin.id} · v{plugin.version}</Typography.Text><Tag>{t("\u8BFB\u53D6\u9875\u9762\u8D44\u6E90")}</Tag><Tag>{t("\u9690\u85CF\u5E7F\u544A\u5143\u7D20")}</Tag></Space></div>}/></List.Item>}/>
    <Typography.Title level={5} style={{marginTop:24}}>{t("\u7B2C\u4E09\u65B9 WASM \u63D2\u4EF6")}</Typography.Title>
    <Alert type="warning" showIcon message={t("\u9ED8\u8BA4\u96F6\u6743\u9650")}description={t("\u5B89\u88C5\u4E0D\u4F1A\u81EA\u52A8\u542F\u7528\u63D2\u4EF6\u3002\u8BF7\u9010\u9879\u6388\u6743\u540E\u518D\u542F\u7528\uFF1B\u4FEE\u6539\u6743\u9650\u4F1A\u7ACB\u5373\u505C\u7528\u63D2\u4EF6\u3002")}/>
    <List loading={busy} dataSource={installed} locale={{emptyText:t("\u5C1A\u672A\u5B89\u88C5\u7B2C\u4E09\u65B9\u63D2\u4EF6")}}renderItem={plugin=><List.Item actions={[<Button onClick={()=>void showAudit(plugin)}>{t("\u5BA1\u8BA1")}</Button>,<Switch checked={plugin.enabled}onChange={value=>void toggleThirdParty(plugin,value)}/>,<Popconfirm title={t("\u5378\u8F7D\u8FD9\u4E2A\u63D2\u4EF6\uFF1F")}onConfirm={()=>void uninstallPlugin(plugin.id).then(reloadPlugins)}><Button danger>{t("\u5378\u8F7D")}</Button></Popconfirm>]}><List.Item.Meta title={<Space><b>{plugin.name}</b><Tag>{plugin.version}</Tag><Tag color={plugin.enabled?'green':'default'}>{plugin.status}</Tag></Space>}description={<Space direction="vertical"><Typography.Text type="secondary">{plugin.manifest.description??plugin.id}</Typography.Text><Space wrap>{plugin.manifest.permissions.map(permission=><Switch key={permission}checked={plugin.grants.includes(permission)}checkedChildren={permission}unCheckedChildren={permission}onChange={value=>void grant(plugin,permission,value)}/>)}</Space>{plugin.enabled&&<Space wrap>{plugin.manifest.uiContributions.map(item=><Button key={item.id}onClick={()=>void runUiCommand(plugin,item.id)}>{item.label}</Button>)}</Space>}{plugin.lastError&&<Alert type="error"message={plugin.lastError}/>}</Space>}/></List.Item>}/>
  </Card><Drawer title={t("{value0} \xB7 \u5BA1\u8BA1\u65E5\u5FD7",{value0:auditPlugin?.name??''})}open={Boolean(auditPlugin)}onClose={()=>setAuditPlugin(undefined)}><List dataSource={auditEntries}locale={{emptyText:t("\u6682\u65E0\u5BA1\u8BA1\u8BB0\u5F55")}}renderItem={entry=><List.Item><List.Item.Meta title={<Space><Tag color={entry.success?'green':'red'}>{entry.success?t("\u6210\u529F"):t("\u5931\u8D25")}</Tag><Typography.Text>{entry.action}</Typography.Text>{entry.permission&&<Tag>{entry.permission}</Tag>}</Space>}description={<><Typography.Text type="secondary">{new Date(entry.createdAt*1000).toLocaleString()}</Typography.Text>{entry.error&&<Alert type="error"message={entry.error}/>}</>}/></List.Item>}/></Drawer></>
}

function McpSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [servers, setServers] = useState<McpServer[]>([])
  const [editingId, setEditingId] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inspecting, setInspecting] = useState<McpServer | null>(null)
  const [mcpBusy, setMcpBusy] = useState(false)
  const [tools, setTools] = useState<Array<{name:string;description?:string;inputSchema?:unknown}>>([])
  const [resources, setResources] = useState<Array<{uri?:string;name?:string;description?:string}>>([])
  const [toolArgs, setToolArgs] = useState<Record<string,string>>({})
  const [toolResult, setToolResult] = useState<unknown>(null)

  const reload = () => void listMcpServers().then(setServers).catch(error => messageApi.error(String(error)))
  useEffect(reload, [])

  function reset() {
    setEditingId(undefined); setName(''); setTransport('stdio'); setCommand(''); setUrl('')
    setArgs(''); setEnv(''); setHeaders(''); setEnabled(true)
  }

  function edit(server: McpServer) {
    setEditingId(server.id); setName(server.name); setTransport(server.transport)
    setCommand(server.command ?? ''); setUrl(server.url ?? ''); setArgs(server.args.join('\n'))
    setEnv(formatStringMap(server.env)); setHeaders(formatStringMap(server.headers)); setEnabled(server.enabled)
  }

  async function save() {
    if (!name.trim()) { messageApi.error(t("\u8BF7\u8F93\u5165 Server \u540D\u79F0"));return}
    if (transport === 'stdio' && !command.trim()) { messageApi.error(t("stdio \u8FDE\u63A5\u9700\u8981\u542F\u52A8\u547D\u4EE4"));return}
    if (transport !== 'stdio' && !url.trim()) { messageApi.error(t("{value0} \u8FDE\u63A5\u9700\u8981 URL",{value0:transport.toUpperCase()}));return}
    setSaving(true)
    try {
      await saveMcpServer({
        id: editingId, name: name.trim(), transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport === 'stdio' ? undefined : url.trim(),
        args: parseArguments(args), env: parseStringMap(env,t("\u73AF\u5883\u53D8\u91CF")),headers:parseStringMap(headers,t("\u8BF7\u6C42\u5934")),enabled,
      })
      messageApi.success(editingId ?t("MCP Server \u5DF2\u66F4\u65B0"):t("MCP Server \u5DF2\u4FDD\u5B58"))
      reset(); reload()
    } catch (error) { messageApi.error(error instanceof Error ? error.message : String(error)) }
    finally { setSaving(false) }
  }

  async function remove(id: string) {
    try { await deleteMcpServer(id); if (editingId === id) reset(); reload(); messageApi.success(t("MCP Server \u5DF2\u5220\u9664"))}
    catch (error) { messageApi.error(String(error)) }
  }

  async function inspect(server: McpServer) {
    setInspecting(server); setMcpBusy(true); setTools([]); setResources([]); setToolResult(null)
    try {
      await discoverMcpServer(server.id).catch(() => undefined)
      const [toolResponse, resourceResponse] = await Promise.all([listMcpTools(server.id), listMcpResources(server.id)])
      setTools((toolResponse as {tools?: typeof tools}).tools ?? [])
      setResources((resourceResponse as {resources?: typeof resources}).resources ?? [])
    } catch (error) { messageApi.error(t("MCP \u8FDE\u63A5\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setMcpBusy(false) }
  }

  async function invokeTool(toolName: string) {
    if (!inspecting) return
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(toolArgs[toolName] || '{}') as Record<string, unknown> }
    catch { messageApi.error(t("\u5DE5\u5177\u53C2\u6570\u5FC5\u987B\u662F JSON \u5BF9\u8C61"));return}
    if (!window.confirm(t("\u5141\u8BB8\u672C\u6B21\u8C03\u7528\u5DE5\u5177 {value0}\uFF1F\n\n{value1}",{value0:toolName,value1:JSON.stringify(parsed,null,2)})))return
    setMcpBusy(true)
    try { setToolResult(await callMcpTool(inspecting.id, toolName, parsed, true)) }
    catch (error) { messageApi.error(t("\u8C03\u7528\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setMcpBusy(false) }
  }

  return <>{contextHolder}<Card title="MCP Server" className="settings-card mcp-settings">
    <Alert type="info" showIcon message={t("MCP \u8FDE\u63A5\u5DF2\u542F\u7528")}description={t("\u652F\u6301\u672C\u5730 stdio\u3001Streamable HTTP \u4E0E SSE \u54CD\u5E94\u3002\u6BCF\u6B21\u5DE5\u5177\u8C03\u7528\u90FD\u4F1A\u663E\u793A\u53C2\u6570\u5E76\u8981\u6C42\u660E\u786E\u6388\u6743\u3002")}/>
    <div className="mcp-form">
      <div className="mcp-form__row mcp-form__row--identity">
        <label className="mcp-field">
          <span className="mcp-field__label">{t("Server \u540D\u79F0")}</span>
          <Input value={name} onChange={event=>setName(event.target.value)} placeholder={t("\u4F8B\u5982 filesystem")}/>
        </label>
        <div className="mcp-field mcp-field--transport">
          <span className="mcp-field__label">{t("\u4F20\u8F93\u65B9\u5F0F")}</span>
          <Segmented value={transport} onChange={value=>setTransport(value as McpTransport)} options={[{label:'stdio',value:'stdio'},{label:'HTTP',value:'http'},{label:'SSE',value:'sse'}]}/>
        </div>
      </div>
      {transport === 'stdio'
        ? <div className="mcp-form__row mcp-form__row--connection">
            <label className="mcp-field">
              <span className="mcp-field__label">{t("\u542F\u52A8\u547D\u4EE4")}</span>
              <Input value={command} onChange={event=>setCommand(event.target.value)} placeholder={t("\u4F8B\u5982 npx")}/>
            </label>
            <label className="mcp-field">
              <span className="mcp-field__label">{t("\u53C2\u6570")} <small>{t("\u6BCF\u884C\u4E00\u4E2A")}</small></span>
              <Input.TextArea value={args} onChange={event=>setArgs(event.target.value)} rows={3} placeholder={t("\u4F8B\u5982\uFF1A\n-y\n@modelcontextprotocol/server-filesystem")}/>
            </label>
          </div>
        : <label className="mcp-field">
            <span className="mcp-field__label">{t("\u670D\u52A1\u5730\u5740")}</span>
            <Input value={url} onChange={event=>setUrl(event.target.value)} placeholder={transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'}/>
          </label>
      }
      <div className="mcp-form__row mcp-form__row--json">
        <label className="mcp-field">
          <span className="mcp-field__label">{t("\u73AF\u5883\u53D8\u91CF JSON")}</span>
          <Input.TextArea value={env} onChange={event=>setEnv(event.target.value)} rows={2} placeholder={'{"TOKEN":"..."}'}/>
        </label>
        <label className="mcp-field">
          <span className="mcp-field__label">{t("\u8BF7\u6C42\u5934 JSON")}</span>
          <Input.TextArea value={headers} onChange={event=>setHeaders(event.target.value)} rows={2} placeholder={'{"Authorization":"Bearer ..."}'}/>
        </label>
      </div>
      <div className="mcp-form__actions">
        <label className="mcp-toggle"><Switch checked={enabled} onChange={setEnabled}/><span>{t("\u542F\u7528")}</span></label>
        <Button type="primary" loading={saving} onClick={()=>void save()}>{editingId ?t("\u4FDD\u5B58\u4FEE\u6539"):t("\u6DFB\u52A0 Server")}</Button>
        {editingId&&<Button onClick={reset}>{t("\u53D6\u6D88\u7F16\u8F91")}</Button>}
      </div>
    </div>
    <List style={{marginTop:18}} dataSource={servers} locale={{emptyText:t("\u5C1A\u672A\u914D\u7F6E MCP Server")}}renderItem={server=><List.Item actions={[<Button size="small"disabled={!server.enabled}onClick={()=>void inspect(server)}>{t("\u8FDE\u63A5")}</Button>,<Button size="small"onClick={()=>edit(server)}>{t("\u7F16\u8F91")}</Button>,<Popconfirm title={t("\u5220\u9664\u8FD9\u4E2A MCP Server\uFF1F")}onConfirm={()=>void remove(server.id)}><Button size="small"danger>{t("\u5220\u9664")}</Button></Popconfirm>]}><List.Item.Meta title={<Space><b>{server.name}</b><Tag>{server.transport}</Tag><Tag color={server.enabled?'green':'default'}>{server.enabled?t("\u542F\u7528"):t("\u505C\u7528")}</Tag></Space>}description={server.transport==='stdio'?[server.command,...server.args].filter(Boolean).join(' '):server.url}/></List.Item>}/>
    <Drawer title={inspecting ? `MCP · ${inspecting.name}` : 'MCP'} width={560} open={Boolean(inspecting)} onClose={()=>setInspecting(null)}>
      {mcpBusy && <Spin/>}<Typography.Title level={5}>{t("\u5DE5\u5177")}</Typography.Title>
      <List dataSource={tools} locale={{emptyText:t("\u670D\u52A1\u672A\u8FD4\u56DE\u5DE5\u5177")}}renderItem={tool=><List.Item><Space direction="vertical"style={{width:'100%'}}><b>{tool.name}</b><Typography.Text type="secondary">{tool.description??t("\u65E0\u63CF\u8FF0")}</Typography.Text><Input.TextArea value={toolArgs[tool.name]??'{}'}onChange={event=>setToolArgs((current)=>({...current,[tool.name]:event.target.value}))}autoSize={{minRows:2,maxRows:8}}/><Button type="primary"disabled={mcpBusy}onClick={()=>void invokeTool(tool.name)}>{t("\u5BA1\u6838\u5E76\u8C03\u7528")}</Button></Space></List.Item>}/>
      <Typography.Title level={5} style={{marginTop:20}}>{t("\u8D44\u6E90")}</Typography.Title><List dataSource={resources}locale={{emptyText:t("\u670D\u52A1\u672A\u8FD4\u56DE\u8D44\u6E90")}}renderItem={resource=><List.Item><List.Item.Meta title={resource.name??resource.uri}description={resource.description??resource.uri}/></List.Item>}/>
      {toolResult!=null&&<><Typography.Title level={5} style={{marginTop:20}}>{t("\u8C03\u7528\u7ED3\u679C")}</Typography.Title><pre style={{whiteSpace:'pre-wrap',overflow:'auto'}}>{JSON.stringify(toolResult,null,2)}</pre></>}
    </Drawer>
  </Card></>
}

function SystemPerformanceSettingsPanel() {
  const [settings, setSettings] = useState<AdvancedSettings>(readAdvancedSettings)

  function update(patch: Partial<AdvancedSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    writeAdvancedSettings(next)
  }

  function reset() {
    setSettings(DEFAULT_ADVANCED_SETTINGS)
    writeAdvancedSettings(DEFAULT_ADVANCED_SETTINGS)
  }

  const systemPanel = <>
    <Alert type="info" showIcon message={t("\u90E8\u5206\u7CFB\u7EDF\u8BBE\u7F6E\u9700\u8981\u91CD\u542F\u6D4F\u89C8\u5668\u540E\u5B8C\u5168\u751F\u6548")}/>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u4F7F\u7528\u786C\u4EF6\u52A0\u901F")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u53EF\u7528\u65F6\u4F7F\u7528 GPU \u7ED8\u5236\u7F51\u9875\u548C\u754C\u9762\u3002\u5173\u95ED\u540E\u53EF\u89E3\u51B3\u90E8\u5206\u663E\u5361\u9A71\u52A8\u5BFC\u81F4\u7684\u95EA\u70C1\u6216\u9ED1\u5C4F\u3002")}</Typography.Paragraph></div><Switch checked={settings.hardwareAcceleration}onChange={value=>update({hardwareAcceleration:value})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u542F\u52A8\u589E\u5F3A")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u4FDD\u7559\u8F7B\u91CF\u7EA7\u542F\u52A8\u72B6\u6001\uFF0C\u4EE5\u7F29\u77ED\u4E0B\u6B21\u6253\u5F00\u6D4F\u89C8\u5668\u7684\u7B49\u5F85\u65F6\u95F4\u3002")}</Typography.Paragraph></div><Switch checked={settings.startupBoost}onChange={value=>update({startupBoost:value})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u4F7F\u7528 F12 \u952E\u6253\u5F00\u5F00\u53D1\u4EBA\u5458\u5DE5\u5177")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u5173\u95ED\u540E\u9690\u85CF\u6D4F\u89C8\u5668\u83DC\u5355\u4E2D\u7684\u5F00\u53D1\u8005\u5DE5\u5177\u5165\u53E3\uFF0C\u5E76\u5FFD\u7565 F12 \u5FEB\u6377\u952E\u3002")}</Typography.Paragraph></div><Switch checked={settings.developerToolsEnabled}onChange={value=>update({developerToolsEnabled:value})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u5371\u9669\u5730\u5740\u63D0\u9192")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u5728\u5730\u5740\u5305\u542B\u53EF\u7591\u534F\u8BAE\u3001\u51ED\u636E\u6216\u4E0D\u5B89\u5168 HTTP \u65F6\u663E\u793A\u63D0\u9192\u3002")}</Typography.Paragraph></div><Switch checked={settings.safetyWarnings}onChange={value=>update({safetyWarnings:value})}/></div>
  </>

  const performancePanel = <>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u6D3B\u52A8\u7F51\u9875\u4E0A\u9650")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u8D85\u8FC7\u4E0A\u9650\u7684\u540E\u53F0\u6807\u7B7E\u9875\u4F1A\u4F11\u7720\uFF0C\u91CD\u65B0\u9009\u4E2D\u65F6\u81EA\u52A8\u6062\u590D\uFF0C\u4EE5\u964D\u4F4E\u5185\u5B58\u5360\u7528\u3002")}</Typography.Paragraph></div><InputNumber min={2}max={16}value={settings.maxLiveWebviews}onChange={value=>update({maxLiveWebviews:value??8})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u51CF\u5C11\u754C\u9762\u52A8\u753B")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u5173\u95ED\u9875\u9762\u5207\u6362\u4F4D\u79FB\u548C\u4FA7\u680F\u52A8\u6548\uFF0C\u9002\u5408\u4F4E\u6027\u80FD\u8BBE\u5907\u6216\u504F\u597D\u9759\u6001\u754C\u9762\u3002")}</Typography.Paragraph></div><Switch checked={settings.reduceMotion}onChange={value=>update({reduceMotion:value})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u7A7A\u95F2\u81EA\u52A8\u4F11\u7720")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u8D85\u8FC7\u8BBE\u5B9A\u5206\u949F\u6570\u672A\u8BBF\u95EE\u7684\u6807\u7B7E\u9875\u4F1A\u88AB\u5217\u5165\u4F11\u7720\u5019\u9009\uFF1B\u56FA\u5B9A\u6807\u7B7E\u3001\u6709\u97F3\u9891\u3001\u6216\u6B63\u5728\u4E0B\u8F7D\u7684\u6807\u7B7E\u9875\u4F1A\u8C41\u514D\u3002")}</Typography.Paragraph></div><InputNumber min={1}max={180}value={settings.idleSuspendMinutes}addonAfter={t("\u5206\u949F")}onChange={value=>update({idleSuspendMinutes:value??30})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u540E\u53F0\u6807\u7B7E\u8F6E\u8BE2")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u5173\u95ED\u540E\u975E\u6D3B\u52A8\u6807\u7B7E\u5B8C\u5168\u505C\u6B62\u8F6E\u8BE2\uFF0C\u4EC5\u5728\u5207\u6362\u65F6\u5237\u65B0\u72B6\u6001\uFF1B\u9002\u5408\u6781\u4F4E\u529F\u8017\u8BBE\u5907\u3002")}</Typography.Paragraph></div><Switch checked={settings.backgroundPollingEnabled}onChange={value=>update({backgroundPollingEnabled:value})}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u540E\u53F0\u8F6E\u8BE2\u9891\u7387")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u540E\u53F0\u6807\u7B7E\u72B6\u6001\u540C\u6B65\u7684\u9891\u7387\uFF0C\u8D8A\u5C0F\u8D8A\u5B9E\u65F6\u4F46 CPU \u8D8A\u9AD8\u3002")}</Typography.Paragraph></div><InputNumber min={1000}max={15000}step={500}value={settings.backgroundPollIntervalMs}addonAfter="ms"onChange={value=>update({backgroundPollIntervalMs:value??3000})}disabled={!settings.backgroundPollingEnabled}/></div>
    <div className="advanced-setting-row"><div><Typography.Text strong>{t("\u4E0B\u8F7D\u5E76\u53D1\u4E0A\u9650")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u540C\u65F6\u8FDB\u884C\u7684\u4E0B\u8F7D\u8D85\u8FC7\u4E0A\u9650\u65F6\uFF0C\u65B0\u4EFB\u52A1\u4F1A\u6309 FIFO \u8FDB\u5165\u672C\u5730\u6392\u961F\uFF1B\u4EFB\u610F\u4E00\u4E2A\u4EFB\u52A1\u7ED3\u675F\u81EA\u52A8\u63A5\u529B\u4E0B\u4E00\u4E2A\u3002")}</Typography.Paragraph></div><InputNumber min={1}max={8}value={settings.maxConcurrentDownloads}onChange={value=>update({maxConcurrentDownloads:value??3})}/></div>
  </>

  return <Card title={t("\u7CFB\u7EDF\u548C\u6027\u80FD")}className="settings-card advanced-settings system-performance-settings">
    <Tabs className="system-performance-tabs" tabPosition="top" defaultActiveKey="system" items={[
      { key: 'system', label:t("\u7CFB\u7EDF"),children:systemPanel},
      { key: 'performance', label:t("\u6027\u80FD"),children:performancePanel},
    ]}/>
    <Button style={{ marginTop: 18 }} onClick={reset}>{t("\u6062\u590D\u7CFB\u7EDF\u548C\u6027\u80FD\u9ED8\u8BA4\u503C")}</Button>
  </Card>
}

function TypographySettingsPanel() {
  const [settings, setSettings] = useState<TypographySettings>(readTypographySettings)
  const activeFont = typographyFont(settings.fontFamily)

  function update(patch: Partial<TypographySettings>) {
    setSettings(writeTypographySettings({ ...settings, ...patch }))
  }

  function reset() {
    setSettings(writeTypographySettings(DEFAULT_TYPOGRAPHY_SETTINGS))
  }

  return <Card title={t("\u5B57\u4F53")}className="settings-card typography-settings">
    <Typography.Paragraph type="secondary">{t("\u4E3A\u754C\u9762\u548C\u9605\u8BFB\u6B63\u6587\u9009\u62E9\u5B57\u4F53\u3002\u4F18\u5148\u4F7F\u7528\u5F00\u6E90\u5B57\u4F53\uFF1B\u672C\u673A\u672A\u5B89\u88C5\u65F6\u4F1A\u56DE\u9000\u5230\u540C\u4E00\u98CE\u683C\u7684\u7CFB\u7EDF\u5B57\u4F53\uFF0C\u4ECD\u53EF\u6B63\u5E38\u9605\u8BFB\u3002")}</Typography.Paragraph>
    <div className="font-option-grid" role="radiogroup" aria-label={t("\u5B57\u4F53")}>
      {TYPOGRAPHY_FONTS.map(font => {
        const selected = font.id === settings.fontFamily
        return <button
          key={font.id}
          type="button"
          role="radio"
          aria-checked={selected}
          className={`font-option${selected ? ' is-active' : ''}`}
          style={{ fontFamily: font.stack }}
          onClick={() => update({ fontFamily: font.id })}
        >
          {selected && <CheckCircleOutlined className="font-option__check"/>}
          <span className="font-option__sample">{t("\u6C38 Aa")}</span>
          <span className="font-option__name">{font.label}</span>
          <span className="font-option__meta">{font.latin} · {font.license}</span>
        </button>
      })}
    </div>
    <div className="advanced-setting-row">
      <div><Typography.Text strong>{t("\u6B63\u6587\u5B57\u53F7")}</Typography.Text><Typography.Paragraph type="secondary">{t("\u5F71\u54CD\u9605\u8BFB\u6A21\u5F0F\u4E0E\u77E5\u8BC6\u5E93\u6B63\u6587\u7684\u5B57\u53F7\uFF0C\u957F\u6587\u9605\u8BFB\u65F6\u66F4\u5BB9\u6613\u627E\u5230\u8212\u9002\u7684\u5B57\u53F7\u3002")}</Typography.Paragraph></div>
      <InputNumber min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} value={settings.fontSize} addonAfter="px" onChange={value => update({ fontSize: value ?? DEFAULT_TYPOGRAPHY_SETTINGS.fontSize })}/>
    </div>
    <div className="typography-preview" style={{ fontFamily: activeFont.stack }}>
      <span className="typography-preview__label">{t("\u9884\u89C8 \xB7")} {activeFont.label} · {settings.fontSize}px</span>
      <p style={{ fontSize: settings.fontSize }}>{t("\u8BFB\u4E66\u662F\u5728\u522B\u4EBA\u601D\u60F3\u7684\u5E2E\u52A9\u4E0B\uFF0C\u5EFA\u7ACB\u8D77\u81EA\u5DF1\u7684\u601D\u60F3\u3002\u5C71\u5DDD\u5F02\u57DF\uFF0C\u98CE\u6708\u540C\u5929\u3002")}</p>
      <p className="typography-preview__latin" style={{ fontSize: settings.fontSize }}>The quick brown fox jumps over the lazy dog. 0123456789</p>
    </div>
    <div className="typography-settings__actions">
      <Button onClick={reset}>{t("\u6062\u590D\u9ED8\u8BA4\u5B57\u4F53\u8BBE\u7F6E")}</Button>
      <Typography.Text type="secondary">{t("\u9ED8\u8BA4\u601D\u6E90\u5B8B\u4F53 \xB7 18px")}</Typography.Text>
    </div>
  </Card>
}

function PasswordManagerSettings() {
  const [messageApi, contextHolder] = message.useMessage()
  const [credentials, setCredentials] = useState<SavedCredential[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try { setCredentials(await listBrowserPasswords()) }
    catch (error) { messageApi.error(t("\u8BFB\u53D6\u5BC6\u7801\u5E93\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  const normalized = query.trim().toLocaleLowerCase()
  const visible = normalized
    ? credentials.filter(item => `${item.origin}\n${item.username}`.toLocaleLowerCase().includes(normalized))
    : credentials

  async function remove(id: string) {
    try {
      if (!(await deleteBrowserPassword(id)))throw new Error(t("\u51ED\u636E\u4E0D\u5B58\u5728\u6216\u5DF2\u5220\u9664"))
      setCredentials(current => current.filter(item => item.id !== id))
      messageApi.success(t("\u5DF2\u4ECE\u7CFB\u7EDF\u5BC6\u7801\u5E93\u5220\u9664"))
    } catch (error) { messageApi.error(t("\u5220\u9664\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
  }

  return <>{contextHolder}<Card title={<Space><KeyOutlined/>{t("\u5BC6\u7801\u7BA1\u7406\u5668")}</Space>}className="settings-card password-manager-settings">
    <Alert type="info" showIcon message={t("\u5BC6\u7801\u7531\u64CD\u4F5C\u7CFB\u7EDF\u4FDD\u62A4")}description={t("\u8FD9\u91CC\u53EA\u663E\u793A\u7F51\u7AD9\u548C\u7528\u6237\u540D\u3002\u5BC6\u7801\u6B63\u6587\u4FDD\u5B58\u5728 Windows \u51ED\u636E\u7BA1\u7406\u5668\u4E2D\uFF0C\u4E0D\u4F1A\u5728\u8BBE\u7F6E\u9875\u9762\u56DE\u663E\u6216\u5199\u5165 SQLite\u3002")}/>
    <Input
      allowClear
      prefix={<SearchOutlined/>}
      value={query}
      onChange={event => setQuery(event.target.value)}
      placeholder={t("\u641C\u7D22\u7F51\u7AD9\u6216\u7528\u6237\u540D")}
      style={{ margin: '16px 0' }}
    />
    <List
      loading={loading}
      dataSource={visible}
      locale={{ emptyText: query ?t("\u6CA1\u6709\u5339\u914D\u7684\u5DF2\u4FDD\u5B58\u5BC6\u7801"):t("\u5C1A\u672A\u4FDD\u5B58\u5BC6\u7801")}}
      renderItem={item => <List.Item actions={[
        <Popconfirm key="delete" title={t("\u5220\u9664\u8FD9\u6761\u5DF2\u4FDD\u5B58\u5BC6\u7801\uFF1F")}description={t("\u5220\u9664\u540E\u65E0\u6CD5\u6062\u590D\uFF0C\u4E0B\u6B21\u767B\u5F55\u65F6\u53EF\u4EE5\u91CD\u65B0\u4FDD\u5B58\u3002")}okText={t("\u5220\u9664")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>void remove(item.id)}>
          <Button type="text" danger icon={<DeleteOutlined/>}>{t("\u5220\u9664")}</Button>
        </Popconfirm>,
      ]}>
        <List.Item.Meta
          avatar={<KeyOutlined/>}
          title={<Typography.Text strong>{item.origin}</Typography.Text>}
          description={<Space direction="vertical" size={2}>
            <Typography.Text copyable={{text:item.username}}>{item.username}</Typography.Text>
            <Typography.Text type="secondary">{t("\u66F4\u65B0\u4E8E")} {new Date(item.updatedAt*1000).toLocaleString()}</Typography.Text>
          </Space>}
        />
      </List.Item>}
    />
    <Typography.Paragraph type="secondary" style={{marginTop:16}}>{t("\u5171")} {credentials.length} {t("\u6761\u51ED\u636E\u3002\u65B0\u5BC6\u7801\u4F1A\u5728 HTTPS \u767B\u5F55\u8868\u5355\u63D0\u4EA4\u540E\u8BE2\u95EE\u662F\u5426\u4FDD\u5B58\u3002")}</Typography.Paragraph>
  </Card></>
}

export function SettingsPage() {
  const panels = [
    [t("\u901A\u7528"),<GeneralSettings/>],
    [t("\u6D4F\u89C8\u5668"),<BrowserSettings/>],
    [t("\u9690\u79C1"),<PrivacySettings/>],
    [t("\u5BC6\u7801\u7BA1\u7406\u5668"),<PasswordManagerSettings/>],
    ['AI Provider', <AIProviderSettings/>],
    [t("\u77E5\u8BC6\u5E93"),<KnowledgeBaseSettings/>],
    ['MCP', <McpSettings/>],
    [t("\u63D2\u4EF6"),<PluginSettings/>],
    [t("\u7CFB\u7EDF\u548C\u6027\u80FD"),<SystemPerformanceSettingsPanel/>],
    [t("\u5B57\u4F53"),<TypographySettingsPanel/>],
    [t("\u641C\u7D22\u5F15\u64CE"),<SearchEngineSettings/>],
    [t("\u4E0B\u8F7D"),<DownloadSettingsPanel/>],
    [t("\u91CD\u7F6E\u8BBE\u7F6E"),<ResetSettingsPanel/>],
    [t("\u5173\u4E8E"),<AboutSettingsPanel/>],
    [t("\u5F00\u6E90\u7EC4\u4EF6"),<OpenSourceSettingsPanel/>],
  ] as const
  const items = panels.map(([label, panel]) =>( {
    key: label,
    label,
    children: <div className="settings-pane">{panel}</div>,
  }))
  return <section className="page settings-page">
    <PageHeader title={t("\u8BBE\u7F6E")}/>
    <Tabs className="settings-tabs" tabPosition="left" items={items} defaultActiveKey={t("\u901A\u7528")}/>
  </section>
}
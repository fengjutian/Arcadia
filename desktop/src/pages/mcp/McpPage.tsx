import { t } from '@arcadia/i18n'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Boxes,
  ChevronRight,
  Copy,
  Database,
  Download,
  History,
  MessageSquare,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  Store,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react'
import {
  callMcpTool,
  clearMcpAudit,
  deleteMcpServer,
  diagnoseMcpServer,
  discoverMcpServer,
  disconnectMcpServer,
  exportMcpConfig,
  getMcpPrompt,
  getMcpServerStatus,
  getMcpCachedCapabilities,
  importMcpConfig,
  listMcpAudit,
  listMcpPrompts,
  listMcpResources,
  listMcpServers,
  listMcpTools,
  pingMcpServer,
  previewMcpConfig,
  readMcpResource,
  revokeMcpToolGrant,
  saveMcpServer,
  type McpAuditEntry,
  type McpCachedCapabilities,
  type McpCapabilityDiff,
  type McpConfigExport,
  type McpConfigPreview,
  type McpDiagnosticReport,
  type McpImportSummary,
  type McpServer,
  type McpServerStatus,
  type McpTransport,
} from '../../api'
import { Alert, Button, Card, Drawer, Input, Modal, Popconfirm, Segmented, Spin, Switch, Tag, Typography, message } from '../../components/ui'
import { formatStringMap, parseArguments, parseStringMap } from '../../features/mcp/config'
import { initialArguments, validateArguments, type ArgumentIssue } from '../../features/mcp/schema'
import { ToolArgumentsEditor } from '../../features/mcp/ToolArgumentsEditor'
import { ToolResultView } from '../../features/mcp/ToolResultView'
import { SkillHubPage } from '../skillhub/SkillHubPage'

type McpTool = { name: string; description?: string; inputSchema?: unknown; arcadiaRisk?: string; arcadiaGranted?: boolean }
type McpResource = { uri?: string; name?: string; description?: string }
type McpPrompt = { name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }

type Viewer = { title: string; body: string; kind: 'resource' | 'prompt' }

const EMPTY_STATUS: McpServerStatus = { serverId: '', connected: false, failureCount: 0 }

function riskColor(risk?: string): string {
  switch (risk) {
    case 'R0': return 'green'
    case 'R1': return 'blue'
    case 'R2': return 'orange'
    case 'R3': return 'red'
    default: return 'default'
  }
}

function riskLabel(risk?: string): string {
  switch (risk) {
    case 'R0': return t("R0 · 只读元数据")
    case 'R1': return t("R1 · 只读数据")
    case 'R2': return t("R2 · 写入或外发")
    case 'R3': return t("R3 · 高风险")
    default: return t("R2 · 写入或外发")
  }
}

function configFieldLabel(field: string): string {
  switch (field) {
    case 'transport': return t("传输方式")
    case 'command': return t("启动命令")
    case 'url': return t("服务地址")
    case 'args': return t("参数")
    case 'enabled': return t("启用")
    default: return field
  }
}

function capabilityKindLabel(kind: string): string {
  switch (kind) {
    case 'tools': return t("工具")
    case 'resources': return t("资源")
    case 'prompts': return t("提示词")
    default: return kind
  }
}

function cachedItemLabel(item: unknown): { name: string; detail?: string } {
  if (!item || typeof item !== 'object') return { name: String(item) }
  const record = item as Record<string, unknown>
  const name = [record.name, record.uri, record.title].find((value): value is string => typeof value === 'string' && value.length > 0)
  const detail = [record.description, record.mimeType].find((value): value is string => typeof value === 'string' && value.length > 0)
  return { name: name ?? '—', detail }
}

function diagnosticStageLabel(name: string): string {
  switch (name) {
    case 'initialize': return t("初始化")
    case 'tools': return t("工具")
    case 'resources': return t("资源")
    case 'prompts': return t("提示词")
    default: return name
  }
}

function argumentIssueMessage(issue: ArgumentIssue): string {
  switch (issue.reason) {
    case 'required': return t("字段 {value0} 为必填项",{value0:issue.field})
    case 'string': return t("字段 {value0} 必须是字符串",{value0:issue.field})
    case 'number': return t("字段 {value0} 必须是数字",{value0:issue.field})
    case 'integer': return t("字段 {value0} 必须是整数",{value0:issue.field})
    case 'boolean': return t("字段 {value0} 必须是布尔值",{value0:issue.field})
    case 'array': return t("字段 {value0} 必须是数组",{value0:issue.field})
    case 'object': return t("字段 {value0} 必须是对象",{value0:issue.field})
    case 'enum': return t("字段 {value0} 的值不在允许范围内",{value0:issue.field})
    default: return issue.field
  }
}

export function McpPage({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [tools, setTools] = useState<McpTool[]>([])
  const [resources, setResources] = useState<McpResource[]>([])
  const [prompts, setPrompts] = useState<McpPrompt[]>([])
  const [toolArgs, setToolArgs] = useState<Record<string, Record<string, unknown>>>({})
  const [result, setResult] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string>()
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [section, setSection] = useState<'servers' | 'skillhub'>('servers')
  const [viewer, setViewer] = useState<Viewer>()
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditEntries, setAuditEntries] = useState<McpAuditEntry[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const [exportJson, setExportJson] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importConfig, setImportConfig] = useState<McpConfigExport>()
  const [importPreview, setImportPreview] = useState<McpConfigPreview>()
  const [importResult, setImportResult] = useState<McpImportSummary | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [diagnoseOpen, setDiagnoseOpen] = useState(false)
  const [diagnoseBusy, setDiagnoseBusy] = useState(false)
  const [diagnostic, setDiagnostic] = useState<McpDiagnosticReport>()
  const [cachedOpen, setCachedOpen] = useState(false)
  const [cachedBusy, setCachedBusy] = useState(false)
  const [cachedCapabilities, setCachedCapabilities] = useState<McpCachedCapabilities>()
  const [capabilityNotice, setCapabilityNotice] = useState<Array<{ kind: 'tools' | 'resources' | 'prompts'; diff: McpCapabilityDiff }>>()
  const [toolFilter, setToolFilter] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => servers.find(server => server.id === selectedId), [selectedId, servers])
  const status = selectedId ? statuses[selectedId] ?? EMPTY_STATUS : EMPTY_STATUS
  const visibleTools = useMemo(() => {
    const query = toolFilter.trim().toLowerCase()
    if (!query) return tools
    return tools.filter(tool => `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(query))
  }, [tools, toolFilter])
  const cachedSections = cachedCapabilities
    ? [
        { key: 'tools', label: t("工具"), items: cachedCapabilities.tools },
        { key: 'resources', label: t("资源"), items: cachedCapabilities.resources },
        { key: 'prompts', label: t("提示词"), items: cachedCapabilities.prompts },
      ]
    : []

  async function refreshStatuses(next: McpServer[]) {
    const entries = await Promise.all(next.map(async server => {
      const value = await getMcpServerStatus(server.id).catch(() => ({ ...EMPTY_STATUS, serverId: server.id }))
      return [server.id, value] as const
    }))
    setStatuses(Object.fromEntries(entries))
  }

  async function reload() {
    try {
      const next = await listMcpServers()
      setServers(next)
      setSelectedId(current => next.some(server => server.id === current) ? current : next[0]?.id)
      await refreshStatuses(next)
    } catch (error) { messageApi.error(String(error)) }
  }

  useEffect(() => { void reload() }, [])

  // The backend pushes health transitions instead of having the page poll.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<McpServerStatus>('mcp://status', event => {
      setStatuses(current => ({ ...current, [event.payload.serverId]: event.payload }))
    }).then(off => {
      if (disposed) off()
      else unlisten = off
    }).catch(() => undefined)
    return () => { disposed = true; unlisten?.() }
  }, [])

  function clearCapabilities() {
    setTools([])
    setResources([])
    setPrompts([])
    setResult(undefined)
    setCapabilityNotice(undefined)
    setToolFilter('')
  }

  function selectServer(id: string) {
    if (id === selectedId) return
    setSelectedId(id)
    clearCapabilities()
  }

  async function connect(server: McpServer) {
    if (!server.enabled) return
    setSelectedId(server.id)
    setBusy(true)
    clearCapabilities()
    try {
      await discoverMcpServer(server.id)
      const [toolResponse, resourceResponse, promptResponse] = await Promise.allSettled([
        listMcpTools(server.id),
        listMcpResources(server.id),
        listMcpPrompts(server.id),
      ])
      if (toolResponse.status === 'fulfilled') {
        const list = (toolResponse.value as { tools?: McpTool[] }).tools ?? []
        setTools(list)
        setToolArgs(Object.fromEntries(list.map(tool => [tool.name, initialArguments(tool.inputSchema)])))
      }
      if (resourceResponse.status === 'fulfilled') setResources((resourceResponse.value as { resources?: McpResource[] }).resources ?? [])
      if (promptResponse.status === 'fulfilled') setPrompts((promptResponse.value as { prompts?: McpPrompt[] }).prompts ?? [])
      const notices: Array<{ kind: 'tools' | 'resources' | 'prompts'; diff: McpCapabilityDiff }> = []
      const collect = (kind: 'tools' | 'resources' | 'prompts', result: PromiseSettledResult<unknown>) => {
        if (result.status !== 'fulfilled') return
        const diff = (result.value as { arcadiaCapabilityDiff?: McpCapabilityDiff }).arcadiaCapabilityDiff
        if (!diff || diff.firstSeen) return
        if (diff.added.length + diff.removed.length + diff.changed.length === 0) return
        notices.push({ kind, diff })
      }
      collect('tools', toolResponse)
      collect('resources', resourceResponse)
      collect('prompts', promptResponse)
      setCapabilityNotice(notices.length > 0 ? notices : undefined)
      const nextStatus = await getMcpServerStatus(server.id).catch(() => ({ ...EMPTY_STATUS, serverId: server.id }))
      setStatuses(current => ({ ...current, [server.id]: nextStatus }))
      messageApi.success(t("已连接 {value0}",{value0:server.name}))
    } catch (error) { messageApi.error(t("连接失败：{value0}",{value0:String(error)}))}
    finally { setBusy(false) }
  }

  async function disconnect(server: McpServer) {
    try { await disconnectMcpServer(server.id) } catch (error) { messageApi.error(String(error)) }
    setStatuses(current => ({ ...current, [server.id]: { ...EMPTY_STATUS, serverId: server.id } }))
    clearCapabilities()
  }

  async function ping(server: McpServer) {
    setBusy(true)
    try {
      const latency = await pingMcpServer(server.id)
      messageApi.success(t("连接正常，延迟 {value0} ms",{value0:String(latency)}))
    } catch (error) {
      messageApi.error(t("健康检查失败：{value0}",{value0:String(error)}))
    } finally { setBusy(false) }
  }

  async function invoke(tool: McpTool) {
    if (!selected) return
    const parsed = toolArgs[tool.name] ?? initialArguments(tool.inputSchema)
    const issues = validateArguments(tool.inputSchema, parsed)
    if (issues.length > 0) {
      messageApi.error(t("参数校验失败：{value0}",{value0:issues.map(argumentIssueMessage).join("；")}))
      return
    }
    const risk = tool.arcadiaRisk ?? 'R2'
    if (risk !== 'R0' && !tool.arcadiaGranted) {
      const prompt = risk === 'R3'
        ? t("高风险操作（R3）：每次调用都需要确认。\n\n允许本次调用工具 {value0}？\n\n{value1}",{value0:tool.name,value1:JSON.stringify(parsed,null,2)})
        : t("允许本次调用工具 {value0}？\n\n{value1}",{value0:tool.name,value1:JSON.stringify(parsed,null,2)})
      if (!window.confirm(prompt)) return
    }
    setBusy(true)
    try {
      setResult(await callMcpTool(selected.id, tool.name, parsed, true))
      if (risk === 'R1') setTools(current => current.map(item => item.name === tool.name ? { ...item, arcadiaGranted: true } : item))
    }
    catch (error) { messageApi.error(t("调用失败：{value0}",{value0:String(error)}))}
    finally { setBusy(false) }
  }

  async function revokeGrant(tool: McpTool) {
    if (!selected) return
    try {
      await revokeMcpToolGrant(selected.id, tool.name)
      setTools(current => current.map(item => item.name === tool.name ? { ...item, arcadiaGranted: false } : item))
      messageApi.success(t("已撤销授权"))
    } catch (error) { messageApi.error(String(error)) }
  }

  async function showResource(resource: McpResource) {
    if (!selected || !resource.uri) return
    const title = resource.name ?? resource.uri
    setViewer({ title, body: t("正在读取资源…"), kind: 'resource' })
    try {
      const value = await readMcpResource(selected.id, resource.uri)
      setViewer({ title, body: JSON.stringify(value, null, 2), kind: 'resource' })
    } catch (error) {
      setViewer({ title, body: String(error), kind: 'resource' })
    }
  }

  async function showPrompt(prompt: McpPrompt) {
    if (!selected) return
    setViewer({ title: prompt.name, body: '…', kind: 'prompt' })
    try {
      const value = await getMcpPrompt(selected.id, prompt.name)
      setViewer({ title: prompt.name, body: JSON.stringify(value, null, 2), kind: 'prompt' })
    } catch (error) {
      setViewer({ title: prompt.name, body: String(error), kind: 'prompt' })
    }
  }

  function resetForm() {
    setEditingId(undefined); setName(''); setCommand(''); setUrl(''); setArgs(''); setEnv(''); setHeaders(''); setEnabled(true); setTransport('stdio')
  }

  function openAdd() {
    resetForm()
    setModalOpen(true)
  }

  function openEdit(server: McpServer) {
    setEditingId(server.id)
    setName(server.name)
    setTransport(server.transport)
    setCommand(server.command ?? '')
    setUrl(server.url ?? '')
    setArgs(server.args.join('\n'))
    setEnv(formatStringMap(server.env))
    setHeaders(formatStringMap(server.headers))
    setEnabled(server.enabled)
    setModalOpen(true)
  }

  async function saveServer() {
    if (!name.trim()) { messageApi.error(t("请输入 Server 名称"));return}
    if (transport === 'stdio' && !command.trim()) { messageApi.error(t("请输入启动命令"));return}
    if (transport !== 'stdio' && !url.trim()) { messageApi.error(t("请输入服务地址"));return}
    setBusy(true)
    try {
      const saved = await saveMcpServer({
        id: editingId,
        name: name.trim(),
        transport,
        enabled,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport === 'stdio' ? undefined : url.trim(),
        args: parseArguments(args),
        env: parseStringMap(env,t("环境变量")),
        headers: parseStringMap(headers,t("请求头")),
      })
      if (editingId) {
        await disconnectMcpServer(editingId).catch(() => undefined)
        if (editingId === selectedId) clearCapabilities()
        messageApi.success(t("MCP Server 已更新"))
      } else {
        messageApi.success(t("MCP Server 已添加"))
      }
      setModalOpen(false)
      resetForm()
      await reload()
      setSelectedId(saved.id)
    } catch (error) { messageApi.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  async function toggleServer(server: McpServer, value: boolean) {
    try {
      await saveMcpServer({
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command,
        url: server.url,
        args: server.args,
        env: server.env,
        headers: server.headers,
        enabled: value,
      })
      if (!value) await disconnect(server)
      await reload()
    } catch (error) { messageApi.error(String(error)) }
  }

  async function removeServer(server: McpServer) {
    try {
      await disconnectMcpServer(server.id).catch(() => undefined)
      await deleteMcpServer(server.id)
      messageApi.success(t("MCP Server 已删除"))
      if (selectedId === server.id) clearCapabilities()
      await reload()
    } catch (error) { messageApi.error(String(error)) }
  }

  async function openAudit() {
    setAuditOpen(true)
    setAuditBusy(true)
    try { setAuditEntries(await listMcpAudit(selectedId)) }
    catch (error) { messageApi.error(String(error)) }
    finally { setAuditBusy(false) }
  }

  async function clearAudit() {
    try {
      await clearMcpAudit(selectedId)
      setAuditEntries([])
      messageApi.success(t("审计记录已清空"))
    } catch (error) { messageApi.error(String(error)) }
  }

  async function exportConfig() {
    setBusy(true)
    try {
      const config = await exportMcpConfig()
      setExportJson(JSON.stringify(config, null, 2))
      setExportOpen(true)
    } catch (error) {
      messageApi.error(t("导出失败：{value0}",{value0:String(error)}))
    } finally { setBusy(false) }
  }

  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportJson)
      messageApi.success(t("已复制到剪贴板"))
    } catch { messageApi.error(t("复制失败，请手动选择文本")) }
  }

  function downloadExport() {
    const blob = new Blob([exportJson], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'arcadia-mcp-config.json'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t("配置文件格式不正确"))
      const preview = await previewMcpConfig(parsed as McpConfigExport)
      setImportConfig(parsed as McpConfigExport)
      setImportPreview(preview)
      setImportOpen(true)
    } catch (error) {
      messageApi.error(t("导入失败：{value0}",{value0:String(error)}))
    }
  }

  async function confirmImport() {
    if (!importConfig) return
    setImportBusy(true)
    try {
      const summary = await importMcpConfig(importConfig)
      setImportOpen(false)
      setImportConfig(undefined)
      setImportPreview(undefined)
      setImportResult(summary.missingSecrets.length > 0 ? summary : null)
      messageApi.success(t("导入完成：新建 {value0}，更新 {value1}",{value0:String(summary.created),value1:String(summary.updated)}))
      await reload()
    } catch (error) {
      messageApi.error(t("导入失败：{value0}",{value0:String(error)}))
    } finally { setImportBusy(false) }
  }

  async function runDiagnose(server: McpServer) {
    setDiagnoseOpen(true)
    setDiagnoseBusy(true)
    setDiagnostic(undefined)
    try {
      setDiagnostic(await diagnoseMcpServer(server.id))
    } catch (error) {
      messageApi.error(t("诊断失败：{value0}",{value0:String(error)}))
      setDiagnoseOpen(false)
    } finally { setDiagnoseBusy(false) }
  }

  async function openCached(server: McpServer) {
    setCachedOpen(true)
    setCachedBusy(true)
    setCachedCapabilities(undefined)
    try {
      setCachedCapabilities(await getMcpCachedCapabilities(server.id))
    } catch (error) {
      messageApi.error(t("读取缓存失败：{value0}",{value0:String(error)}))
      setCachedOpen(false)
    } finally { setCachedBusy(false) }
  }

  const connected = status.connected
  const statusLabel = !selected?.enabled ? t("已停用") : connected ? t("已连接") : t("未连接")

  return <section className={`page mcp-page${section === 'skillhub' ? ' mcp-page--market' : ''}`}>
    {contextHolder}
    <header className="mcp-page__header">
      <div><span className="eyebrow">MODEL CONTEXT PROTOCOL</span><Typography.Title level={1}>{t("MCP 工作台")}</Typography.Title><Typography.Text type="secondary">{t("连接外部工具与数据源，每次工具调用都需要你的明确授权。")}</Typography.Text></div>
      {section === 'servers' && <div className="mcp-page__header-actions">
        <Button icon={<Download size={15}/>} onClick={()=>void exportConfig()}>{t("导出")}</Button>
        <Button icon={<Upload size={15}/>} onClick={()=>fileInputRef.current?.click()}>{t("导入")}</Button>
        <Button type="primary" icon={<Plus size={16}/>} onClick={openAdd}>{t("添加 Server")}</Button>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={event=>void handleImportFile(event)}/>
      </div>}
    </header>

    <nav className="mcp-section-nav" aria-label={t("MCP 工作台功能")}>
      <button type="button" className={section === 'servers' ? 'is-active' : ''} onClick={() => setSection('servers')}><Server size={17}/><span>Server</span></button>
      <button type="button" className={section === 'skillhub' ? 'is-active' : ''} onClick={() => setSection('skillhub')}><Store size={17}/><span>{t("SkillHub 技能市场")}</span></button>
    </nav>

    {section === 'skillhub' ? <SkillHubPage onOpenUrl={onOpenUrl}/> : <div className="mcp-workspace">
      <aside className="mcp-servers">
        <div className="mcp-section-title"><span><Server size={17}/>Servers</span><button type="button" aria-label={t("刷新 Server")} onClick={()=>void reload()}><RefreshCw size={15}/></button></div>
        {servers.length === 0
          ? <div className="mcp-empty"><Boxes size={30}/><b>{t("还没有 MCP Server")}</b><span>{t("添加本地 stdio 或远程 HTTP 服务。")}</span></div>
          : servers.map(server => <div key={server.id} className="mcp-server-row">
              <button type="button" className={`mcp-server${selectedId === server.id ? ' is-selected' : ''}`} onClick={() => selectServer(server.id)}>
                <span className="mcp-server__icon"><PlugZap size={18}/></span>
                <span className="mcp-server__copy"><b>{server.name}</b><small>{server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url}</small></span>
                <span className={`mcp-status${statuses[server.id]?.connected ? ' is-online' : ''}`} title={statuses[server.id]?.connected ? t("已连接") : t("未连接")}/>
                <Tag color={server.enabled ? 'green' : 'default'}>{server.enabled ?t("启用"):t("停用")}</Tag><ChevronRight size={15}/>
              </button>
            </div>)}
      </aside>

      <main className="mcp-console">
        {!selected ? <div className="mcp-console__empty"><PlugZap size={42}/><h2>{t("选择一个 MCP Server")}</h2><p>{t("连接后可以浏览它提供的工具和资源。")}</p></div>:<>
          <div className="mcp-console__head">
            <div>
              <h2>{selected.name}</h2>
              <span>{selected.transport.toUpperCase()} · {statusLabel}{status.protocolVersion ? ` · MCP ${status.protocolVersion}` : ''}</span>
            </div>
            <div className="mcp-console__actions">
              <Switch checked={selected.enabled} onChange={value => void toggleServer(selected, value)}/>
              <Button size="small" icon={<Pencil size={14}/>} onClick={()=>openEdit(selected)}>{t("编辑")}</Button>
              <Popconfirm title={t("删除这个 MCP Server？")} onConfirm={()=>void removeServer(selected)}><Button size="small" danger icon={<Trash2 size={14}/>}>{t("删除")}</Button></Popconfirm>
              <Button size="small" icon={<History size={14}/>} onClick={()=>void openAudit()}>{t("审计")}</Button>
              <Button size="small" loading={diagnoseBusy} onClick={()=>void runDiagnose(selected)}>{t("诊断")}</Button>
              <Button size="small" onClick={()=>void openCached(selected)}>{t("查看缓存")}</Button>
              {connected
                ? <>
                    <Button size="small" loading={busy} onClick={()=>void ping(selected)}>{t("检测")}</Button>
                    <Button size="small" onClick={()=>void disconnect(selected)}>{t("断开连接")}</Button>
                  </>
                : <Button type="primary" loading={busy} disabled={!selected.enabled} icon={<PlugZap size={16}/>} onClick={()=>void connect(selected)}>{t("连接并发现")}</Button>}
            </div>
          </div>
          {!connected && status.lastError && <Alert type="error" showIcon message={t("最近一次连接错误")} description={status.lastError}/>}
          {capabilityNotice && <Alert type="warning" showIcon closable message={t("服务能力已变化")} description={<ul className="mcp-capability-changes">{capabilityNotice.map(item => <li key={item.kind}>{t("{value0}：新增 {value1}、移除 {value2}、变更 {value3}",{value0:capabilityKindLabel(item.kind),value1:String(item.diff.added.length),value2:String(item.diff.removed.length),value3:String(item.diff.changed.length)})}</li>)}</ul>}/>}
          <Alert type="info" showIcon message={t("安全调用")} description={t("工具名称、参数会在执行前展示。只有确认后，Arcadia 才会发送本次调用。")}/>
          {busy && tools.length === 0 ? <div className="mcp-loading"><Spin/><span>{t("正在发现服务能力…")}</span></div>:<div className="mcp-capabilities">
            <section><div className="mcp-section-title"><span><Wrench size={17}/>{t("工具")}</span><Tag>{toolFilter ? `${visibleTools.length}/${tools.length}` : tools.length}</Tag></div>
              {tools.length > 5 && <div className="mcp-tool-filter"><Input allowClear value={toolFilter} prefix={<Search size={15}/>} onChange={event=>setToolFilter(event.target.value)} placeholder={t("筛选工具…")} aria-label={t("筛选工具…")}/></div>}
              {tools.length === 0 ? <div className="mcp-placeholder">{connected ? t("服务未返回工具") : t("连接 Server 后显示工具")}</div>:visibleTools.length === 0 ? <div className="mcp-placeholder">{t("没有匹配的工具")}</div>:visibleTools.map(tool => {
                const args = toolArgs[tool.name] ?? initialArguments(tool.inputSchema)
                return <Card key={tool.name} className="mcp-tool-card">
                  <div className="mcp-tool-card__title"><div><b>{tool.name}</b><p>{tool.description ||t("无描述")}</p></div><div className="mcp-tool-card__actions">
                    <Tag color={riskColor(tool.arcadiaRisk)} title={riskLabel(tool.arcadiaRisk)}>{tool.arcadiaRisk ?? 'R2'}</Tag>
                    {tool.arcadiaGranted && <Tag color="geekblue">{t("已记住授权")}</Tag>}
                    {tool.arcadiaGranted && <Button size="small" onClick={()=>void revokeGrant(tool)}>{t("撤销授权")}</Button>}
                    <Button icon={<Play size={14}/>} disabled={busy} onClick={()=>void invoke(tool)}>{t("审核并调用")}</Button>
                  </div></div>
                  <ToolArgumentsEditor schema={tool.inputSchema} value={args} disabled={busy} onChange={next => setToolArgs(current => ({...current,[tool.name]:next}))}/>
                </Card>
              })}
            </section>
            <section>
              <div className="mcp-section-title"><span><Database size={17}/>{t("资源")}</span><Tag>{resources.length}</Tag></div>
              {resources.length === 0 ? <div className="mcp-placeholder">{connected ? t("服务未返回资源") : t("连接 Server 后显示资源")}</div>:resources.map((resource,index)=><div className="mcp-resource" key={resource.uri??index}>
                <Database size={16}/><span><b>{resource.name??resource.uri}</b><small>{resource.description??resource.uri}</small></span>
                {resource.uri && <button type="button" className="mcp-resource__open" onClick={()=>void showResource(resource)}>{t("读取")}</button>}
              </div>)}
              <div className="mcp-section-title mcp-section-title--spaced"><span><MessageSquare size={17}/>{t("提示词")}</span><Tag>{prompts.length}</Tag></div>
              {prompts.length === 0 ? <div className="mcp-placeholder">{connected ? t("服务未返回提示词") : t("连接 Server 后显示提示词")}</div>:prompts.map(prompt=><div className="mcp-resource mcp-prompt" key={prompt.name}>
                <MessageSquare size={16}/><span><b>{prompt.name}</b><small>{prompt.description ?? t("无描述")}</small></span>
                <button type="button" className="mcp-resource__open" onClick={()=>void showPrompt(prompt)}>{t("查看")}</button>
              </div>)}
            </section>
          </div>}
          {result !== undefined && <section className="mcp-result"><div className="mcp-section-title"><span>{t("调用结果")}</span></div><ToolResultView value={result}/></section>}
        </>}
      </main>
    </div>}

    <Modal open={modalOpen} title={editingId ? t("编辑 MCP Server") : t("添加 MCP Server")} width={640} okText={editingId ? t("保存修改") : t("添加")} okButtonProps={{loading:busy}} onOk={()=>void saveServer()} onCancel={()=>{setModalOpen(false);resetForm()}}>
      <div className="mcp-add-form">
        <label><span>{t("Server 名称")}</span><Input value={name} onChange={event=>setName(event.target.value)} placeholder={t("例如 filesystem")}/></label>
        <label><span>{t("传输方式")}</span><Segmented value={transport} onChange={value=>setTransport(value as McpTransport)} options={[{label:'stdio',value:'stdio'},{label:'HTTP',value:'http'},{label:'SSE',value:'sse'}]}/></label>
        {transport === 'stdio' ? <><label><span>{t("启动命令")}</span><Input value={command} onChange={event=>setCommand(event.target.value)} placeholder={t("例如 npx")}/></label><label><span>{t("参数（每行一个）")}</span><Input.TextArea rows={4} value={args} onChange={event=>setArgs(event.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\Documents'}/></label></>:<label><span>{t("服务地址")}</span><Input value={url} onChange={event=>setUrl(event.target.value)} placeholder="https://example.com/mcp"/></label>}
        <div className="mcp-add-form__split"><label><span>{t("环境变量 JSON")}</span><Input.TextArea rows={3} value={env} onChange={event=>setEnv(event.target.value)} placeholder='{"TOKEN":"..."}'/></label><label><span>{t("请求头 JSON")}</span><Input.TextArea rows={3} value={headers} onChange={event=>setHeaders(event.target.value)} placeholder='{"Authorization":"Bearer ..."}'/></label></div>
        {editingId && <p className="mcp-add-form__hint">{t("密钥保存在系统密钥环；保留 ******** 表示不修改。")}</p>}
        <label className="mcp-add-form__toggle"><Switch checked={enabled} onChange={setEnabled}/><span>{t("添加后启用")}</span></label>
      </div>
    </Modal>

    <Drawer title={viewer?.kind === 'prompt' ? t("提示词内容") : t("资源内容")} open={Boolean(viewer)} onClose={()=>setViewer(undefined)} width={680}>
      <Typography.Title level={5}>{viewer?.title}</Typography.Title>
      <pre className="mcp-json">{viewer?.body}</pre>
    </Drawer>

    <Drawer
      title={t("审计日志")}
      open={auditOpen}
      onClose={()=>setAuditOpen(false)}
      width={720}
      extra={<Popconfirm title={t("确定清空审计记录？")} onConfirm={()=>void clearAudit()}><Button size="small" danger disabled={auditEntries.length === 0}>{t("清空审计")}</Button></Popconfirm>}
    >
      {auditBusy ? <div className="mcp-loading"><Spin/></div> : auditEntries.length === 0
        ? <div className="mcp-placeholder">{t("暂无 MCP 调用记录")}</div>
        : <div className="mcp-audit">{auditEntries.map(entry => <div className="mcp-audit__entry" key={entry.id}>
            <div className="mcp-audit__head">
              <Tag color={entry.success ? 'green' : 'red'}>{entry.success ? t("成功") : t("失败")}</Tag>
              {entry.risk && <Tag color={riskColor(entry.risk)}>{entry.risk}</Tag>}
              <b>{entry.method}</b>
              {entry.targetName && <code>{entry.targetName}</code>}
              <span className="mcp-audit__time">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            {entry.error && <p>{entry.error}</p>}
          </div>)}
        </div>}
    </Drawer>

    <Drawer title={t("兼容性诊断")} open={diagnoseOpen} onClose={()=>setDiagnoseOpen(false)} width={640}>
      {diagnoseBusy ? <div className="mcp-loading"><Spin/></div> : diagnostic && <>
        <p className="mcp-diagnose__summary">{diagnostic.serverName ?? selected?.name}{diagnostic.protocolVersion ? ` · MCP ${diagnostic.protocolVersion}` : ''} · {t("总耗时 {value0} ms",{value0:String(diagnostic.totalMs)})}</p>
        <div className="mcp-diagnose__stages">{diagnostic.stages.map(stage => <div className="mcp-diagnose__row" key={stage.name}>
          <Tag color={stage.ok ? 'green' : 'red'}>{stage.ok ? t("成功") : t("失败")}</Tag>
          <b>{diagnosticStageLabel(stage.name)}</b>
          {stage.count !== undefined && <span>{t("{value0} 项",{value0:String(stage.count)})}</span>}
          {stage.detail && <span className="mcp-diagnose__detail">{stage.detail}</span>}
          <span className="mcp-diagnose__time">{stage.durationMs} ms</span>
          {stage.error && <p>{stage.error}</p>}
        </div>)}</div>
      </>}
    </Drawer>

    <Drawer title={t("离线能力快照")} open={cachedOpen} onClose={()=>setCachedOpen(false)} width={640}>
      {cachedBusy ? <div className="mcp-loading"><Spin/></div> : cachedCapabilities && <>
        <p className="mcp-diagnose__summary">{cachedCapabilities.capturedAt ? t("上次更新：{value0}",{value0:new Date(cachedCapabilities.capturedAt).toLocaleString()}) : t("暂无缓存")}</p>
        {cachedSections.filter(section => section.items.length > 0).map(section => <section key={section.key}>
          <div className="mcp-section-title"><span>{section.label}</span><Tag>{section.items.length}</Tag></div>
          <div className="mcp-cached-list">{section.items.map((item, index) => {
            const info = cachedItemLabel(item)
            return <div className="mcp-resource" key={`${section.key}-${index}`}><span><b>{info.name}</b>{info.detail && <small>{info.detail}</small>}</span></div>
          })}</div>
        </section>)}
        {cachedSections.every(section => section.items.length === 0) && <div className="mcp-placeholder">{t("暂无缓存")}</div>}
      </>}
    </Drawer>

    <Modal
      title={t("导出 MCP 配置")}
      open={exportOpen}
      width={720}
      onCancel={()=>setExportOpen(false)}
      footer={<>
        <Button icon={<Copy size={14}/>} onClick={()=>void copyExport()}>{t("复制")}</Button>
        <Button icon={<Download size={14}/>} onClick={downloadExport}>{t("下载文件")}</Button>
        <Button type="primary" onClick={()=>setExportOpen(false)}>{t("关闭")}</Button>
      </>}
    >
      <p className="mcp-import__note">{t("配置不包含密钥；导入后请重新填写。")}</p>
      <Input.TextArea value={exportJson} readOnly rows={16} className="mcp-export-json"/>
    </Modal>

    <Modal
      title={t("导入 MCP 配置")}
      open={importOpen}
      width={680}
      okText={t("确认导入")}
      okButtonProps={{ loading: importBusy }}
      onOk={()=>void confirmImport()}
      onCancel={()=>{ setImportOpen(false); setImportPreview(undefined); setImportConfig(undefined) }}
    >
      {importPreview && <>
        <p>{t("将创建 {value0} 个、更新 {value1} 个 Server，{value2} 个无变化。",{value0:String(importPreview.created),value1:String(importPreview.updated),value2:String(importPreview.unchanged)})}</p>
        <div className="mcp-import__list">{importPreview.servers.map(change => <div className="mcp-import__row" key={change.name}>
          <Tag color={change.action === 'create' ? 'green' : change.action === 'update' ? 'blue' : 'default'}>{change.action === 'create' ? t("新建") : change.action === 'update' ? t("更新") : t("无变化")}</Tag>
          <b>{change.name}</b>
          {change.changedFields.length > 0 && <span className="mcp-import__meta">{t("变更字段：{value0}",{value0:change.changedFields.map(configFieldLabel).join("、")})}</span>}
        </div>)}</div>
        <p className="mcp-import__note">{t("密钥不会随配置导入；新建 Server 的密钥需要在导入后重新填写。")}</p>
      </>}
    </Modal>

    <Modal
      title={t("需要补充密钥的 Server")}
      open={importResult !== null}
      okText={t("关闭")}
      onOk={()=>setImportResult(null)}
      onCancel={()=>setImportResult(null)}
    >
      {importResult && <ul className="mcp-secret-list">{importResult.missingSecrets.map(item => {
        const keys = [...item.envKeys, ...item.headerKeys]
        return <li key={item.name}><b>{item.name}</b>{keys.length > 0 ? <> — <code>{keys.join(", ")}</code></> : null}</li>
      })}</ul>}
    </Modal>
  </section>
}

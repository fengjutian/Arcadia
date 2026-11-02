import { t } from '../../i18n'
import { useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  Boxes,
  ChevronRight,
  Database,
  History,
  MessageSquare,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Store,
  Trash2,
  Wrench,
} from 'lucide-react'
import {
  callMcpTool,
  clearMcpAudit,
  deleteMcpServer,
  discoverMcpServer,
  disconnectMcpServer,
  getMcpPrompt,
  getMcpServerStatus,
  listMcpAudit,
  listMcpPrompts,
  listMcpResources,
  listMcpServers,
  listMcpTools,
  pingMcpServer,
  readMcpResource,
  revokeMcpToolGrant,
  saveMcpServer,
  type McpAuditEntry,
  type McpServer,
  type McpServerStatus,
  type McpTransport,
} from '../../api'
import { Alert, Button, Card, Drawer, Input, Modal, Popconfirm, Segmented, Spin, Switch, Tag, Typography, message } from '../../components/ui'
import { formatStringMap, parseArguments, parseStringMap } from '../../features/mcp/config'
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

export function McpPage({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [tools, setTools] = useState<McpTool[]>([])
  const [resources, setResources] = useState<McpResource[]>([])
  const [prompts, setPrompts] = useState<McpPrompt[]>([])
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({})
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

  const selected = useMemo(() => servers.find(server => server.id === selectedId), [selectedId, servers])
  const status = selectedId ? statuses[selectedId] ?? EMPTY_STATUS : EMPTY_STATUS

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
      if (toolResponse.status === 'fulfilled') setTools((toolResponse.value as { tools?: McpTool[] }).tools ?? [])
      if (resourceResponse.status === 'fulfilled') setResources((resourceResponse.value as { resources?: McpResource[] }).resources ?? [])
      if (promptResponse.status === 'fulfilled') setPrompts((promptResponse.value as { prompts?: McpPrompt[] }).prompts ?? [])
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
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(toolArgs[tool.name] || '{}') as Record<string, unknown>
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    } catch { messageApi.error(t("工具参数必须是 JSON 对象"));return}
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

  const connected = status.connected
  const statusLabel = !selected?.enabled ? t("已停用") : connected ? t("已连接") : t("未连接")

  return <section className={`page mcp-page${section === 'skillhub' ? ' mcp-page--market' : ''}`}>
    {contextHolder}
    <header className="mcp-page__header">
      <div><span className="eyebrow">MODEL CONTEXT PROTOCOL</span><Typography.Title level={1}>{t("MCP 工作台")}</Typography.Title><Typography.Text type="secondary">{t("连接外部工具与数据源，每次工具调用都需要你的明确授权。")}</Typography.Text></div>
      {section === 'servers' && <Button type="primary" icon={<Plus size={16}/>} onClick={openAdd}>{t("添加 Server")}</Button>}
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
              {connected
                ? <>
                    <Button size="small" loading={busy} onClick={()=>void ping(selected)}>{t("检测")}</Button>
                    <Button size="small" onClick={()=>void disconnect(selected)}>{t("断开连接")}</Button>
                  </>
                : <Button type="primary" loading={busy} disabled={!selected.enabled} icon={<PlugZap size={16}/>} onClick={()=>void connect(selected)}>{t("连接并发现")}</Button>}
            </div>
          </div>
          {!connected && status.lastError && <Alert type="error" showIcon message={t("最近一次连接错误")} description={status.lastError}/>}
          <Alert type="info" showIcon message={t("安全调用")} description={t("工具名称、参数会在执行前展示。只有确认后，Arcadia 才会发送本次调用。")}/>
          {busy && tools.length === 0 ? <div className="mcp-loading"><Spin/><span>{t("正在发现服务能力…")}</span></div>:<div className="mcp-capabilities">
            <section><div className="mcp-section-title"><span><Wrench size={17}/>{t("工具")}</span><Tag>{tools.length}</Tag></div>
              {tools.length === 0 ? <div className="mcp-placeholder">{connected ? t("服务未返回工具") : t("连接 Server 后显示工具")}</div>:tools.map(tool=><Card key={tool.name} className="mcp-tool-card">
                <div className="mcp-tool-card__title"><div><b>{tool.name}</b><p>{tool.description ||t("无描述")}</p></div><div className="mcp-tool-card__actions">
                  <Tag color={riskColor(tool.arcadiaRisk)} title={riskLabel(tool.arcadiaRisk)}>{tool.arcadiaRisk ?? 'R2'}</Tag>
                  {tool.arcadiaGranted && <Tag color="cyan">{t("已记住授权")}</Tag>}
                  {tool.arcadiaGranted && <Button size="small" onClick={()=>void revokeGrant(tool)}>{t("撤销授权")}</Button>}
                  <Button icon={<Play size={14}/>} disabled={busy} onClick={()=>void invoke(tool)}>{t("审核并调用")}</Button>
                </div></div>
                <Input.TextArea value={toolArgs[tool.name] ?? '{}'} onChange={event => setToolArgs(current => ({...current,[tool.name]:event.target.value}))} autoSize={{minRows:2,maxRows:8}}/>
              </Card>)}
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
          {result !== undefined && <section className="mcp-result"><div className="mcp-section-title"><span>{t("调用结果")}</span></div><pre>{JSON.stringify(result,null,2)}</pre></section>}
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
  </section>
}

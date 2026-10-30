import { useEffect, useMemo, useState } from 'react'
import { Boxes, ChevronRight, Database, Play, PlugZap, Plus, RefreshCw, Server, Store, Wrench } from 'lucide-react'
import {
  callMcpTool,
  discoverMcpServer,
  listMcpResources,
  listMcpServers,
  listMcpTools,
  saveMcpServer,
  type McpServer,
  type McpTransport,
} from '../../api'
import { Alert, Button, Card, Input, Modal, Segmented, Spin, Switch, Tag, Typography, message } from '../../components/ui'
import { parseArguments, parseStringMap } from '../../features/mcp/config'
import { SkillHubPage } from '../skillhub/SkillHubPage'

type McpTool = { name: string; description?: string; inputSchema?: unknown }
type McpResource = { uri?: string; name?: string; description?: string }

export function McpPage({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [servers, setServers] = useState<McpServer[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [tools, setTools] = useState<McpTool[]>([])
  const [resources, setResources] = useState<McpResource[]>([])
  const [toolArgs, setToolArgs] = useState<Record<string, string>>({})
  const [result, setResult] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [transport, setTransport] = useState<McpTransport>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [section, setSection] = useState<'servers' | 'skillhub'>('servers')

  const selected = useMemo(() => servers.find(server => server.id === selectedId), [selectedId, servers])

  async function reload() {
    try {
      const next = await listMcpServers()
      setServers(next)
      setSelectedId(current => next.some(server => server.id === current) ? current : next[0]?.id)
    } catch (error) { messageApi.error(String(error)) }
  }

  useEffect(() => { void reload() }, [])

  async function connect(server: McpServer) {
    if (!server.enabled) return
    setSelectedId(server.id)
    setBusy(true)
    setTools([])
    setResources([])
    setResult(undefined)
    try {
      await discoverMcpServer(server.id)
      const [toolResponse, resourceResponse] = await Promise.all([listMcpTools(server.id), listMcpResources(server.id)])
      setTools((toolResponse as { tools?: McpTool[] }).tools ?? [])
      setResources((resourceResponse as { resources?: McpResource[] }).resources ?? [])
      messageApi.success(`已连接 ${server.name}`)
    } catch (error) { messageApi.error(`连接失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  async function invoke(tool: McpTool) {
    if (!selected) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(toolArgs[tool.name] || '{}') as Record<string, unknown>
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    } catch { messageApi.error('工具参数必须是 JSON 对象'); return }
    if (!window.confirm(`允许本次调用工具 ${tool.name}？\n\n${JSON.stringify(parsed, null, 2)}`)) return
    setBusy(true)
    try { setResult(await callMcpTool(selected.id, tool.name, parsed, true)) }
    catch (error) { messageApi.error(`调用失败：${String(error)}`) }
    finally { setBusy(false) }
  }

  function resetForm() {
    setName(''); setCommand(''); setUrl(''); setArgs(''); setEnv(''); setHeaders(''); setEnabled(true); setTransport('stdio')
  }

  async function addServer() {
    if (!name.trim()) { messageApi.error('请输入 Server 名称'); return }
    if (transport === 'stdio' && !command.trim()) { messageApi.error('请输入启动命令'); return }
    if (transport !== 'stdio' && !url.trim()) { messageApi.error('请输入服务地址'); return }
    setBusy(true)
    try {
      const saved = await saveMcpServer({
        name: name.trim(), transport, enabled,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport === 'stdio' ? undefined : url.trim(),
        args: parseArguments(args),
        env: parseStringMap(env, '环境变量'),
        headers: parseStringMap(headers, '请求头'),
      })
      await reload()
      setSelectedId(saved.id)
      setAdding(false)
      resetForm()
      messageApi.success('MCP Server 已添加')
    } catch (error) { messageApi.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <section className={`page mcp-page${section === 'skillhub' ? ' mcp-page--market' : ''}`}>
    {contextHolder}
    <header className="mcp-page__header">
      <div><span className="eyebrow">MODEL CONTEXT PROTOCOL</span><Typography.Title level={1}>MCP 工作台</Typography.Title><Typography.Text type="secondary">连接外部工具与数据源，每次工具调用都需要你的明确授权。</Typography.Text></div>
      {section === 'servers' && <Button type="primary" icon={<Plus size={16}/>} onClick={() => setAdding(true)}>添加 Server</Button>}
    </header>

    <nav className="mcp-section-nav" aria-label="MCP 工作台功能">
      <button type="button" className={section === 'servers' ? 'is-active' : ''} onClick={() => setSection('servers')}><Server size={17}/><span>Server</span></button>
      <button type="button" className={section === 'skillhub' ? 'is-active' : ''} onClick={() => setSection('skillhub')}><Store size={17}/><span>SkillHub 技能市场</span></button>
    </nav>

    {section === 'skillhub' ? <SkillHubPage onOpenUrl={onOpenUrl}/> : <div className="mcp-workspace">
      <aside className="mcp-servers">
        <div className="mcp-section-title"><span><Server size={17}/>Servers</span><button type="button" aria-label="刷新 Server" onClick={() => void reload()}><RefreshCw size={15}/></button></div>
        {servers.length === 0
          ? <div className="mcp-empty"><Boxes size={30}/><b>还没有 MCP Server</b><span>添加本地 stdio 或远程 HTTP 服务。</span></div>
          : servers.map(server => <button key={server.id} type="button" className={`mcp-server${selectedId === server.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(server.id)}>
              <span className="mcp-server__icon"><PlugZap size={18}/></span>
              <span className="mcp-server__copy"><b>{server.name}</b><small>{server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url}</small></span>
              <Tag color={server.enabled ? 'green' : 'default'}>{server.enabled ? '启用' : '停用'}</Tag><ChevronRight size={15}/>
            </button>)}
      </aside>

      <main className="mcp-console">
        {!selected ? <div className="mcp-console__empty"><PlugZap size={42}/><h2>选择一个 MCP Server</h2><p>连接后可以浏览它提供的工具和资源。</p></div> : <>
          <div className="mcp-console__head"><div><h2>{selected.name}</h2><span>{selected.transport.toUpperCase()} · {selected.enabled ? '可连接' : '已停用'}</span></div><Button type="primary" loading={busy} disabled={!selected.enabled} icon={<PlugZap size={16}/>} onClick={() => void connect(selected)}>连接并发现</Button></div>
          <Alert type="info" showIcon message="安全调用" description="工具名称、参数会在执行前展示。只有确认后，Arcadia 才会发送本次调用。"/>
          {busy && tools.length === 0 ? <div className="mcp-loading"><Spin/><span>正在发现服务能力…</span></div> : <div className="mcp-capabilities">
            <section><div className="mcp-section-title"><span><Wrench size={17}/>工具</span><Tag>{tools.length}</Tag></div>
              {tools.length === 0 ? <div className="mcp-placeholder">连接 Server 后显示工具</div> : tools.map(tool => <Card key={tool.name} className="mcp-tool-card">
                <div className="mcp-tool-card__title"><div><b>{tool.name}</b><p>{tool.description || '无描述'}</p></div><Button icon={<Play size={14}/>} disabled={busy} onClick={() => void invoke(tool)}>审核并调用</Button></div>
                <Input.TextArea value={toolArgs[tool.name] ?? '{}'} onChange={event => setToolArgs(current => ({ ...current, [tool.name]: event.target.value }))} autoSize={{ minRows: 2, maxRows: 8 }}/>
              </Card>)}
            </section>
            <section><div className="mcp-section-title"><span><Database size={17}/>资源</span><Tag>{resources.length}</Tag></div>
              {resources.length === 0 ? <div className="mcp-placeholder">服务未返回资源</div> : resources.map((resource, index) => <div className="mcp-resource" key={resource.uri ?? index}><Database size={16}/><span><b>{resource.name ?? resource.uri}</b><small>{resource.description ?? resource.uri}</small></span></div>)}
            </section>
          </div>}
          {result !== undefined && <section className="mcp-result"><div className="mcp-section-title"><span>调用结果</span></div><pre>{JSON.stringify(result, null, 2)}</pre></section>}
        </>}
      </main>
    </div>}

    <Modal open={adding} title="添加 MCP Server" width={640} okText="添加" okButtonProps={{ loading: busy }} onOk={() => void addServer()} onCancel={() => setAdding(false)}>
      <div className="mcp-add-form">
        <label><span>Server 名称</span><Input value={name} onChange={event => setName(event.target.value)} placeholder="例如 filesystem"/></label>
        <label><span>传输方式</span><Segmented value={transport} onChange={value => setTransport(value as McpTransport)} options={[{label:'stdio',value:'stdio'},{label:'HTTP',value:'http'},{label:'SSE',value:'sse'}]}/></label>
        {transport === 'stdio' ? <><label><span>启动命令</span><Input value={command} onChange={event => setCommand(event.target.value)} placeholder="例如 npx"/></label><label><span>参数（每行一个）</span><Input.TextArea rows={4} value={args} onChange={event => setArgs(event.target.value)} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\Documents'}/></label></> : <label><span>服务地址</span><Input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp"/></label>}
        <div className="mcp-add-form__split"><label><span>环境变量 JSON</span><Input.TextArea rows={3} value={env} onChange={event => setEnv(event.target.value)} placeholder='{"TOKEN":"..."}'/></label><label><span>请求头 JSON</span><Input.TextArea rows={3} value={headers} onChange={event => setHeaders(event.target.value)} placeholder='{"Authorization":"Bearer ..."}'/></label></div>
        <label className="mcp-add-form__toggle"><Switch checked={enabled} onChange={setEnabled}/><span>添加后启用</span></label>
      </div>
    </Modal>
  </section>
}

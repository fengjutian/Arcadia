import { t } from '../../i18n'
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
      messageApi.success(t("\u5DF2\u8FDE\u63A5 {value0}",{value0:server.name}))
    } catch (error) { messageApi.error(t("\u8FDE\u63A5\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setBusy(false) }
  }

  async function invoke(tool: McpTool) {
    if (!selected) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(toolArgs[tool.name] || '{}') as Record<string, unknown>
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error()
    } catch { messageApi.error(t("\u5DE5\u5177\u53C2\u6570\u5FC5\u987B\u662F JSON \u5BF9\u8C61"));return}
    if (!window.confirm(t("\u5141\u8BB8\u672C\u6B21\u8C03\u7528\u5DE5\u5177 {value0}\uFF1F\n\n{value1}",{value0:tool.name,value1:JSON.stringify(parsed,null,2)})))return
    setBusy(true)
    try { setResult(await callMcpTool(selected.id, tool.name, parsed, true)) }
    catch (error) { messageApi.error(t("\u8C03\u7528\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setBusy(false) }
  }

  function resetForm() {
    setName(''); setCommand(''); setUrl(''); setArgs(''); setEnv(''); setHeaders(''); setEnabled(true); setTransport('stdio')
  }

  async function addServer() {
    if (!name.trim()) { messageApi.error(t("\u8BF7\u8F93\u5165 Server \u540D\u79F0"));return}
    if (transport === 'stdio' && !command.trim()) { messageApi.error(t("\u8BF7\u8F93\u5165\u542F\u52A8\u547D\u4EE4"));return}
    if (transport !== 'stdio' && !url.trim()) { messageApi.error(t("\u8BF7\u8F93\u5165\u670D\u52A1\u5730\u5740"));return}
    setBusy(true)
    try {
      const saved = await saveMcpServer({
        name: name.trim(), transport, enabled,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport === 'stdio' ? undefined : url.trim(),
        args: parseArguments(args),
        env: parseStringMap(env,t("\u73AF\u5883\u53D8\u91CF")),
        headers: parseStringMap(headers,t("\u8BF7\u6C42\u5934")),
      })
      await reload()
      setSelectedId(saved.id)
      setAdding(false)
      resetForm()
      messageApi.success(t("MCP Server \u5DF2\u6DFB\u52A0"))
    } catch (error) { messageApi.error(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }

  return <section className={`page mcp-page${section === 'skillhub' ? ' mcp-page--market' : ''}`}>
    {contextHolder}
    <header className="mcp-page__header">
      <div><span className="eyebrow">MODEL CONTEXT PROTOCOL</span><Typography.Title level={1}>{t("MCP \u5DE5\u4F5C\u53F0")}</Typography.Title><Typography.Text type="secondary">{t("\u8FDE\u63A5\u5916\u90E8\u5DE5\u5177\u4E0E\u6570\u636E\u6E90\uFF0C\u6BCF\u6B21\u5DE5\u5177\u8C03\u7528\u90FD\u9700\u8981\u4F60\u7684\u660E\u786E\u6388\u6743\u3002")}</Typography.Text></div>
      {section === 'servers' && <Button type="primary" icon={<Plus size={16}/>} onClick={() => setAdding(true)}>{t("\u6DFB\u52A0 Server")}</Button>}
    </header>

    <nav className="mcp-section-nav" aria-label={t("MCP \u5DE5\u4F5C\u53F0\u529F\u80FD")}>
      <button type="button" className={section === 'servers' ? 'is-active' : ''} onClick={() => setSection('servers')}><Server size={17}/><span>Server</span></button>
      <button type="button" className={section === 'skillhub' ? 'is-active' : ''} onClick={() => setSection('skillhub')}><Store size={17}/><span>{t("SkillHub \u6280\u80FD\u5E02\u573A")}</span></button>
    </nav>

    {section === 'skillhub' ? <SkillHubPage onOpenUrl={onOpenUrl}/> : <div className="mcp-workspace">
      <aside className="mcp-servers">
        <div className="mcp-section-title"><span><Server size={17}/>Servers</span><button type="button" aria-label={t("\u5237\u65B0 Server")}onClick={()=>void reload()}><RefreshCw size={15}/></button></div>
        {servers.length === 0
          ? <div className="mcp-empty"><Boxes size={30}/><b>{t("\u8FD8\u6CA1\u6709 MCP Server")}</b><span>{t("\u6DFB\u52A0\u672C\u5730 stdio \u6216\u8FDC\u7A0B HTTP \u670D\u52A1\u3002")}</span></div>
          : servers.map(server => <button key={server.id} type="button" className={`mcp-server${selectedId === server.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(server.id)}>
              <span className="mcp-server__icon"><PlugZap size={18}/></span>
              <span className="mcp-server__copy"><b>{server.name}</b><small>{server.transport === 'stdio' ? [server.command, ...server.args].filter(Boolean).join(' ') : server.url}</small></span>
              <Tag color={server.enabled ? 'green' : 'default'}>{server.enabled ?t("\u542F\u7528"):t("\u505C\u7528")}</Tag><ChevronRight size={15}/>
            </button>)}
      </aside>

      <main className="mcp-console">
        {!selected ? <div className="mcp-console__empty"><PlugZap size={42}/><h2>{t("\u9009\u62E9\u4E00\u4E2A MCP Server")}</h2><p>{t("\u8FDE\u63A5\u540E\u53EF\u4EE5\u6D4F\u89C8\u5B83\u63D0\u4F9B\u7684\u5DE5\u5177\u548C\u8D44\u6E90\u3002")}</p></div>:<>
          <div className="mcp-console__head"><div><h2>{selected.name}</h2><span>{selected.transport.toUpperCase()} · {selected.enabled ?t("\u53EF\u8FDE\u63A5"):t("\u5DF2\u505C\u7528")}</span></div><Button type="primary"loading={busy}disabled={!selected.enabled}icon={<PlugZap size={16}/>}onClick={()=>void connect(selected)}>{t("\u8FDE\u63A5\u5E76\u53D1\u73B0")}</Button></div>
          <Alert type="info" showIcon message={t("\u5B89\u5168\u8C03\u7528")}description={t("\u5DE5\u5177\u540D\u79F0\u3001\u53C2\u6570\u4F1A\u5728\u6267\u884C\u524D\u5C55\u793A\u3002\u53EA\u6709\u786E\u8BA4\u540E\uFF0CArcadia \u624D\u4F1A\u53D1\u9001\u672C\u6B21\u8C03\u7528\u3002")}/>
          {busy && tools.length === 0 ? <div className="mcp-loading"><Spin/><span>{t("\u6B63\u5728\u53D1\u73B0\u670D\u52A1\u80FD\u529B\u2026")}</span></div>:<div className="mcp-capabilities">
            <section><div className="mcp-section-title"><span><Wrench size={17}/>{t("\u5DE5\u5177")}</span><Tag>{tools.length}</Tag></div>
              {tools.length === 0 ? <div className="mcp-placeholder">{t("\u8FDE\u63A5 Server \u540E\u663E\u793A\u5DE5\u5177")}</div>:tools.map(tool=><Card key={tool.name}className="mcp-tool-card">
                <div className="mcp-tool-card__title"><div><b>{tool.name}</b><p>{tool.description ||t("\u65E0\u63CF\u8FF0")}</p></div><Button icon={<Play size={14}/>}disabled={busy}onClick={()=>void invoke(tool)}>{t("\u5BA1\u6838\u5E76\u8C03\u7528")}</Button></div>
                <Input.TextArea value={toolArgs[tool.name] ?? '{}'} onChange={event => setToolArgs(           (current                                        )=>({...current,[tool.name]:event.target.value}))}autoSize={{minRows:2,maxRows:8}}/>
              </Card>)}
            </section>
            <section><div className="mcp-section-title"><span><Database size={17}/>{t("\u8D44\u6E90")}</span><Tag>{resources.length}</Tag></div>
              {resources.length === 0 ? <div className="mcp-placeholder">{t("\u670D\u52A1\u672A\u8FD4\u56DE\u8D44\u6E90")}</div>:resources.map((resource,index)=><div className="mcp-resource"key={resource.uri??index}><Database size={16}/><span><b>{resource.name??resource.uri}</b><small>{resource.description??resource.uri}</small></span></div>)}
            </section>
          </div>}
          {result !== undefined && <section className="mcp-result"><div className="mcp-section-title"><span>{t("\u8C03\u7528\u7ED3\u679C")}</span></div><pre>{JSON.stringify(result,null,2)}</pre></section>}
        </>}
      </main>
    </div>}

    <Modal open={adding} title={t("\u6DFB\u52A0 MCP Server")}width={640}okText={t("\u6DFB\u52A0")}okButtonProps={{loading:busy}}onOk={()=>void addServer()}onCancel={()=>setAdding(false)}>
      <div className="mcp-add-form">
        <label><span>{t("Server \u540D\u79F0")}</span><Input value={name}onChange={event=>setName(event.target.value)}placeholder={t("\u4F8B\u5982 filesystem")}/></label>
        <label><span>{t("\u4F20\u8F93\u65B9\u5F0F")}</span><Segmented value={transport}onChange={value=>setTransport(value as McpTransport)}options={[{label:'stdio',value:'stdio'},{label:'HTTP',value:'http'},{label:'SSE',value:'sse'}]}/></label>
        {transport === 'stdio' ? <><label><span>{t("\u542F\u52A8\u547D\u4EE4")}</span><Input value={command}onChange={event=>setCommand(event.target.value)}placeholder={t("\u4F8B\u5982 npx")}/></label><label><span>{t("\u53C2\u6570\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09")}</span><Input.TextArea rows={4}value={args}onChange={event=>setArgs(event.target.value)}placeholder={'-y\n@modelcontextprotocol/server-filesystem\nD:\\Documents'}/></label></>:<label><span>{t("\u670D\u52A1\u5730\u5740")}</span><Input value={url}onChange={event=>setUrl(event.target.value)}placeholder="https://example.com/mcp"/></label>}
        <div className="mcp-add-form__split"><label><span>{t("\u73AF\u5883\u53D8\u91CF JSON")}</span><Input.TextArea rows={3}value={env}onChange={event=>setEnv(event.target.value)}placeholder='{"TOKEN":"..."}'/></label><label><span>{t("\u8BF7\u6C42\u5934 JSON")}</span><Input.TextArea rows={3}value={headers}onChange={event=>setHeaders(event.target.value)}placeholder='{"Authorization":"Bearer ..."}'/></label></div>
        <label className="mcp-add-form__toggle"><Switch checked={enabled} onChange={setEnabled}/><span>{t("\u6DFB\u52A0\u540E\u542F\u7528")}</span></label>
      </div>
    </Modal>
  </section>
}
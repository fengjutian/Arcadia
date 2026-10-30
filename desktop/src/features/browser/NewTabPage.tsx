import { type MouseEvent, useState } from 'react'
import { Button, Input, Select, Switch, Typography } from '../../components/ui'
import { SearchOutlined } from '../../components/ui/icons'
import { Sparkles as RobotOutlined } from 'lucide-react'
import { readSearchEngineConfig, SEARCH_ENGINE_PRESETS } from './searchEngine'
import { classifyNavigationInput, renderSearchTemplate } from './navigation'
import { QUICK_SITES } from './browserUtils'

export function NewTab({ address, setAddress, navigate, onCompareSearch, onAiSearch }: {
  address: string
  setAddress: (value: string) => void
  navigate: (input: string) => Promise<void>
  onCompareSearch: (query: string, engineIds: string[], includeKnowledge: boolean) => void
  onAiSearch: (query: string) => void
}) {
  const configuredEngine = readSearchEngineConfig().presetId
  const initialEngine = SEARCH_ENGINE_PRESETS.some(engine => engine.id === configuredEngine) ? configuredEngine : 'google'
  const [engines, setEngines] = useState<string[]>([initialEngine])
  const [searchKnowledge, setSearchKnowledge] = useState(true)
  const presets = SEARCH_ENGINE_PRESETS.map(item => ({ label: item.label, value: item.id }))

  function templateFor(id: string) { return SEARCH_ENGINE_PRESETS.find(item => item.id === id)?.template ?? SEARCH_ENGINE_PRESETS[0].template }
  function submit() {
    const query = address.trim()
    if (!query) return
    if (classifyNavigationInput(query) !== 'search') { void navigate(query); return }
    if (engines.length === 1 && !searchKnowledge) {
      void navigate(renderSearchTemplate(templateFor(engines[0]), query))
      return
    }
    onCompareSearch(query, engines, searchKnowledge)
  }

  function submitAiSearch() {
    const query = address.trim()
    if (!query) return
    onAiSearch(query)
  }

  return <div className="new-tab"><main className="new-tab__workspace"><div className="new-tab__hero"><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>一次输入，同时搜索互联网与本地知识库。</Typography.Paragraph></div><div className="new-tab-search"><form onSubmit={event=>{event.preventDefault();submit()}}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder="输入搜索内容或网址" suffix={<div className="new-tab-search__actions"><Button htmlType="button" icon={<RobotOutlined size={15}/>} onClick={submitAiSearch}>AI 搜索</Button><Button type="primary" htmlType="submit" disabled={engines.length === 0 && !searchKnowledge}>搜索</Button></div>}/></form><div className="new-tab-search__sources"><div className="search-engine-picker"><span>参与搜索</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder="选择搜索引擎"/></div><label className="knowledge-search-toggle"><Switch checked={searchKnowledge} onChange={setSearchKnowledge}/><span><b>本地知识库</b><small>网页、笔记与标签</small></span></label></div><div className="new-tab-search__hint">普通搜索会查询所选来源；AI 搜索会生成带引用、可继续追问的答案。</div></div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event: MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}><span>{site.initial}</span><img src={site.iconUrl} alt="" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/></span><span className="quick-site__name">{site.name}</span></button>)}</div></div></main></div>
}

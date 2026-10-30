import { type MouseEvent, useState } from 'react'
import { Button, Input, Select, Switch, Typography } from '../../components/ui'
import { SearchOutlined } from '../../components/ui/icons'
import { readSearchEngineConfig, SEARCH_ENGINE_PRESETS } from './searchEngine'
import { classifyNavigationInput, renderSearchTemplate } from './navigation'
import { QUICK_SITES } from './browserUtils'

export function NewTab({ address, setAddress, navigate, onCompareSearch }: {
  address: string
  setAddress: (value: string) => void
  navigate: (input: string) => Promise<void>
  onCompareSearch: (query: string, engineIds: string[], includeKnowledge: boolean) => void
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

  return <div className="new-tab"><main className="new-tab__workspace"><div className="new-tab__hero"><Typography.Title>今天想探索什么？</Typography.Title><Typography.Paragraph>一次输入，同时搜索互联网与本地知识库。</Typography.Paragraph></div><div className="new-tab-search"><form onSubmit={event=>{event.preventDefault();submit()}}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event=>setAddress(event.target.value)} placeholder="输入搜索内容或网址" suffix={<Button type="primary" htmlType="submit" disabled={engines.length === 0 && !searchKnowledge}>搜索</Button>}/></form><div className="new-tab-search__sources"><div className="search-engine-picker"><span>参与搜索</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder="选择搜索引擎"/></div><label className="knowledge-search-toggle"><Switch checked={searchKnowledge} onChange={setSearchKnowledge}/><span><b>本地知识库</b><small>网页、笔记与标签</small></span></label></div><div className="new-tab-search__hint">提交后，所选搜索引擎与本地知识库将同时查询。</div></div><div className="quick-sites"><div className="quick-sites__label">常用网站</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`打开 ${site.name}`} onClick={(event: MouseEvent<HTMLButtonElement>)=>{event.currentTarget.blur();void navigate(site.url)}}><span className="quick-site__mark" style={{background:site.color}}><span>{site.initial}</span><img src={site.iconUrl} alt="" referrerPolicy="no-referrer" onError={event=>{event.currentTarget.style.display='none'}}/></span><span className="quick-site__name">{site.name}</span></button>)}</div></div></main></div>
}

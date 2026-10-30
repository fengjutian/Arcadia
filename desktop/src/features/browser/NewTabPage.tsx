import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Switch, Typography } from '../../components/ui'
import { SearchOutlined } from '../../components/ui/icons'
import { ArrowUpRight, CloudSun, Grid3X3, Languages, Sparkles as RobotOutlined } from 'lucide-react'
import { readSearchEngineConfig, SEARCH_ENGINE_PRESETS } from './searchEngine'
import { classifyNavigationInput, renderSearchTemplate } from './navigation'
import { QUICK_SITES } from './browserUtils'

type Locale = 'zh' | 'en'
interface WeatherState { temperature: number; weatherCode: number; place: string }

const copy = {
  zh: {
    title: '今天想探索什么？', subtitle: '一次输入，同时搜索互联网与本地知识库。', placeholder: '输入搜索内容或网址', aiSearch: 'AI 搜索', search: '搜索', sources: '参与搜索', selectEngine: '选择搜索引擎', knowledge: '本地知识库', knowledgeDetail: '网页、笔记与标签', hint: '普通搜索会查询所选来源；AI 搜索会生成带引用、可继续追问的答案。', quickSites: '常用网站', tools: '微软工具', allApps: 'Microsoft 365', currentLocation: '当前位置', weatherUnavailable: '天气暂不可用', open: '打开',
  },
  en: {
    title: 'What would you like to explore?', subtitle: 'Search the web and your local knowledge in one place.', placeholder: 'Search or enter a web address', aiSearch: 'AI Search', search: 'Search', sources: 'Search with', selectEngine: 'Choose search engines', knowledge: 'Local knowledge', knowledgeDetail: 'Pages, notes and tags', hint: 'Standard search checks selected sources; AI Search returns a cited answer you can follow up on.', quickSites: 'Quick links', tools: 'Microsoft apps', allApps: 'Microsoft 365', currentLocation: 'Current location', weatherUnavailable: 'Weather unavailable', open: 'Open',
  },
} as const

const tools = [
  { name: 'Copilot', initial: 'C', color: '#6d55dc', url: 'https://copilot.microsoft.com' },
  { name: 'Outlook', initial: 'O', color: '#0a64ad', url: 'https://outlook.live.com/mail/' },
  { name: 'OneDrive', initial: '☁', color: '#1687d4', url: 'https://onedrive.live.com' },
  { name: 'Word', initial: 'W', color: '#185abd', url: 'https://www.office.com/launch/word' },
  { name: 'Excel', initial: 'X', color: '#107c41', url: 'https://www.office.com/launch/excel' },
  { name: 'PowerPoint', initial: 'P', color: '#c43e1c', url: 'https://www.office.com/launch/powerpoint' },
  { name: 'OneNote', initial: 'N', color: '#7719aa', url: 'https://www.onenote.com/notebooks' },
  { name: 'Teams', initial: 'T', color: '#5b5fc7', url: 'https://teams.microsoft.com/v2/' },
  { name: 'SharePoint', initial: 'S', color: '#03787c', url: 'https://www.office.com/launch/sharepoint' },
]

function weatherSymbol(code: number) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️'
  if (code <= 77 || code >= 85) return '🌨️'
  return '⛈️'
}

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
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('new-tab-locale') === 'en' ? 'en' : 'zh')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const text = copy[locale]
  const presets = SEARCH_ENGINE_PRESETS.map(item => ({ label: item.label, value: item.id }))

  useEffect(() => { localStorage.setItem('new-tab-locale', locale) }, [locale])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setToolsOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  useEffect(() => {
    let active = true
    setWeatherFailed(false)
    const loadWeather = async (latitude: number, longitude: number, place: string) => {
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`)
        if (!response.ok) throw new Error('weather request failed')
        const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number } }
        if (active && data.current?.temperature_2m != null && data.current.weather_code != null) setWeather({ temperature: Math.round(data.current.temperature_2m), weatherCode: data.current.weather_code, place })
      } catch { if (active) setWeatherFailed(true) }
    }
    const fallback = () => void loadWeather(31.23, 121.47, locale === 'zh' ? '上海' : 'Shanghai')
    if (!navigator.geolocation) fallback()
    else navigator.geolocation.getCurrentPosition(position => void loadWeather(position.coords.latitude, position.coords.longitude, text.currentLocation), fallback, { timeout: 3500, maximumAge: 30 * 60 * 1000 })
    return () => { active = false }
  }, [locale, text.currentLocation])

  function templateFor(id: string) { return SEARCH_ENGINE_PRESETS.find(item => item.id === id)?.template ?? SEARCH_ENGINE_PRESETS[0].template }
  function submit() {
    const query = address.trim()
    if (!query) return
    if (classifyNavigationInput(query) !== 'search') { void navigate(query); return }
    if (engines.length === 1 && !searchKnowledge) { void navigate(renderSearchTemplate(templateFor(engines[0]), query)); return }
    onCompareSearch(query, engines, searchKnowledge)
  }
  function submitAiSearch() { const query = address.trim(); if (query) onAiSearch(query) }

  return <div className="new-tab">
    <div className="new-tab__utilities">
      <div className="new-tab__weather" title={weatherFailed ? text.weatherUnavailable : undefined}><CloudSun size={18}/>{weather ? <><span>{weather.place}</span><b>{weatherSymbol(weather.weatherCode)} {weather.temperature}°C</b></> : <span>{weatherFailed ? text.weatherUnavailable : '···'}</span>}</div>
      <button className="new-tab__utility" type="button" onClick={() => setLocale(value => value === 'zh' ? 'en' : 'zh')} aria-label="Switch language"><Languages size={18}/><span>{locale === 'zh' ? '中' : 'EN'}</span></button>
      <div className="new-tab__tools-wrap" ref={toolsRef}>
        <button className="new-tab__utility" type="button" onClick={() => setToolsOpen(value => !value)} aria-expanded={toolsOpen} aria-label={text.tools}><Grid3X3 size={18}/><span>{text.tools}</span></button>
        {toolsOpen && <section className="new-tab__tools" aria-label={text.tools}><header><span><Grid3X3 size={17}/><b>{text.tools}</b></span><button type="button" onClick={() => { setToolsOpen(false); void navigate('https://www.microsoft365.com') }}>{text.allApps}<ArrowUpRight size={14}/></button></header><div>{tools.map(tool => <button key={tool.url} type="button" onClick={() => { setToolsOpen(false); void navigate(tool.url) }} title={`${text.open} ${tool.name}`}><span className="new-tab__microsoft-icon" style={{ '--tool-color': tool.color } as CSSProperties}>{tool.initial}</span><small>{tool.name}</small></button>)}</div></section>}
      </div>
    </div>
    <main className="new-tab__workspace">
      <div className="new-tab__hero"><Typography.Title>{text.title}</Typography.Title><Typography.Paragraph>{text.subtitle}</Typography.Paragraph></div>
      <div className="new-tab-search">
        <form onSubmit={event => { event.preventDefault(); submit() }}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event => setAddress(event.target.value)} placeholder={text.placeholder} suffix={<div className="new-tab-search__actions"><Button htmlType="button" icon={<RobotOutlined size={15}/>} onClick={submitAiSearch}>{text.aiSearch}</Button><Button type="primary" htmlType="submit" disabled={engines.length === 0 && !searchKnowledge}>{text.search}</Button></div>}/></form>
        <div className="new-tab-search__sources"><div className="search-engine-picker"><span>{text.sources}</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder={text.selectEngine}/></div><label className="knowledge-search-toggle"><Switch checked={searchKnowledge} onChange={setSearchKnowledge}/><span><b>{text.knowledge}</b><small>{text.knowledgeDetail}</small></span></label></div>
        <div className="new-tab-search__hint">{text.hint}</div>
      </div>
      <div className="quick-sites"><div className="quick-sites__label">{text.quickSites}</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`${text.open} ${site.name}`} onClick={(event: MouseEvent<HTMLButtonElement>) => { event.currentTarget.blur(); void navigate(site.url) }}><span className="quick-site__mark" style={{ background: site.color }}><span>{site.initial}</span><img src={site.iconUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }}/></span><span className="quick-site__name">{site.name}</span></button>)}</div></div>
    </main>
  </div>
}

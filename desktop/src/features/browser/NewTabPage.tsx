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
    title: '今天想探索什么？', subtitle: '一次输入，同时搜索互联网、AI 与本地知识库。', placeholder: '输入搜索内容或网址', aiSearch: 'AI 搜索', aiDetail: '生成答案并继续追问', search: '搜索', sources: '参与搜索', selectEngine: '选择搜索引擎', knowledge: '本地知识库', knowledgeDetail: '网页、笔记与标签', hint: '搜索引擎、AI 搜索与本地知识库将作为并列来源参与对比查询。', quickSites: '常用网站', tools: '微软工具', allApps: 'Microsoft 365', currentLocation: '当前位置', weatherUnavailable: '天气暂不可用', open: '打开',
  },
  en: {
    title: 'What would you like to explore?', subtitle: 'Search the web, AI and your local knowledge in one place.', placeholder: 'Search or enter a web address', aiSearch: 'AI Search', aiDetail: 'Answer and follow-up chat', search: 'Search', sources: 'Search with', selectEngine: 'Choose search engines', knowledge: 'Local knowledge', knowledgeDetail: 'Pages, notes and tags', hint: 'Search engines, AI Search and local knowledge are peer sources in one comparison.', quickSites: 'Quick links', tools: 'Microsoft apps', allApps: 'Microsoft 365', currentLocation: 'Current location', weatherUnavailable: 'Weather unavailable', open: 'Open',
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
  { name: 'To Do', initial: '✓', color: '#2564cf', url: 'https://to-do.office.com/tasks/' },
  { name: 'Planner', initial: 'P', color: '#31752f', url: 'https://planner.cloud.microsoft' },
  { name: 'Loop', initial: 'L', color: '#8230c6', url: 'https://loop.cloud.microsoft' },
  { name: 'Forms', initial: 'F', color: '#038387', url: 'https://forms.office.com' },
  { name: 'Whiteboard', initial: 'W', color: '#0078d4', url: 'https://whiteboard.office.com' },
  { name: 'Lists', initial: 'L', color: '#744da9', url: 'https://lists.live.com' },
  { name: 'Power Automate', initial: 'A', color: '#0066ff', url: 'https://make.powerautomate.com' },
  { name: 'Power BI', initial: 'BI', color: '#e0a800', url: 'https://app.powerbi.com' },
  { name: 'Designer', initial: 'D', color: '#7b2ff7', url: 'https://designer.microsoft.com' },
  { name: 'Clipchamp', initial: 'C', color: '#7f28d8', url: 'https://app.clipchamp.com' },
  { name: 'Viva Engage', initial: 'V', color: '#5b5fc7', url: 'https://web.yammer.com' },
  { name: 'Bookings', initial: 'B', color: '#2b88d8', url: 'https://outlook.office.com/bookings/' },
]

function weatherSymbol(code: number) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️'
  if (code <= 77 || code >= 85) return '🌨️'
  return '⛈️'
}

export function NewTab({ address, setAddress, navigate, onCompareSearch }: {
  address: string
  setAddress: (value: string) => void
  navigate: (input: string) => Promise<void>
  onCompareSearch: (query: string, engineIds: string[], includeKnowledge: boolean, includeAi: boolean) => void
}) {
  const configuredEngine = readSearchEngineConfig().presetId
  const initialEngine = SEARCH_ENGINE_PRESETS.some(engine => engine.id === configuredEngine) ? configuredEngine : 'google'
  const [engines, setEngines] = useState<string[]>([initialEngine])
  const [searchKnowledge, setSearchKnowledge] = useState(true)
  const [searchAi, setSearchAi] = useState(true)
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
    if (engines.length === 1 && !searchKnowledge && !searchAi) { void navigate(renderSearchTemplate(templateFor(engines[0]), query)); return }
    onCompareSearch(query, engines, searchKnowledge, searchAi)
  }

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
        <form onSubmit={event => { event.preventDefault(); submit() }}><Input size="large" autoFocus prefix={<SearchOutlined/>} value={address} onChange={event => setAddress(event.target.value)} placeholder={text.placeholder} suffix={<Button type="primary" htmlType="submit" disabled={engines.length === 0 && !searchKnowledge && !searchAi}>{text.search}</Button>}/></form>
        <div className="new-tab-search__sources"><div className="search-engine-picker"><span>{text.sources}</span><Select mode="multiple" maxTagCount="responsive" value={engines} onChange={setEngines} options={presets} placeholder={text.selectEngine}/></div><label className="knowledge-search-toggle ai-search-source-toggle"><Switch checked={searchAi} onChange={setSearchAi}/><RobotOutlined size={17}/><span><b>{text.aiSearch}</b><small>{text.aiDetail}</small></span></label><label className="knowledge-search-toggle"><Switch checked={searchKnowledge} onChange={setSearchKnowledge}/><span><b>{text.knowledge}</b><small>{text.knowledgeDetail}</small></span></label></div>
        <div className="new-tab-search__hint">{text.hint}</div>
      </div>
      <div className="quick-sites"><div className="quick-sites__label">{text.quickSites}</div><div className="quick-sites__grid">{QUICK_SITES.map(site => <button key={site.url} type="button" className="quick-site" title={site.name} aria-label={`${text.open} ${site.name}`} onClick={(event: MouseEvent<HTMLButtonElement>) => { event.currentTarget.blur(); void navigate(site.url) }}><span className="quick-site__mark" style={{ background: site.color }}><span>{site.initial}</span><img src={site.iconUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }}/></span><span className="quick-site__name">{site.name}</span></button>)}</div></div>
    </main>
  </div>
}

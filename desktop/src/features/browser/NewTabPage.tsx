import { t } from '../../i18n'
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Switch, Typography } from '../../components/ui'
import { SearchOutlined } from '../../components/ui/icons'
import { ArrowLeftRight, ArrowUpRight, Calculator, CloudSun, Gauge, Grid3X3, Languages, MapPin, QrCode, Sparkles as RobotOutlined, Timer, Wrench } from 'lucide-react'
import { readSearchEngineConfig, SEARCH_ENGINE_PRESETS } from './searchEngine'
import { classifyNavigationInput, renderSearchTemplate } from './navigation'
import { QUICK_SITES } from './browserUtils'

type Locale = 'zh' | 'en'
interface WeatherState { temperature: number; weatherCode: number; place: string }

const copy = {
  zh: {
    title:t("\u4ECA\u5929\u60F3\u63A2\u7D22\u4EC0\u4E48\uFF1F"),subtitle:t("\u4E00\u6B21\u8F93\u5165\uFF0C\u540C\u65F6\u641C\u7D22\u4E92\u8054\u7F51\u3001AI \u4E0E\u672C\u5730\u77E5\u8BC6\u5E93\u3002"),placeholder:t("\u8F93\u5165\u641C\u7D22\u5185\u5BB9\u6216\u7F51\u5740"),aiSearch:t("AI \u641C\u7D22"),aiDetail:t("\u751F\u6210\u7B54\u6848\u5E76\u7EE7\u7EED\u8FFD\u95EE"),search:t("\u641C\u7D22"),sources:t("\u53C2\u4E0E\u641C\u7D22"),selectEngine:t("\u9009\u62E9\u641C\u7D22\u5F15\u64CE"),knowledge:t("\u672C\u5730\u77E5\u8BC6\u5E93"),knowledgeDetail:t("\u7F51\u9875\u3001\u7B14\u8BB0\u4E0E\u6807\u7B7E"),hint:t("\u641C\u7D22\u5F15\u64CE\u3001AI \u641C\u7D22\u4E0E\u672C\u5730\u77E5\u8BC6\u5E93\u5C06\u4F5C\u4E3A\u5E76\u5217\u6765\u6E90\u53C2\u4E0E\u5BF9\u6BD4\u67E5\u8BE2\u3002"),quickSites:t("\u5E38\u7528\u7F51\u7AD9"),tools:t("\u5FAE\u8F6F\u5DE5\u5177"),googleTools:t("Google \u5E94\u7528"),commonTools:t("\u5E38\u7528\u5DE5\u5177"),allApps:'Microsoft 365',allGoogleApps:'Google',currentLocation:t("\u5F53\u524D\u4F4D\u7F6E"),weatherUnavailable:t("\u5929\u6C14\u6682\u4E0D\u53EF\u7528"),open:t("\u6253\u5F00"),
  },
  en: {
    title: 'What would you like to explore?', subtitle: 'Search the web, AI and your local knowledge in one place.', placeholder: 'Search or enter a web address', aiSearch: 'AI Search', aiDetail: 'Answer and follow-up chat', search: 'Search', sources: 'Search with', selectEngine: 'Choose search engines', knowledge: 'Local knowledge', knowledgeDetail: 'Pages, notes and tags', hint: 'Search engines, AI Search and local knowledge are peer sources in one comparison.', quickSites: 'Quick links', tools: 'Microsoft apps', googleTools: 'Google apps', commonTools: 'Useful tools', allApps: 'Microsoft 365', allGoogleApps: 'Google', currentLocation: 'Current location', weatherUnavailable: 'Weather unavailable', open: 'Open',
  },
} as const

const officeIcon = (name: string) => `https://res-1.cdn.office.net/files/fabric-cdn-prod_20230815.002/assets/brand-icons/product/svg/${name}_48x1.svg`

const tools = [
  { name: 'Copilot', initial: 'C', color: '#6d55dc', iconUrl: 'https://copilot.microsoft.com/favicon.ico', url: 'https://copilot.microsoft.com' },
  { name: 'Outlook', initial: 'O', color: '#0a64ad', iconUrl: officeIcon('outlook'), url: 'https://outlook.live.com/mail/' },
  { name: 'OneDrive', initial: '☁', color: '#1687d4', iconUrl: officeIcon('onedrive'), url: 'https://onedrive.live.com' },
  { name: 'Word', initial: 'W', color: '#185abd', iconUrl: officeIcon('word'), url: 'https://www.office.com/launch/word' },
  { name: 'Excel', initial: 'X', color: '#107c41', iconUrl: officeIcon('excel'), url: 'https://www.office.com/launch/excel' },
  { name: 'PowerPoint', initial: 'P', color: '#c43e1c', iconUrl: officeIcon('powerpoint'), url: 'https://www.office.com/launch/powerpoint' },
  { name: 'OneNote', initial: 'N', color: '#7719aa', iconUrl: officeIcon('onenote'), url: 'https://www.onenote.com/notebooks' },
  { name: 'Teams', initial: 'T', color: '#5b5fc7', iconUrl: officeIcon('teams'), url: 'https://teams.microsoft.com/v2/' },
  { name: 'SharePoint', initial: 'S', color: '#03787c', iconUrl: officeIcon('sharepoint'), url: 'https://www.office.com/launch/sharepoint' },
  { name: 'To Do', initial: '✓', color: '#2564cf', iconUrl: officeIcon('todo'), url: 'https://to-do.office.com/tasks/' },
  { name: 'Planner', initial: 'P', color: '#31752f', iconUrl: 'https://planner.cloud.microsoft/favicon.ico', url: 'https://planner.cloud.microsoft' },
  { name: 'Loop', initial: 'L', color: '#8230c6', iconUrl: officeIcon('loop'), url: 'https://loop.cloud.microsoft' },
  { name: 'Forms', initial: 'F', color: '#038387', iconUrl: officeIcon('forms'), url: 'https://forms.office.com' },
  { name: 'Whiteboard', initial: 'W', color: '#0078d4', iconUrl: 'https://whiteboard.office.com/favicon.ico', url: 'https://whiteboard.office.com' },
  { name: 'Lists', initial: 'L', color: '#744da9', iconUrl: 'https://lists.live.com/favicon.ico', url: 'https://lists.live.com' },
  { name: 'Power Automate', initial: 'A', color: '#0066ff', iconUrl: 'https://make.powerautomate.com/favicon.ico', url: 'https://make.powerautomate.com' },
  { name: 'Power BI', initial: 'BI', color: '#e0a800', iconUrl: 'https://app.powerbi.com/images/PowerBI_Favicon.ico', url: 'https://app.powerbi.com' },
  { name: 'Designer', initial: 'D', color: '#7b2ff7', iconUrl: 'https://designer.microsoft.com/favicon.ico', url: 'https://designer.microsoft.com' },
  { name: 'Clipchamp', initial: 'C', color: '#7f28d8', iconUrl: 'https://app.clipchamp.com/favicon.ico', url: 'https://app.clipchamp.com' },
  { name: 'Viva Engage', initial: 'V', color: '#5b5fc7', iconUrl: 'https://web.yammer.com/favicon.ico', url: 'https://web.yammer.com' },
  { name: 'Bookings', initial: 'B', color: '#2b88d8', iconUrl: 'https://outlook.office.com/favicon.ico', url: 'https://outlook.office.com/bookings/' },
]

const googleTools = [
  { name: 'Google', initial: 'G', color: '#4285f4', iconUrl: 'https://www.google.com/favicon.ico', transparentIcon: true, url: 'https://www.google.com' },
  { name: 'Gmail', initial: 'M', color: '#ea4335', iconUrl: 'https://mail.google.com/favicon.ico', url: 'https://mail.google.com' },
  { name: 'Drive', initial: 'D', color: '#0f9d58', iconUrl: 'https://drive.google.com/favicon.ico', url: 'https://drive.google.com' },
  { name: 'Docs', initial: 'D', color: '#4285f4', iconUrl: 'https://docs.google.com/favicon.ico', url: 'https://docs.google.com/document/' },
  { name: 'Sheets', initial: 'S', color: '#0f9d58', iconUrl: 'https://docs.google.com/spreadsheets/favicon.ico', url: 'https://docs.google.com/spreadsheets/' },
  { name: 'Slides', initial: 'S', color: '#f4b400', iconUrl: 'https://docs.google.com/presentation/favicon.ico', url: 'https://docs.google.com/presentation/' },
  { name: 'Calendar', initial: '31', color: '#4285f4', iconUrl: 'https://calendar.google.com/favicon.ico', url: 'https://calendar.google.com' },
  { name: 'Meet', initial: 'M', color: '#00ac47', iconUrl: 'https://meet.google.com/favicon.ico', url: 'https://meet.google.com' },
  { name: 'Maps', initial: 'M', color: '#34a853', iconUrl: 'https://maps.google.com/favicon.ico', url: 'https://maps.google.com' },
  { name: 'YouTube', initial: '▶', color: '#ff0000', iconUrl: 'https://www.youtube.com/favicon.ico', url: 'https://www.youtube.com' },
  { name: 'Photos', initial: 'P', color: '#4285f4', iconUrl: 'https://photos.google.com/favicon.ico', url: 'https://photos.google.com' },
  { name: 'Translate', initial: 'T', color: '#4285f4', iconUrl: 'https://translate.google.com/favicon.ico', url: 'https://translate.google.com' },
]

const commonTools = [
  { name:t("\u8BA1\u7B97\u5668"),initial:'123',color:'#2563eb',icon:<Calculator/>,url:'https://www.bing.com/search?q=calculator'},
  { name:t("\u7FFB\u8BD1"),initial:t("\u8BD1"),color:'#0f8b8d',icon:<Languages/>,url:'https://www.bing.com/translator'},
  { name:t("\u5355\u4F4D\u6362\u7B97"),initial:'↔',color:'#7c3aed',icon:<ArrowLeftRight/>,url:'https://www.bing.com/search?q=unit+converter'},
  { name:t("\u4E8C\u7EF4\u7801"),initial:'QR',color:'#111827',icon:<QrCode/>,url:'https://www.bing.com/search?q=qr+code+generator'},
  { name:t("\u8BA1\u65F6\u5668"),initial:'⏱',color:'#e11d48',icon:<Timer/>,url:'https://www.bing.com/search?q=timer'},
  { name:t("\u6D4B\u901F"),initial:'⚡',color:'#f59e0b',icon:<Gauge/>,url:'https://fast.com'},
  { name:t("\u5929\u6C14"),initial:'☀',color:'#0ea5e9',icon:<CloudSun/>,url:'https://www.msn.com/weather'},
  { name:t("\u5730\u56FE"),initial:'⌖',color:'#16a34a',icon:<MapPin/>,url:'https://www.bing.com/maps'},
]

function weatherSymbol(code: number) {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 48) return '🌫️'
  if (code <= 67 ||( code >= 80 && code <= 82)) return '🌧️'
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
  const [toolsOpen, setToolsOpen] = useState<'microsoft' | 'google' | 'common' | null>(null)
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [weatherFailed, setWeatherFailed] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const text = copy[locale]
  const presets = SEARCH_ENGINE_PRESETS.map(        (item                                 )=>({label:item.label,value:item.id}))

  useEffect(() => { localStorage.setItem('new-tab-locale', locale) }, [locale])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(event.target as Node)) setToolsOpen(null)
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
        const data = (await response.json())as{ current?: { temperature_2m?: number; weather_code?: number } }
        if (active && data.current?.temperature_2m != null && data.current.weather_code != null) setWeather({ temperature: Math.round(data.current.temperature_2m), weatherCode: data.current.weather_code, place })
      } catch { if (active) setWeatherFailed(true) }
    }
    const fallback = () => void loadWeather(31.23, 121.47, locale === 'zh' ?t("\u4E0A\u6D77"):'Shanghai')
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

  function toolPanel(items: Array<{ name: string; initial: string; color: string; iconUrl?: string; icon?: ReactNode; transparentIcon?: boolean; url: string }>, title: string, icon: ReactNode, homeUrl?: string, homeLabel?: string) {
    return <section className="new-tab__tools" aria-label={title}>
      <header><span>{icon}<b>{title}</b></span>{homeUrl && <button type="button" onClick={() => { setToolsOpen(null); void navigate(homeUrl) }}>{homeLabel}<ArrowUpRight size={14}/></button>}</header>
      <div>{items.map(tool => <button key={tool.url} type="button" onClick={() => { setToolsOpen(null); void navigate(tool.url) }} title={`${text.open} ${tool.name}`}><span className={`new-tab__tool-icon${tool.transparentIcon ? ' new-tab__tool-icon--transparent' : ''}`} style={{ '--tool-color': tool.color } as CSSProperties}><span>{tool.icon ?? tool.initial}</span>{tool.iconUrl && <img src={tool.iconUrl} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }}/>}</span><small>{tool.name}</small></button>)}</div>
    </section>
  }

  return <div className="new-tab">
    <div className="new-tab__utilities">
      <div className="new-tab__weather" title={weatherFailed ? text.weatherUnavailable : undefined}><CloudSun size={18}/>{weather ? <><span>{weather.place}</span><b>{weatherSymbol(weather.weatherCode)} {weather.temperature}°C</b></> : <span>{weatherFailed ? text.weatherUnavailable : '···'}</span>}</div>
      <button className="new-tab__utility" type="button" onClick={() => setLocale(value => value === 'zh' ? 'en' : 'zh')} aria-label="Switch language"><Languages size={18}/><span>{locale === 'zh' ?t("\u4E2D"):'EN'}</span></button>
      <div className="new-tab__launchers" ref={toolsRef}>
        <div className="new-tab__tools-wrap">
          <button className="new-tab__utility new-tab__utility--google" type="button" onClick={() => setToolsOpen(value => value === 'google' ? null : 'google')} aria-expanded={toolsOpen === 'google'} aria-label={text.googleTools}><b>G</b><span>{text.googleTools}</span></button>
          {toolsOpen === 'google' && toolPanel(googleTools, text.googleTools, <b className="google-g">G</b>, 'https://www.google.com/intl/zh-CN/about/products', text.allGoogleApps)}
        </div>
        <div className="new-tab__tools-wrap">
          <button className="new-tab__utility" type="button" onClick={() => setToolsOpen(value => value === 'common' ? null : 'common')} aria-expanded={toolsOpen === 'common'} aria-label={text.commonTools}><Wrench size={18}/><span>{text.commonTools}</span></button>
          {toolsOpen === 'common' && toolPanel(commonTools, text.commonTools, <Wrench size={17}/>)}
        </div>
        <div className="new-tab__tools-wrap">
          <button className="new-tab__utility" type="button" onClick={() => setToolsOpen(value => value === 'microsoft' ? null : 'microsoft')} aria-expanded={toolsOpen === 'microsoft'} aria-label={text.tools}><Grid3X3 size={18}/><span>{text.tools}</span></button>
          {toolsOpen === 'microsoft' && toolPanel(tools, text.tools, <Grid3X3 size={17}/>, 'https://www.microsoft365.com', text.allApps)}
        </div>
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
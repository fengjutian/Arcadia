import { t } from '../../i18n'
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowUpRight, BadgeCheck, Download, Search, Sparkles, Star, Store } from 'lucide-react'
import { searchSkillHub, type SkillHubSkill } from '../../api'
import { Button, Input, Spin, Tag, Typography, message } from '../../components/ui'

function compactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function skillUrl(skill: SkillHubSkill): string {
  const canonical = skill.canonicalName?.replace(/^@/, '')
  return canonical ? `https://skillhub.cn/skills/${canonical}` : `https://skillhub.cn/skills/${skill.slug}`
}

export function SkillHubPage({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [skills, setSkills] = useState<SkillHubSkill[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load(keyword: string) {
    setLoading(true)
    try {
      const result = await searchSkillHub(keyword)
      setSkills(result.skills)
      setTotal(result.total)
    } catch (error) { messageApi.error(t("SkillHub \u52A0\u8F7D\u5931\u8D25\uFF1A{value0}",{value0:String(error)}))}
    finally { setLoading(false) }
  }

  useEffect(() => { void load(submitted) }, [submitted])

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = query.trim()
    if (next === submitted) void load(next)
    else setSubmitted(next)
  }

  return <section className="page skillhub-page">
    {contextHolder}
    <header className="skillhub-hero">
      <div className="skillhub-hero__brand"><span><Store size={23}/></span><b>SkillHub</b><Tag color="blue">{t("\u5B98\u65B9 API")}</Tag></div>
      <Typography.Title level={1}>{t("\u4E3A AI \u627E\u5230\u4E0B\u4E00\u9879\u80FD\u529B")}</Typography.Title>
      <Typography.Paragraph>{t("\u63A2\u7D22\u4E2D\u6587\u4F18\u5148\u7684 Agent Skills\uFF0C\u67E5\u770B\u53EF\u4FE1\u53D1\u5E03\u8005\u3001\u7248\u672C\u4E0E\u793E\u533A\u70ED\u5EA6\u3002")}</Typography.Paragraph>
      <form onSubmit={submit} className="skillhub-search">
        <Input value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={18}/>} placeholder={t("\u641C\u7D22\u6280\u80FD\uFF0C\u4F8B\u5982\uFF1A\u7F51\u9875\u641C\u7D22\u3001\u6587\u6863\u5904\u7406\u3001\u4EE3\u7801\u5BA1\u67E5")}allowClear/>
        <Button type="primary" htmlType="submit" loading={loading}>{t("\u641C\u7D22")}</Button>
      </form>
      <div className="skillhub-hero__meta"><span><Sparkles size={15}/>{submitted ?t("\u201C{value0}\u201D\u7684\u641C\u7D22\u7ED3\u679C",{value0:submitted}):t("\u4E0B\u8F7D\u70ED\u699C")}</span><span>{compactNumber(total)} {t("\u4E2A Skills")}</span><button type="button"onClick={()=>onOpenUrl('https://skillhub.cn/')}>{t("\u8BBF\u95EE\u5B98\u7F51")} <ArrowUpRight size={14}/></button></div>
    </header>

    {loading ? <div className="skillhub-loading"><Spin size="large"/><span>{t("\u6B63\u5728\u8FDE\u63A5 SkillHub\u2026")}</span></div>:skills.length===0?<div className="skillhub-empty"><Search size={36}/><h2>{t("\u6CA1\u6709\u627E\u5230\u76F8\u5173\u6280\u80FD")}</h2><p>{t("\u6362\u4E00\u4E2A\u66F4\u5BBD\u6CDB\u7684\u5173\u952E\u8BCD\u8BD5\u8BD5\u3002")}</p></div>:<div className="skillhub-grid">
      {skills.map(skill => <article className="skill-card" key={`${skill.canonicalName ?? skill.slug}-${skill.version}`}>
        <div className="skill-card__top">
          <span className="skill-card__icon">{skill.iconUrl ? <img src={skill.iconUrl} alt=""/> : <Sparkles size={22}/>}</span>
          <div className="skill-card__identity"><h2>{skill.name}</h2><span>{skill.canonicalName ?? `@${skill.ownerName ?? 'community'}/${skill.slug}`}</span></div>
          {skill.publisherVerified && <BadgeCheck className="skill-card__verified" size={20} aria-label={t("\u8BA4\u8BC1\u53D1\u5E03\u8005")}/>}
        </div>
        <p className="skill-card__description">{skill.description ||t("\u6682\u65E0\u63CF\u8FF0")}</p>
        <div className="skill-card__tags"><Tag>{skill.category ??t("\u5176\u4ED6")}</Tag><Tag color={skill.source==='enterprise'?'green':'default'}>{skill.source==='enterprise'?t("\u4F01\u4E1A\u53D1\u5E03"):t("\u793E\u533A")}</Tag><Tag>v{skill.version||'—'}</Tag></div>
        <footer><span><Download size={14}/>{compactNumber(skill.downloads)}</span><span><Star size={14}/>{compactNumber(skill.stars)}</span><button type="button" onClick={() => onOpenUrl(skillUrl(skill))}>{t("\u67E5\u770B\u8BE6\u60C5")} <ArrowUpRight size={14}/></button></footer>
      </article>)}
    </div>}
    <p className="skillhub-disclaimer">{t("\u6280\u80FD\u5185\u5BB9\u6765\u81EA SkillHub \u516C\u5F00 API\u3002\u5B89\u88C5\u6216\u4F7F\u7528\u7B2C\u4E09\u65B9 Skill \u524D\uFF0C\u8BF7\u68C0\u67E5\u5176\u6743\u9650\u3001\u6587\u4EF6\u5185\u5BB9\u548C\u5B89\u5168\u8BC4\u6D4B\u3002")}</p>
  </section>
}
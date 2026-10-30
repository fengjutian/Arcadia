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
    } catch (error) { messageApi.error(`SkillHub 加载失败：${String(error)}`) }
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
      <div className="skillhub-hero__brand"><span><Store size={23}/></span><b>SkillHub</b><Tag color="blue">官方 API</Tag></div>
      <Typography.Title level={1}>为 AI 找到下一项能力</Typography.Title>
      <Typography.Paragraph>探索中文优先的 Agent Skills，查看可信发布者、版本与社区热度。</Typography.Paragraph>
      <form onSubmit={submit} className="skillhub-search">
        <Input value={query} onChange={event => setQuery(event.target.value)} prefix={<Search size={18}/>} placeholder="搜索技能，例如：网页搜索、文档处理、代码审查" allowClear/>
        <Button type="primary" htmlType="submit" loading={loading}>搜索</Button>
      </form>
      <div className="skillhub-hero__meta"><span><Sparkles size={15}/>{submitted ? `“${submitted}”的搜索结果` : '下载热榜'}</span><span>{compactNumber(total)} 个 Skills</span><button type="button" onClick={() => onOpenUrl('https://skillhub.cn/')}>访问官网 <ArrowUpRight size={14}/></button></div>
    </header>

    {loading ? <div className="skillhub-loading"><Spin size="large"/><span>正在连接 SkillHub…</span></div> : skills.length === 0 ? <div className="skillhub-empty"><Search size={36}/><h2>没有找到相关技能</h2><p>换一个更宽泛的关键词试试。</p></div> : <div className="skillhub-grid">
      {skills.map(skill => <article className="skill-card" key={`${skill.canonicalName ?? skill.slug}-${skill.version}`}>
        <div className="skill-card__top">
          <span className="skill-card__icon">{skill.iconUrl ? <img src={skill.iconUrl} alt=""/> : <Sparkles size={22}/>}</span>
          <div className="skill-card__identity"><h2>{skill.name}</h2><span>{skill.canonicalName ?? `@${skill.ownerName ?? 'community'}/${skill.slug}`}</span></div>
          {skill.publisherVerified && <BadgeCheck className="skill-card__verified" size={20} aria-label="认证发布者"/>}
        </div>
        <p className="skill-card__description">{skill.description || '暂无描述'}</p>
        <div className="skill-card__tags"><Tag>{skill.category ?? '其他'}</Tag><Tag color={skill.source === 'enterprise' ? 'green' : 'default'}>{skill.source === 'enterprise' ? '企业发布' : '社区'}</Tag><Tag>v{skill.version || '—'}</Tag></div>
        <footer><span><Download size={14}/>{compactNumber(skill.downloads)}</span><span><Star size={14}/>{compactNumber(skill.stars)}</span><button type="button" onClick={() => onOpenUrl(skillUrl(skill))}>查看详情 <ArrowUpRight size={14}/></button></footer>
      </article>)}
    </div>}
    <p className="skillhub-disclaimer">技能内容来自 SkillHub 公开 API。安装或使用第三方 Skill 前，请检查其权限、文件内容和安全评测。</p>
  </section>
}

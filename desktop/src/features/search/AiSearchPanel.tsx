import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Alert, Button, Empty, Input, message, Select, Spin, Tag } from '../../components/ui'
import { ArrowUpOutlined, CopyOutlined, DownloadOutlined, FileTextOutlined, PlusOutlined, RobotOutlined, SearchOutlined } from '../../components/ui/icons'
import { aiChat, getSession, listAIProviders, ragRetrieve, searchDocuments, setSession, type RagRetrieveResponse } from '../../api'
import type { AIProvider, ChatMessage } from '../../types'
import { buildAiSearchRequest, citedSourceIds, sourcesFromRetrieval, type AiSearchSource } from './aiSearchPrompt'
import { answerAsMarkdown, extractFollowUpQuestions, parseAnswerSegments, standaloneAnswerHtml, type AiSearchAskBlock } from './aiSearchAnswer'

const AI_SEARCH_SESSION_KEY = 'search.ai.conversation.v1'

interface AiSearchTurn {
  id: string
  question: string
  answer: string
  sources: AiSearchSource[]
  citedIds: string[]
}

export function AiSearchPanel({ initialQuery = '', onOpenUrl }: { initialQuery?: string; onOpenUrl?: (url: string) => void }) {
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [question, setQuestion] = useState(initialQuery)
  const [turns, setTurns] = useState<AiSearchTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [sessionHydrated, setSessionHydrated] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    void listAIProviders()
      .then(items => {
        if (!current) return
        setProviders(items)
        setProviderId(previous => previous || items[0]?.id || '')
      })
      .catch(caught => { if (current) setError(errorText(caught, '读取 AI Provider 失败')) })
      .finally(() => { if (current) setLoadingProviders(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    void getSession(AI_SEARCH_SESSION_KEY)
      .then(raw => {
        if (!raw) return
        const parsed = JSON.parse(raw) as unknown
        if (isStoredTurns(parsed)) setTurns(parsed.slice(-12))
      })
      .catch(() => undefined)
      .finally(() => setSessionHydrated(true))
  }, [])

  useEffect(() => {
    if (!sessionHydrated) return
    void setSession(AI_SEARCH_SESSION_KEY, JSON.stringify(turns.slice(-12))).catch(() => undefined)
  }, [sessionHydrated, turns])

  useEffect(() => {
    if (initialQuery.trim() && turns.length === 0) setQuestion(initialQuery)
  }, [initialQuery, turns.length])

  const activeProvider = providers.find(provider => provider.id === providerId)
  const history = useMemo<ChatMessage[]>(() => turns.flatMap(turn => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]).slice(-6), [turns])

  async function submit(rawQuestion = question) {
    const prompt = rawQuestion.trim()
    if (!prompt || !providerId || busy) return
    setBusy(true)
    setError('')
    try {
      const provider = providers.find(item => item.id === providerId)
      const baseQuery = {
        query: prompt,
        topK: 10,
        candidateK: 24,
        includeArchived: false,
        retrievalMode: provider?.embeddingModel ? 'hybrid' as const : 'lexical' as const,
        rerank: Boolean(provider?.embeddingModel),
        providerId,
        embeddingModel: provider?.embeddingModel,
      }
      let retrieval: RagRetrieveResponse
      try {
        retrieval = await ragRetrieve(providerId, baseQuery)
      } catch (caught) {
        if (!provider?.embeddingModel) throw caught
        retrieval = await ragRetrieve(providerId, { ...baseQuery, retrievalMode: 'lexical', rerank: false, embeddingModel: undefined })
      }
      let sources = sourcesFromRetrieval(retrieval)
      if (sources.length === 0) {
        const documents = await searchDocuments(prompt)
        sources = documents.slice(0, 8).map((document, index) => ({
          id: `S${index + 1}`,
          documentId: document.id,
          title: document.title || document.url || '未命名来源',
          url: document.url,
          excerpt: (document.markdownSnippet || document.summarySnippet || document.summary || document.markdown || '').trim().slice(0, 2400),
        })).filter(source => source.excerpt.length > 0)
      }
      if (sources.length === 0) {
        setError('本地知识库中没有找到足够证据。请先保存相关网页，或换一种问法。')
        return
      }
      const response = await aiChat(providerId, buildAiSearchRequest(prompt, sources, history))
      const answer = response.content.trim()
      if (!answer) throw new Error('模型返回了空答案')
      setTurns(current => [...current, {
        id: `ai-search-${Date.now()}`,
        question: prompt,
        answer,
        sources,
        citedIds: citedSourceIds(answer, sources),
      }])
      setQuestion('')
    } catch (caught) {
      setError(errorText(caught, 'AI 搜索失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  async function copyTurn(turn: AiSearchTurn) {
    try {
      await navigator.clipboard.writeText(answerAsMarkdown(turn.question, turn.answer, turn.sources))
      message.success('答案 Markdown 已复制')
    } catch { message.error('复制失败，请检查剪贴板权限') }
  }

  function exportTurn(turn: AiSearchTurn) {
    const answerHtml = document.getElementById(`ai-search-answer-${turn.id}`)?.innerHTML
    if (!answerHtml) { message.error('答案尚未渲染完成'); return }
    const html = standaloneAnswerHtml({ question: turn.question, answerHtml, sources: turn.sources })
    const url = URL.createObjectURL(new Blob([html], { type:'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeFilename(turn.question)}.html`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    message.success('已导出单文件 HTML')
  }

  if (loadingProviders) return <div className="ai-search-loading"><Spin/><span>正在读取模型配置…</span></div>

  return <div className="ai-search">
    <div className="ai-search__composer">
      <div className="ai-search__composer-head">
        <span><RobotOutlined/> 基于本地知识库生成带引用的结构化答案</span>
        <div className="ai-search__composer-actions">
        {turns.length > 0 && <Button size="small" icon={<PlusOutlined/>} disabled={busy} onClick={() => { setTurns([]); setQuestion(''); setError('') }}>新搜索</Button>}
        {providers.length > 0 && <Select
          className="ai-search__provider"
          ariaLabel="AI Provider"
          value={providerId}
          options={providers.map(provider => ({ label: provider.model, value: provider.id }))}
          onChange={setProviderId}
        />}
        </div>
      </div>
      <div className="ai-search__input-row">
        <Input.TextArea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder="例如：比较我保存过的 SQLite FTS 与向量检索方案"
          aria-label="AI 搜索问题"
          autoSize={{ minRows: 2, maxRows: 5 }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <Button type="primary" icon={busy ? <Spin size="small"/> : <ArrowUpOutlined/>} disabled={!question.trim() || !providerId || busy} onClick={() => void submit()}>
          {busy ? '生成中' : '搜索'}
        </Button>
      </div>
      <div className="ai-search__hint">Enter 发送 · Shift + Enter 换行 · 只使用本地知识库证据</div>
    </div>

    {providers.length === 0 && <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="尚未配置 AI Provider。请先在设置中添加兼容模型。"
    />}
    {error && <Alert type="warning" showIcon message={error}/>} 

    {turns.length === 0 && providers.length > 0 && !error && <div className="ai-search__empty">
      <SearchOutlined/>
      <h2>把搜索结果整理成答案</h2>
      <p>AI 会先检索本地知识库，再生成带来源的结论、步骤或对比表。</p>
    </div>}

    <div className="ai-search__turns">
      {turns.map((turn, index) => {
        const generatedFollowUps = extractFollowUpQuestions(turn.answer)
        const followUps = generatedFollowUps.length > 0 ? generatedFollowUps : ['给我一个具体实施步骤', '有哪些风险或反例？', '用表格比较关键选项']
        return <article className="ai-search-answer" key={turn.id}>
        <header>
          <span className="ai-search-answer__index">{index + 1}</span>
          <div><small>问题</small><h2>{turn.question}</h2></div>
          <div className="ai-search-answer__actions">
            <Button size="small" type="text" icon={<CopyOutlined/>} onClick={() => void copyTurn(turn)}>复制</Button>
            <Button size="small" type="text" icon={<DownloadOutlined/>} onClick={() => exportTurn(turn)}>HTML</Button>
          </div>
        </header>
        <div id={`ai-search-answer-${turn.id}`} className="ai-search-answer__markdown markdown-body">
          <AiSearchAnswerContent answer={turn.answer} busy={busy} onAnswer={value => void submit(value)}/>
        </div>
        <section className="ai-search-sources" aria-label="答案来源">
          <h3><FileTextOutlined/> 来源</h3>
          <div className="ai-search-sources__list">
            {turn.sources.map(source => <button key={source.id} type="button" onClick={() => onOpenUrl?.(source.url)}>
              <Tag color={turn.citedIds.includes(source.id) ? 'green' : undefined}>{source.id}</Tag>
              <span><b>{source.title}</b><small>{domainOf(source.url)}</small></span>
            </button>)}
          </div>
        </section>
        {index === turns.length - 1 && <div className="ai-search-followups">
          <span>继续追问</span>
          {followUps.map(item => <button key={item} type="button" disabled={busy} onClick={() => { setQuestion(item); void submit(item) }}>{item}</button>)}
        </div>}
      </article>})}
    </div>
    {turns.length > 0 && <div className="ai-search__footer-note">当前模型：{activeProvider?.model ?? '—'} · 新追问会重新检索本地证据</div>}
  </div>
}

function AiSearchAnswerContent({ answer, busy, onAnswer }: { answer: string; busy: boolean; onAnswer: (value: string) => void }) {
  return <>{parseAnswerSegments(answer).map((segment, index) => segment.kind === 'markdown'
    ? <ReactMarkdown key={`markdown-${index}`} remarkPlugins={[remarkGfm]}>{segment.content}</ReactMarkdown>
    : <AiSearchAsk key={`ask-${index}`} block={segment} busy={busy} onAnswer={onAnswer}/>)}</>
}

function AiSearchAsk({ block, busy, onAnswer }: { block: AiSearchAskBlock; busy: boolean; onAnswer: (value: string) => void }) {
  const [selected, setSelected] = useState('')
  const [comment, setComment] = useState('')
  const followUp = selected
    ? `关于“${block.question}”，我的选择是“${selected}”${comment.trim() ? `，补充说明：${comment.trim()}` : ''}。请据此继续回答。`
    : ''
  return <section className="ai-search-ask" aria-label={block.question}>
    <div className="ai-search-ask__eyebrow"><RobotOutlined/> 需要你的选择</div>
    <h3>{block.question}</h3>
    <div className="ai-search-ask__options" role="radiogroup" aria-label={block.question}>
      {block.options.map(option => <button
        key={option}
        type="button"
        role="radio"
        aria-checked={selected === option}
        className={selected === option ? 'is-selected' : ''}
        onClick={() => setSelected(option)}
      >
        <span aria-hidden="true"/>{option}{block.suggested === option && <Tag color="green">建议</Tag>}
      </button>)}
    </div>
    <Input
      value={comment}
      onChange={event => setComment(event.target.value)}
      placeholder="补充说明（可选）"
      aria-label="补充说明"
    />
    <Button type="primary" disabled={!selected || busy} onClick={() => onAnswer(followUp)}>按此选择继续</Button>
  </section>
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function safeFilename(value: string): string {
  const safe = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80)
  return safe || 'Arcadia-AI-Search'
}

function isStoredTurns(value: unknown): value is AiSearchTurn[] {
  return Array.isArray(value) && value.every(turn => {
    if (!turn || typeof turn !== 'object') return false
    const item = turn as Partial<AiSearchTurn>
    return typeof item.id === 'string'
      && typeof item.question === 'string'
      && typeof item.answer === 'string'
      && Array.isArray(item.sources)
      && Array.isArray(item.citedIds)
  })
}

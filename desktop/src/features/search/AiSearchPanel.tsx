import { t } from '../../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Alert, Button, Empty, Input, message, Modal, Select, Spin, Switch, Tag } from '../../components/ui'
import { ArrowUpOutlined, CheckCircleOutlined, ClockCircleOutlined, CopyOutlined, DownloadOutlined, ExportOutlined, FileTextOutlined, FullscreenOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, SearchOutlined } from '../../components/ui/icons'
import { aiChat, getSession, listAIProviders, ragRetrieve, saveDocument, searchDocuments, setSession, webSearch, type RagRetrieveResponse } from '../../api'
import type { AIProvider, ChatMessage } from '../../types'
import { buildAiSearchRequest, citedSourceIds, prepareAiSearchSources, sourcesFromDocuments, sourcesFromRetrieval, type AiSearchSource } from './aiSearchPrompt'
import { compareAnswerVersions } from './aiSearchVersionDiff'
import { evaluateAiSearchAnswer } from './aiSearchQuality'
import { aiSearchCacheKey, readAiSearchCache, upsertAiSearchCache } from './aiSearchCache'
import {
  answerAsMarkdown,
  extractFollowUpQuestions,
  parseAnswerSegments,
  standaloneAnswerHtml,
  type AiSearchAskBlock,
  type AiSearchChartBlock,
  type AiSearchFlowBlock,
  type AiSearchTimelineBlock,
} from './aiSearchAnswer'

const AI_SEARCH_SESSION_KEY = 'search.ai.conversation.v1'
const AI_SEARCH_CACHE_KEY = 'search.ai.answer-cache.v1'

interface AiSearchTurn {
  id: string
  question: string
  answer: string
  sources: AiSearchSource[]
  citedIds: string[]
  savedDocumentId?: string
  versionCreatedAt?: string
  previousVersions?: AiSearchVersion[]
  fromCache?: boolean
  webSourceCount?: number
  webWarning?: string
}

interface AnswerPreview { turnId: string; title: string; html: string }
interface AiSearchVersion { id: string; answer: string; sources: AiSearchSource[]; citedIds: string[]; createdAt: string }

export function AiSearchPanel({ initialQuery = '', initialWebEnabled = false, autoSubmit = false, sessionKey = AI_SEARCH_SESSION_KEY, onOpenUrl }: { initialQuery?: string; initialWebEnabled?: boolean; autoSubmit?: boolean; sessionKey?: string; onOpenUrl?: (url: string) => void }) {
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [question, setQuestion] = useState(initialQuery)
  const [turns, setTurns] = useState<AiSearchTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [sessionHydrated, setSessionHydrated] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<AnswerPreview | null>(null)
  const [versionTurnId, setVersionTurnId] = useState<string | null>(null)
  const [comparisonTarget, setComparisonTarget] = useState<{ turnId:string; versionId:string } | null>(null)
  const [qualityTurnId, setQualityTurnId] = useState<string | null>(null)
  const [webEnabled, setWebEnabled] = useState(initialWebEnabled)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)
  const autoSubmittedRef = useRef(false)

  useEffect(() => {
    let current = true
    void listAIProviders()
      .then(items => {
        if (!current) return
        setProviders(items)
        setProviderId(previous => previous || items[0]?.id || '')
      })
      .catch(caught => { if (current) setError(errorText(caught,t("\u8BFB\u53D6 AI Provider \u5931\u8D25")))})
      .finally(() => { if (current) setLoadingProviders(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    void getSession(sessionKey)
      .then(raw => {
        if (!raw) return
        const parsed = JSON.parse(raw) as unknown
        if (isStoredTurns(parsed)) setTurns(parsed.slice(-12))
      })
      .catch(() => undefined)
      .finally(() => setSessionHydrated(true))
  }, [sessionKey])

  useEffect(() => {
    if (!sessionHydrated) return
    void setSession(sessionKey, JSON.stringify(turns.slice(-12))).catch(() => undefined)
  }, [sessionHydrated, sessionKey, turns])

  useEffect(() => {
    if (initialQuery.trim() && turns.length === 0) setQuestion(initialQuery)
  }, [initialQuery, turns.length])

  useEffect(() => {
    setWebEnabled(initialWebEnabled)
  }, [initialWebEnabled])

  useEffect(() => {
    if (!autoSubmit || autoSubmittedRef.current || !sessionHydrated || !providerId || turns.length > 0 || !initialQuery.trim()) return
    autoSubmittedRef.current = true
    void submit(initialQuery)
    // Submit once after the reusable conversation has hydrated its provider and session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, initialQuery, providerId, sessionHydrated, turns.length])

  useEffect(() => {
    if (!preview) return
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== previewFrameRef.current?.contentWindow || !isPreviewFollowUp(event.data)) return
      const { question: askQuestion, option, comment } = event.data
      const followUp =t("\u5173\u4E8E\u201C{value0}\u201D\uFF0C\u6211\u7684\u9009\u62E9\u662F\u201C{value1}\u201D{value2}\u3002\u8BF7\u636E\u6B64\u7EE7\u7EED\u56DE\u7B54\u3002",{value0:askQuestion,value1:option,value2:comment?t("\uFF0C\u8865\u5145\u8BF4\u660E\uFF1A{value0}",{value0:comment}):''})
      setPreview(null)
      setQuestion(followUp)
      void submit(followUp)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
    // `submit` intentionally uses the current provider and conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview])

  const activeProvider = providers.find(provider => provider.id === providerId)
  const history = useMemo<ChatMessage[]>(() => turns.flatMap(turn => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer },
  ]).slice(-6), [turns])
  const versionComparison = useMemo(() => {
    if (!comparisonTarget) return null
    const turn = turns.find(item => item.id === comparisonTarget.turnId)
    const version = turn?.previousVersions?.find(item => item.id === comparisonTarget.versionId)
    if (!turn || !version) return null
    return {
      turn,
      version,
      diff:compareAnswerVersions({
        previousAnswer:version.answer,
        currentAnswer:turn.answer,
        previousSourceUrls:version.sources.map(source => source.url),
        currentSourceUrls:turn.sources.map(source => source.url),
      }),
    }
  }, [comparisonTarget, turns])

  async function generateAnswer(prompt: string, conversationHistory: readonly ChatMessage[], options?: { forceRefresh?: boolean }) {
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
      retrieval = await ragRetrieve(providerId, { ...baseQuery, retrievalMode:'lexical', rerank:false, embeddingModel:undefined })
    }
    let sources = sourcesFromRetrieval(retrieval)
    if (sources.length === 0) sources = sourcesFromDocuments(await searchDocuments(prompt))
    let webWarning: string | undefined
    if (webEnabled) {
      try {
        const webResults = await webSearch(prompt, 6)
        sources = prepareAiSearchSources([
          ...sources.map(({ id: _id, ...source }) => source),
          ...webResults.map((result, index) =>( {
            documentId:`web-${index}-${result.url}`,
            title:result.title,
            url:result.url,
            excerpt:result.snippet,
            kind:'web' as const,
          })),
        ], 10)
      } catch (caught) {
        webWarning = errorText(caught,t("\u8054\u7F51\u641C\u7D22\u5931\u8D25\uFF0C\u5DF2\u4EC5\u4F7F\u7528\u672C\u5730\u77E5\u8BC6\u5E93"))
      }
    }
    if (sources.length === 0) throw new Error(t("\u6CA1\u6709\u627E\u5230\u8DB3\u591F\u8BC1\u636E\u3002\u8BF7\u5148\u4FDD\u5B58\u76F8\u5173\u7F51\u9875\u3001\u5F00\u542F\u8054\u7F51\u8865\u5145\uFF0C\u6216\u6362\u4E00\u79CD\u95EE\u6CD5\u3002"))
    const cacheKey = aiSearchCacheKey({ providerId, question:prompt, history:conversationHistory, sources })
    const cachedEntries = readAiSearchCache(await getSession(AI_SEARCH_CACHE_KEY).catch(() => null))
    const cached = options?.forceRefresh ? undefined : cachedEntries.find(entry => entry.key === cacheKey)
    if (cached) return { answer:cached.answer, sources:cached.sources, citedIds:cached.citedIds, fromCache:true, webSourceCount:cached.sources.filter(source => source.kind === 'web').length, webWarning }
    const response = await aiChat(providerId, buildAiSearchRequest(prompt, sources, conversationHistory))
    const answer = response.content.trim()
    if (!answer) throw new Error(t("\u6A21\u578B\u8FD4\u56DE\u4E86\u7A7A\u7B54\u6848"))
    const citedIds = citedSourceIds(answer, sources)
    const nextCache = upsertAiSearchCache(cachedEntries, { key:cacheKey, answer, sources, citedIds, createdAt:Date.now() })
    void setSession(AI_SEARCH_CACHE_KEY, JSON.stringify(nextCache)).catch(() => undefined)
    return { answer, sources, citedIds, fromCache:false, webSourceCount:sources.filter(source => source.kind === 'web').length, webWarning }
  }

  async function submit(rawQuestion = question) {
    const prompt = rawQuestion.trim()
    if (!prompt || !providerId || busy) return
    setBusy(true)
    setError('')
    try {
      const generated = await generateAnswer(prompt, history)
      setTurns(current => [...current, {
        id: `ai-search-${Date.now()}`,
        question: prompt,
        ...generated,
        versionCreatedAt:new Date().toISOString(),
      }])
      setQuestion('')
    } catch (caught) {
      setError(errorText(caught,t("AI \u641C\u7D22\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")))
    } finally {
      setBusy(false)
    }
  }

  async function regenerateTurn(turn: AiSearchTurn) {
    if (busy || !providerId) return
    setBusy(true)
    setError('')
    try {
      const turnIndex = turns.findIndex(item => item.id === turn.id)
      const priorHistory = turns.slice(0, Math.max(0, turnIndex)).flatMap(item => [
        { role:'user', content:item.question },
        { role:'assistant', content:item.answer },
      ]).slice(-6)
      const generated = await generateAnswer(turn.question, priorHistory, { forceRefresh:true })
      const previous = versionFromTurn(turn)
      setTurns(current => current.map(item => item.id === turn.id ? {
        ...item,
        ...generated,
        savedDocumentId:undefined,
        versionCreatedAt:new Date().toISOString(),
        previousVersions:[...(item.previousVersions ?? []), previous].slice(-5),
      } : item))
      message.success(t("\u5DF2\u751F\u6210\u65B0\u7248\u672C\uFF0C\u65E7\u7248\u672C\u5DF2\u4FDD\u7559"))
    } catch (caught) { setError(errorText(caught,t("\u91CD\u65B0\u751F\u6210\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")))}
    finally { setBusy(false) }
  }

  function restoreVersion(turnId: string, versionId: string) {
    setTurns(current => current.map(turn => {
      if (turn.id !== turnId) return turn
      const target = turn.previousVersions?.find(version => version.id === versionId)
      if (!target) return turn
      const currentVersion = versionFromTurn(turn)
      return {
        ...turn,
        answer:target.answer,
        sources:target.sources,
        citedIds:target.citedIds,
        versionCreatedAt:target.createdAt,
        previousVersions:[...(turn.previousVersions ?? []).filter(version => version.id !== versionId), currentVersion].slice(-5),
        savedDocumentId:undefined,
        fromCache:false,
        webSourceCount:target.sources.filter(source => source.kind === 'web').length,
        webWarning:undefined,
      }
    }))
    setVersionTurnId(null)
    message.success(t("\u5DF2\u6062\u590D\u6240\u9009\u7248\u672C"))
  }

  async function copyTurn(turn: AiSearchTurn) {
    try {
      await navigator.clipboard.writeText(answerAsMarkdown(turn.question, turn.answer, turn.sources))
      message.success(t("\u7B54\u6848 Markdown \u5DF2\u590D\u5236"))
    } catch { message.error(t("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u526A\u8D34\u677F\u6743\u9650"))}
  }

  async function saveTurn(turn: AiSearchTurn) {
    if (turn.savedDocumentId) return
    try {
      const saved = await saveDocument({
        title: t("AI \u641C\u7D22\uFF1A{value0}",{value0:turn.question}).slice(0,160),
        url: `arcadia://ai-search/${encodeURIComponent(turn.id)}`,
        markdown: answerAsMarkdown(turn.question, turn.answer, turn.sources),
        tags: [t("AI \u641C\u7D22")],
      })
      setTurns(current => current.map(item => item.id === turn.id ? { ...item, savedDocumentId:saved.id } : item))
      message.success(t("\u5DF2\u4FDD\u5B58\u5230\u672C\u5730\u77E5\u8BC6\u5E93"))
    } catch (caught) { message.error(errorText(caught,t("\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")))}
  }

  async function shareTurn(turn: AiSearchTurn) {
    const text = answerAsMarkdown(turn.question, turn.answer, turn.sources)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title:t("AI \u641C\u7D22\uFF1A{value0}",{value0:turn.question}),text})
        return
      }
      await navigator.clipboard.writeText(text)
      message.success(t("\u5F53\u524D\u5E73\u53F0\u4E0D\u652F\u6301\u7CFB\u7EDF\u5206\u4EAB\uFF0C\u5DF2\u590D\u5236 Markdown"))
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      message.error(t("\u5206\u4EAB\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))
    }
  }

  function exportTurn(turn: AiSearchTurn) {
    const answerHtml = document.getElementById(`ai-search-answer-${turn.id}`)?.innerHTML
    if (!answerHtml) { message.error(t("\u7B54\u6848\u5C1A\u672A\u6E32\u67D3\u5B8C\u6210"));return}
    const html = standaloneAnswerHtml({ question: turn.question, answerHtml, sources: turn.sources })
    const url = URL.createObjectURL(new Blob([html], { type:'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${safeFilename(turn.question)}.html`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    message.success(t("\u5DF2\u5BFC\u51FA\u5355\u6587\u4EF6 HTML"))
  }

  function previewTurn(turn: AiSearchTurn) {
    const answerHtml = document.getElementById(`ai-search-answer-${turn.id}`)?.innerHTML
    if (!answerHtml) { message.error(t("\u7B54\u6848\u5C1A\u672A\u6E32\u67D3\u5B8C\u6210"));return}
    setPreview({ turnId:turn.id, title:turn.question, html:standaloneAnswerHtml({ question:turn.question, answerHtml, sources:turn.sources }) })
  }

  if (loadingProviders) return <div className="ai-search-loading"><Spin/><span>{t("\u6B63\u5728\u8BFB\u53D6\u6A21\u578B\u914D\u7F6E\u2026")}</span></div>

  return <div className="ai-search">
    <div className="ai-search__composer">
      <div className="ai-search__composer-head">
        <span><RobotOutlined/> {t("\u57FA\u4E8E\u672C\u5730\u77E5\u8BC6\u5E93\u751F\u6210\u5E26\u5F15\u7528\u7684\u7ED3\u6784\u5316\u7B54\u6848")}</span>
        <div className="ai-search__composer-actions">
        <label className="ai-search-web-toggle" title={t("\u542F\u7528\u540E\u4F1A\u628A\u95EE\u9898\u53D1\u9001\u5230 Bing RSS \u641C\u7D22\uFF0C\u5E76\u5C06\u7ED3\u679C\u6458\u8981\u52A0\u5165\u8BC1\u636E\u5305")}>
          <Switch checked={webEnabled} onChange={setWebEnabled}/><span>{t("\u8054\u7F51\u8865\u5145")}</span>
        </label>
        {turns.length > 0 && <Button size="small" icon={<PlusOutlined/>} disabled={busy} onClick={() => { setTurns([]); setQuestion(''); setError('') }}>{t("\u65B0\u641C\u7D22")}</Button>}
        {providers.length > 0 && <Select
          className="ai-search__provider"
          ariaLabel="AI Provider"
          value={providerId}
          options={providers.map(            (provider                                     )=>({label:provider.model,value:provider.id}))}
          onChange={setProviderId}
        />}
        </div>
      </div>
      <div className="ai-search__input-row">
        <Input.TextArea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder={t("\u4F8B\u5982\uFF1A\u6BD4\u8F83\u6211\u4FDD\u5B58\u8FC7\u7684 SQLite FTS \u4E0E\u5411\u91CF\u68C0\u7D22\u65B9\u6848")}
          aria-label={t("AI \u641C\u7D22\u95EE\u9898")}
          autoSize={{ minRows: 2, maxRows: 5 }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <Button type="primary" icon={busy ? <Spin size="small"/> : <ArrowUpOutlined/>} disabled={!question.trim() || !providerId || busy} onClick={() => void submit()}>
          {busy ?t("\u751F\u6210\u4E2D"):t("\u641C\u7D22")}
        </Button>
      </div>
      <div className="ai-search__hint">{t("Enter \u53D1\u9001 \xB7 Shift + Enter \u6362\u884C \xB7 \u53EA\u4F7F\u7528\u672C\u5730\u77E5\u8BC6\u5E93\u8BC1\u636E")}</div>
    </div>

    {providers.length === 0 && <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t("\u5C1A\u672A\u914D\u7F6E AI Provider\u3002\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u6DFB\u52A0\u517C\u5BB9\u6A21\u578B\u3002")}
    />}
    {error && <Alert type="warning" showIcon message={error}/>} 

    {turns.length === 0 && providers.length > 0 && !error && <div className="ai-search__empty">
      <SearchOutlined/>
      <h2>{t("\u628A\u641C\u7D22\u7ED3\u679C\u6574\u7406\u6210\u7B54\u6848")}</h2>
      <p>{t("AI \u4F1A\u5148\u68C0\u7D22\u672C\u5730\u77E5\u8BC6\u5E93\uFF0C\u518D\u751F\u6210\u5E26\u6765\u6E90\u7684\u7ED3\u8BBA\u3001\u6B65\u9AA4\u6216\u5BF9\u6BD4\u8868\u3002")}</p>
    </div>}

    <div className="ai-search__turns">
      {turns.map((turn, index) => {
        const generatedFollowUps = extractFollowUpQuestions(turn.answer)
        const followUps = generatedFollowUps.length > 0 ? generatedFollowUps : [t("\u7ED9\u6211\u4E00\u4E2A\u5177\u4F53\u5B9E\u65BD\u6B65\u9AA4"),t("\u6709\u54EA\u4E9B\u98CE\u9669\u6216\u53CD\u4F8B\uFF1F"),t("\u7528\u8868\u683C\u6BD4\u8F83\u5173\u952E\u9009\u9879")]
        const quality = evaluateAiSearchAnswer(turn.answer, turn.sources)
        return <article className="ai-search-answer" key={turn.id}>
        <header>
          <span className="ai-search-answer__index">{index + 1}</span>
          <div><small>{t("\u95EE\u9898")} {turn.fromCache&&<Tag color="green">{t("\u7F13\u5B58\u547D\u4E2D")}</Tag>}{Boolean(turn.webSourceCount)&&<Tag color="blue">{t("\u8054\u7F51")} {turn.webSourceCount}</Tag>}{turn.webWarning&&<Tag color="orange">{t("\u8054\u7F51\u964D\u7EA7")}</Tag>}</small><h2>{turn.question}</h2></div>
          <div className="ai-search-answer__actions">
            <Button size="small" type="text" icon={<CopyOutlined/>} onClick={() => void copyTurn(turn)}>{t("\u590D\u5236")}</Button>
            <Button size="small" type="text" icon={<ReloadOutlined/>} disabled={busy} onClick={() => void regenerateTurn(turn)}>{t("\u91CD\u751F\u6210")}</Button>
            {(turn.previousVersions?.length ?? 0) > 0 && <Button size="small" type="text" icon={<ClockCircleOutlined/>} onClick={() => setVersionTurnId(turn.id)}>{t("\u7248\u672C")} {turn.previousVersions?.length}</Button>}
            <button type="button" className={`ai-search-quality-badge is-${quality.level}`} onClick={() => setQualityTurnId(turn.id)} title={t("\u67E5\u770B\u672C\u5730\u7B54\u6848\u8D28\u91CF\u68C0\u67E5")}>{t("\u8D28\u91CF")} {quality.score}</button>
            <Button size="small" type="text" icon={turn.savedDocumentId ? <CheckCircleOutlined/> : <SaveOutlined/>} disabled={Boolean(turn.savedDocumentId)} onClick={() => void saveTurn(turn)}>{turn.savedDocumentId ?t("\u5DF2\u4FDD\u5B58"):t("\u4FDD\u5B58")}</Button>
            <Button size="small" type="text" icon={<ExportOutlined/>} onClick={() => void shareTurn(turn)}>{t("\u5206\u4EAB")}</Button>
            <Button size="small" type="text" icon={<FullscreenOutlined/>} onClick={() => previewTurn(turn)}>{t("\u9875\u9762")}</Button>
            <Button size="small" type="text" icon={<DownloadOutlined/>} onClick={() => exportTurn(turn)}>HTML</Button>
          </div>
        </header>
        <div id={`ai-search-answer-${turn.id}`} className="ai-search-answer__markdown markdown-body">
          <AiSearchAnswerContent answer={turn.answer} busy={busy} onAnswer={value => void submit(value)}/>
        </div>
        <section className="ai-search-sources" aria-label={t("\u7B54\u6848\u6765\u6E90")}>
          <h3><FileTextOutlined/> {t("\u6765\u6E90")}</h3>
          <div className="ai-search-sources__list">
            {turn.sources.map(source => <button key={source.id} type="button" onClick={() => onOpenUrl?.(source.url)}>
              <Tag color={turn.citedIds.includes(source.id) ? 'green' : undefined}>{source.id}</Tag>
              <span><b>{source.title}</b><small>{domainOf(source.url)}</small></span>
            </button>)}
          </div>
        </section>
        {index === turns.length - 1 && <div className="ai-search-followups">
          <span>{t("\u7EE7\u7EED\u8FFD\u95EE")}</span>
          {followUps.map(item => <button key={item} type="button" disabled={busy} onClick={() => { setQuestion(item); void submit(item) }}>{item}</button>)}
        </div>}
      </article>})}
    </div>
    {turns.length > 0 && <div className="ai-search__footer-note">{t("\u5F53\u524D\u6A21\u578B\uFF1A")}{activeProvider?.model??'—'} {t("\xB7 \u65B0\u8FFD\u95EE\u4F1A\u91CD\u65B0\u68C0\u7D22\u672C\u5730\u8BC1\u636E")}</div>}
    <Modal
      open={preview !== null}
      title={preview?.title ||t("AI \u641C\u7D22\u7B54\u6848")}
      width="min(1100px, 96vw)"
      className="ai-search-preview-modal"
      styles={{ body:{ padding:0 } }}
      footer={<Button onClick={() => setPreview(null)}>{t("\u5173\u95ED")}</Button>}
      onCancel={() => setPreview(null)}
      destroyOnHidden
    >
      {preview && <iframe
        ref={previewFrameRef}
        title={t("AI \u641C\u7D22\u7B54\u6848\uFF1A{value0}",{value0:preview.title})}
        className="ai-search-preview-frame"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={preview.html}
      />}
    </Modal>
    <Modal
      open={versionTurnId !== null}
      title={t("\u56DE\u7B54\u5386\u53F2\u7248\u672C")}
      width={720}
      footer={<Button onClick={() => setVersionTurnId(null)}>{t("\u5173\u95ED")}</Button>}
      onCancel={() => setVersionTurnId(null)}
      destroyOnHidden
    >
      <div className="ai-search-versions">
        {(turns.find(turn => turn.id === versionTurnId)?.previousVersions ?? []).map((version, index) => <article key={version.id}>
          <div><b>{t("\u7248\u672C")} {index+1}</b><time>{formatVersionTime(version.createdAt)}</time></div>
          <p>{version.answer.replace(/[#*_`>\[\]]/g, '').slice(0, 240)}{version.answer.length > 240 ? '…' : ''}</p>
          <span>{version.sources.length} {t("\u4E2A\u6765\u6E90")}</span>
          <div className="ai-search-versions__actions">
            <Button size="small" onClick={() => versionTurnId && setComparisonTarget({ turnId:versionTurnId, versionId:version.id })}>{t("\u4E0E\u5F53\u524D\u6BD4\u8F83")}</Button>
            <Button size="small" onClick={() => versionTurnId && restoreVersion(versionTurnId, version.id)}>{t("\u6062\u590D\u6B64\u7248\u672C")}</Button>
          </div>
        </article>)}
      </div>
    </Modal>
    <Modal
      open={versionComparison !== null}
      title={t("\u7248\u672C\u5DEE\u5F02")}
      width="min(1120px, 96vw)"
      className="ai-search-diff-modal"
      footer={<Button onClick={() => setComparisonTarget(null)}>{t("\u5173\u95ED")}</Button>}
      onCancel={() => setComparisonTarget(null)}
      destroyOnHidden
    >
      {versionComparison && <>
        <div className="ai-search-diff__summary">
          <Tag color="green">{t("\u65B0\u589E")} {versionComparison.diff.addedLines} {t("\u884C")}</Tag>
          <Tag color="red">{t("\u5220\u9664")} {versionComparison.diff.removedLines} {t("\u884C")}</Tag>
          <span>{t("\u6765\u6E90 +")}{versionComparison.diff.addedSources.length} / -{versionComparison.diff.removedSources.length}</span>
        </div>
        <div className="ai-search-diff">
          <VersionDiffColumn title={t("\u5386\u53F2\u7248 \xB7 {value0}",{value0:formatVersionTime(versionComparison.version.createdAt)})}lines={versionComparison.diff.previous}/>
          <VersionDiffColumn title={t("\u5F53\u524D\u7248")}lines={versionComparison.diff.current}/>
        </div>
      </>}
    </Modal>
    <Modal
      open={qualityTurnId !== null}
      title={t("\u7B54\u6848\u8D28\u91CF\u68C0\u67E5")}
      width={640}
      footer={<Button onClick={() => setQualityTurnId(null)}>{t("\u5173\u95ED")}</Button>}
      onCancel={() => setQualityTurnId(null)}
      destroyOnHidden
    >
      { (()=> {
        const turn = turns.find(item => item.id === qualityTurnId)
        if (!turn) return null
        const report = evaluateAiSearchAnswer(turn.answer, turn.sources)
        return <div className="ai-search-quality">
          <div className={`ai-search-quality__score is-${report.level}`}><strong>{report.score}</strong><span>{t("\u672C\u5730\u89C4\u5219\u8BC4\u5206")}</span></div>
          <dl>
            <div><dt>{t("\u5F15\u7528\u8986\u76D6")}</dt><dd>{Math.round(report.citationCoverage*100)}%（{report.citedParagraphs}/{report.factualParagraphs} {t("\u6BB5\uFF09")}</dd></div>
            <div><dt>{t("\u6709\u6548\u5F15\u7528")}</dt><dd>{report.citedSourceIds.length} {t("\u4E2A")}</dd></div>
            <div><dt>{t("\u6765\u6E90\u57DF\u540D")}</dt><dd>{report.sourceDomains} {t("\u4E2A")}</dd></div>
            <div><dt>{t("\u53EF\u89C6\u5316\u7EC4\u4EF6")}</dt><dd>{report.validVisuals} {t("\u4E2A\u6709\u6548 /")} {report.invalidDslBlocks} {t("\u4E2A\u65E0\u6548")}</dd></div>
          </dl>
          {report.warnings.length > 0 ? <ul>{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className="ai-search-quality__ok"><CheckCircleOutlined/> {t("\u672A\u53D1\u73B0\u660E\u663E\u7684\u7ED3\u6784\u6216\u5F15\u7528\u95EE\u9898")}</p>}
          <small>{t("\u8BC4\u5206\u53EA\u68C0\u67E5\u53EF\u9A8C\u8BC1\u7684\u683C\u5F0F\u3001\u5F15\u7528\u548C\u6765\u6E90\u591A\u6837\u6027\uFF0C\u4E0D\u4EE3\u8868\u4E8B\u5B9E\u4E00\u5B9A\u6B63\u786E\u3002")}</small>
        </div>
      }  )()}
    </Modal>
  </div>
}

function VersionDiffColumn({ title, lines }: { title: string; lines: Array<{ text:string; status:'same' | 'added' | 'removed' }> }) {
  return <section className="ai-search-diff__column">
    <h3>{title}</h3>
    <div>{lines.map((line, index) => <pre key={`${index}-${line.text}`} className={`is-${line.status}`}><span>{index + 1}</span>{line.text || ' '}</pre>)}</div>
  </section>
}

function AiSearchAnswerContent({ answer, busy, onAnswer }: { answer: string; busy: boolean; onAnswer: (value: string) => void }) {
  return <>{parseAnswerSegments(answer).map((segment, index) => {
    if (segment.kind === 'markdown') return <ReactMarkdown key={`markdown-${index}`} remarkPlugins={[remarkGfm]}>{segment.content}</ReactMarkdown>
    if (segment.kind === 'ask') return <AiSearchAsk key={`ask-${index}`} block={segment} busy={busy} onAnswer={onAnswer}/>
    if (segment.kind === 'flow') return <AiSearchFlow key={`flow-${index}`} block={segment}/>
    if (segment.kind === 'timeline') return <AiSearchTimeline key={`timeline-${index}`} block={segment}/>
    return <AiSearchChart key={`chart-${index}`} block={segment}/>
  })}</>
}

function AiSearchAsk({ block, busy, onAnswer }: { block: AiSearchAskBlock; busy: boolean; onAnswer: (value: string) => void }) {
  const [selected, setSelected] = useState('')
  const [comment, setComment] = useState('')
  const followUp = selected
    ?t("\u5173\u4E8E\u201C{value0}\u201D\uFF0C\u6211\u7684\u9009\u62E9\u662F\u201C{value1}\u201D{value2}\u3002\u8BF7\u636E\u6B64\u7EE7\u7EED\u56DE\u7B54\u3002",{value0:block.question,value1:selected,value2:comment.trim()?t("\uFF0C\u8865\u5145\u8BF4\u660E\uFF1A{value0}",{value0:comment.trim()}):''}):
      ''
  return <section className="ai-search-ask" aria-label={block.question} data-ai-ask-question={block.question}>
    <div className="ai-search-ask__eyebrow"><RobotOutlined/> {t("\u9700\u8981\u4F60\u7684\u9009\u62E9")}</div>
    <h3>{block.question}</h3>
    <div className="ai-search-ask__options" role="radiogroup" aria-label={block.question}>
      {block.options.map(option => <button
        key={option}
        type="button"
        role="radio"
        aria-checked={selected === option}
        data-ai-ask-option={option}
        className={selected === option ? 'is-selected' : ''}
        onClick={() => setSelected(option)}
      >
        <span aria-hidden="true"/>{option}{block.suggested === option && <Tag color="green">{t("\u5EFA\u8BAE")}</Tag>}
      </button>)}
    </div>
    <Input
      value={comment}
      onChange={event => setComment(event.target.value)}
      placeholder={t("\u8865\u5145\u8BF4\u660E\uFF08\u53EF\u9009\uFF09")}
      aria-label={t("\u8865\u5145\u8BF4\u660E")}
      data-ai-ask-comment
    />
    <Button type="primary" data-ai-ask-submit disabled={!selected || busy} onClick={() => onAnswer(followUp)}>{t("\u6309\u6B64\u9009\u62E9\u7EE7\u7EED")}</Button>
  </section>
}

function AiSearchFlow({ block }: { block: AiSearchFlowBlock }) {
  return <figure className="ai-search-visual ai-search-flow" aria-label={t("\u6D41\u7A0B\u56FE")}>
    <figcaption>{t("\u6D41\u7A0B")}</figcaption>
    <div className="ai-search-flow__edges">
      {block.edges.map((edge, index) => <div className="ai-search-flow__edge" key={`${edge.from}-${edge.to}-${index}`}>
        <span className="ai-search-flow__node">{edge.from}</span>
        <span className="ai-search-flow__arrow"><i/>{edge.label && <em>{edge.label}</em>}</span>
        <span className="ai-search-flow__node">{edge.to}</span>
      </div>)}
    </div>
  </figure>
}

function AiSearchTimeline({ block }: { block: AiSearchTimelineBlock }) {
  return <figure className="ai-search-visual ai-search-timeline" aria-label={t("\u65F6\u95F4\u7EBF")}>
    <figcaption>{t("\u65F6\u95F4\u7EBF")}</figcaption>
    <ol>{block.items.map((item, index) => <li key={`${item.date}-${item.title}-${index}`}>
      <time>{item.date}</time><span aria-hidden="true"/><div><b>{item.title}</b>{item.description && <p>{item.description}</p>}</div>
    </li>)}</ol>
  </figure>
}

function AiSearchChart({ block }: { block: AiSearchChartBlock }) {
  const maximum = Math.max(...block.items.map(item => Math.abs(item.value)), 1)
  return <figure className="ai-search-visual ai-search-chart" aria-label={block.title ||t("\u6570\u636E\u56FE\u8868")}>
    <figcaption>{block.title ||t("\u6570\u636E\u5BF9\u6BD4")}</figcaption>
    <div className="ai-search-chart__rows">{block.items.map((item, index) => <div className="ai-search-chart__row" key={`${item.label}-${index}`}>
      <span title={item.label}>{item.label}</span>
      <i><b className={item.value < 0 ? 'is-negative' : ''} style={{ width:`${Math.max(2, Math.abs(item.value) / maximum * 100)}%` }}/></i>
      <strong>{item.value.toLocaleString('zh-CN')}</strong>
    </div>)}</div>
  </figure>
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
      &&( item.savedDocumentId === undefined || typeof item.savedDocumentId === 'string')
      &&( item.versionCreatedAt === undefined || typeof item.versionCreatedAt === 'string')
      &&( item.previousVersions === undefined || isStoredVersions(item.previousVersions))
      &&( item.fromCache === undefined || typeof item.fromCache === 'boolean')
      &&( item.webSourceCount === undefined || typeof item.webSourceCount === 'number')
      &&( item.webWarning === undefined || typeof item.webWarning === 'string')
  })
}

function isStoredVersions(value: unknown): value is AiSearchVersion[] {
  return Array.isArray(value) && value.every(version => {
    if (!version || typeof version !== 'object') return false
    const item = version as Partial<AiSearchVersion>
    return typeof item.id === 'string' && typeof item.answer === 'string' && typeof item.createdAt === 'string'
      && Array.isArray(item.sources) && Array.isArray(item.citedIds)
  })
}

function versionFromTurn(turn: AiSearchTurn): AiSearchVersion {
  return {
    id:`version-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    answer:turn.answer,
    sources:turn.sources,
    citedIds:turn.citedIds,
    createdAt:turn.versionCreatedAt ?? new Date().toISOString(),
  }
}

function formatVersionTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function isPreviewFollowUp(value: unknown): value is { type:'arcadia-ai-search-follow-up'; question:string; option:string; comment:string } {
  if (!value || typeof value !== 'object') return false
  const data = value as Record<string, unknown>
  return data.type === 'arcadia-ai-search-follow-up'
    && typeof data.question === 'string' && data.question.length > 0 && data.question.length <= 160
    && typeof data.option === 'string' && data.option.length > 0 && data.option.length <= 160
    && typeof data.comment === 'string' && data.comment.length <= 500
}
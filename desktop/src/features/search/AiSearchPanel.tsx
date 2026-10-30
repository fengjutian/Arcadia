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

export function AiSearchPanel({ initialQuery = '', onOpenUrl }: { initialQuery?: string; onOpenUrl?: (url: string) => void }) {
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
  const [webEnabled, setWebEnabled] = useState(false)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)

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

  useEffect(() => {
    if (!preview) return
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== previewFrameRef.current?.contentWindow || !isPreviewFollowUp(event.data)) return
      const { question: askQuestion, option, comment } = event.data
      const followUp = `关于“${askQuestion}”，我的选择是“${option}”${comment ? `，补充说明：${comment}` : ''}。请据此继续回答。`
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
          ...webResults.map((result, index) => ({
            documentId:`web-${index}-${result.url}`,
            title:result.title,
            url:result.url,
            excerpt:result.snippet,
            kind:'web' as const,
          })),
        ], 10)
      } catch (caught) {
        webWarning = errorText(caught, '联网搜索失败，已仅使用本地知识库')
      }
    }
    if (sources.length === 0) throw new Error('没有找到足够证据。请先保存相关网页、开启联网补充，或换一种问法。')
    const cacheKey = aiSearchCacheKey({ providerId, question:prompt, history:conversationHistory, sources })
    const cachedEntries = readAiSearchCache(await getSession(AI_SEARCH_CACHE_KEY).catch(() => null))
    const cached = options?.forceRefresh ? undefined : cachedEntries.find(entry => entry.key === cacheKey)
    if (cached) return { answer:cached.answer, sources:cached.sources, citedIds:cached.citedIds, fromCache:true, webSourceCount:cached.sources.filter(source => source.kind === 'web').length, webWarning }
    const response = await aiChat(providerId, buildAiSearchRequest(prompt, sources, conversationHistory))
    const answer = response.content.trim()
    if (!answer) throw new Error('模型返回了空答案')
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
      setError(errorText(caught, 'AI 搜索失败，请稍后重试'))
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
      message.success('已生成新版本，旧版本已保留')
    } catch (caught) { setError(errorText(caught, '重新生成失败，请稍后重试')) }
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
    message.success('已恢复所选版本')
  }

  async function copyTurn(turn: AiSearchTurn) {
    try {
      await navigator.clipboard.writeText(answerAsMarkdown(turn.question, turn.answer, turn.sources))
      message.success('答案 Markdown 已复制')
    } catch { message.error('复制失败，请检查剪贴板权限') }
  }

  async function saveTurn(turn: AiSearchTurn) {
    if (turn.savedDocumentId) return
    try {
      const saved = await saveDocument({
        title: `AI 搜索：${turn.question}`.slice(0, 160),
        url: `arcadia://ai-search/${encodeURIComponent(turn.id)}`,
        markdown: answerAsMarkdown(turn.question, turn.answer, turn.sources),
        tags: ['AI 搜索'],
      })
      setTurns(current => current.map(item => item.id === turn.id ? { ...item, savedDocumentId:saved.id } : item))
      message.success('已保存到本地知识库')
    } catch (caught) { message.error(errorText(caught, '保存失败，请稍后重试')) }
  }

  async function shareTurn(turn: AiSearchTurn) {
    const text = answerAsMarkdown(turn.question, turn.answer, turn.sources)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title:`AI 搜索：${turn.question}`, text })
        return
      }
      await navigator.clipboard.writeText(text)
      message.success('当前平台不支持系统分享，已复制 Markdown')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      message.error('分享失败，请稍后重试')
    }
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

  function previewTurn(turn: AiSearchTurn) {
    const answerHtml = document.getElementById(`ai-search-answer-${turn.id}`)?.innerHTML
    if (!answerHtml) { message.error('答案尚未渲染完成'); return }
    setPreview({ turnId:turn.id, title:turn.question, html:standaloneAnswerHtml({ question:turn.question, answerHtml, sources:turn.sources }) })
  }

  if (loadingProviders) return <div className="ai-search-loading"><Spin/><span>正在读取模型配置…</span></div>

  return <div className="ai-search">
    <div className="ai-search__composer">
      <div className="ai-search__composer-head">
        <span><RobotOutlined/> 基于本地知识库生成带引用的结构化答案</span>
        <div className="ai-search__composer-actions">
        <label className="ai-search-web-toggle" title="启用后会把问题发送到 Bing RSS 搜索，并将结果摘要加入证据包">
          <Switch checked={webEnabled} onChange={setWebEnabled}/><span>联网补充</span>
        </label>
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
        const quality = evaluateAiSearchAnswer(turn.answer, turn.sources)
        return <article className="ai-search-answer" key={turn.id}>
        <header>
          <span className="ai-search-answer__index">{index + 1}</span>
          <div><small>问题 {turn.fromCache && <Tag color="green">缓存命中</Tag>}{Boolean(turn.webSourceCount) && <Tag color="blue">联网 {turn.webSourceCount}</Tag>}{turn.webWarning && <Tag color="orange">联网降级</Tag>}</small><h2>{turn.question}</h2></div>
          <div className="ai-search-answer__actions">
            <Button size="small" type="text" icon={<CopyOutlined/>} onClick={() => void copyTurn(turn)}>复制</Button>
            <Button size="small" type="text" icon={<ReloadOutlined/>} disabled={busy} onClick={() => void regenerateTurn(turn)}>重生成</Button>
            {(turn.previousVersions?.length ?? 0) > 0 && <Button size="small" type="text" icon={<ClockCircleOutlined/>} onClick={() => setVersionTurnId(turn.id)}>版本 {turn.previousVersions?.length}</Button>}
            <button type="button" className={`ai-search-quality-badge is-${quality.level}`} onClick={() => setQualityTurnId(turn.id)} title="查看本地答案质量检查">质量 {quality.score}</button>
            <Button size="small" type="text" icon={turn.savedDocumentId ? <CheckCircleOutlined/> : <SaveOutlined/>} disabled={Boolean(turn.savedDocumentId)} onClick={() => void saveTurn(turn)}>{turn.savedDocumentId ? '已保存' : '保存'}</Button>
            <Button size="small" type="text" icon={<ExportOutlined/>} onClick={() => void shareTurn(turn)}>分享</Button>
            <Button size="small" type="text" icon={<FullscreenOutlined/>} onClick={() => previewTurn(turn)}>页面</Button>
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
    <Modal
      open={preview !== null}
      title={preview?.title || 'AI 搜索答案'}
      width="min(1100px, 96vw)"
      className="ai-search-preview-modal"
      styles={{ body:{ padding:0 } }}
      footer={<Button onClick={() => setPreview(null)}>关闭</Button>}
      onCancel={() => setPreview(null)}
      destroyOnHidden
    >
      {preview && <iframe
        ref={previewFrameRef}
        title={`AI 搜索答案：${preview.title}`}
        className="ai-search-preview-frame"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={preview.html}
      />}
    </Modal>
    <Modal
      open={versionTurnId !== null}
      title="回答历史版本"
      width={720}
      footer={<Button onClick={() => setVersionTurnId(null)}>关闭</Button>}
      onCancel={() => setVersionTurnId(null)}
      destroyOnHidden
    >
      <div className="ai-search-versions">
        {(turns.find(turn => turn.id === versionTurnId)?.previousVersions ?? []).map((version, index) => <article key={version.id}>
          <div><b>版本 {index + 1}</b><time>{formatVersionTime(version.createdAt)}</time></div>
          <p>{version.answer.replace(/[#*_`>\[\]]/g, '').slice(0, 240)}{version.answer.length > 240 ? '…' : ''}</p>
          <span>{version.sources.length} 个来源</span>
          <div className="ai-search-versions__actions">
            <Button size="small" onClick={() => versionTurnId && setComparisonTarget({ turnId:versionTurnId, versionId:version.id })}>与当前比较</Button>
            <Button size="small" onClick={() => versionTurnId && restoreVersion(versionTurnId, version.id)}>恢复此版本</Button>
          </div>
        </article>)}
      </div>
    </Modal>
    <Modal
      open={versionComparison !== null}
      title="版本差异"
      width="min(1120px, 96vw)"
      className="ai-search-diff-modal"
      footer={<Button onClick={() => setComparisonTarget(null)}>关闭</Button>}
      onCancel={() => setComparisonTarget(null)}
      destroyOnHidden
    >
      {versionComparison && <>
        <div className="ai-search-diff__summary">
          <Tag color="green">新增 {versionComparison.diff.addedLines} 行</Tag>
          <Tag color="red">删除 {versionComparison.diff.removedLines} 行</Tag>
          <span>来源 +{versionComparison.diff.addedSources.length} / -{versionComparison.diff.removedSources.length}</span>
        </div>
        <div className="ai-search-diff">
          <VersionDiffColumn title={`历史版 · ${formatVersionTime(versionComparison.version.createdAt)}`} lines={versionComparison.diff.previous}/>
          <VersionDiffColumn title="当前版" lines={versionComparison.diff.current}/>
        </div>
      </>}
    </Modal>
    <Modal
      open={qualityTurnId !== null}
      title="答案质量检查"
      width={640}
      footer={<Button onClick={() => setQualityTurnId(null)}>关闭</Button>}
      onCancel={() => setQualityTurnId(null)}
      destroyOnHidden
    >
      {(() => {
        const turn = turns.find(item => item.id === qualityTurnId)
        if (!turn) return null
        const report = evaluateAiSearchAnswer(turn.answer, turn.sources)
        return <div className="ai-search-quality">
          <div className={`ai-search-quality__score is-${report.level}`}><strong>{report.score}</strong><span>本地规则评分</span></div>
          <dl>
            <div><dt>引用覆盖</dt><dd>{Math.round(report.citationCoverage * 100)}%（{report.citedParagraphs}/{report.factualParagraphs} 段）</dd></div>
            <div><dt>有效引用</dt><dd>{report.citedSourceIds.length} 个</dd></div>
            <div><dt>来源域名</dt><dd>{report.sourceDomains} 个</dd></div>
            <div><dt>可视化组件</dt><dd>{report.validVisuals} 个有效 / {report.invalidDslBlocks} 个无效</dd></div>
          </dl>
          {report.warnings.length > 0 ? <ul>{report.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : <p className="ai-search-quality__ok"><CheckCircleOutlined/> 未发现明显的结构或引用问题</p>}
          <small>评分只检查可验证的格式、引用和来源多样性，不代表事实一定正确。</small>
        </div>
      })()}
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
    ? `关于“${block.question}”，我的选择是“${selected}”${comment.trim() ? `，补充说明：${comment.trim()}` : ''}。请据此继续回答。`
    : ''
  return <section className="ai-search-ask" aria-label={block.question} data-ai-ask-question={block.question}>
    <div className="ai-search-ask__eyebrow"><RobotOutlined/> 需要你的选择</div>
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
        <span aria-hidden="true"/>{option}{block.suggested === option && <Tag color="green">建议</Tag>}
      </button>)}
    </div>
    <Input
      value={comment}
      onChange={event => setComment(event.target.value)}
      placeholder="补充说明（可选）"
      aria-label="补充说明"
      data-ai-ask-comment
    />
    <Button type="primary" data-ai-ask-submit disabled={!selected || busy} onClick={() => onAnswer(followUp)}>按此选择继续</Button>
  </section>
}

function AiSearchFlow({ block }: { block: AiSearchFlowBlock }) {
  return <figure className="ai-search-visual ai-search-flow" aria-label="流程图">
    <figcaption>流程</figcaption>
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
  return <figure className="ai-search-visual ai-search-timeline" aria-label="时间线">
    <figcaption>时间线</figcaption>
    <ol>{block.items.map((item, index) => <li key={`${item.date}-${item.title}-${index}`}>
      <time>{item.date}</time><span aria-hidden="true"/><div><b>{item.title}</b>{item.description && <p>{item.description}</p>}</div>
    </li>)}</ol>
  </figure>
}

function AiSearchChart({ block }: { block: AiSearchChartBlock }) {
  const maximum = Math.max(...block.items.map(item => Math.abs(item.value)), 1)
  return <figure className="ai-search-visual ai-search-chart" aria-label={block.title || '数据图表'}>
    <figcaption>{block.title || '数据对比'}</figcaption>
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
      && (item.savedDocumentId === undefined || typeof item.savedDocumentId === 'string')
      && (item.versionCreatedAt === undefined || typeof item.versionCreatedAt === 'string')
      && (item.previousVersions === undefined || isStoredVersions(item.previousVersions))
      && (item.fromCache === undefined || typeof item.fromCache === 'boolean')
      && (item.webSourceCount === undefined || typeof item.webSourceCount === 'number')
      && (item.webWarning === undefined || typeof item.webWarning === 'string')
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

import { t } from '../../i18n'
import { Alert, Button, Card, Empty, Input, message, Segmented, Select, Space, Spin, Tag, Typography } from '../../components/ui'
import { ArrowRightOutlined, BookOutlined, CloseOutlined, CopyOutlined, GlobalOutlined, RobotOutlined, SaveOutlined, StopOutlined, ThunderboltOutlined, TranslationOutlined } from '../../components/ui/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import { aiChat, findDocumentByUrl, getSession, listAIProviders, setSession, updateDocument } from '../../api'
import type { AIProvider } from '../../types'
import type { ReaderArticle } from '../reader/types'
import { buildAskPrompt, numberPassages, parseAnswer, passageById } from './ask'
import { buildSummaryPrompt, summaryKindLabel, type SummaryKind } from './summarize'
import { TRANSLATION_VIEW_LABEL, buildTranslatePrompt, detectTranslationTarget, translationKey, type TranslationView } from './translate'
import { useStreamingChat } from './useStreamingChat'
import { getCurrentWindow } from '@tauri-apps/api/window'

type PanelMode = 'summarize' | 'ask' | 'translate'

interface AssistantPanelProps {
  close: () => void
  saveToLibrary: () => Promise<void>
  currentUrl: string
  currentTabId: string
  readerArticle: ReaderArticle | null
  pageContextPending?: boolean
  pageContextError?: string | null
  pdfArticle?: ReaderArticle | null
  pdfContextError?: string | null
  initialQuestion?: string
  initialMode?: PanelMode
  translationSource?: string
  nativeWindow?: boolean
}

const TRANSLATION_LANGUAGES = [
  { value: 'zh-CN', label:t("\u4E2D\u6587\uFF08\u7B80\u4F53\uFF09")},
  { value: 'en', label: 'English' },
  { value: 'ja', label:t("\u65E5\u672C\u8A9E")},
  { value: 'ko', label: '한국어' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
]

interface TranslationCacheEntry { key: string; content: string }

interface PanelPosition { x: number | null; y: number }

const PANEL_EDGE_GAP = 12

export function AssistantPanel({ close, saveToLibrary, currentUrl, currentTabId, readerArticle, pageContextPending = false, pageContextError = null, pdfArticle = null, pdfContextError = null, initialQuestion = '', initialMode, translationSource = '', nativeWindow = false }: AssistantPanelProps) {
  const article = readerArticle ?? pdfArticle
  const isPdfContext = /^file:\/\/.*\.pdf(?:$|[?#])/i.test(currentUrl)
  const [messageApi, contextHolder] = message.useMessage()
  const [mode, setMode] = useState<PanelMode>('summarize')
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [kind, setKind] = useState<SummaryKind>('short')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const [askCitations, setAskCitations] = useState<string[]>([])
  const [askNotFound, setAskNotFound] = useState(false)
  const [targetLanguage, setTargetLanguage] = useState('zh-CN')
  const [translationView, setTranslationView] = useState<TranslationView>('translation-only')
  const [translation, setTranslation] = useState('')
  const askStream = useStreamingChat()
  const [cache, setCache] = useState<TranslationCacheEntry[]>([])
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)
  const [position, setPosition] = useState<PanelPosition>({ x: null, y: PANEL_EDGE_GAP })

  function clampPosition(x: number, y: number): PanelPosition {
    const panel = panelRef.current
    const container = panel?.offsetParent as HTMLElement | null
    if (!panel || !container) return { x, y }
    return {
      x: Math.max(PANEL_EDGE_GAP, Math.min(x, container.clientWidth - panel.offsetWidth - PANEL_EDGE_GAP)),
      y: Math.max(PANEL_EDGE_GAP, Math.min(y, container.clientHeight - panel.offsetHeight - PANEL_EDGE_GAP)),
    }
  }

  function startDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea')) return
    if (nativeWindow) {
      event.preventDefault()
      void getCurrentWindow().startDragging()
      return
    }
    const panel = panelRef.current
    const container = panel?.offsetParent as HTMLElement | null
    if (!panel || !container || container.classList.contains('has-native-ai-panel')) return
    const panelRect = panel.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    }
    setPosition({ x: panelRect.left - containerRect.left, y: panelRect.top - containerRect.top })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function dragPanel(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    const container = panelRef.current?.offsetParent as HTMLElement | null
    if (!drag || drag.pointerId !== event.pointerId || !container) return
    const containerRect = container.getBoundingClientRect()
    setPosition(clampPosition(
      event.clientX - containerRect.left - drag.offsetX,
      event.clientY - containerRect.top - drag.offsetY,
    ))
  }

  function stopDragging(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  useEffect(() => {
    const panel = panelRef.current
    const container = panel?.offsetParent as HTMLElement | null
    if (!panel || !container) return
    const observer = new ResizeObserver(() => {
      setPosition(current => current.x === null ? current : clampPosition(current.x, current.y))
    })
    observer.observe(container)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void listAIProviders().then(list => {
      setProviders(list)
      setProviderId(prev => prev ?? list[0]?.id ?? null)
    }).catch(() => { /* non-Tauri fallback */ })
  }, [])

  useEffect(() => {
    setSummary(''); setError(null); setAskAnswer(''); setAskCitations([]); setAskNotFound(false); setQuestion(''); setTranslation('')
  }, [currentUrl, mode])

  useEffect(() => {
    if (!initialQuestion.trim()) return
    setMode('ask')
    setQuestion(initialQuestion.trim())
  }, [initialQuestion])

  useEffect(() => {
    if (initialMode) setMode(initialMode)
    if (initialMode === 'translate') {
      const source = translationSource.trim() || article?.markdown || ''
      setTargetLanguage(detectTranslationTarget(source))
    }
  }, [initialMode, translationSource, article?.markdown])

  useEffect(() => {
    void getSession('ai.translations').then(raw => {
      if (!raw) { setCache([]); return }
      try {
        const parsed = JSON.parse(raw) as TranslationCacheEntry[]
        if (Array.isArray(parsed)) setCache(parsed.slice(0, 50))
      } catch { setCache([]) }
    })
  }, [])

  const passages = useMemo(() => article ? numberPassages(article.markdown ?? '') : [], [article])

  async function generateSummary() {
    if (!providerId) { setError(t("\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 AI Provider\u300D\u4E2D\u914D\u7F6E\u4E00\u4E2A Provider\u3002"));return}
    const markdown = (translationSource || article?.markdown || '').trim()
    if (!markdown) { setError(t("\u6682\u65F6\u65E0\u6CD5\u63D0\u53D6\u5F53\u524D\u9875\u9762\u6B63\u6587\u3002"));return}
    setBusy(true); setError(null); setSummary('')
    try {
      const request = buildSummaryPrompt(markdown, kind, article?.title || currentUrl)
      const response = await aiChat(providerId, request)
      setSummary(response.content)
    } catch (caught) { setError(caught instanceof Error ? caught.message :t("\u751F\u6210\u6458\u8981\u5931\u8D25"))}
    finally { setBusy(false) }
  }

  async function askQuestion() {
    if (!providerId) { setError(t("\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 AI Provider\u300D\u4E2D\u914D\u7F6E\u4E00\u4E2A Provider\u3002"));return}
    const markdown = article?.markdown?.trim()
    const trimmed = question.trim()
    if (!markdown) { setError(t("\u6682\u65F6\u65E0\u6CD5\u63D0\u53D6\u5F53\u524D\u9875\u9762\u6B63\u6587\u3002"));return}
    if (!trimmed) { setError(t("\u8BF7\u8F93\u5165\u95EE\u9898\u3002"));return}
    setBusy(true); setError(null); setAskAnswer(''); setAskCitations([]); setAskNotFound(false)
    try {
      const request = buildAskPrompt(markdown, trimmed, article?.title || currentUrl)
      const result = await askStream.start(providerId, request)
      const parsed = parseAnswer(result.content)
      setAskAnswer(parsed.answer)
      setAskCitations(parsed.citations)
      setAskNotFound(parsed.notFound)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message :t("\u56DE\u7B54\u5931\u8D25")
      if (message !== 'cancelled') setError(message)
    }
    finally { setBusy(false) }
  }

  async function translateArticle() {
    if (!providerId) { setError(t("\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 AI Provider\u300D\u4E2D\u914D\u7F6E\u4E00\u4E2A Provider\u3002"));return}
    const markdown = article?.markdown?.trim()
    if (!markdown) { setError(t("\u6682\u65F6\u65E0\u6CD5\u63D0\u53D6\u5F53\u524D\u9875\u9762\u6B63\u6587\u3002"));return}
    const input = { markdown, targetLanguage, view: translationView }
    const key = translationKey(input)
    const hit = cache.find(entry => entry.key === key)
    if (hit) { setTranslation(hit.content); return }
    setBusy(true); setError(null); setTranslation('')
    try {
      const request = buildTranslatePrompt(input)
      const response = await aiChat(providerId, request)
      const content = response.content
      const next = [{ key, content }, ...cache.filter(entry => entry.key !== key)].slice(0, 50)
      setCache(next)
      void setSession('ai.translations', JSON.stringify(next))
      setTranslation(content)
    } catch (caught) { setError(caught instanceof Error ? caught.message :t("\u7FFB\u8BD1\u5931\u8D25"))}
    finally { setBusy(false) }
  }

  async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); messageApi.success(t("\u5DF2\u590D\u5236"))}
    catch { messageApi.error(t("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u6D4F\u89C8\u5668\u6743\u9650"))}
  }

  async function saveAsDocumentSummary() {
    if (!summary) return
    try {
      const document = await findDocumentByUrl(currentUrl)
      if (!document) { messageApi.warning(t("\u8BF7\u5148\u4FDD\u5B58\u7F51\u9875\u5230\u77E5\u8BC6\u5E93\uFF0C\u518D\u5199\u5165\u6458\u8981"));return}
      await updateDocument(document.id, { summary })
      messageApi.success(t("\u6458\u8981\u5DF2\u5199\u5165\u6587\u6863"))
    } catch (caught) { messageApi.error(caught instanceof Error ? caught.message :t("\u4FDD\u5B58\u5931\u8D25"))}
  }

  const currentProvider = providers.find(item => item.id === providerId)
  const noProvider = providers.length === 0
  const noArticle = !article?.markdown?.trim()
  const noTranslationSource = !(translationSource || article?.markdown || '').trim()

  return <>{contextHolder}<aside
    ref={panelRef}
    className="ai-panel"
    style={position.x === null ? { right: PANEL_EDGE_GAP, top: position.y } : { left: position.x, top: position.y }}
  >
    <div
      className="panel-title ai-panel__drag-handle"
      onPointerDown={startDragging}
      onPointerMove={dragPanel}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      title={t("\u62D6\u62FD\u79FB\u52A8 AI \u52A9\u624B")}
    ><div className="ai-panel__heading"><span className="ai-mark"><RobotOutlined/></span><span><b>AI Assistant</b><small>{t("\u9605\u8BFB\u3001\u63D0\u95EE\u4E0E\u7FFB\u8BD1")}</small></span></div><Button type="text"aria-label={t("\u5173\u95ED AI \u52A9\u624B")}icon={<CloseOutlined/>}onClick={close}/></div>
    <Segmented className="ai-panel__modes" block value={mode} onChange={value => setMode(value as PanelMode)} options={[
      {label:t("\u6458\u8981"),value:'summarize'as PanelMode},
      {label:t("\u63D0\u95EE"),value:'ask'as PanelMode},
      {label:t("\u7FFB\u8BD1"),value:'translate'as PanelMode},
    ]}/>
    <Space wrap className="ai-panel__provider">
      <Tag icon={<RobotOutlined/>} color={currentProvider ? 'green' : 'default'}>
        {currentProvider ? `${currentProvider.type ||t("OpenAI \u517C\u5BB9")} · ${currentProvider.model||t("\u672A\u8BBE\u7F6E\u6A21\u578B")}`:t("\u672A\u914D\u7F6E Provider")}
      </Tag>
      {providers.length > 1 && <Select<string> size="small" value={providerId ?? undefined} onChange={setProviderId} options={providers.map(        (item                            )=>({label:item.model,value:item.id}))}style={{minWidth:160}}/>}
    </Space>
    <Card size="small" className="context-card">
      {article
        ? <><GlobalOutlined/> {isPdfContext ?t("PDF \u6587\u672C"):t("\u9875\u9762\u6B63\u6587")} · {article.wordCount} {t("\u5B57")}<Tag color="success">{t("\u5C31\u7EEA")}</Tag></>
        : isPdfContext
          ? <><GlobalOutlined/> {t("PDF \u6587\u672C")}<Tag>{pdfContextError||t("\u6B63\u5728\u63D0\u53D6")}</Tag></>
          : <><GlobalOutlined/> {t("\u5F53\u524D\u9875\u9762")}<Tag>{pageContextPending?t("\u6B63\u5728\u63D0\u53D6\u6B63\u6587"):pageContextError||t("\u65E0\u6CD5\u63D0\u53D6\u6B63\u6587")}</Tag></>}
    </Card>

    {mode === 'summarize' &&(
      <>
        <Segmented className="ai-panel__summary-kind" block value={kind} onChange={value => setKind(value as SummaryKind)} options={[
          {label:t("\u4E00\u53E5\u8BDD"),value:'one-sentence'},
          {label:t("\u7B80\u77ED"),value:'short'},
          {label:t("\u8BE6\u7EC6"),value:'detailed'},
          {label:t("\u89C2\u70B9"),value:'key-points'},
        ]}/>
        <Space orientation="vertical" className="panel-actions">
          <Button block icon={<ThunderboltOutlined/>} onClick={() => void generateSummary()} loading={busy} disabled={noProvider || noArticle}>{t("\u751F\u6210")} {summaryKindLabel(kind)}</Button>
          <Button block icon={<CopyOutlined/>} onClick={() => void copyText(summary)} disabled={!summary}>{t("\u590D\u5236\u6458\u8981")}</Button>
          <Button block icon={<ThunderboltOutlined/>} onClick={() => void generateSummary()} disabled={busy || noProvider || !summary}>{t("\u91CD\u65B0\u751F\u6210")}</Button>
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && summary && <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{summary}</Typography.Paragraph>}
          {!busy && !error && !summary && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u751F\u6210\u7ED3\u679C\u5C06\u51FA\u73B0\u5728\u8FD9\u91CC")}/>}
        </Card>
        <Space orientation="vertical" style={{width:'100%'}}>
          <Button block icon={<SaveOutlined/>} onClick={() => void saveAsDocumentSummary()} disabled={!summary}>{t("\u628A\u6458\u8981\u5199\u56DE\u6587\u6863")}</Button>
          <Button block onClick={() => void saveToLibrary()}>{t("\u4FDD\u5B58\u5230\u77E5\u8BC6\u5E93")}</Button>
        </Space>
      </>)
     }

    {mode === 'ask' &&(
      <>
        <Space orientation="vertical" className="panel-actions" style={{width:'100%'}}>
          <Input.TextArea autoSize={{minRows:2,maxRows:4}} value={question} onChange={event => setQuestion(event.target.value)} placeholder={t("\u5411\u5F53\u524D\u9875\u9762\u63D0\u95EE\u2026")}disabled={busy}/>
          {askStream.status === 'streaming'
            ? <Button block danger icon={<StopOutlined/>} onClick={() => askStream.cancel()}>{t("\u505C\u6B62\u751F\u6210")}</Button>
            : <Button block type="primary" icon={<ArrowRightOutlined/>} onClick={() => void askQuestion()} loading={busy} disabled={noProvider || noArticle || !question.trim()}>{t("\u63D0\u95EE")}</Button>}
          {askStream.status === 'failed' && askStream.retryable &&(
            <Alert type="warning" showIcon message={t("\u4E0A\u6B21\u5931\u8D25\uFF1A{value0}",{value0:askStream.errorMessage??''})}description={t("\u7F51\u7EDC\u6216\u670D\u52A1\u7AEF\u6682\u65F6\u4E0D\u53EF\u7528\uFF0C\u53EF\u91CD\u65B0\u63D0\u4EA4\u4EE5\u89E6\u53D1\u81EA\u52A8\u91CD\u8BD5\u3002")}/>)
           }
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && askAnswer &&(
            <>
              {askNotFound
                ? <Alert type="info" message={askAnswer}/>
                : <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{askAnswer}</Typography.Paragraph>}
              {!askNotFound && askCitations.length > 0 &&(
                <Space wrap style={{marginTop:8}}>
                  <Typography.Text type="secondary">{t("\u5F15\u7528\uFF1A")}</Typography.Text>
                  {askCitations.map(id => {
                    const passage = passageById(passages, id)
                    return <Tag key={id} className="ai-citation" onClick={() => passage && void copyText(passage.text)} title={passage ?t("\u70B9\u51FB\u590D\u5236\u6BB5\u843D\u539F\u6587"):t("\u672A\u627E\u5230\u6BB5\u843D")}>{id}</Tag>
                  })}
                </Space>)
               }
            </>)
           }
          {!busy && !error && !askAnswer && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u56DE\u7B54\u5C06\u51FA\u73B0\u5728\u8FD9\u91CC")}/>}
        </Card>
      </>)
     }

    {mode === 'translate' &&(
      <>
        <Space wrap>
          <Select<string> size="small" value={targetLanguage} onChange={setTargetLanguage} options={TRANSLATION_LANGUAGES} style={{minWidth:160}}/>
          <Segmented size="small" value={translationView} onChange={value => setTranslationView(value as TranslationView)} options={[
            {label:TRANSLATION_VIEW_LABEL['translation-only'],value:'translation-only'},
            {label:TRANSLATION_VIEW_LABEL.bilingual,value:'bilingual'},
          ]}/>
        </Space>
        <Space orientation="vertical" className="panel-actions" style={{width:'100%'}}>
          <Button block type="primary" icon={<TranslationOutlined/>} onClick={() => void translateArticle()} loading={busy} disabled={noProvider || noTranslationSource}>{t("\u7FFB\u8BD1")}{translationSource?t("\u9009\u4E2D\u5185\u5BB9"):t("\u5F53\u524D\u9875\u9762")}</Button>
          <Button block icon={<CopyOutlined/>} onClick={() => void copyText(translation)} disabled={!translation}>{t("\u590D\u5236\u8BD1\u6587")}</Button>
        </Space>
        <Card className="ai-result" size="small">
          {busy && <Spin/>}
          {error && <Alert type="error" message={error}/>}
          {!busy && !error && translation && <Typography.Paragraph style={{whiteSpace:'pre-wrap'}}>{translation}</Typography.Paragraph>}
          {!busy && !error && !translation && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u8BD1\u6587\u5C06\u51FA\u73B0\u5728\u8FD9\u91CC")}/>}
        </Card>
        {cache.length > 0 && <Typography.Text type="secondary" style={{fontSize:12}}>{t("\u7F13\u5B58")} {cache.length} {t("\u6761\u5386\u53F2\u7FFB\u8BD1")}</Typography.Text>}
      </>)
     }
  </aside></>
}
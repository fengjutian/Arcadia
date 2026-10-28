import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  List,
  message,
  Popconfirm,
  Space,
  Spin,
  Tag,
} from '../../components/ui'
import {
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  WarningOutlined,
} from '../../components/ui/icons'
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PageHeader } from '../../shared/components/PageHeader'
import { aiChat, aiEmbed, getSession, listAIProviders, listDocuments, ragAnswer, searchDocuments, searchSimilarEmbeddings, setSession } from '../../api'
import type { RagQuery } from '../../api'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { buildCrossAskPrompt, citationIdsInRequest, parseCrossAnswer } from '../../features/ai/crossAsk'
import type { AIProvider, Document, View } from '../../types'
import { compactChatHistory, restoreConversation } from '../../features/ai/conversation'
import { reciprocalRankFusion, stripSourceBlocks, validateAnswerCitations } from '../../features/ai/rag'
import { applyReranker, rrfReranker } from '../../features/ai/reranker'
import { defaultAgentDeps, runResearchAgent } from '../../features/ai/agentLoop'
import { listAgentRuns, type AgentRun } from '../../api'
import { AgentRunHistory } from '../../features/ai/AgentRunHistory'

const CONVERSATION_KEY = 'ai.conversation.v1'

const SUGGESTED_PROMPTS = [
  { title: '总结我最近保存的内容', hint: '提炼最近资料里的关键结论', icon: <FileTextOutlined /> },
  { title: '比较这些来源的核心观点', hint: '找出共识、分歧与证据', icon: <BookOutlined /> },
  { title: '从已保存资料生成研究简报', hint: '整理成结构化速览', icon: <SearchOutlined /> },
]

interface UserTurn {
  id: string
  role: 'user'
  content: string
}

interface AssistantTurn {
  id: string
  role: 'assistant'
  content: string
  /** 1-based indexes persisted by the legacy `[doc-N]` answer format. */
  docIds?: number[]
  /** Real ids returned by the RAG pipeline, preferred over `docIds`. */
  documentIds?: string[]
  notFound: boolean
  pending: boolean
  interrupted?: boolean
  error?: string
}

type Turn = UserTurn | AssistantTurn
type AssistantPatch = Partial<Omit<AssistantTurn, 'id' | 'role'>>

/** Keep in-app navigation intact: answer links open as a normal browser tab. */
function AssistantMarkdownLink({ href, children, node: _node, onClick, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  return (
    <a
      {...props}
      href={href}
      onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault()
        if (/^https?:\/\//i.test(href)) {
          window.dispatchEvent(new CustomEvent('arcadia-browser-open-url', { detail: { url: href } }))
        }
      }}
    >
      {children}
    </a>
  )
}

const MARKDOWN_COMPONENTS = { a: AssistantMarkdownLink }

export function AssistantPage({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [conversationHydrated, setConversationHydrated] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [copiedTurnId, setCopiedTurnId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    void listDocuments()
      .then(items => setDocuments(items.filter(item => item.status !== 'ARCHIVED')))
      .catch(() => setDocuments([]))
    void listAIProviders()
      .then(items => {
        setProviders(items)
        setProviderId(prev => prev ?? items[0]?.id ?? null)
      })
      .catch(() => { /* non-Tauri fallback */ })
    void getSession(CONVERSATION_KEY).then(raw => {
      setTurns(restoreConversation(raw).map(turn => turn.role === 'user'
        ? { id:turn.id, role:'user', content:turn.content }
        : {
            id:turn.id,
            role:'assistant',
            content:turn.content,
            docIds:turn.docIds,
            documentIds:turn.documentIds,
            notFound:turn.notFound === true,
            pending:turn.pending === true,
            interrupted:turn.interrupted === true,
            error:turn.error,
          }))
    }).catch(() => setTurns([])).finally(() => setConversationHydrated(true))
  }, [])

  useEffect(() => {
    if (!conversationHydrated) return
    const stored = turns.map(turn => turn.role === 'user'
      ? { id:turn.id, role:turn.role, content:turn.content }
      : {
          id:turn.id,
          role:turn.role,
          content:turn.content,
          docIds:turn.docIds,
          documentIds:turn.documentIds,
          notFound:turn.notFound,
          interrupted:turn.interrupted,
          error:turn.error,
          pending:turn.pending,
        })
    void setSession(CONVERSATION_KEY, JSON.stringify(stored)).catch(() => undefined)
  }, [turns, conversationHydrated])

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const frame = window.requestAnimationFrame(() => { node.scrollTop = node.scrollHeight })
    return () => window.cancelAnimationFrame(frame)
  }, [turns])

  const documentsById = useMemo(() => new Map(documents.map(doc => [doc.id, doc])), [documents])

  const citedDocIds = useMemo(() => {
    const ids = new Set<string>()
    turns.forEach(turn => {
      if (turn.role !== 'assistant') return
      turn.documentIds?.forEach(id => { if (documentsById.has(id)) ids.add(id) })
      turn.docIds?.forEach(index => {
        const doc = documents[index - 1]
        if (doc) ids.add(doc.id)
      })
    })
    return ids
  }, [turns, documents, documentsById])

  const sourceItems = citedDocIds.size > 0
    ? documents.filter(doc => citedDocIds.has(doc.id))
    : documents

  const roundCount = turns.filter(turn => turn.role === 'user').length
  const activeProvider = providers.find(item => item.id === providerId)
  const noProvider = providers.length === 0
  const noDocuments = documents.length === 0
  const canAsk = conversationHydrated && !noProvider && !noDocuments && question.trim().length > 0
  const placeholder = !conversationHydrated
    ? '正在恢复对话…'
    : noDocuments
      ? '知识库中暂无真实数据'
      : noProvider
        ? '请先在「设置 → AI Provider」中配置'
        : '继续追问，或换一个角度提问…'

  function patchTurn(id: string, patch: AssistantPatch) {
    setTurns(current => current.map(turn => (
      turn.id === id && turn.role === 'assistant' ? { ...turn, ...patch } : turn
    )))
  }

  function resolveCitedDocs(turn: AssistantTurn): Document[] {
    const ids = new Set<string>()
    turn.documentIds?.forEach(id => ids.add(id))
    turn.docIds?.forEach(index => {
      const doc = documents[index - 1]
      if (doc) ids.add(doc.id)
    })
    return Array.from(ids)
      .map(id => documentsById.get(id))
      .filter((doc): doc is Document => Boolean(doc))
  }

  async function generateAnswer(prompt: string, pendingId: string, historyTurns: readonly Turn[]) {
    if (!providerId || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    patchTurn(pendingId, {
      content: '',
      pending: true,
      interrupted: false,
      error: undefined,
      notFound: false,
      docIds: undefined,
      documentIds: undefined,
    })

    try {
      const history = compactChatHistory(historyTurns
        .filter(turn => turn.role === 'user' || (!turn.pending && !turn.interrupted && !turn.error && !turn.notFound))
        .filter(turn => turn.content.trim().length > 0)
        .map(turn => ({
          role: turn.role as 'user' | 'assistant',
          content: turn.role === 'assistant' ? stripSourceBlocks(turn.content) : turn.content,
        })), 12_000)
      const provider = providers.find(item => item.id === providerId)

      // Prefer the Rust `rag_answer` pipeline: it builds the evidence pack,
      // calls the model, validates citations, and applies one repair pass on
      // the Rust side.
      const ragQuery: RagQuery = {
        query: prompt,
        topK: 8,
        candidateK: 16,
        documentIds: undefined,
        collectionIds: undefined,
        tags: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        includeArchived: false,
        retrievalMode: provider?.embeddingModel ? 'hybrid' : 'lexical',
        rerank: !!provider?.embeddingModel,
        providerId,
        embeddingModel: provider?.embeddingModel ?? undefined,
        embeddingVersion: undefined,
        chunkerVersion: undefined,
        dimensions: undefined,
      }
      const rag = await ragAnswer(providerId, ragQuery, { temperature: 0.2, maxTokens: 1024 })
      if (rag) {
        const status = rag.citationStatus
        const usable = status === 'valid' || status === 'notRequired' || status === 'partial'
        if (usable) {
          patchTurn(pendingId, {
            content: rag.answer,
            documentIds: Array.from(new Set(rag.citations.map(citation => citation.documentId).filter(Boolean))),
            docIds: undefined,
            notFound: status === 'notRequired',
            pending: false,
          })
          return
        }
        // fall through to the legacy path for `invalid`
      }

      // Fallback: legacy local-RAG path used when `ragAnswer` is unavailable
      // (no Tauri, embedding model missing, or answer is invalid). Kept so
      // the page still works in browser-only mode.
      let rankedDocumentIds: string[] | undefined
      if (provider?.embeddingModel) {
        const [queryVector] = await aiEmbed(providerId, [prompt])
        const [keyword, vector] = await Promise.all([
          searchDocuments(prompt),
          searchSimilarEmbeddings(provider.embeddingModel, queryVector, 16),
        ])
        const fused = await applyReranker(rrfReranker, prompt, reciprocalRankFusion(
          keyword.map((item, index) => ({ documentId:item.id, chunkIndex:0, excerpt:item.markdownSnippet ?? item.summary ?? '', score:1 / (index + 1) })),
          vector.map(item => ({ documentId:item.documentId, chunkIndex:item.chunkIndex, excerpt:item.excerpt, score:item.similarity })),
          { limit:8, maxChunksPerDocument:3 },
        ), 8)
        rankedDocumentIds = fused.map(item => item.documentId)
      }
      const request = buildCrossAskPrompt(
        documents,
        prompt,
        history.map(entry => ({ role: entry.role as 'user' | 'assistant', content: entry.content })),
        { topK: 8, rankedDocumentIds },
      )
      const response = await aiChat(providerId, request)
      const parsed = parseCrossAnswer(response.content)
      const validation = validateAnswerCitations(parsed.answer, citationIdsInRequest(request))
      if (!parsed.notFound && !validation.valid) throw new Error('模型回答未通过引用校验，请重试')
      patchTurn(pendingId, {
        content: parsed.answer,
        documentIds: parsed.docIds
          .map(index => documents[index - 1]?.id)
          .filter((id): id is string => Boolean(id)),
        docIds: undefined,
        notFound: parsed.notFound,
        pending: false,
      })
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : '提问失败'
      patchTurn(pendingId, {
        content: errorMessage,
        pending: false,
        interrupted: false,
        error: errorMessage,
      })
      messageApi.error(errorMessage)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function submitQuestion(raw: string) {
    const trimmed = raw.trim()
    if (!conversationHydrated || !providerId || !trimmed || busyRef.current || agentBusy) return
    const now = Date.now()
    const userTurn: UserTurn = { id: `u-${now}`, role: 'user', content: trimmed }
    const pendingTurn: AssistantTurn = {
      id: `a-${now}`,
      role: 'assistant',
      content: '',
      notFound: false,
      pending: true,
    }
    const history = turns
    setTurns(current => [...current, userTurn, pendingTurn])
    setQuestion('')
    await generateAnswer(trimmed, pendingTurn.id, history)
  }

  async function retryTurn(turn: AssistantTurn) {
    if (busyRef.current || agentBusy) return
    const index = turns.findIndex(item => item.id === turn.id)
    if (index < 0) return
    let userIndex = -1
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (turns[cursor].role === 'user') {
        userIndex = cursor
        break
      }
    }
    if (userIndex < 0) return
    const prompt = turns[userIndex].content
    await generateAnswer(prompt, turn.id, turns.slice(0, userIndex))
  }

  async function openAgent() {
    setAgentOpen(true)
    await listAgentRuns(20).then(setAgentRuns).catch(() => setAgentRuns([]))
  }

  /** Run the bounded research agent and surface its answer as a normal turn. */
  async function runAgent() {
    const trimmed = question.trim()
    if (!providerId || !trimmed || busyRef.current || agentBusy) return
    busyRef.current = true
    setAgentBusy(true)
    const now = Date.now()
    const userTurn: UserTurn = { id:`u-${now}`, role:'user', content:trimmed }
    const pendingTurn: AssistantTurn = {
      id:`a-${now}`,
      role:'assistant',
      content:'',
      notFound:false,
      pending:true,
    }
    setTurns(current => [...current, userTurn, pendingTurn])
    setQuestion('')
    try {
      const result = await runResearchAgent(defaultAgentDeps, trimmed, { providerId })
      const content = result.stopped && !result.answer
        ? `研究未完成：${result.stopped.message}`
        : result.stopped
          ? `${result.answer}\n\n（已中止：${result.stopped.message}）`
          : result.answer
      patchTurn(pendingTurn.id, { content, pending:false })
      await listAgentRuns(20).then(setAgentRuns).catch(() => undefined)
    } catch (caught) {
      const text = caught instanceof Error ? caught.message : '研究失败'
      patchTurn(pendingTurn.id, { content:text, pending:false, error:text })
      messageApi.error(text)
    } finally {
      busyRef.current = false
      setAgentBusy(false)
    }
  }

  function applySuggestion(text: string) {
    setQuestion(text)
    window.requestAnimationFrame(() => document.getElementById('assistant-question')?.focus())
  }

  function clearConversation() {
    if (busyRef.current) return
    setTurns([])
  }

  function goToProviderSettings() {
    onNavigate?.('settings')
  }

  async function copyAnswer(turn: AssistantTurn) {
    const text = stripSourceBlocks(turn.content)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedTurnId(turn.id)
      window.setTimeout(() => setCopiedTurnId(current => current === turn.id ? null : current), 1600)
      messageApi.success('回答已复制')
    } catch {
      messageApi.error('复制失败，请检查剪贴板权限')
    }
  }

  function renderConversation() {
    if (!conversationHydrated) {
      return <div className="assistant-thread-loading"><Spin size="small"/><span>正在恢复对话…</span></div>
    }
    if (turns.length === 0) {
      return (
        <div className="assistant-empty">
          <span className="assistant-empty__icon"><RobotOutlined/></span>
          <h2>{noDocuments ? '知识库还是空的' : '从一个好问题开始'}</h2>
          <p>
            {noDocuments
              ? '请先在浏览器中保存网页，再基于真实资料提问。'
              : `我会在已保存的 ${documents.length} 篇资料中检索，并标注引用来源。`}
          </p>
          {!noDocuments && (
            <div className="assistant-suggestions">
              {SUGGESTED_PROMPTS.map(item => (
                <button
                  key={item.title}
                  type="button"
                  className="assistant-suggestion"
                  disabled={noProvider}
                  onClick={() => applySuggestion(item.title)}
                >
                  <span className="assistant-suggestion__icon">{item.icon}</span>
                  <span className="assistant-suggestion__copy">
                    <b>{item.title}</b>
                    <small>{item.hint}</small>
                  </span>
                  <ArrowRightOutlined className="assistant-suggestion__arrow"/>
                </button>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="assistant-thread" role="log" aria-live="polite" aria-label="知识库对话">
        {turns.map(turn => {
          if (turn.role === 'user') {
            return (
              <div className="assistant-message assistant-message--user" key={turn.id}>
                <div className="assistant-message__body">
                  <div className="assistant-bubble assistant-bubble--user">{turn.content}</div>
                </div>
                <span className="assistant-avatar assistant-avatar--user" aria-hidden="true"><UserOutlined/></span>
              </div>
            )
          }

          const cited = resolveCitedDocs(turn)
          const answer = stripSourceBlocks(turn.content)
          const noticeOnly = !turn.pending && (Boolean(turn.error) || turn.notFound || (turn.interrupted === true && !answer))
          return (
            <div className={`assistant-message assistant-message--assistant${turn.pending ? ' is-pending' : ''}`} key={turn.id}>
              <span className="assistant-avatar assistant-avatar--bot" aria-hidden="true"><RobotOutlined/></span>
              <div className="assistant-message__body">
                <div className="assistant-message__meta">
                  <span className="assistant-message__author">知识助手</span>
                  {turn.pending && <span className="assistant-message__status">正在生成</span>}
                  {turn.interrupted && <span className="assistant-message__status is-interrupted">已中断</span>}
                </div>
                <div className={`assistant-bubble assistant-bubble--assistant${turn.pending ? ' is-pending' : ''}${noticeOnly ? ' is-notice' : ''}`}>
                  {turn.pending ? (
                    <>
                      <div className="assistant-thinking">
                        <span className="assistant-thinking__dots" aria-hidden="true"><i/><i/><i/></span>
                        <span>正在检索 {documents.length} 篇资料并生成回答…</span>
                      </div>
                      <div className="assistant-thinking__skeleton" aria-hidden="true"><span/><span/></div>
                    </>
                  ) : turn.error ? (
                    <div className="assistant-notice assistant-notice--error">
                      <span className="assistant-notice__icon"><WarningOutlined/></span>
                      <div className="assistant-notice__body">
                        <strong>生成失败</strong>
                        <p>{turn.error}</p>
                      </div>
                      <Button
                        size="small"
                        icon={<ReloadOutlined/>}
                        disabled={busy || agentBusy}
                        onClick={() => void retryTurn(turn)}
                      >
                        重试
                      </Button>
                    </div>
                  ) : turn.interrupted ? (
                    <>
                      {answer && (
                        <div className="assistant-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{answer}</ReactMarkdown>
                        </div>
                      )}
                      <div className="assistant-notice assistant-notice--interrupted">
                        <span className="assistant-notice__icon"><ClockCircleOutlined/></span>
                        <div className="assistant-notice__body">
                          <strong>回答在应用重新加载时中断</strong>
                          <p>这次生成没有完成，可以重新生成同一条回答。</p>
                        </div>
                        <Button
                          size="small"
                          icon={<ReloadOutlined/>}
                          disabled={busy || agentBusy}
                          onClick={() => void retryTurn(turn)}
                        >
                          重新生成
                        </Button>
                      </div>
                    </>
                  ) : turn.notFound ? (
                    <div className="assistant-notice assistant-notice--empty">
                      <span className="assistant-notice__icon"><SearchOutlined/></span>
                      <div className="assistant-notice__body">
                        <strong>资料中暂未找到答案</strong>
                        <p>{answer || '试试换一个问法，或再保存一些相关资料。'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="assistant-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{answer}</ReactMarkdown>
                    </div>
                  )}
                </div>

                {!turn.pending && !turn.error && cited.length > 0 && (
                  <div className="assistant-citations">
                    <span className="assistant-citations__label">引用</span>
                    {cited.map((doc, index) => (
                      <button
                        type="button"
                        className="assistant-citation"
                        key={doc.id}
                        title={`打开：${doc.title}`}
                        onClick={() => setSelectedDoc(doc)}
                      >
                        <span className="assistant-citation__index">{index + 1}</span>
                        <span className="assistant-citation__title">{doc.title}</span>
                      </button>
                    ))}
                  </div>
                )}

                {!turn.pending && !turn.error && !turn.notFound && !turn.interrupted && answer && (
                  <div className="assistant-response-actions">
                    <button type="button" onClick={() => void copyAnswer(turn)} title="复制回答">
                      {copiedTurnId === turn.id ? <CheckCircleOutlined/> : <CopyOutlined/>}
                      <span>{copiedTurnId === turn.id ? '已复制' : '复制'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void retryTurn(turn)}
                      disabled={busy || agentBusy}
                      title="重新生成这条回答"
                    >
                      <ReloadOutlined/>
                      <span>重新生成</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      {contextHolder}
      <section className="page assistant-page">
        <PageHeader
          eyebrow="KNOWLEDGE ASSISTANT"
          title="向整个知识库提问"
          description={`基于 ${documents.length} 篇已保存资料回答问题，并标注引用来源${noProvider ? ' · 未配置 AI Provider' : ''}。`}
        />
        {noProvider && (
          <Alert
            className="assistant-provider-alert"
            type="warning"
            showIcon
            message="尚未配置 AI Provider"
            description="请在“设置 → AI Provider”中添加 OpenAI 兼容或 Ollama 服务。"
            action={onNavigate ? <Button size="small" type="primary" icon={<SettingOutlined />} onClick={goToProviderSettings}>去设置</Button> : undefined}
          />
        )}
        <div className="assistant-grid">
          <Card
            className="assistant-chat"
            title={
              <div className="assistant-chat__title">
                <span>对话</span>
                {roundCount > 0 && (
                  <span className="assistant-chat__summary">
                    {roundCount} 轮{citedDocIds.size > 0 ? ` · ${citedDocIds.size} 篇引用` : ''}
                  </span>
                )}
              </div>
            }
            extra={
              <Space size={6} wrap>
                <Button size="small" icon={<RobotOutlined />} onClick={() => void openAgent()}>
                  Agent 运行历史
                </Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setSourcesOpen(true)}>
                  {citedDocIds.size > 0 ? `引用 ${citedDocIds.size}` : `来源 ${documents.length}`}
                </Button>
                {turns.length > 0 && (
                  <Popconfirm
                    title="清空当前对话？"
                    description="对话记录将从本机删除，且无法恢复。"
                    okText="清空"
                    okButtonProps={{ danger: true }}
                    disabled={busy || agentBusy}
                    onConfirm={clearConversation}
                  >
                    <Button size="small" type="text" danger disabled={busy || agentBusy}>清空</Button>
                  </Popconfirm>
                )}
              </Space>
            }
          >
            <div className="assistant-conversation" ref={listRef}>
              {renderConversation()}
            </div>

            <div className="assistant-composer">
              <div className="assistant-composer__box">
                <Input.TextArea
                  id="assistant-question"
                  className="assistant-composer__input"
                  rows={2}
                  disabled={noDocuments || !conversationHydrated}
                  value={question}
                  onChange={event => setQuestion(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      if (canAsk && !busy && !agentBusy) void submitQuestion(question)
                    }
                  }}
                  placeholder={placeholder}
                  aria-label="向知识库提问"
                />
                <div className="assistant-composer__toolbar">
                  <div className="assistant-composer__hint">
                    <span>Enter 发送 · Shift + Enter 换行</span>
                    {activeProvider && <span className="assistant-composer__model">{activeProvider.model}</span>}
                  </div>
                  <Space size={6}>
                    <Button
                      size="small"
                      icon={<RobotOutlined />}
                      loading={agentBusy}
                      disabled={!canAsk || busy || agentBusy}
                      onClick={() => void runAgent()}
                      title="用受控 Agent 循环研究这个问题"
                    >
                      深度研究
                    </Button>
                    <Button
                      type="primary"
                      shape="circle"
                      className="assistant-send"
                      icon={<ArrowUpOutlined />}
                      aria-label="发送"
                      title="发送"
                      disabled={!canAsk || busy || agentBusy}
                      loading={busy}
                      onClick={() => void submitQuestion(question)}
                    />
                  </Space>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <Drawer
          title={citedDocIds.size > 0 ? `引用来源（${citedDocIds.size}）` : `知识库来源（${documents.length}）`}
          placement="right"
          width={420}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        >
          <List
            dataSource={sourceItems}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无来源" /> }}
            renderItem={item => (
              <List.Item
                onClick={() => setSelectedDoc(item)}
                className="search-result-clickable"
                actions={citedDocIds.has(item.id) ? [<Tag key="cited" color="green">已引用</Tag>] : undefined}
              >
                <List.Item.Meta
                  avatar={<FileTextOutlined />}
                  title={item.title}
                  description={item.source || item.url}
                />
              </List.Item>
            )}
          />
        </Drawer>
        <DocumentDetailDrawer
          document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => setSelectedDoc(null)}
        />
        <Drawer
          title="Agent 运行历史"
          placement="right"
          width={460}
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
        >
          <AgentRunHistory runs={agentRuns} />
        </Drawer>
      </section>
    </>
  )
}

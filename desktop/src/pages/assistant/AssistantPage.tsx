import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  List,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
} from '../../components/ui'
import {
  ArrowRightOutlined,
  ArrowUpOutlined,
  BookOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  UserOutlined,
  WarningOutlined,
} from '../../components/ui/icons'
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AssistantRuntimeProvider,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type CompleteAttachment,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { aiChat, aiEmbed, getAssistantTask, getSession, listAIProviders, listDocuments, ragAnswer, saveDocument, searchDocuments, searchSimilarEmbeddings, setSession, startAssistantTask, type RagAnswerResponse } from '../../api'
import type { RagQuery } from '../../api'
import { DocumentDetailDrawer } from '../../features/documents/DocumentDetailDrawer'
import { buildCitationRepairPrompt, buildCrossAskPrompt, buildGeneralAnswerPrompt, citationIdsInRequest, parseCrossAnswer } from '../../features/ai/crossAsk'
import type { AIProvider, Document, View } from '../../types'
import { compactChatHistory, restoreConversation } from '../../features/ai/conversation'
import { hasUsableAnswerCitations, reciprocalRankFusion, stripModelReasoning, stripSourceBlocks, validateAnswerCitations } from '../../features/ai/rag'
import { applyReranker, rrfReranker } from '../../features/ai/reranker'
import { defaultAgentDeps, runResearchAgent } from '../../features/ai/agentLoop'
import { listAgentRuns, type AgentRun } from '../../api'
import { AgentRunHistory } from '../../features/ai/AgentRunHistory'
import { KnowledgeAttachmentAdapter } from '../../features/ai/knowledgeAttachmentAdapter'
import { filterConversations, makeConversationTitle, normalizeConversationTitle } from '../../features/ai/conversationHistory'

const CONVERSATION_KEY = 'ai.conversation.v1'
const CONVERSATION_HISTORY_KEY = 'ai.conversation.history.v1'

const SUGGESTED_PROMPTS = [
  { title: '总结我最近保存的内容', hint: '提炼最近资料里的关键结论', icon: <FileTextOutlined /> },
  { title: '比较这些来源的核心观点', hint: '找出共识、分歧与证据', icon: <BookOutlined /> },
  { title: '从已保存资料生成研究简报', hint: '整理成结构化速览', icon: <SearchOutlined /> },
]

interface UserTurn {
  id: string
  role: 'user'
  content: string
  attachments?: readonly CompleteAttachment[]
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
  /** Answer came from the model's general knowledge after local retrieval missed. */
  generalKnowledge?: boolean
  backgroundTaskId?: string
  /** Document created when this answer is explicitly saved to the knowledge base. */
  savedDocumentId?: string
}

type Turn = UserTurn | AssistantTurn
type AssistantPatch = Partial<Omit<AssistantTurn, 'id' | 'role'>>

interface SavedConversation {
  id: string
  title: string
  updatedAt: string
  turns: Turn[]
}

const KNOWLEDGE_ATTACHMENT_ADAPTER = new KnowledgeAttachmentAdapter()

function restorableTurns(turns: readonly Turn[]): Turn[] {
  return turns.map(turn => turn.role === 'user'
    ? { id: turn.id, role: 'user', content: turn.content }
    : { ...turn, pending: Boolean(turn.pending && turn.backgroundTaskId), interrupted: turn.backgroundTaskId ? turn.interrupted : turn.pending || turn.interrupted })
}

async function waitForAssistantTask(taskId: string): Promise<RagAnswerResponse> {
  let missingAttempts = 0
  for (;;) {
    const task = await getAssistantTask(taskId).catch(error => {
      // A reload can reconnect in the few milliseconds between persisting the
      // deterministic id and the backend command registering it.
      if (missingAttempts++ < 10) return null
      throw error
    })
    if (!task) {
      await new Promise(resolve => window.setTimeout(resolve, 250))
      continue
    }
    if (task.status === 'completed' && task.result) return task.result
    if (task.status === 'failed') throw new Error(task.error || '后台生成失败')
    await new Promise(resolve => window.setTimeout(resolve, 800))
  }
}

function conversationAsMarkdown(turns: readonly Turn[], documentsById: ReadonlyMap<string, Document>): string {
  const lines = ['# 知识库对话', '']
  for (const turn of turns) {
    if (turn.role === 'user') {
      lines.push('## 我', '', turn.content, '')
      continue
    }
    if (turn.pending) continue
    lines.push('## 知识助手', '', stripSourceBlocks(turn.content), '')
    const cited = (turn.documentIds ?? [])
      .map(id => documentsById.get(id))
      .filter((doc): doc is Document => Boolean(doc))
    if (cited.length > 0) {
      lines.push('引用：', ...cited.map((doc, index) => `${index + 1}. ${doc.title}${doc.url ? ` — ${doc.url}` : ''}`), '')
    }
  }
  return lines.join('\n').trimEnd()
}

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

export function AssistantPage({ onNavigate, initialQuestion = '', autoSubmit = false, embedded = false, sessionNamespace = 'default' }: { onNavigate?: (view: View) => void; initialQuestion?: string; autoSubmit?: boolean; embedded?: boolean; sessionNamespace?: string }) {
  const conversationKey = sessionNamespace === 'default' ? CONVERSATION_KEY : `${CONVERSATION_KEY}:${sessionNamespace}`
  const conversationHistoryKey = sessionNamespace === 'default' ? CONVERSATION_HISTORY_KEY : `${CONVERSATION_HISTORY_KEY}:${sessionNamespace}`
  const [messageApi, contextHolder] = message.useMessage()
  const [documents, setDocuments] = useState<Document[]>([])
  const [savingAnswerId, setSavingAnswerId] = useState<string>()
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [providerId, setProviderId] = useState<string | null>(null)
  const [question, setQuestion] = useState(initialQuestion)
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [conversationHydrated, setConversationHydrated] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState('')
  const [renamingConversation, setRenamingConversation] = useState<SavedConversation | null>(null)
  const [conversationTitleDraft, setConversationTitleDraft] = useState('')
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([])
  const [conversationHistory, setConversationHistory] = useState<SavedConversation[]>([])
  const [historyHydrated, setHistoryHydrated] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const busyRef = useRef(false)
  const conversationSaveRef = useRef<Promise<void>>(Promise.resolve())
  const autoSubmittedRef = useRef(false)

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
    void getSession(conversationKey).then(raw => {
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
            generalKnowledge:turn.generalKnowledge === true,
            backgroundTaskId:turn.backgroundTaskId,
          }))
    }).catch(() => setTurns([])).finally(() => setConversationHydrated(true))
    void getSession(conversationHistoryKey)
      .then(raw => {
        if (!raw) return
        const parsed = JSON.parse(raw) as SavedConversation[]
        if (Array.isArray(parsed)) setConversationHistory(parsed)
      })
      .catch(() => setConversationHistory([]))
      .finally(() => setHistoryHydrated(true))
  }, [conversationHistoryKey, conversationKey])

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
          generalKnowledge:turn.generalKnowledge,
          pending:turn.pending,
          backgroundTaskId:turn.backgroundTaskId,
        })
    const serialized = JSON.stringify(stored)
    conversationSaveRef.current = conversationSaveRef.current
      .catch(() => undefined)
      .then(() => setSession(conversationKey, serialized))
      .catch(() => undefined)
  }, [conversationKey, turns, conversationHydrated])

  useEffect(() => {
    if (!conversationHydrated) return
    const resumable = turns.filter((turn): turn is AssistantTurn => turn.role === 'assistant' && turn.pending && Boolean(turn.backgroundTaskId))
    resumable.forEach(turn => {
      void waitForAssistantTask(turn.backgroundTaskId!).then(rag => {
        patchTurn(turn.id, {
          content: rag.answer,
          documentIds: Array.from(new Set(rag.citations.map(citation => citation.documentId).filter(Boolean))),
          pending: false,
          interrupted: false,
          backgroundTaskId: undefined,
        })
      }).catch(caught => {
        const error = caught instanceof Error ? caught.message : String(caught)
        patchTurn(turn.id, { content: error, pending: false, error, backgroundTaskId: undefined })
      })
    })
  // Resumption is intentionally triggered only after the initial persisted conversation is loaded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationHydrated])

  useEffect(() => {
    if (!historyHydrated) return
    void setSession(conversationHistoryKey, JSON.stringify(conversationHistory)).catch(() => undefined)
  }, [conversationHistory, conversationHistoryKey, historyHydrated])

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
  const filteredConversationHistory = useMemo(
    () => filterConversations(conversationHistory, historyQuery),
    [conversationHistory, historyQuery],
  )

  const roundCount = turns.filter(turn => turn.role === 'user').length
  const activeProvider = providers.find(item => item.id === providerId)
  const noProvider = providers.length === 0
  const noDocuments = documents.length === 0
  const canAsk = conversationHydrated && !noProvider && question.trim().length > 0
  const placeholder = !conversationHydrated
    ? '正在恢复对话…'
    : noProvider
        ? '请先在「设置 → AI Provider」中配置'
        : '继续追问，或换一个角度提问…'

  const assistantRuntime = useExternalStoreRuntime<Turn>({
    messages: turns,
    isRunning: busy || agentBusy,
    isDisabled: !conversationHydrated,
    isSendDisabled: noProvider,
    convertMessage: (turn): ThreadMessageLike => ({
      id: turn.id,
      role: turn.role,
      content: turn.content,
      ...(turn.role === 'user' && turn.attachments ? { attachments: turn.attachments } : {}),
      ...(turn.role === 'assistant'
        ? {
            status: turn.pending
              ? { type: 'running' as const }
              : turn.error
                ? { type: 'incomplete' as const, reason: 'error' as const, error: turn.error }
                : turn.interrupted
                  ? { type: 'incomplete' as const, reason: 'cancelled' as const }
                  : { type: 'complete' as const, reason: 'stop' as const },
          }
        : {}),
    }),
    onNew: async (message: AppendMessage) => {
      const prompt = message.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
        .trim()
      const attachmentText = message.attachments
        ?.flatMap(attachment => attachment.content)
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n\n')
        .trim() ?? ''
      if (prompt || attachmentText) {
        await submitQuestion(prompt || '请分析附件', {
          attachments: message.attachments,
          modelPrompt: attachmentText ? `${prompt || '请分析以下附件'}\n\n${attachmentText}` : prompt,
        })
      }
    },
    setMessages: messages => setTurns([...messages]),
    adapters: { attachments: KNOWLEDGE_ATTACHMENT_ADAPTER },
    onEdit: async (message: AppendMessage) => {
      if (!message.sourceId) return
      const prompt = message.content
        .filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n')
        .trim()
      const userIndex = turns.findIndex(turn => turn.id === message.sourceId && turn.role === 'user')
      if (!prompt || userIndex < 0 || busyRef.current) return
      const pendingTurn: AssistantTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        notFound: false,
        pending: true,
      }
      const history = turns.slice(0, userIndex)
      setTurns([...history, { id: `u-${Date.now()}`, role: 'user', content: prompt }, pendingTurn])
      await generateAnswer(prompt, pendingTurn.id, history)
    },
    onReload: async parentId => {
      if (!parentId) return
      const userIndex = turns.findIndex(turn => turn.id === parentId && turn.role === 'user')
      if (userIndex < 0) return
      if (busyRef.current || agentBusy) return
      const pendingTurn: AssistantTurn = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: '',
        notFound: false,
        pending: true,
      }
      const history = turns.slice(0, userIndex)
      setTurns([...turns.slice(0, userIndex + 1), pendingTurn])
      await generateAnswer(turns[userIndex].content, pendingTurn.id, history)
    },
  })

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
      backgroundTaskId: pendingId,
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
      let rag: RagAnswerResponse | null = null
      const generalRequest = buildGeneralAnswerPrompt(
        prompt,
        history.map(entry => ({ role: entry.role as 'user' | 'assistant', content: entry.content })),
      )
      const taskId = await startAssistantTask(
        providerId,
        ragQuery,
        generalRequest,
        { temperature: 0.2, maxTokens: 1024 },
        pendingId,
      ).catch(() => null)
      if (taskId) {
        patchTurn(pendingId, { backgroundTaskId: taskId })
        rag = await waitForAssistantTask(taskId)
        patchTurn(pendingId, { backgroundTaskId: undefined })
      } else {
        rag = await ragAnswer(providerId, ragQuery, { temperature: 0.2, maxTokens: 1024 }).catch(() => null)
      }
      if (rag) {
        const status = rag.citationStatus
        if (status === 'valid' || status === 'partial') {
          patchTurn(pendingId, {
            content: rag.answer,
            documentIds: Array.from(new Set(rag.citations.map(citation => citation.documentId).filter(Boolean))),
            docIds: undefined,
            notFound: false,
            pending: false,
          })
          return
        }
        if (status === 'notRequired') {
          const general = await aiChat(providerId, buildGeneralAnswerPrompt(
            prompt,
            history.map(entry => ({ role: entry.role as 'user' | 'assistant', content: entry.content })),
          ))
          patchTurn(pendingId, {
            content: stripModelReasoning(general.content),
            documentIds: [],
            docIds: undefined,
            notFound: false,
            generalKnowledge: true,
            pending: false,
          })
          return
        }
        // fall through to the legacy path for `invalid`
      }

      // Fallback: legacy local-RAG path used when `ragAnswer` is unavailable
      // (no Tauri, embedding model missing, or answer is invalid). Kept so
      // the page still works in browser-only mode.
      // Reuse the user-facing local search index here. It includes CJK,
      // Pinyin and initials, while the chunk-level RAG FTS currently does not.
      const keywordMatches = await searchDocuments(prompt).catch(() => [])
      let rankedDocumentIds: string[] | undefined = keywordMatches.map(item => item.id)
      if (provider?.embeddingModel) {
        try {
          const [queryVector] = await aiEmbed(providerId, [prompt])
          const vector = await searchSimilarEmbeddings(provider.embeddingModel, queryVector, 16)
          const fused = await applyReranker(rrfReranker, prompt, reciprocalRankFusion(
            keywordMatches.map((item, index) => ({ documentId:item.id, chunkIndex:0, excerpt:item.markdownSnippet ?? item.summary ?? '', score:1 / (index + 1) })),
            vector.map(item => ({ documentId:item.documentId, chunkIndex:item.chunkIndex, excerpt:item.excerpt, score:item.similarity })),
            { limit:8, maxChunksPerDocument:3 },
          ), 8)
          rankedDocumentIds = fused.map(item => item.documentId)
        } catch {
          // Embeddings are an optional quality boost. Keyword/Pinyin results
          // remain a complete fallback when the embedding endpoint is absent
          // or temporarily unavailable.
        }
      }
      const request = buildCrossAskPrompt(
        documents,
        prompt,
        history.map(entry => ({ role: entry.role as 'user' | 'assistant', content: entry.content })),
        { topK: 8, rankedDocumentIds },
      )
      const response = await aiChat(providerId, request)
      let parsed = parseCrossAnswer(stripModelReasoning(response.content))
      if (parsed.notFound) {
        const general = await aiChat(providerId, buildGeneralAnswerPrompt(
          prompt,
          history.map(entry => ({ role: entry.role as 'user' | 'assistant', content: entry.content })),
        ))
        patchTurn(pendingId, {
          content: stripModelReasoning(general.content),
          documentIds: [],
          docIds: undefined,
          notFound: false,
          generalKnowledge: true,
          pending: false,
        })
        return
      }
      let validation = validateAnswerCitations(parsed.answer, citationIdsInRequest(request))
      if (!parsed.notFound && !validation.valid) {
        const repairResponse = await aiChat(providerId, buildCitationRepairPrompt(request, parsed.answer))
        parsed = parseCrossAnswer(stripModelReasoning(repairResponse.content))
        validation = validateAnswerCitations(parsed.answer, citationIdsInRequest(request))
      }
      if (!parsed.notFound && !hasUsableAnswerCitations(validation)) {
        throw new Error('模型未能按资料生成有效引用，请换一种问法或重试')
      }
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
      const errorMessage = caught instanceof Error
        ? caught.message
        : String(caught || '提问失败')
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

  async function submitQuestion(
    raw: string,
    options?: { attachments?: readonly CompleteAttachment[]; modelPrompt?: string },
  ) {
    const trimmed = raw.trim()
    if (!conversationHydrated || !providerId || !trimmed || busyRef.current || agentBusy) return
    const now = Date.now()
    const userTurn: UserTurn = {
      id: `u-${now}`,
      role: 'user',
      content: trimmed,
      attachments: options?.attachments,
    }
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
    await generateAnswer(options?.modelPrompt?.trim() || trimmed, pendingTurn.id, history)
  }

  useEffect(() => {
    if (!initialQuestion.trim() || turns.length > 0) return
    setQuestion(initialQuestion)
  }, [initialQuestion, turns.length])

  useEffect(() => {
    if (!autoSubmit || autoSubmittedRef.current || !conversationHydrated || !providerId || turns.length > 0 || !initialQuestion.trim()) return
    autoSubmittedRef.current = true
    void submitQuestion(initialQuestion)
    // Submit once after the shared conversation runtime has restored its provider and session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, conversationHydrated, initialQuestion, providerId, turns.length])

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

  function archiveCurrentConversation(excludeId?: string) {
    if (turns.length === 0) return
    const saved: SavedConversation = {
      id: `conversation-${Date.now()}`,
      title: makeConversationTitle(turns),
      updatedAt: new Date().toISOString(),
      turns: restorableTurns(turns),
    }
    setConversationHistory(current => [saved, ...current.filter(item => item.id !== excludeId)].slice(0, 50))
  }

  function startNewConversation() {
    if (busyRef.current) return
    archiveCurrentConversation()
    setTurns([])
    setQuestion('')
    window.requestAnimationFrame(() => document.getElementById('assistant-question')?.focus())
  }

  function openSavedConversation(saved: SavedConversation) {
    if (busyRef.current || agentBusy) return
    archiveCurrentConversation(saved.id)
    setConversationHistory(current => current.filter(item => item.id !== saved.id))
    setTurns(restorableTurns(saved.turns))
    setQuestion('')
    setHistoryOpen(false)
  }

  function deleteSavedConversation(id: string) {
    setConversationHistory(current => current.filter(item => item.id !== id))
  }

  function beginRenameConversation(saved: SavedConversation) {
    setRenamingConversation(saved)
    setConversationTitleDraft(saved.title)
  }

  function renameConversation() {
    if (!renamingConversation) return
    const title = normalizeConversationTitle(conversationTitleDraft)
    if (!title) return
    setConversationHistory(current => current.map(item => (
      item.id === renamingConversation.id ? { ...item, title, updatedAt: new Date().toISOString() } : item
    )))
    setRenamingConversation(null)
    setConversationTitleDraft('')
  }

  async function copyConversation() {
    const markdown = conversationAsMarkdown(turns, documentsById)
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      messageApi.success('已复制整段对话')
    } catch {
      messageApi.error('复制失败，请检查剪贴板权限')
    }
  }

  function exportConversation() {
    const markdown = conversationAsMarkdown(turns, documentsById)
    if (!markdown) return
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `知识库对话-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
    messageApi.success('对话已导出')
  }

  function goToProviderSettings() {
    onNavigate?.('settings')
  }

  async function saveAnswerToKnowledge(turn: AssistantTurn, answer: string, cited: readonly Document[]) {
    if (turn.savedDocumentId || savingAnswerId) return
    const turnIndex = turns.findIndex(item => item.id === turn.id)
    const question = [...turns.slice(0, turnIndex)].reverse().find(item => item.role === 'user')?.content.trim() || '知识助手回答'
    const markdown = [
      `# ${question}`,
      '',
      answer,
      ...(cited.length > 0
        ? ['', '## 引用', '', ...cited.map((doc, index) => `${index + 1}. [${doc.title}](${doc.url})`)]
        : []),
    ].join('\n')

    setSavingAnswerId(turn.id)
    try {
      const saved = await saveDocument({
        title: `知识助手：${question}`.slice(0, 160),
        url: `arcadia://assistant-answer/${encodeURIComponent(turn.id)}`,
        markdown,
        tags: ['知识助手回答'],
      })
      setTurns(current => current.map(item => item.id === turn.id ? { ...item, savedDocumentId: saved.id } : item))
      setDocuments(current => current.some(item => item.id === saved.id) ? current : [saved, ...current])
      messageApi.success('回答已加入知识库')
    } catch (caught) {
      messageApi.error(caught instanceof Error ? caught.message : '加入知识库失败，请稍后重试')
    } finally {
      setSavingAnswerId(undefined)
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
              ? '可以直接提问；保存网页后，我还会优先结合你的资料并标注来源。'
              : `我会在已保存的 ${documents.length} 篇资料中检索，并标注引用来源。`}
          </p>
          {!noDocuments && (
            <div className="assistant-suggestions">
              {SUGGESTED_PROMPTS.map(item => (
                <ThreadPrimitive.Suggestion
                  key={item.title}
                  prompt={item.title}
                  send={false}
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
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="assistant-thread" role="log" aria-live="polite" aria-label="知识库对话">
        <ThreadPrimitive.Messages>{({ message: runtimeMessage }) => {
          const turn = turns.find(item => item.id === runtimeMessage.id)
          if (!turn) return null
          if (runtimeMessage.composer.isEditing) {
            return (
              <MessagePrimitive.Root className="assistant-message assistant-message--editing">
                <ComposerPrimitive.Root className="assistant-edit-composer">
                  <ComposerPrimitive.Input className="assistant-edit-composer__input" minRows={2} maxRows={8} autoFocus />
                  <div className="assistant-edit-composer__actions">
                    <ComposerPrimitive.Cancel type="button">取消</ComposerPrimitive.Cancel>
                    <ComposerPrimitive.Send type="submit">保存并重新生成</ComposerPrimitive.Send>
                  </div>
                </ComposerPrimitive.Root>
              </MessagePrimitive.Root>
            )
          }
          if (turn.role === 'user') {
            return (
              <MessagePrimitive.Root className="assistant-message assistant-message--user">
                <div className="assistant-message__body">
                  <div className="assistant-bubble assistant-bubble--user">{turn.content}</div>
                  {turn.attachments && turn.attachments.length > 0 && (
                    <div className="assistant-message-attachments">
                      {turn.attachments.map(attachment => (
                        <span className="assistant-message-attachment" key={attachment.id}>
                          <FileTextOutlined />{attachment.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <ActionBarPrimitive.Root className="assistant-response-actions assistant-response-actions--user" autohide="never">
                    <ActionBarPrimitive.Edit title="编辑问题">编辑</ActionBarPrimitive.Edit>
                    <ActionBarPrimitive.Copy title="复制问题"><CopyOutlined />复制</ActionBarPrimitive.Copy>
                  </ActionBarPrimitive.Root>
                </div>
                <span className="assistant-avatar assistant-avatar--user" aria-hidden="true"><UserOutlined/></span>
              </MessagePrimitive.Root>
            )
          }

          const cited = resolveCitedDocs(turn)
          const answer = stripSourceBlocks(turn.content)
          const noticeOnly = !turn.pending && (Boolean(turn.error) || turn.notFound || (turn.interrupted === true && !answer))
          return (
            <MessagePrimitive.Root className={`assistant-message assistant-message--assistant${turn.pending ? ' is-pending' : ''}`}>
              <span className="assistant-avatar assistant-avatar--bot" aria-hidden="true"><RobotOutlined/></span>
              <div className="assistant-message__body">
                <div className="assistant-message__meta">
                  <span className="assistant-message__author">知识助手</span>
                  {turn.pending && <span className="assistant-message__status">正在生成</span>}
                  {turn.interrupted && <span className="assistant-message__status is-interrupted">已中断</span>}
                  {turn.generalKnowledge && <span className="assistant-message__status">通用知识补充</span>}
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
                  <ActionBarPrimitive.Root className="assistant-response-actions" hideWhenRunning autohide="never">
                    <ActionBarPrimitive.Copy title="复制回答">
                      <CopyOutlined />
                      <span>复制</span>
                    </ActionBarPrimitive.Copy>
                    <ActionBarPrimitive.Reload title="重新生成回答">
                      <ReloadOutlined/>
                      <span>重新生成</span>
                    </ActionBarPrimitive.Reload>
                    <ActionBarPrimitive.ExportMarkdown title="导出 Markdown">
                      <FileTextOutlined />
                      <span>导出</span>
                    </ActionBarPrimitive.ExportMarkdown>
                    <button
                      type="button"
                      title={turn.savedDocumentId ? '已加入知识库' : '将回答加入知识库'}
                      disabled={Boolean(turn.savedDocumentId) || Boolean(savingAnswerId)}
                      onClick={() => void saveAnswerToKnowledge(turn, answer, cited)}
                    >
                      <BookOutlined />
                      <span>{turn.savedDocumentId ? '已加入知识库' : savingAnswerId === turn.id ? '加入中…' : '加入知识库'}</span>
                    </button>
                    <BranchPickerPrimitive.Root className="assistant-branch-picker" hideWhenSingleBranch>
                      <BranchPickerPrimitive.Previous title="上一个分支">‹</BranchPickerPrimitive.Previous>
                      <span><BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count /></span>
                      <BranchPickerPrimitive.Next title="下一个分支">›</BranchPickerPrimitive.Next>
                    </BranchPickerPrimitive.Root>
                  </ActionBarPrimitive.Root>
                )}
              </div>
            </MessagePrimitive.Root>
          )
        }}</ThreadPrimitive.Messages>
      </div>
    )
  }

  return (
    <>
      {contextHolder}
      <section className={`page assistant-page${embedded ? ' assistant-page--embedded' : ''}`}>
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
          <AssistantRuntimeProvider runtime={assistantRuntime}>
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
                <Button
                  size="small"
                  icon={<ClockCircleOutlined />}
                  onClick={() => setHistoryOpen(true)}
                >
                  对话历史{conversationHistory.length > 0 ? ` ${conversationHistory.length}` : ''}
                </Button>
                {providers.length > 1 && (
                  <Select
                    size="small"
                    className="assistant-provider-select"
                    value={providerId}
                    options={providers.map(provider => ({
                      value: provider.id,
                      label: `${provider.type === 'ollama' ? 'Ollama' : 'OpenAI'} · ${provider.model}`,
                    }))}
                    onChange={value => setProviderId(value)}
                    disabled={busy || agentBusy}
                    ariaLabel="选择对话模型"
                  />
                )}
                <Button
                  size="small"
                  icon={<RobotOutlined />}
                  title="查看通过“深度研究”执行的任务，不包含普通问答"
                  onClick={() => void openAgent()}
                >
                  深度研究记录{agentRuns.length > 0 ? ` ${agentRuns.length}` : ''}
                </Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setSourcesOpen(true)}>
                  {citedDocIds.size > 0 ? `引用 ${citedDocIds.size}` : `来源 ${documents.length}`}
                </Button>
                {turns.length > 0 && (
                  <>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyConversation()}>
                      复制对话
                    </Button>
                    <Button size="small" type="text" icon={<DownloadOutlined />} onClick={exportConversation}>
                      导出
                    </Button>
                    <Popconfirm
                      title="开始新对话？"
                      description="当前对话将从本机删除；需要保留时请先导出。"
                      okText="新建"
                      okButtonProps={{ danger: true }}
                      disabled={busy || agentBusy}
                      onConfirm={startNewConversation}
                    >
                      <Button size="small" icon={<PlusOutlined />} disabled={busy || agentBusy}>新对话</Button>
                    </Popconfirm>
                  </>
                )}
              </Space>
            }
          >
            <ThreadPrimitive.Root className="assistant-ui-thread">
              <ThreadPrimitive.Viewport className="assistant-conversation" ref={listRef} autoScroll>
                {renderConversation()}
              </ThreadPrimitive.Viewport>
              <ThreadPrimitive.ScrollToBottom className="assistant-scroll-to-bottom" aria-label="滚动到最新消息">
                <ArrowUpOutlined />
              </ThreadPrimitive.ScrollToBottom>

            <ComposerPrimitive.Root className="assistant-composer">
              <div className="assistant-composer__box">
                <ComposerPrimitive.Attachments>
                  {({ attachment }) => (
                    <AttachmentPrimitive.Root className="assistant-composer-attachment">
                      <FileTextOutlined />
                      <AttachmentPrimitive.Name />
                      <AttachmentPrimitive.Remove aria-label={`移除 ${attachment.name}`}>×</AttachmentPrimitive.Remove>
                    </AttachmentPrimitive.Root>
                  )}
                </ComposerPrimitive.Attachments>
                <ComposerPrimitive.Input
                  id="assistant-question"
                  className="assistant-composer__input"
                  minRows={2}
                  maxRows={6}
                  value={question}
                  onChange={event => setQuestion(event.target.value)}
                  submitMode="enter"
                  placeholder={placeholder}
                  aria-label="向知识库提问"
                />
                <div className="assistant-composer__toolbar">
                  <div className="assistant-composer__hint">
                    <span>Enter 发送 · Shift + Enter 换行</span>
                    {activeProvider && <span className="assistant-composer__model">{activeProvider.model}</span>}
                  </div>
                  <Space size={6}>
                    <ComposerPrimitive.AddAttachment
                      type="button"
                      className="assistant-attach-button"
                      title="添加附件（PDF、DOCX 或文本文件）"
                      aria-label="添加附件"
                    >
                      <FileTextOutlined />
                    </ComposerPrimitive.AddAttachment>
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
                    <ComposerPrimitive.Send
                      type="submit"
                      className="assistant-send"
                      aria-label="发送"
                      title="发送"
                    >
                      {busy ? <Spin size="small" /> : <ArrowUpOutlined />}
                    </ComposerPrimitive.Send>
                  </Space>
                </div>
              </div>
            </ComposerPrimitive.Root>
            </ThreadPrimitive.Root>
          </Card>
          </AssistantRuntimeProvider>
        </div>

        <Drawer
          title={`对话历史（${conversationHistory.length}）`}
          placement="right"
          width={420}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
        >
          <div className="assistant-history-toolbar">
            <Input
              value={historyQuery}
              onChange={event => setHistoryQuery(event.target.value)}
              prefix={<SearchOutlined />}
              allowClear
              placeholder="搜索标题或对话内容"
              aria-label="搜索历史对话"
            />
            {conversationHistory.length > 0 && (
              <Popconfirm
                title="清空全部历史对话？"
                description="当前正在查看的对话不会被删除；历史记录删除后无法恢复。"
                okText="全部清空"
                okButtonProps={{ danger: true }}
                onConfirm={() => setConversationHistory([])}
              >
                <Button danger>清空历史</Button>
              </Popconfirm>
            )}
          </div>
          <List
            dataSource={filteredConversationHistory}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={historyQuery ? '没有匹配的历史对话' : '暂无历史对话；新建对话后，当前内容会自动保存在这里。'} /> }}
            renderItem={item => (
              <List.Item
                className="assistant-history-item"
                onClick={() => openSavedConversation(item)}
                actions={[
                  <Button
                    key="rename"
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    title="重命名"
                    onClick={event => {
                      event.stopPropagation()
                      beginRenameConversation(item)
                    }}
                  />,
                  <Popconfirm
                    key="delete"
                    title="删除这条历史对话？"
                    description="删除后无法恢复。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deleteSavedConversation(item.id)}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      title="删除这条历史对话"
                      onClick={event => event.stopPropagation()}
                    />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={<ClockCircleOutlined />}
                  title={item.title}
                  description={`${item.turns.filter(turn => turn.role === 'user').length} 轮 · ${new Date(item.updatedAt).toLocaleString('zh-CN')}`}
                />
              </List.Item>
            )}
          />
        </Drawer>
        <Modal
          title="重命名对话"
          open={renamingConversation !== null}
          okText="保存"
          okButtonProps={{ disabled: normalizeConversationTitle(conversationTitleDraft).length === 0 }}
          onOk={renameConversation}
          onCancel={() => setRenamingConversation(null)}
        >
          <Input
            autoFocus
            maxLength={60}
            value={conversationTitleDraft}
            onChange={event => setConversationTitleDraft(event.target.value)}
            onPressEnter={renameConversation}
            placeholder="输入对话标题"
            aria-label="对话标题"
          />
        </Modal>
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
          title="深度研究记录"
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

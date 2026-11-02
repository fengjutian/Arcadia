import { t } from '../../i18n'
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
  { title:t("\u603B\u7ED3\u6211\u6700\u8FD1\u4FDD\u5B58\u7684\u5185\u5BB9"),hint:t("\u63D0\u70BC\u6700\u8FD1\u8D44\u6599\u91CC\u7684\u5173\u952E\u7ED3\u8BBA"),icon:<FileTextOutlined/>},
  { title:t("\u6BD4\u8F83\u8FD9\u4E9B\u6765\u6E90\u7684\u6838\u5FC3\u89C2\u70B9"),hint:t("\u627E\u51FA\u5171\u8BC6\u3001\u5206\u6B67\u4E0E\u8BC1\u636E"),icon:<BookOutlined/>},
  { title:t("\u4ECE\u5DF2\u4FDD\u5B58\u8D44\u6599\u751F\u6210\u7814\u7A76\u7B80\u62A5"),hint:t("\u6574\u7406\u6210\u7ED3\u6784\u5316\u901F\u89C8"),icon:<SearchOutlined/>},
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
    if (task.status === 'failed') throw new Error(task.error ||t("\u540E\u53F0\u751F\u6210\u5931\u8D25"))
    await new Promise(resolve => window.setTimeout(resolve, 800))
  }
}

function conversationAsMarkdown(turns: readonly Turn[], documentsById: ReadonlyMap<string, Document>): string {
  const lines = [t("# \u77E5\u8BC6\u5E93\u5BF9\u8BDD"),'']
  for (const turn of turns) {
    if (turn.role === 'user') {
      lines.push(t("## \u6211"),'',turn.content,'')
      continue
    }
    if (turn.pending) continue
    lines.push(t("## \u77E5\u8BC6\u52A9\u624B"),'',stripSourceBlocks(turn.content),'')
    const cited = (turn.documentIds ?? [])
      .map(id => documentsById.get(id))
      .filter((doc): doc is Document => Boolean(doc))
    if (cited.length > 0) {
      lines.push(t("\u5F15\u7528\uFF1A"),...cited.map((doc,index)=>`${index+1}. ${doc.title}${doc.url?` — ${doc.url}`:''}`),'')
    }
  }
  return lines.join('\n').trimEnd()
}

/** Keep in-app navigation intact: answer links open as a normal browser tab. */
function AssistantMarkdownLink({ href, children, node: _node, onClick, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  return(
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
    </a>)

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
    ?t("\u6B63\u5728\u6062\u590D\u5BF9\u8BDD\u2026")
    : noProvider
        ?t("\u8BF7\u5148\u5728\u300C\u8BBE\u7F6E \u2192 AI Provider\u300D\u4E2D\u914D\u7F6E")
        :t("\u7EE7\u7EED\u8FFD\u95EE\uFF0C\u6216\u6362\u4E00\u4E2A\u89D2\u5EA6\u63D0\u95EE\u2026")

  const assistantRuntime = useExternalStoreRuntime<Turn>({
    messages: turns,
    isRunning: busy || agentBusy,
    isDisabled: !conversationHydrated,
    isSendDisabled: noProvider,
    convertMessage: (turn): ThreadMessageLike =>( {
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
        await submitQuestion(prompt ||t("\u8BF7\u5206\u6790\u9644\u4EF6"),{
          attachments: message.attachments,
          modelPrompt: attachmentText ? `${prompt ||t("\u8BF7\u5206\u6790\u4EE5\u4E0B\u9644\u4EF6")}\n\n${attachmentText}`:prompt,
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
    setTurns(current => current.map(        (turn

    )                                    =>(turn.id===id&&turn.role==='assistant'?{...turn,...patch}:turn)))
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
        .filter(turn => turn.role === 'user' ||( !turn.pending && !turn.interrupted && !turn.error && !turn.notFound))
        .filter(turn => turn.content.trim().length > 0)
        .map(        (turn


         )        =>( {role:turn.role as'user'|'assistant',content:turn.role==='assistant'?stripSourceBlocks(turn.content):turn.content,})),12_000)
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
        history.map(         (entry                                                               )=>({role:entry.role as'user'|'assistant',content:entry.content})),
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
            history.map(         (entry                                                               )=>({role:entry.role as'user'|'assistant',content:entry.content})),
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
            keywordMatches.map((item, index) =>( { documentId:item.id, chunkIndex:0, excerpt:item.markdownSnippet ?? item.summary ?? '', score:1 /( index + 1) })),
            vector.map(        (item                                                                                                   )=>({documentId:item.documentId,chunkIndex:item.chunkIndex,excerpt:item.excerpt,score:item.similarity})),
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
        history.map(         (entry                                                               )=>({role:entry.role as'user'|'assistant',content:entry.content})),
        { topK: 8, rankedDocumentIds },
      )
      const response = await aiChat(providerId, request)
      let parsed = parseCrossAnswer(stripModelReasoning(response.content))
      if (parsed.notFound) {
        const general = await aiChat(providerId, buildGeneralAnswerPrompt(
          prompt,
          history.map(         (entry                                                               )=>({role:entry.role as'user'|'assistant',content:entry.content})),
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
        throw new Error(t("\u6A21\u578B\u672A\u80FD\u6309\u8D44\u6599\u751F\u6210\u6709\u6548\u5F15\u7528\uFF0C\u8BF7\u6362\u4E00\u79CD\u95EE\u6CD5\u6216\u91CD\u8BD5"))
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
        : String(caught ||t("\u63D0\u95EE\u5931\u8D25"))
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
        ?t("\u7814\u7A76\u672A\u5B8C\u6210\uFF1A{value0}",{value0:result.stopped.message})
        : result.stopped
          ?t("{value0}\n\n\uFF08\u5DF2\u4E2D\u6B62\uFF1A{value1}\uFF09",{value0:result.answer,value1:result.stopped.message})
          : result.answer
      patchTurn(pendingTurn.id, { content, pending:false })
      await listAgentRuns(20).then(setAgentRuns).catch(() => undefined)
    } catch (caught) {
      const text = caught instanceof Error ? caught.message :t("\u7814\u7A76\u5931\u8D25")
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
    setConversationHistory(current => current.map(        (item

    )                                                  =>(item.id===renamingConversation.id?{...item,title,updatedAt:new Date().toISOString()}:item)))
    setRenamingConversation(null)
    setConversationTitleDraft('')
  }

  async function copyConversation() {
    const markdown = conversationAsMarkdown(turns, documentsById)
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      messageApi.success(t("\u5DF2\u590D\u5236\u6574\u6BB5\u5BF9\u8BDD"))
    } catch {
      messageApi.error(t("\u590D\u5236\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u526A\u8D34\u677F\u6743\u9650"))
    }
  }

  function exportConversation() {
    const markdown = conversationAsMarkdown(turns, documentsById)
    if (!markdown) return
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download =t("\u77E5\u8BC6\u5E93\u5BF9\u8BDD-{value0}.md",{value0:new Date().toISOString().slice(0,10)})
    link.click()
    URL.revokeObjectURL(url)
    messageApi.success(t("\u5BF9\u8BDD\u5DF2\u5BFC\u51FA"))
  }

  function goToProviderSettings() {
    onNavigate?.('settings')
  }

  async function saveAnswerToKnowledge(turn: AssistantTurn, answer: string, cited: readonly Document[]) {
    if (turn.savedDocumentId || savingAnswerId) return
    const turnIndex = turns.findIndex(item => item.id === turn.id)
    const question = [...turns.slice(0, turnIndex)].reverse().find(item => item.role === 'user')?.content.trim() ||t("\u77E5\u8BC6\u52A9\u624B\u56DE\u7B54")
    const markdown = [
      `# ${question}`,
      '',
      answer,
      ...(cited.length > 0
        ? ['',t("## \u5F15\u7528"),'',...cited.map((doc,index)=>`${index+1}. [${doc.title}](${doc.url})`)]
        : []),
    ].join('\n')

    setSavingAnswerId(turn.id)
    try {
      const saved = await saveDocument({
        title: t("\u77E5\u8BC6\u52A9\u624B\uFF1A{value0}",{value0:question}).slice(0,160),
        url: `arcadia://assistant-answer/${encodeURIComponent(turn.id)}`,
        markdown,
        tags: [t("\u77E5\u8BC6\u52A9\u624B\u56DE\u7B54")],
      })
      setTurns(current => current.map(item => item.id === turn.id ? { ...item, savedDocumentId: saved.id } : item))
      setDocuments(current => current.some(item => item.id === saved.id) ? current : [saved, ...current])
      messageApi.success(t("\u56DE\u7B54\u5DF2\u52A0\u5165\u77E5\u8BC6\u5E93"))
    } catch (caught) {
      messageApi.error(caught instanceof Error ? caught.message :t("\u52A0\u5165\u77E5\u8BC6\u5E93\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5"))
    } finally {
      setSavingAnswerId(undefined)
    }
  }

  function renderConversation() {
    if (!conversationHydrated) {
      return <div className="assistant-thread-loading"><Spin size="small"/><span>{t("\u6B63\u5728\u6062\u590D\u5BF9\u8BDD\u2026")}</span></div>
    }
    if (turns.length === 0) {
      return(
        <div className="assistant-empty">
          <span className="assistant-empty__icon"><RobotOutlined/></span>
          <h2>{noDocuments ?t("\u77E5\u8BC6\u5E93\u8FD8\u662F\u7A7A\u7684"):t("\u4ECE\u4E00\u4E2A\u597D\u95EE\u9898\u5F00\u59CB")}</h2>
          <p>
            {noDocuments
              ?t("\u53EF\u4EE5\u76F4\u63A5\u63D0\u95EE\uFF1B\u4FDD\u5B58\u7F51\u9875\u540E\uFF0C\u6211\u8FD8\u4F1A\u4F18\u5148\u7ED3\u5408\u4F60\u7684\u8D44\u6599\u5E76\u6807\u6CE8\u6765\u6E90\u3002")
              :t("\u6211\u4F1A\u5728\u5DF2\u4FDD\u5B58\u7684 {value0} \u7BC7\u8D44\u6599\u4E2D\u68C0\u7D22\uFF0C\u5E76\u6807\u6CE8\u5F15\u7528\u6765\u6E90\u3002",{value0:documents.length})}
          </p>
          {!noDocuments &&(
            <div className="assistant-suggestions">
              {SUGGESTED_PROMPTS.map(        (item















              )                           =>(<ThreadPrimitive.Suggestion key={item.title}prompt={item.title}send={false}className="assistant-suggestion"disabled={noProvider}onClick={()=>applySuggestion(item.title)}>
                  <span className="assistant-suggestion__icon">{item.icon}</span>
                  <span className="assistant-suggestion__copy">
                    <b>{item.title}</b>
                    <small>{item.hint}</small>
                  </span>
                  <ArrowRightOutlined className="assistant-suggestion__arrow"/>
                </ThreadPrimitive.Suggestion>))}
            </div>)}
        </div>)}return(<div className="assistant-thread"role="log"aria-live="polite"aria-label={t("\u77E5\u8BC6\u5E93\u5BF9\u8BDD")}>
        <ThreadPrimitive.Messages>{({ message: runtimeMessage }) => {const turn=turns.find(item=>item.id===runtimeMessage.id)
          if (!turn) return null
          if (runtimeMessage.composer.isEditing) {
            return(
              <MessagePrimitive.Root className="assistant-message assistant-message--editing">
                <ComposerPrimitive.Root className="assistant-edit-composer">
                  <ComposerPrimitive.Input className="assistant-edit-composer__input" minRows={2} maxRows={8} autoFocus />
                  <div className="assistant-edit-composer__actions">
                    <ComposerPrimitive.Cancel type="button">{t("\u53D6\u6D88")}</ComposerPrimitive.Cancel>
                    <ComposerPrimitive.Send type="submit">{t("\u4FDD\u5B58\u5E76\u91CD\u65B0\u751F\u6210")}</ComposerPrimitive.Send>
                  </div>
                </ComposerPrimitive.Root>
              </MessagePrimitive.Root>)

          }
          if (turn.role === 'user') {
            return(
              <MessagePrimitive.Root className="assistant-message assistant-message--user">
                <div className="assistant-message__body">
                  <div className="assistant-bubble assistant-bubble--user">{turn.content}</div>
                  {turn.attachments && turn.attachments.length > 0 &&(
                    <div className="assistant-message-attachments">
                      {turn.attachments.map(              (attachment



                      )                                =>(<span className="assistant-message-attachment"key={attachment.id}>
                          <FileTextOutlined />{attachment.name}
                        </span>))}
                    </div>)}
                  <ActionBarPrimitive.Root className="assistant-response-actions assistant-response-actions--user" autohide="never">
                    <ActionBarPrimitive.Edit title={t("\u7F16\u8F91\u95EE\u9898")}>{t("\u7F16\u8F91")}</ActionBarPrimitive.Edit>
                    <ActionBarPrimitive.Copy title={t("\u590D\u5236\u95EE\u9898")}><CopyOutlined/>{t("\u590D\u5236")}</ActionBarPrimitive.Copy>
                  </ActionBarPrimitive.Root>
                </div>
                <span className="assistant-avatar assistant-avatar--user" aria-hidden="true"><UserOutlined/></span>
              </MessagePrimitive.Root>)
          }

          const cited = resolveCitedDocs(turn)
          const answer = stripSourceBlocks(turn.content)
          const noticeOnly = !turn.pending &&                                          (Boolean(turn.error)||turn.notFound||(turn.interrupted===true&&!answer))
          return(
            <MessagePrimitive.Root className={`assistant-message assistant-message--assistant${turn.pending ? ' is-pending' : ''}`}>
              <span className="assistant-avatar assistant-avatar--bot" aria-hidden="true"><RobotOutlined/></span>
              <div className="assistant-message__body">
                <div className="assistant-message__meta">
                  <span className="assistant-message__author">{t("\u77E5\u8BC6\u52A9\u624B")}</span>
                  {turn.pending && <span className="assistant-message__status">{t("\u6B63\u5728\u751F\u6210")}</span>}
                  {turn.interrupted && <span className="assistant-message__status is-interrupted">{t("\u5DF2\u4E2D\u65AD")}</span>}
                  {turn.generalKnowledge && <span className="assistant-message__status">{t("\u901A\u7528\u77E5\u8BC6\u8865\u5145")}</span>}
                </div>
                <div className={`assistant-bubble assistant-bubble--assistant${turn.pending ? ' is-pending' : ''}${noticeOnly ? ' is-notice' : ''}`}>
                  {turn.pending ?(
                    <>
                      <div className="assistant-thinking">
                        <span className="assistant-thinking__dots" aria-hidden="true"><i/><i/><i/></span>
                        <span>{t("\u6B63\u5728\u68C0\u7D22")} {documents.length} {t("\u7BC7\u8D44\u6599\u5E76\u751F\u6210\u56DE\u7B54\u2026")}</span>
                      </div>
                      <div className="assistant-thinking__skeleton" aria-hidden="true"><span/><span/></div>
                    </>)
                    : turn.error ?(
                    <div className="assistant-notice assistant-notice--error">
                      <span className="assistant-notice__icon"><WarningOutlined/></span>
                      <div className="assistant-notice__body">
                        <strong>{t("\u751F\u6210\u5931\u8D25")}</strong>
                        <p>{turn.error}</p>
                      </div>
                      <Button
                        size="small"
                        icon={<ReloadOutlined/>}
                        disabled={busy || agentBusy}
                        onClick={() => void retryTurn(turn)}
                      >{t("\u91CD\u8BD5")} 

                      </Button>
                    </div>)
                    : turn.interrupted ?(
                    <>
                      {answer &&(
                        <div className="assistant-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{answer}</ReactMarkdown>
                        </div>)
                       }
                      <div className="assistant-notice assistant-notice--interrupted">
                        <span className="assistant-notice__icon"><ClockCircleOutlined/></span>
                        <div className="assistant-notice__body">
                          <strong>{t("\u56DE\u7B54\u5728\u5E94\u7528\u91CD\u65B0\u52A0\u8F7D\u65F6\u4E2D\u65AD")}</strong>
                          <p>{t("\u8FD9\u6B21\u751F\u6210\u6CA1\u6709\u5B8C\u6210\uFF0C\u53EF\u4EE5\u91CD\u65B0\u751F\u6210\u540C\u4E00\u6761\u56DE\u7B54\u3002")}</p>
                        </div>
                        <Button
                          size="small"
                          icon={<ReloadOutlined/>}
                          disabled={busy || agentBusy}
                          onClick={() => void retryTurn(turn)}
                        >{t("\u91CD\u65B0\u751F\u6210")} 

                        </Button>
                      </div>
                    </>)
                    : turn.notFound ?(
                    <div className="assistant-notice assistant-notice--empty">
                      <span className="assistant-notice__icon"><SearchOutlined/></span>
                      <div className="assistant-notice__body">
                        <strong>{t("\u8D44\u6599\u4E2D\u6682\u672A\u627E\u5230\u7B54\u6848")}</strong>
                        <p>{answer ||t("\u8BD5\u8BD5\u6362\u4E00\u4E2A\u95EE\u6CD5\uFF0C\u6216\u518D\u4FDD\u5B58\u4E00\u4E9B\u76F8\u5173\u8D44\u6599\u3002")}</p>
                      </div>
                    </div>)
                    :(
                    <div className="assistant-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>{answer}</ReactMarkdown>
                    </div>)
                   }
                </div>

                {!turn.pending && !turn.error && cited.length > 0 &&(
                  <div className="assistant-citations">
                    <span className="assistant-citations__label">{t("\u5F15\u7528")}</span>
                    {cited.map((doc, index) =>(
                      <button
                        type="button"
                        className="assistant-citation"
                        key={doc.id}
                        title={t("\u6253\u5F00\uFF1A{value0}",{value0:doc.title})}
                        onClick={() => setSelectedDoc(doc)}
                      >
                        <span className="assistant-citation__index">{index + 1}</span>
                        <span className="assistant-citation__title">{doc.title}</span>
                      </button>)
                     )}
                  </div>)
                 }

                {!turn.pending && !turn.error && !turn.notFound && !turn.interrupted && answer &&(
                  <ActionBarPrimitive.Root className="assistant-response-actions" hideWhenRunning autohide="never">
                    <ActionBarPrimitive.Copy title={t("\u590D\u5236\u56DE\u7B54")}>
                      <CopyOutlined />
                      <span>{t("\u590D\u5236")}</span>
                    </ActionBarPrimitive.Copy>
                    <ActionBarPrimitive.Reload title={t("\u91CD\u65B0\u751F\u6210\u56DE\u7B54")}>
                      <ReloadOutlined/>
                      <span>{t("\u91CD\u65B0\u751F\u6210")}</span>
                    </ActionBarPrimitive.Reload>
                    <ActionBarPrimitive.ExportMarkdown title={t("\u5BFC\u51FA Markdown")}>
                      <FileTextOutlined />
                      <span>{t("\u5BFC\u51FA")}</span>
                    </ActionBarPrimitive.ExportMarkdown>
                    <button
                      type="button"
                      title={turn.savedDocumentId ?t("\u5DF2\u52A0\u5165\u77E5\u8BC6\u5E93"):t("\u5C06\u56DE\u7B54\u52A0\u5165\u77E5\u8BC6\u5E93")}
                      disabled={Boolean(turn.savedDocumentId) || Boolean(savingAnswerId)}
                      onClick={() => void saveAnswerToKnowledge(turn, answer, cited)}
                    >
                      <BookOutlined />
                      <span>{turn.savedDocumentId ?t("\u5DF2\u52A0\u5165\u77E5\u8BC6\u5E93"):savingAnswerId===turn.id?t("\u52A0\u5165\u4E2D\u2026"):t("\u52A0\u5165\u77E5\u8BC6\u5E93")}</span>
                    </button>
                    <BranchPickerPrimitive.Root className="assistant-branch-picker" hideWhenSingleBranch>
                      <BranchPickerPrimitive.Previous title={t("\u4E0A\u4E00\u4E2A\u5206\u652F")}>‹</BranchPickerPrimitive.Previous>
                      <span><BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count /></span>
                      <BranchPickerPrimitive.Next title={t("\u4E0B\u4E00\u4E2A\u5206\u652F")}>›</BranchPickerPrimitive.Next>
                    </BranchPickerPrimitive.Root>
                  </ActionBarPrimitive.Root>)
                 }
              </div>
            </MessagePrimitive.Root>)

        }}</ThreadPrimitive.Messages>
      </div>)

  }

  return(
    <>
      {contextHolder}
      <section className={`page assistant-page${embedded ? ' assistant-page--embedded' : ''}`}>
        {noProvider &&(
          <Alert
            className="assistant-provider-alert"
            type="warning"
            showIcon
            message={t("\u5C1A\u672A\u914D\u7F6E AI Provider")}
            description={t("\u8BF7\u5728\u201C\u8BBE\u7F6E \u2192 AI Provider\u201D\u4E2D\u6DFB\u52A0 OpenAI \u517C\u5BB9\u6216 Ollama \u670D\u52A1\u3002")}
            action={onNavigate ? <Button size="small" type="primary" icon={<SettingOutlined />} onClick={goToProviderSettings}>{t("\u53BB\u8BBE\u7F6E")}</Button>:undefined}
          />)
         }
        <div className="assistant-grid">
          <AssistantRuntimeProvider runtime={assistantRuntime}>
          <Card
            className="assistant-chat"
            title={
              <div className="assistant-chat__title">
                <span>{t("\u5BF9\u8BDD")}</span>
                {roundCount > 0 &&(
                  <span className="assistant-chat__summary">
                    {roundCount} {t("\u8F6E")}{citedDocIds.size>0?t(" \xB7 {value0} \u7BC7\u5F15\u7528",{value0:citedDocIds.size}):''}
                  </span>)
                 }
              </div>
            }
            extra={
              <Space size={6} wrap>
                <Button
                  size="small"
                  icon={<ClockCircleOutlined />}
                  onClick={() => setHistoryOpen(true)}
                >{t("\u5BF9\u8BDD\u5386\u53F2")}
                      {conversationHistory.length > 0 ? ` ${conversationHistory.length}` : ''}
                </Button>
                {providers.length > 1 &&(
                  <Select
                    size="small"
                    className="assistant-provider-select"
                    value={providerId}
                    options={providers.map(            (provider


                     )                              =>( {value:provider.id,label:`${provider.type==='ollama'?'Ollama':'OpenAI'} · ${provider.model}`,}))}
                    onChange={value => setProviderId(value)}
                    disabled={busy || agentBusy}
                    ariaLabel={t("\u9009\u62E9\u5BF9\u8BDD\u6A21\u578B")}
                  />)
                 }
                <Button
                  size="small"
                  icon={<RobotOutlined />}
                  title={t("\u67E5\u770B\u901A\u8FC7\u201C\u6DF1\u5EA6\u7814\u7A76\u201D\u6267\u884C\u7684\u4EFB\u52A1\uFF0C\u4E0D\u5305\u542B\u666E\u901A\u95EE\u7B54")}
                  onClick={() => void openAgent()}
                >{t("\u6DF1\u5EA6\u7814\u7A76\u8BB0\u5F55")}
                        {agentRuns.length > 0 ? ` ${agentRuns.length}` : ''}
                </Button>
                <Button size="small" icon={<FileTextOutlined />} onClick={() => setSourcesOpen(true)}>
                  {citedDocIds.size > 0 ?t("\u5F15\u7528 {value0}",{value0:citedDocIds.size}):t("\u6765\u6E90 {value0}",{value0:documents.length})}
                </Button>
                {turns.length > 0 &&(
                  <>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copyConversation()}>{t("\u590D\u5236\u5BF9\u8BDD")} 

                    </Button>
                    <Button size="small" type="text" icon={<DownloadOutlined />} onClick={exportConversation}>{t("\u5BFC\u51FA")} 

                    </Button>
                    <Popconfirm
                      title={t("\u5F00\u59CB\u65B0\u5BF9\u8BDD\uFF1F")}
                      description={t("\u5F53\u524D\u5BF9\u8BDD\u5C06\u4ECE\u672C\u673A\u5220\u9664\uFF1B\u9700\u8981\u4FDD\u7559\u65F6\u8BF7\u5148\u5BFC\u51FA\u3002")}
                      okText={t("\u65B0\u5EFA")}
                      okButtonProps={{ danger: true }}
                      disabled={busy || agentBusy}
                      onConfirm={startNewConversation}
                    >
                      <Button size="small" icon={<PlusOutlined />} disabled={busy || agentBusy}>{t("\u65B0\u5BF9\u8BDD")}</Button>
                    </Popconfirm>
                  </>)
                 }
              </Space>
            }
          >
            <ThreadPrimitive.Root className="assistant-ui-thread">
              <ThreadPrimitive.Viewport className="assistant-conversation" ref={listRef} autoScroll>
                {renderConversation()}
              </ThreadPrimitive.Viewport>
              <ThreadPrimitive.ScrollToBottom className="assistant-scroll-to-bottom" aria-label={t("\u6EDA\u52A8\u5230\u6700\u65B0\u6D88\u606F")}>
                <ArrowUpOutlined />
              </ThreadPrimitive.ScrollToBottom>

            <ComposerPrimitive.Root className="assistant-composer">
              <div className="assistant-composer__box">
                <ComposerPrimitive.Attachments>
                  {({ attachment }) =>(
                    <AttachmentPrimitive.Root className="assistant-composer-attachment">
                      <FileTextOutlined />
                      <AttachmentPrimitive.Name />
                      <AttachmentPrimitive.Remove aria-label={t("\u79FB\u9664 {value0}",{value0:attachment.name})}>×</AttachmentPrimitive.Remove>
                    </AttachmentPrimitive.Root>)
                   }
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
                  aria-label={t("\u5411\u77E5\u8BC6\u5E93\u63D0\u95EE")}
                />
                <div className="assistant-composer__toolbar">
                  <div className="assistant-composer__hint">
                    <span>{t("Enter \u53D1\u9001 \xB7 Shift + Enter \u6362\u884C")}</span>
                    {activeProvider && <span className="assistant-composer__model">{activeProvider.model}</span>}
                  </div>
                  <Space size={6}>
                    <ComposerPrimitive.AddAttachment
                      type="button"
                      className="assistant-attach-button"
                      title={t("\u6DFB\u52A0\u9644\u4EF6\uFF08PDF\u3001DOCX \u6216\u6587\u672C\u6587\u4EF6\uFF09")}
                      aria-label={t("\u6DFB\u52A0\u9644\u4EF6")}
                    >
                      <FileTextOutlined />
                    </ComposerPrimitive.AddAttachment>
                    <Button
                      size="small"
                      icon={<RobotOutlined />}
                      loading={agentBusy}
                      disabled={!canAsk || busy || agentBusy}
                      onClick={() => void runAgent()}
                      title={t("\u7528\u53D7\u63A7 Agent \u5FAA\u73AF\u7814\u7A76\u8FD9\u4E2A\u95EE\u9898")}
                    >{t("\u6DF1\u5EA6\u7814\u7A76")} 

                    </Button>
                    <ComposerPrimitive.Send
                      type="submit"
                      className="assistant-send"
                      aria-label={t("\u53D1\u9001")}
                      title={t("\u53D1\u9001")}
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
          title={t("\u5BF9\u8BDD\u5386\u53F2\uFF08{value0}\uFF09",{value0:conversationHistory.length})}
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
              placeholder={t("\u641C\u7D22\u6807\u9898\u6216\u5BF9\u8BDD\u5185\u5BB9")}
              aria-label={t("\u641C\u7D22\u5386\u53F2\u5BF9\u8BDD")}
            />
            {conversationHistory.length > 0 &&(
              <Popconfirm
                title={t("\u6E05\u7A7A\u5168\u90E8\u5386\u53F2\u5BF9\u8BDD\uFF1F")}
                description={t("\u5F53\u524D\u6B63\u5728\u67E5\u770B\u7684\u5BF9\u8BDD\u4E0D\u4F1A\u88AB\u5220\u9664\uFF1B\u5386\u53F2\u8BB0\u5F55\u5220\u9664\u540E\u65E0\u6CD5\u6062\u590D\u3002")}
                okText={t("\u5168\u90E8\u6E05\u7A7A")}
                okButtonProps={{ danger: true }}
                onConfirm={() => setConversationHistory([])}
              >
                <Button danger>{t("\u6E05\u7A7A\u5386\u53F2")}</Button>
              </Popconfirm>)
             }
          </div>
          <List
            dataSource={filteredConversationHistory}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={historyQuery ?t("\u6CA1\u6709\u5339\u914D\u7684\u5386\u53F2\u5BF9\u8BDD"):t("\u6682\u65E0\u5386\u53F2\u5BF9\u8BDD\uFF1B\u65B0\u5EFA\u5BF9\u8BDD\u540E\uFF0C\u5F53\u524D\u5185\u5BB9\u4F1A\u81EA\u52A8\u4FDD\u5B58\u5728\u8FD9\u91CC\u3002")}/>}}
            renderItem={        (item








































            )                =>(<List.Item className="assistant-history-item"onClick={()=>openSavedConversation(item)}actions={[<Button key="rename"type="text"size="small"icon={<EditOutlined/>}title={t("\u91CD\u547D\u540D")}onClick={event=>{event.stopPropagation();beginRenameConversation(item)}}/>,<Popconfirm key="delete"title={t("\u5220\u9664\u8FD9\u6761\u5386\u53F2\u5BF9\u8BDD\uFF1F")}description={t("\u5220\u9664\u540E\u65E0\u6CD5\u6062\u590D\u3002")}okText={t("\u5220\u9664")}okButtonProps={{danger:true}}onConfirm={()=>deleteSavedConversation(item.id)}>
                    <Button type="text"danger size="small"icon={<DeleteOutlined/>}title={t("\u5220\u9664\u8FD9\u6761\u5386\u53F2\u5BF9\u8BDD")}onClick={event=>event.stopPropagation()}/>
                  </Popconfirm>,]}>
                <List.Item.Meta avatar={<ClockCircleOutlined/>}title={item.title}description={t("{value0} \u8F6E \xB7 {value1}",{value0:item.turns.filter(turn=>turn.role==='user').length,value1:new Date(item.updatedAt).toLocaleString('zh-CN')})}/>
              </List.Item>)}/>
        </Drawer>
        <Modal title={t("\u91CD\u547D\u540D\u5BF9\u8BDD")}open={renamingConversation!==null}okText={t("\u4FDD\u5B58")}
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
            placeholder={t("\u8F93\u5165\u5BF9\u8BDD\u6807\u9898")}
            aria-label={t("\u5BF9\u8BDD\u6807\u9898")}
          />
        </Modal>
        <Drawer
          title={citedDocIds.size > 0 ?t("\u5F15\u7528\u6765\u6E90\uFF08{value0}\uFF09",{value0:citedDocIds.size}):t("\u77E5\u8BC6\u5E93\u6765\u6E90\uFF08{value0}\uFF09",{value0:documents.length})}
          placement="right"
          width={420}
          open={sourcesOpen}
          onClose={() => setSourcesOpen(false)}
        >
          <List
            dataSource={sourceItems}
            locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u6682\u65E0\u6765\u6E90")}/>}}
            renderItem={        (item











            )                =>(<List.Item onClick={()=>setSelectedDoc(item)}className="search-result-clickable"actions={citedDocIds.has(item.id)?[<Tag key="cited"color="green">{t("\u5DF2\u5F15\u7528")}</Tag>]:undefined}>
                <List.Item.Meta avatar={<FileTextOutlined/>}title={item.title}description={item.source||item.url}/>
              </List.Item>)}/>
        </Drawer>
        <DocumentDetailDrawer document={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDeleted={() => setSelectedDoc(null)}
        />
        <Drawer
          title={t("\u6DF1\u5EA6\u7814\u7A76\u8BB0\u5F55")}
          placement="right"
          width={460}
          open={agentOpen}
          onClose={() => setAgentOpen(false)}
        >
          <AgentRunHistory runs={agentRuns} />
        </Drawer>
      </section>
    </>)

}
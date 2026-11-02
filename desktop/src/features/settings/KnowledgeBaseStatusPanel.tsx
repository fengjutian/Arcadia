import { t } from '../../i18n'
import { Alert, Button, Empty, Space, Table, Tag, Typography, message } from '../../components/ui'
import { ReloadOutlined } from '../../components/ui/icons'
import { useCallback, useEffect, useState } from 'react'
import { getMigrationStatus, listStoredSitePermissions, ragEnqueueAll, ragIndexStatus, ragListJobs, ragRebuildIndex, ragRetryJob, replaceSitePermissions, type MigrationStatus, type RagIndexStatus, type RagJobRow, listAIProviders } from '../../api'
import type { AIProvider } from '../../types'
import { SITE_PERMISSION_KINDS, type SitePermissionRule } from '../browser/sitePermissions'

const DECISION_COLOR: Record<string, string> = { allow: 'green', deny: 'red', ask: 'gold' }

/**
 * Knowledge-base health: schema version plus the stored site permission rules.
 *
 * `listStoredSitePermissions` reads the database rather than localStorage, so
 * this is the view that tells the user what the app will actually enforce.
 */
export function KnowledgeBaseStatusPanel() {
  const [messageApi, contextHolder] = message.useMessage()
  const [status, setStatus] = useState<MigrationStatus | null>(null)
  const [rules, setRules] = useState<SitePermissionRule[]>([])
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<AIProvider[]>([])
  const [ragStatus, setRagStatus] = useState<RagIndexStatus | null>(null)
  const [ragJobs, setRagJobs] = useState<RagJobRow[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, nextRules, nextProviders, nextRag, nextJobs] = await Promise.all([
        getMigrationStatus(),
        listStoredSitePermissions(),
        listAIProviders(),
        ragIndexStatus().catch(() => null),
        ragListJobs(20).catch(() => []),
      ])
      setStatus(nextStatus)
      setRules(nextRules)
      setProviders(nextProviders)
      setRagStatus(nextRag)
      setRagJobs(nextJobs ?? [])
    } catch {
      // Non-Tauri preview: nothing to report.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function resetRule(origin: string) {
    const remaining = rules.filter(rule => rule.origin !== origin)
    await replaceSitePermissions(remaining)
    setRules(remaining)
    messageApi.success(t("\u5DF2\u6E05\u9664 {value0} \u7684\u7AD9\u70B9\u6743\u9650",{value0:origin}))
  }

  async function rebuildIndex() {
    const target = providers.find(p => p.embeddingModel)
    if (!target) {
      messageApi.warning(t("\u8BF7\u5148\u5728\u300CAI Provider\u300D\u4E2D\u914D\u7F6E\u5E26 embeddingModel \u7684 Provider"))
      return
    }
    const n = await ragRebuildIndex(target.id, target.embeddingModel ?? target.model)
    messageApi.success(t("\u5DF2\u91CD\u5EFA\u7D22\u5F15\uFF1A{value0} \u4E2A\u6587\u6863\u5F85\u5904\u7406",{value0:n}))
    void refresh()
  }

  async function enqueueAll() {
    const target = providers.find(p => p.embeddingModel)
    if (!target) {
      messageApi.warning(t("\u8BF7\u5148\u5728\u300CAI Provider\u300D\u4E2D\u914D\u7F6E\u5E26 embeddingModel \u7684 Provider"))
      return
    }
    const n = await ragEnqueueAll(target.id, target.embeddingModel ?? target.model)
    messageApi.success(t("\u5DF2\u5165\u961F {value0} \u7BC7\u65B0\u6587\u6863",{value0:n}))
    void refresh()
  }

  async function retryJob(jobId: string) {
    await ragRetryJob(jobId)
    void refresh()
  }

  return <div className="kb-status-panel">
    {contextHolder}
    <Space style={{ marginBottom: 8 }} align="center">
      <Typography.Title level={5} style={{ margin: 0 }}>{t("\u77E5\u8BC6\u5E93\u72B6\u6001")}</Typography.Title>
      <Button size="small" icon={<ReloadOutlined spin={loading} />} onClick={() => void refresh()}>{t("\u5237\u65B0")}</Button>
    </Space>
    {status
      ? <Typography.Paragraph type="secondary">{t("\u6570\u636E\u5E93 schema \u7248\u672C")} 
                        <b>{status.version}</b>
          {status.pending > 0
            ? <Tag color="gold" style={{ marginLeft: 8 }}>{t("\u5F85\u5E94\u7528")} {status.pending} {t("\u4E2A\u8FC1\u79FB")}</Tag>
            : <Tag color="green" style={{ marginLeft: 8 }}>{t("\u5DF2\u662F\u6700\u65B0")}</Tag>}
        </Typography.Paragraph>
      : <Alert type="info" showIcon message={t("\u684C\u9762\u7AEF\u4EE5\u5916\u7684\u73AF\u5883\u4E0D\u5305\u542B\u672C\u5730\u77E5\u8BC6\u5E93")}/>}
    <Typography.Title level={5} style={{ marginTop: 16 }}>{t("\u7AD9\u70B9\u6743\u9650\uFF08")}{rules.length}）</Typography.Title>
    {rules.length === 0
      ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("\u5C1A\u672A\u8BB0\u5F55\u4EFB\u4F55\u7AD9\u70B9\u6743\u9650")}/>
      : <Table<SitePermissionRule>
          size="small"
          rowKey="origin"
          dataSource={rules}
          pagination={false}
          columns={[
            { title:t("\u7AD9\u70B9"),dataIndex:'origin'},
            ...SITE_PERMISSION_KINDS.map(        (kind






             )                                =>( {title:kind,key:kind,width:80,render:(_:unknown,rule:SitePermissionRule)=>(<Tag color={DECISION_COLOR[rule[kind]]??'default'}>{rule[kind]}</Tag>),})),
            {
              title:t("\u64CD\u4F5C"),
              key: 'actions',
              width: 90,
              render: (_: unknown, rule: SitePermissionRule) =>(
                <Button size="small" danger onClick={() => void resetRule(rule.origin)}>{t("\u6E05\u9664")}</Button>)
               ,
            },
          ]}
        />}

    <Typography.Title level={5} style={{ marginTop: 16 }}>{t("RAG \u7D22\u5F15")}</Typography.Title>
    {ragStatus
      ? <Space wrap>
          <Tag>{t("\u603B\u4EFB\u52A1")} {ragStatus.totalJobs}</Tag>
          <Tag color="gold">{t("\u7B49\u5F85")} {ragStatus.pending}</Tag>
          <Tag color="red">{t("\u5931\u8D25")} {ragStatus.failed}</Tag>
          <Tag color="green">{t("\u5B8C\u6210")} {ragStatus.completed}</Tag>
          <Tag>{t("\u5DF2\u7D22\u5F15")} {ragStatus.indexedDocuments}</Tag>
          {ragStatus.recovered > 0 && <Tag color="cyan">{t("\u5DF2\u6062\u590D")} {ragStatus.recovered}</Tag>}
        </Space>
      : <Alert type="info" showIcon message={t("\u975E\u684C\u9762\u73AF\u5883\uFF0C\u8DF3\u8FC7 RAG \u7D22\u5F15")}/>}
    <Space style={{ marginTop: 8 }} wrap>
      <Button size="small" onClick={() => void rebuildIndex()}>{t("\u91CD\u5EFA\u7D22\u5F15")}</Button>
      <Button size="small" onClick={() => void enqueueAll()}>{t("\u5165\u961F\u65B0\u6587\u6863")}</Button>
    </Space>
    {ragJobs.length > 0 &&(
      <Table<RagJobRow>
        size="small"
        style={{ marginTop: 8 }}
        rowKey="id"
        dataSource={ragJobs}
        pagination={false}
        columns={[
          { title:t("\u6587\u6863"),dataIndex:'documentId'},
          { title: 'Provider', dataIndex: 'providerId' },
          { title:t("\u6A21\u578B"),dataIndex:'model'},
          {
            title:t("\u72B6\u6001"),
            dataIndex: 'status',
            render: (status: RagJobRow['status']) => {
              const color = status === 'COMPLETED' ? 'green'
                : status === 'FAILED' ? 'red'
                : status === 'CANCELLED' ? 'default'
                : 'blue'
              return <Tag color={color}>{status}</Tag>
            },
          },
          {
            title:t("\u64CD\u4F5C"),
            key: 'actions',
            render: (_: unknown, job: RagJobRow) =>(
              <Button size="small" onClick={() => void retryJob(job.id)}>{t("\u91CD\u8BD5")}</Button>)
             ,
          },
        ]}
      />)
     }
  </div>
}
import { t } from '../../i18n'
import { Button, message, Table, Tag, Tooltip, Typography } from '../../components/ui'
import { ReloadOutlined, SyncOutlined } from '../../components/ui/icons'
import { useEffect, useState } from 'react'
import type { Task } from '../../types'
import { listRecentTasks, recoverStaleTasks, retryTask } from '../../api'

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'gold',
  PROCESSING: 'blue',
  COMPLETED: 'green',
  FAILED: 'red',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING:t("\u7B49\u5F85\u4E2D"),
  PROCESSING:t("\u5904\u7406\u4E2D"),
  COMPLETED:t("\u5DF2\u5B8C\u6210"),
  FAILED:t("\u5931\u8D25"),
}

const KIND_LABEL: Record<string, string> = {
  'autotag.generate':t("\u81EA\u52A8\u6807\u7B7E"),
  'embedding.index':t("\u5411\u91CF\u7D22\u5F15"),
}

export function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  async function refresh() {
    setLoading(true)
    try {
      const recovered = await recoverStaleTasks(120)
      if (recovered > 0) messageApi.info(t("\u56DE\u6536\u4E86 {value0} \u4E2A\u957F\u65F6\u95F4\u65E0\u54CD\u5E94\u7684\u4EFB\u52A1",{value0:recovered}))
      setTasks(await listRecentTasks(50))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("\u4EFB\u52A1\u961F\u5217\u52A0\u8F7D\u5931\u8D25"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function retry(task: Task) {
    try {
      await retryTask(task.id)
      messageApi.success(t("\u5DF2\u91CD\u65B0\u5165\u961F"))
      await refresh()
    } catch {
      messageApi.error(t("\u91CD\u8BD5\u5931\u8D25"))
    }
  }

  if (tasks.length === 0) return <>{contextHolder}</>

  const active = tasks.filter(task => task.status === 'PENDING' || task.status === 'PROCESSING').length
  const failed = tasks.filter(task => task.status === 'FAILED').length
  const badge = active > 0 ?t("{value0} \u4E2A\u8FDB\u884C\u4E2D",{value0:active}):failed>0?t("{value0} \u4E2A\u5931\u8D25",{value0:failed}):t("\u5DF2\u5168\u90E8\u5B8C\u6210")
  const badgeClass = active > 0 ? ' is-active' : failed > 0 ? ' is-error' : ''

  return <div className="task-panel">
    {contextHolder}
    <div className="task-panel__head">
      <div className="task-panel__title">
        <span className={`task-panel__icon${loading ? ' is-spinning' : ''}`}><SyncOutlined/></span>
        <span>
          <Typography.Title level={3}>{t("\u4EFB\u52A1\u961F\u5217")}</Typography.Title>
          <Typography.Text type="secondary">{t("\u4FDD\u5B58\u540E\u7684\u89E3\u6790\u3001\u6807\u7B7E\u4E0E\u7D22\u5F15\u4EFB\u52A1")}</Typography.Text>
        </span>
        <span className={`task-panel__badge${badgeClass}`}>{badge}</span>
      </div>
      <Button type="text" size="small" icon={<ReloadOutlined/>} loading={loading} onClick={() => void refresh()}>{t("\u5237\u65B0")}</Button>
    </div>
    <Table<Task>
      size="small"
      rowKey="id"
      dataSource={tasks}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      columns={[
        { title:t("\u7C7B\u578B"),dataIndex:'kind',width:150,render:(kind:string)=>KIND_LABEL[kind]??kind},
        { title:t("\u72B6\u6001"),dataIndex:'status',width:104,render:(status:string)=><Tag color={STATUS_COLOR[status]??'default'}>{STATUS_LABEL[status]?? status}</Tag> },
        { title:t("\u8FDB\u5EA6"),width:100,render:(_,task)=>`${task.attempts}/${task.maxAttempts}`},
        { title:t("\u6700\u8FD1\u9519\u8BEF"),dataIndex:'lastError',ellipsis:true,render:(value?:string)=>value?<Tooltip title={value}><Typography.Text type="danger">{value}</Typography.Text></Tooltip>:<Typography.Text type="secondary">—</Typography.Text>},
        { title:t("\u64CD\u4F5C"),width:90,render:(_,task)=>task.status==='FAILED'?<Button size="small"icon={<ReloadOutlined/>} onClick={() => void retry(task)}>{t("\u91CD\u8BD5")}</Button>:null},
      ]}
    />
  </div>
}
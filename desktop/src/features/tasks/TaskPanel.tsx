import { t } from '@arcadia/i18n'
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
  PENDING:t("等待中"),
  PROCESSING:t("处理中"),
  COMPLETED:t("已完成"),
  FAILED:t("失败"),
}

const KIND_LABEL: Record<string, string> = {
  'autotag.generate':t("自动标签"),
  'embedding.index':t("向量索引"),
}

export function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  async function refresh() {
    setLoading(true)
    try {
      const recovered = await recoverStaleTasks(120)
      if (recovered > 0) messageApi.info(t("回收了 {value0} 个长时间无响应的任务",{value0:recovered}))
      setTasks(await listRecentTasks(50))
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message :t("任务队列加载失败"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  async function retry(task: Task) {
    try {
      await retryTask(task.id)
      messageApi.success(t("已重新入队"))
      await refresh()
    } catch {
      messageApi.error(t("重试失败"))
    }
  }

  if (tasks.length === 0) return <>{contextHolder}</>

  const active = tasks.filter(task => task.status === 'PENDING' || task.status === 'PROCESSING').length
  const failed = tasks.filter(task => task.status === 'FAILED').length
  const badge = active > 0 ?t("{value0} 个进行中",{value0:active}):failed>0?t("{value0} 个失败",{value0:failed}):t("已全部完成")
  const badgeClass = active > 0 ? ' is-active' : failed > 0 ? ' is-error' : ''

  return <div className="task-panel">
    {contextHolder}
    <div className="task-panel__head">
      <div className="task-panel__title">
        <span className={`task-panel__icon${loading ? ' is-spinning' : ''}`}><SyncOutlined/></span>
        <span>
          <Typography.Title level={3}>{t("任务队列")}</Typography.Title>
          <Typography.Text type="secondary">{t("保存后的解析、标签与索引任务")}</Typography.Text>
        </span>
        <span className={`task-panel__badge${badgeClass}`}>{badge}</span>
      </div>
      <Button type="text" size="small" icon={<ReloadOutlined/>} loading={loading} onClick={() => void refresh()}>{t("刷新")}</Button>
    </div>
    <Table<Task>
      size="small"
      rowKey="id"
      dataSource={tasks}
      loading={loading}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      columns={[
        { title:t("类型"),dataIndex:'kind',width:150,render:(kind:string)=>KIND_LABEL[kind]??kind},
        { title:t("状态"),dataIndex:'status',width:104,render:(status:string)=><Tag color={STATUS_COLOR[status]??'default'}>{STATUS_LABEL[status]?? status}</Tag> },
        { title:t("进度"),width:100,render:(_,task)=>`${task.attempts}/${task.maxAttempts}`},
        { title:t("最近错误"),dataIndex:'lastError',ellipsis:true,render:(value?:string)=>value?<Tooltip title={value}><Typography.Text type="danger">{value}</Typography.Text></Tooltip>:<Typography.Text type="secondary">—</Typography.Text>},
        { title:t("操作"),width:90,render:(_,task)=>task.status==='FAILED'?<Button size="small" icon={<ReloadOutlined/>} onClick={() => void retry(task)}>{t("重试")}</Button>:null},
      ]}
    />
  </div>
}
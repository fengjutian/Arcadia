import { Button, Space, Typography } from '../../components/ui'
import { CheckCircleOutlined, CopyOutlined, PlusOutlined, ReloadOutlined } from '../../components/ui/icons'
import type { BrowserTab } from '../../types'

export function BrowserErrorView({ tab, onRetry, onNewTab, onCopy, onUnblock }: {
  tab: BrowserTab
  onRetry: () => void
  onNewTab: () => void
  onCopy: () => void
  onUnblock?: () => void
}) {
  const error = tab.error
  const kind = error?.kind ?? 'load-failed'
  const blocked = kind === 'site-blocked'
  const host = error?.host ?? ''
  const ruleHost = error?.ruleHost ?? ''
  const message = error?.message ?? '未知错误'
  const title = blocked ? '已封杀该网站'
    : kind === 'web-mode-required' ? '请在 Tauri 桌面应用中打开网页'
    : kind === 'tab-view-missing' ? '标签页视图已失效'
    : kind === 'unsupported-protocol' ? '应用不支持该协议'
    : kind === 'offline' ? '设备当前离线'
    : kind === 'dns' ? '找不到网站地址'
    : kind === 'timeout' ? '连接超时'
    : kind === 'tls' ? '无法建立安全连接'
    : kind === 'connection-refused' ? '服务器拒绝连接'
    : kind === 'http-client' || kind === 'http-server' ? `服务器返回错误${error?.httpStatus ? `（${error.httpStatus}）` : ''}`
    : '无法加载该网页'
  const eyebrow = blocked ? '网站封杀'
    : kind === 'web-mode-required' ? '需要桌面应用'
    : kind === 'tab-view-missing' ? '需要重建视图'
    : kind === 'unsupported-protocol' ? '协议被拦截'
    : '加载失败'
  return <div className={`browser-error${blocked ? ' browser-error--blocked' : ''}`}>
    <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
    <Typography.Title level={3}>{title}</Typography.Title>
    {blocked
      ? <>
          <Typography.Paragraph type="secondary">
            {host
              ? <>你已把 <b>{host}</b> 加入封杀名单{ruleHost && ruleHost !== host ? `（命中规则 ${ruleHost}）` : ''}，应用已阻止该网站继续加载。</>
              : '该网站已在封杀名单中，应用已阻止它继续加载。'}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">可在「设置 → 隐私 → 网站封杀」中管理名单；解除封杀后即可重新访问。</Typography.Paragraph>
        </>
      : <Typography.Paragraph type="secondary">{message}</Typography.Paragraph>}
    {tab.url && <Typography.Text code className="browser-error__url">{tab.url}</Typography.Text>}
    <Space wrap>
      {blocked && onUnblock && <Button type="primary" icon={<CheckCircleOutlined/>} onClick={onUnblock}>解除封杀并访问</Button>}
      {!blocked && !['web-mode-required','unsupported-protocol'].includes(kind) && <Button type="primary" icon={<ReloadOutlined/>} onClick={onRetry}>重试</Button>}
      <Button icon={<PlusOutlined/>} onClick={onNewTab}>返回新标签页</Button>
      {tab.url && <Button icon={<CopyOutlined/>} onClick={onCopy}>复制 URL</Button>}
    </Space>
  </div>
}

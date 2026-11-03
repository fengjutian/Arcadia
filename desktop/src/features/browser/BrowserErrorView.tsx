import { t } from '@arcadia/i18n'
import { Button, Space, Typography } from '@arcadia/ui'
import { CheckCircleOutlined, CopyOutlined, LockOutlined, PlusOutlined, ReloadOutlined } from '@arcadia/ui/icons'
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
  const privateMode = tab.private === true
  const host = error?.host ?? ''
  const ruleHost = error?.ruleHost ?? ''
  const message = error?.message ??t("未知错误")
  const title = blocked ?t("已封杀该网站")
    : kind === 'web-mode-required' && privateMode ?t("此页面暂时无法在私密模式中打开")
    : kind === 'web-mode-required' ?t("当前环境无法打开此网页")
    : kind === 'tab-view-missing' ?t("标签页视图已失效")
    : kind === 'unsupported-protocol' ?t("应用不支持该协议")
    : kind === 'offline' ?t("设备当前离线")
    : kind === 'dns' ?t("找不到网站地址")
    : kind === 'timeout' ?t("连接超时")
    : kind === 'tls' ?t("无法建立安全连接")
    : kind === 'connection-refused' ?t("服务器拒绝连接")
    : kind === 'http-client' || kind === 'http-server' ?t("服务器返回错误{value0}",{value0:error?.httpStatus?`（${error.httpStatus}）`:''}):t("无法加载该网页")

  const eyebrow = blocked ?t("网站封杀")
    : kind === 'web-mode-required' && privateMode ?t("私密浏览")
    : kind === 'web-mode-required' ?t("浏览服务不可用")
    : kind === 'tab-view-missing' ?t("需要重建视图")
    : kind === 'unsupported-protocol' ?t("协议被拦截")
    :t("加载失败")
  return <div className={`browser-error${blocked ? ' browser-error--blocked' : ''}${privateMode ? ' browser-error--private' : ''}`}>
    {privateMode && <div className="browser-private-mark"><LockOutlined/><span>{t("私密浏览")}</span></div>}
    <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
    <Typography.Title level={3}>{title}</Typography.Title>
    {blocked
      ? <>
          <Typography.Paragraph type="secondary">
            {host
              ? <>{t("你已把")} <b>{host}</b> {t("加入封杀名单")}{ruleHost&&ruleHost!==host?t("（命中规则 {value0}）",{value0:ruleHost}):''}{t("，应用已阻止该网站继续加载。")}</>
              :t("该网站已在封杀名单中，应用已阻止它继续加载。")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t("可在「设置 \u2192 隐私 \u2192 网站封杀」中管理名单；解除封杀后即可重新访问。")}</Typography.Paragraph>
        </>
      : kind === 'web-mode-required' && privateMode
        ? <Typography.Paragraph type="secondary">{t("此标签不会保存浏览历史、关闭记录、站点权限或表单数据。你可以返回私密新标签页后重试。")}</Typography.Paragraph>
        : <Typography.Paragraph type="secondary">{message}</Typography.Paragraph>}
    {tab.url && <Typography.Text code className="browser-error__url">{tab.url}</Typography.Text>}
    <Space wrap>
      {blocked && onUnblock && <Button type="primary" icon={<CheckCircleOutlined/>} onClick={onUnblock}>{t("解除封杀并访问")}</Button>}
      {!blocked && !['web-mode-required','unsupported-protocol'].includes(kind) && <Button type="primary" icon={<ReloadOutlined/>} onClick={onRetry}>{t("重试")}</Button>}
      <Button icon={<PlusOutlined/>} onClick={onNewTab}>{t("返回新标签页")}</Button>
      {tab.url && <Button icon={<CopyOutlined/>} onClick={onCopy}>{t("复制 URL")}</Button>}
    </Space>
  </div>
}
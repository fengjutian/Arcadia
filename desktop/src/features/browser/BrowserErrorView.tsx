import { t } from '../../i18n'
import { Button, Space, Typography } from '../../components/ui'
import { CheckCircleOutlined, CopyOutlined, LockOutlined, PlusOutlined, ReloadOutlined } from '../../components/ui/icons'
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
  const message = error?.message ??t("\u672A\u77E5\u9519\u8BEF")
  const title = blocked ?t("\u5DF2\u5C01\u6740\u8BE5\u7F51\u7AD9")
    : kind === 'web-mode-required' && privateMode ?t("\u6B64\u9875\u9762\u6682\u65F6\u65E0\u6CD5\u5728\u79C1\u5BC6\u6A21\u5F0F\u4E2D\u6253\u5F00")
    : kind === 'web-mode-required' ?t("\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u6253\u5F00\u6B64\u7F51\u9875")
    : kind === 'tab-view-missing' ?t("\u6807\u7B7E\u9875\u89C6\u56FE\u5DF2\u5931\u6548")
    : kind === 'unsupported-protocol' ?t("\u5E94\u7528\u4E0D\u652F\u6301\u8BE5\u534F\u8BAE")
    : kind === 'offline' ?t("\u8BBE\u5907\u5F53\u524D\u79BB\u7EBF")
    : kind === 'dns' ?t("\u627E\u4E0D\u5230\u7F51\u7AD9\u5730\u5740")
    : kind === 'timeout' ?t("\u8FDE\u63A5\u8D85\u65F6")
    : kind === 'tls' ?t("\u65E0\u6CD5\u5EFA\u7ACB\u5B89\u5168\u8FDE\u63A5")
    : kind === 'connection-refused' ?t("\u670D\u52A1\u5668\u62D2\u7EDD\u8FDE\u63A5")
    : kind === 'http-client' || kind === 'http-server' ?t("\u670D\u52A1\u5668\u8FD4\u56DE\u9519\u8BEF{value0}",{value0:error?.httpStatus?`（${error.httpStatus}）`:''}):t("\u65E0\u6CD5\u52A0\u8F7D\u8BE5\u7F51\u9875")

  const eyebrow = blocked ?t("\u7F51\u7AD9\u5C01\u6740")
    : kind === 'web-mode-required' && privateMode ?t("\u79C1\u5BC6\u6D4F\u89C8")
    : kind === 'web-mode-required' ?t("\u6D4F\u89C8\u670D\u52A1\u4E0D\u53EF\u7528")
    : kind === 'tab-view-missing' ?t("\u9700\u8981\u91CD\u5EFA\u89C6\u56FE")
    : kind === 'unsupported-protocol' ?t("\u534F\u8BAE\u88AB\u62E6\u622A")
    :t("\u52A0\u8F7D\u5931\u8D25")
  return <div className={`browser-error${blocked ? ' browser-error--blocked' : ''}${privateMode ? ' browser-error--private' : ''}`}>
    {privateMode && <div className="browser-private-mark"><LockOutlined/><span>{t("\u79C1\u5BC6\u6D4F\u89C8")}</span></div>}
    <Typography.Text className="eyebrow">{eyebrow}</Typography.Text>
    <Typography.Title level={3}>{title}</Typography.Title>
    {blocked
      ? <>
          <Typography.Paragraph type="secondary">
            {host
              ? <>{t("\u4F60\u5DF2\u628A")} <b>{host}</b> {t("\u52A0\u5165\u5C01\u6740\u540D\u5355")}{ruleHost&&ruleHost!==host?t("\uFF08\u547D\u4E2D\u89C4\u5219 {value0}\uFF09",{value0:ruleHost}):''}{t("\uFF0C\u5E94\u7528\u5DF2\u963B\u6B62\u8BE5\u7F51\u7AD9\u7EE7\u7EED\u52A0\u8F7D\u3002")}</>
              :t("\u8BE5\u7F51\u7AD9\u5DF2\u5728\u5C01\u6740\u540D\u5355\u4E2D\uFF0C\u5E94\u7528\u5DF2\u963B\u6B62\u5B83\u7EE7\u7EED\u52A0\u8F7D\u3002")}
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary">{t("\u53EF\u5728\u300C\u8BBE\u7F6E \u2192 \u9690\u79C1 \u2192 \u7F51\u7AD9\u5C01\u6740\u300D\u4E2D\u7BA1\u7406\u540D\u5355\uFF1B\u89E3\u9664\u5C01\u6740\u540E\u5373\u53EF\u91CD\u65B0\u8BBF\u95EE\u3002")}</Typography.Paragraph>
        </>
      : kind === 'web-mode-required' && privateMode
        ? <Typography.Paragraph type="secondary">{t("\u6B64\u6807\u7B7E\u4E0D\u4F1A\u4FDD\u5B58\u6D4F\u89C8\u5386\u53F2\u3001\u5173\u95ED\u8BB0\u5F55\u3001\u7AD9\u70B9\u6743\u9650\u6216\u8868\u5355\u6570\u636E\u3002\u4F60\u53EF\u4EE5\u8FD4\u56DE\u79C1\u5BC6\u65B0\u6807\u7B7E\u9875\u540E\u91CD\u8BD5\u3002")}</Typography.Paragraph>
        : <Typography.Paragraph type="secondary">{message}</Typography.Paragraph>}
    {tab.url && <Typography.Text code className="browser-error__url">{tab.url}</Typography.Text>}
    <Space wrap>
      {blocked && onUnblock && <Button type="primary" icon={<CheckCircleOutlined/>} onClick={onUnblock}>{t("\u89E3\u9664\u5C01\u6740\u5E76\u8BBF\u95EE")}</Button>}
      {!blocked && !['web-mode-required','unsupported-protocol'].includes(kind) && <Button type="primary" icon={<ReloadOutlined/>} onClick={onRetry}>{t("\u91CD\u8BD5")}</Button>}
      <Button icon={<PlusOutlined/>} onClick={onNewTab}>{t("\u8FD4\u56DE\u65B0\u6807\u7B7E\u9875")}</Button>
      {tab.url && <Button icon={<CopyOutlined/>} onClick={onCopy}>{t("\u590D\u5236 URL")}</Button>}
    </Space>
  </div>
}
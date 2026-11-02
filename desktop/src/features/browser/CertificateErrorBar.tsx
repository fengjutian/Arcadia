import { t } from '../../i18n'
import { Alert, Button, Space, Typography } from '../../components/ui'
import { SafetyCertificateOutlined } from '../../components/ui/icons'
import type { CertificateErrorPayload } from '../../services/nativeBrowser'

export interface CertificateErrorBarProps {
  payload: CertificateErrorPayload
  onRespond: (allow: boolean) => void
}

/**
 * Persistent banner that sits at the top of the browser surface while a
 * certificate failure blocks the underlying webview from loading. The user can
 * dismiss the banner or explicitly allow the intercepted navigation once.
 */
export function CertificateErrorBar({ payload, onRespond }: CertificateErrorBarProps) {
  return <Alert
    banner
    type="error"
    showIcon
    icon={<SafetyCertificateOutlined />}
    message={<>
        <Typography.Text strong>{t("\u8BC1\u4E66\u9A8C\u8BC1\u88AB\u62E6\u622A\uFF1A")}</Typography.Text>{' '}
        {payload.url ||t("\u5F53\u524D\u7F51\u9875")}
      </>}
    description={<>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>{t("\u6D4F\u89C8\u5668\u9ED8\u8BA4\u62D2\u7EDD\u5C55\u793A\u8BC1\u4E66\u65E0\u6548\u7684\u7F51\u9875\uFF08")}
                           {payload.message ||t("\u672A\u77E5\u539F\u56E0")}）。
          {payload.repeated &&t(" \u540C\u4E00\u7AD9\u70B9\u6B64\u524D\u5DF2\u88AB\u62E6\u622A\u8FC7\u4E00\u6B21\uFF0C\u8BF7\u786E\u8BA4\u540E\u518D\u7EE7\u7EED\u3002")}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" danger onClick={() => onRespond(false)}>{t("\u4FDD\u6301\u62E6\u622A")}</Button>
          <Button onClick={() => onRespond(true)}>{t("\u4EC5\u672C\u6B21\u7EE7\u7EED\u8BBF\u95EE")}</Button>
        </Space>
      </>}
    closable={false}
  />
}
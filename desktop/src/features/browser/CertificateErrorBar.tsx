import { t } from '@arcadia/i18n'
import { Alert, Button, Space, Typography } from '@arcadia/ui'
import { SafetyCertificateOutlined } from '@arcadia/ui/icons'
import type { CertificateErrorPayload } from '@arcadia/browser-core/nativeBrowser'

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
        <Typography.Text strong>{t("证书验证被拦截：")}</Typography.Text>{' '}
        {payload.url ||t("当前网页")}
      </>}
    description={<>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>{t("浏览器默认拒绝展示证书无效的网页（")}
                           {payload.message ||t("未知原因")}）。
          {payload.repeated &&t(" 同一站点此前已被拦截过一次，请确认后再继续。")}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" danger onClick={() => onRespond(false)}>{t("保持拦截")}</Button>
          <Button onClick={() => onRespond(true)}>{t("仅本次继续访问")}</Button>
        </Space>
      </>}
    closable={false}
  />
}
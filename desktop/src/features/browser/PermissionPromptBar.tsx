import { t } from '@arcadia/i18n'
import { Button, Space, Typography } from '@arcadia/ui'
import { CheckCircleOutlined, CloseCircleOutlined, SafetyCertificateOutlined } from '@arcadia/ui/icons'
import type { UsePermissionPromptResult } from '@arcadia/browser-core/usePermissionPrompt'
import { describePrompt } from '@arcadia/browser-core/usePermissionPrompt'

export interface PermissionPromptBarProps {
  prompt: UsePermissionPromptResult
}

/**
 * Inline permission bar shown beneath the address bar. Three choices per
 * the task description:
 *   - 本次允许
 *   - 始终允许
 *   - 拒绝  (default — implies deny-once)
 * Hidden when no pending request.
 */
export function PermissionPromptBar({ prompt }: PermissionPromptBarProps) {
  const { pending, decide } = prompt
  if (!pending) return null
  const { origin, kindLabel, originLabel } = describePrompt(pending)
  return(
    <div className="browser-permission-prompt" role="alert" aria-live="polite">
      <span className="browser-permission-prompt__icon" aria-hidden="true">
        <SafetyCertificateOutlined />
      </span>
      <div className="browser-permission-prompt__body">
        <Typography.Text strong>
          {originLabel} {t("请求使用")} {kindLabel}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{t("来源：")}
             {origin}
        </Typography.Text>
      </div>
      <Space className="browser-permission-prompt__actions" size={6}>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => void decide('allow-once')}
        >{t("本次允许")} 

        </Button>
        {!pending.private &&(
          <Button
            size="small"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => void decide('allow-always')}
          >{t("始终允许")} 

          </Button>)
         }
        <Button
          size="small"
          danger
          icon={<CloseCircleOutlined />}
          onClick={() => void decide('deny-once')}
        >{t("拒绝")} 

        </Button>
      </Space>
    </div>)

}
import { t } from '../../i18n'
import { Button, Space, Typography } from '../../components/ui'
import { CheckCircleOutlined, CloseCircleOutlined, SafetyCertificateOutlined } from '../../components/ui/icons'
import type { UsePermissionPromptResult } from './usePermissionPrompt'
import { describePrompt } from './usePermissionPrompt'

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
          {originLabel} {t("\u8BF7\u6C42\u4F7F\u7528")} {kindLabel}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{t("\u6765\u6E90\uFF1A")}
             {origin}
        </Typography.Text>
      </div>
      <Space className="browser-permission-prompt__actions" size={6}>
        <Button
          size="small"
          icon={<CheckCircleOutlined />}
          onClick={() => void decide('allow-once')}
        >{t("\u672C\u6B21\u5141\u8BB8")} 

        </Button>
        {!pending.private &&(
          <Button
            size="small"
            type="primary"
            icon={<CheckCircleOutlined />}
            onClick={() => void decide('allow-always')}
          >{t("\u59CB\u7EC8\u5141\u8BB8")} 

          </Button>)
         }
        <Button
          size="small"
          danger
          icon={<CloseCircleOutlined />}
          onClick={() => void decide('deny-once')}
        >{t("\u62D2\u7EDD")} 

        </Button>
      </Space>
    </div>)

}
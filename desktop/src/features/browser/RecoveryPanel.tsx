import { t } from '../../i18n'
import { Button, Modal, Space, Typography } from '../../components/ui'
import { ExclamationCircleOutlined } from '../../components/ui/icons'
import type { SessionLockState } from '../../services/session'

export type RecoveryChoice = 'all' | 'pinned' | 'discard'

export interface RecoveryPanelProps {
  open: boolean
  state: SessionLockState | null
  onChoose: (choice: RecoveryChoice) => void
}

/**
 * Modal that appears when the previous run left a lock behind (crash, kill,
 * power loss). Three options:
 *   - 恢复全部 — restore every non-private tab
 *   - 仅恢复固定标签 — restore pinned tabs only
 *   - 放弃恢复 — start a fresh tab; the lock is cleared either way
 */
export function RecoveryPanel({ open, state, onChoose }: RecoveryPanelProps) {
  if (!state) return null
  const ageMinutes = Math.max(0, Math.round((Date.now() / 1000 - state.updatedAt) / 60))
  return(
    <Modal
      title={
        <Space>
          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
          <span>{t("\u68C0\u6D4B\u5230\u4E0A\u4E00\u6B21\u4F1A\u8BDD\u5F02\u5E38\u9000\u51FA")}</span>
        </Space>
      }
      open={open}
      closable={false}
      mask={{ closable: false }}
      footer={null}
      width={520}
    >
      <Typography.Paragraph>{t("\u4E0A\u6B21\u4F1A\u8BDD\u7EA6")} 
              <b>{ageMinutes} {t("\u5206\u949F\u524D")}</b> {t("\u672A\u6B63\u5E38\u7ED3\u675F\uFF08\u5D29\u6E83 / \u5F3A\u6740 / \u65AD\u7535\uFF09\u3002\u8BF7\u9009\u62E9\u5982\u4F55\u6062\u590D\uFF1A")} 
      </Typography.Paragraph>
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Button block type="primary" onClick={() => onChoose('all')}>{t("\u6062\u590D\u5168\u90E8\u6807\u7B7E")} 

        </Button>
        <Button block onClick={() => onChoose('pinned')}>{t("\u4EC5\u6062\u590D\u56FA\u5B9A\u6807\u7B7E")} 

        </Button>
        <Button block danger onClick={() => onChoose('discard')}>{t("\u653E\u5F03\u6062\u590D\uFF0C\u4ECE\u65B0\u6807\u7B7E\u5F00\u59CB")} 

        </Button>
      </Space>
    </Modal>)

}
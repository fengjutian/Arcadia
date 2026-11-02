import { useState } from 'react'
import { t } from '../../i18n'
import { Button, Input, Modal, Space, Tag, Typography } from '../../components/ui'
import { DeleteOutlined, PlusOutlined } from '../../components/ui/icons'
import { SITE_SEARCH_SHORTCUTS, validateCustomShortcut, type SiteSearchShortcut } from './siteSearch'

/**
 * Small editor for user-defined `!` shortcuts. Built-ins are shown read-only;
 * only custom entries can be removed. Persistence is handled by the caller so
 * this component stays pure UI.
 */
export function SiteSearchManager({
  open,
  custom,
  onSave,
  onClose,
}: {
  open: boolean
  custom: readonly SiteSearchShortcut[]
  onSave: (next: SiteSearchShortcut[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ triggers: '', label: '', template: '' })
  const [error, setError] = useState('')

  function add() {
    const result = validateCustomShortcut(draft, [...SITE_SEARCH_SHORTCUTS, ...custom])
    if (!result.ok) {
      setError(result.reason)
      return
    }
    onSave([...custom, result.shortcut])
    setDraft({ triggers: '', label: '', template: '' })
    setError('')
  }

  return <Modal
    open={open}
    title={t("快捷搜索词")}
    onCancel={onClose}
    footer={<Button onClick={onClose}>{t("完成")}</Button>}
    width={560}
  >
    <Typography.Paragraph type="secondary" className="site-search-manager__intro">
      {t("在命令栏输入「!触发词 查询」直接站内搜索，例如 !gh react hooks。")}
    </Typography.Paragraph>

    <div className="site-search-manager__list">
      {SITE_SEARCH_SHORTCUTS.map(shortcut => <div className="site-search-manager__row" key={shortcut.id}>
        <Tag>{shortcut.triggers.map(trigger => `!${trigger}`).join(' / ')}</Tag>
        <span className="site-search-manager__label">{shortcut.label}</span>
        <Typography.Text type="secondary" className="site-search-manager__builtin">{t("内置")}</Typography.Text>
      </div>)}
      {custom.map(shortcut => <div className="site-search-manager__row" key={shortcut.id}>
        <Tag color="green">{shortcut.triggers.map(trigger => `!${trigger}`).join(' / ')}</Tag>
        <span className="site-search-manager__label">{shortcut.label}</span>
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined/>}
          aria-label={t("删除快捷词")}
          onClick={() => onSave(custom.filter(item => item.id !== shortcut.id))}
        />
      </div>)}
    </div>

    <div className="site-search-manager__form">
      <Input
        placeholder={t("触发词，例如 npm 或 npm,pkg")}
        value={draft.triggers}
        onChange={event => { setDraft({ ...draft, triggers: event.target.value }); setError('') }}
      />
      <Input
        placeholder={t("名称，例如 npm")}
        value={draft.label}
        onChange={event => { setDraft({ ...draft, label: event.target.value }); setError('') }}
      />
      <Input
        placeholder={t("URL 模板，含 %s，例如 https://www.npmjs.com/search?q=%s")}
        value={draft.template}
        onChange={event => { setDraft({ ...draft, template: event.target.value }); setError('') }}
        onPressEnter={add}
      />
      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      <Space>
        <Button type="primary" icon={<PlusOutlined/>} onClick={add}>{t("添加快捷词")}</Button>
      </Space>
    </div>
  </Modal>
}

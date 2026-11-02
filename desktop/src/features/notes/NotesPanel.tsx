import { t } from '../../i18n'
import { useMemo, useState } from 'react'
import { Button, Empty, Input, Popconfirm, Space, Tooltip, Typography } from '../../components/ui'
import { CloseOutlined, DeleteOutlined, EditOutlined, PushpinFilled, PushpinOutlined } from '../../components/ui/icons'
import {
  groupNotesByUrl,
  removeNote,
  updateNote,
  type NoteEntry,
} from './notes'

export interface NotesPanelProps {
  open: boolean
  notes: NoteEntry[]
  onToggle: () => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<NoteEntry, 'comment' | 'text' | 'title'>>) => void
}

export function NotesPanel({ open, notes, onToggle, onRemove, onUpdate }: NotesPanelProps) {
  const groups = useMemo(() => groupNotesByUrl(notes), [notes])
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!open) {
    return <Tooltip title={t("\u7B14\u8BB0\u9762\u677F (Ctrl+Shift+N)")}placement="left">
      <button type="button" className="notes-panel-toggle is-collapsed" onClick={onToggle} aria-label={t("\u6253\u5F00\u7B14\u8BB0\u9762\u677F")}>
        <PushpinOutlined />
      </button>
    </Tooltip>
  }

  return <aside className="notes-panel" role="complementary" aria-label={t("\u7B14\u8BB0\u9762\u677F")}>
    <header className="notes-panel__header">
      <Space>
        <PushpinFilled style={{ color: '#a7dfbd' }} />
        <Typography.Text strong>{t("\u7F51\u9875\u7B14\u8BB0")}</Typography.Text>
        <Typography.Text type="secondary">{notes.length} {t("\u6761")}</Typography.Text>
      </Space>
      <Button type="text" icon={<CloseOutlined />} onClick={onToggle} aria-label={t("\u5173\u95ED\u7B14\u8BB0\u9762\u677F")}/>
    </header>
    <div className="notes-panel__body">
      {groups.length === 0
        ? <Empty description={<>
            <p>{t("\u53F3\u952E\u9009\u4E2D\u6587\u672C \u2192 \"\u52A0\u5165\u7B14\u8BB0\"")}</p>
            <Typography.Text type="secondary">{t("\u9009\u4E2D\u6587\u5B57\u4F1A\u5728\u6B64\u9762\u677F\u91CC\u51FA\u73B0\uFF0C\u65B9\u4FBF\u65E5\u540E\u56DE\u987E\u3002")}</Typography.Text>
          </>} />
        : groups.map(group => <section key={group.url} className="notes-panel__group">
            <header>
              <Typography.Text ellipsis style={{ maxWidth: 240 }} title={group.url}>{group.title || group.url}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{group.notes.length} {t("\u6761")}</Typography.Text>
            </header>
            {group.notes.map(note => <article key={note.id} className="notes-panel__note">
              <blockquote>{note.text}</blockquote>
              {editingId === note.id
                ? <Space.Compact style={{ width: '100%' }}>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      defaultValue={note.comment}
                      onChange={event => onUpdate(note.id, { comment: event.target.value })}
                    />
                    <Button type="text" icon={<CloseOutlined />} onClick={() => setEditingId(null)}>{t("\u5B8C\u6210")}</Button>
                  </Space.Compact>
                : note.comment && <p className="notes-panel__comment">{note.comment}</p>}
              <footer>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>{new Date(note.createdAt).toLocaleString('zh-CN')}</Typography.Text>
                <Space size={4}>
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingId(editingId === note.id ? null : note.id)}>{t("\u6279\u6CE8")}</Button>
                    <Popconfirm title={t("\u5220\u9664\u8FD9\u6761\u7B14\u8BB0\uFF1F")}okText={t("\u5220\u9664")}cancelText={t("\u53D6\u6D88")}okButtonProps={{danger:true}}onConfirm={()=>onRemove(note.id)}>
                      <Button type="text" size="small" danger icon={<DeleteOutlined />}>{t("\u5220\u9664")}</Button>
                    </Popconfirm>
                  </Space>
              </footer>
            </article>)}
          </section>)}
    </div>
  </aside>
}

// Re-export the helpers that the panel uses so the BrowserPage can avoid
// double-importing the module when wiring onRemove / onUpdate.
export { removeNote, updateNote }
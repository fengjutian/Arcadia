import { Button, Typography } from '../../components/ui'
import { PlusOutlined } from '../../components/ui/icons'
import type { ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, action, extra }: { eyebrow: string; title: string; description: string; action?: string; extra?: ReactNode }) {
  return <header className="page-header">
    <div><Typography.Text className="eyebrow">{eyebrow}</Typography.Text><Typography.Title level={1}>{title}</Typography.Title><Typography.Paragraph>{description}</Typography.Paragraph></div>
    {(action || extra) && <div className="page-header__aside">{extra}{action && <Button type="primary" icon={<PlusOutlined/>}>{action}</Button>}</div>}
  </header>
}

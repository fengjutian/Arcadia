import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import { useState, type ReactElement, type ReactNode } from 'react'
import { splitPlacement, type Placement } from './floating'
import { useModalOverlayLifecycle } from './overlayLifecycle'

export type MenuItem = { key?: string; label?: ReactNode; icon?: ReactNode; extra?: ReactNode; disabled?: boolean; danger?: boolean; onClick?: () => void; type?: 'divider' }
export interface MenuProps { items?: Array<MenuItem | null> }
export interface DropdownProps {
  children: ReactElement
  menu: MenuProps
  trigger?: Array<'click' | 'contextMenu'>
  placement?: Placement
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function MenuRows({ items }: { items?: Array<MenuItem | null> }) {
  return <>{items?.map((item, index) => !item ? null : item.type === 'divider'
    ? <Menu.Separator className="ui-dropdown__separator" key={item.key ?? `divider-${index}`}/>
    : <Menu.Item className={`ui-dropdown__item ${item.danger ? 'is-danger' : ''}`} key={item.key ?? index} disabled={item.disabled} onClick={() => item.onClick?.()}>
        {item.icon && <span className="ui-dropdown__icon">{item.icon}</span>}<span>{item.label}</span>{item.extra != null && <span className="ui-dropdown__extra">{item.extra}</span>}
      </Menu.Item>)}</>
}

function ContextRows({ items }: { items?: Array<MenuItem | null> }) {
  return <>{items?.map((item, index) => !item ? null : item.type === 'divider'
    ? <ContextMenu.Separator className="ui-dropdown__separator" key={item.key ?? `divider-${index}`}/>
    : <ContextMenu.Item className={`ui-dropdown__item ${item.danger ? 'is-danger' : ''}`} key={item.key ?? index} disabled={item.disabled} onClick={() => item.onClick?.()}>
        {item.icon && <span className="ui-dropdown__icon">{item.icon}</span>}<span>{item.label}</span>{item.extra != null && <span className="ui-dropdown__extra">{item.extra}</span>}
      </ContextMenu.Item>)}</>
}

export function Dropdown({ children, menu, trigger = ['click'], placement = 'bottomLeft', open, onOpenChange }: DropdownProps) {
  // Menus render in the host document, but the browser route paints the page
  // in a native child WebView stacked above that document. A menu anchored in
  // the rail (the Space switch) or the toolbar therefore loses every pixel
  // that reaches over the page area: its label text and hit area are covered
  // by the page content. Join the Select/Modal/AutoComplete overlay lifecycle
  // so the browser route hides the native surface while a menu is open and
  // restores it on dismissal.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const expanded = open ?? uncontrolledOpen
  useModalOverlayLifecycle(expanded)
  const changeOpen = (value: boolean) => {
    if (open === undefined) setUncontrolledOpen(value)
    onOpenChange?.(value)
  }

  if (trigger.includes('contextMenu')) {
    return <ContextMenu.Root onOpenChange={changeOpen}>
      <ContextMenu.Trigger render={<span className="ui-floating-trigger"/>}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal><ContextMenu.Positioner className="ui-dropdown__positioner"><ContextMenu.Popup className="ui-dropdown"><ContextRows items={menu.items}/></ContextMenu.Popup></ContextMenu.Positioner></ContextMenu.Portal>
    </ContextMenu.Root>
  }
  const { side, align } = splitPlacement(placement)
  return <Menu.Root open={expanded} onOpenChange={changeOpen}>
    <Menu.Trigger nativeButton={false} render={<span className="ui-floating-trigger"/>}>{children}</Menu.Trigger>
    <Menu.Portal><Menu.Positioner side={side} align={align} sideOffset={6} className="ui-dropdown__positioner"><Menu.Popup className="ui-dropdown"><MenuRows items={menu.items}/></Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.Root>
}

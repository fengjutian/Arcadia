/**
 * Model for the Space switch menu.
 *
 * The same rows feed two renderers: the React `Dropdown` (used when no native
 * page is on screen) and the in-page menu drawn by Rust (`space_menu_script`).
 * Keeping one flat, serialisable list means the two cannot drift apart, and it
 * also lets the nested "knowledge scope" and "colour" groups render as compact
 * sections instead of the inert nesting rows the old menu produced.
 */

import { t } from '../../i18n'
import { SPACE_COLORS, SPACE_ICONS } from './spaces'

export type SpaceMenuRow =
  | { type: 'divider' }
  | { type: 'section'; label: string }
  | {
      type?: 'item'
      key: string
      label: string
      checked?: boolean
      disabled?: boolean
      swatch?: string
    }

export interface SpaceMenuInput {
  spaces: { id: string; name: string; tabCount: number }[]
  collections: { id: string; name: string }[]
  currentSpace: { id: string; name: string } | null
  /** Collection the active Space is scoped to, or null for all knowledge. */
  scope: string | null
  /** Accent colour of the active Space, or null for the default. */
  color: string | null
  /** Emoji icon of the active Space, or null for the default. */
  icon: string | null
}

export function spaceMenuRows(input: SpaceMenuInput): SpaceMenuRow[] {
  const rows: SpaceMenuRow[] = []
  if (input.spaces.length) {
    for (const space of input.spaces) {
      const active = space.id === input.currentSpace?.id
      rows.push({
        key: `space:${space.id}`,
        label: `${space.name} · ${space.tabCount}`,
        // Clicking the active Space is a no-op (no tab swap, no auto-save), so
        // mark it instead of leaving the user with a row that does nothing.
        ...(active ? { checked: true } : {}),
      })
    }
  } else {
    rows.push({ key: 'empty', label: t('还没有已保存的 Space'), disabled: true })
  }
  rows.push({ type: 'divider' })
  rows.push({ key: 'save', label: t('保存当前为 Space') })
  rows.push({ key: 'manage', label: t('管理 Space') })
  if (!input.currentSpace) return rows

  rows.push({ key: 'leave', label: t('不使用 Space') })
  rows.push({ type: 'divider' })
  rows.push({ type: 'section', label: t('知识范围') })
  rows.push({ key: 'scope:all', label: t('全部知识库'), checked: input.scope === null })
  for (const collection of input.collections) {
    rows.push({ key: `scope:${collection.id}`, label: collection.name, checked: input.scope === collection.id })
  }
  rows.push({ type: 'divider' })
  rows.push({ type: 'section', label: t('Space 颜色') })
  rows.push({ key: 'space-color:default', label: t('默认'), checked: input.color === null })
  for (const color of SPACE_COLORS) {
    rows.push({
      key: `space-color:${color.value}`,
      label: t(color.label),
      checked: input.color === color.value,
      swatch: color.value,
    })
  }
  rows.push({ type: 'divider' })
  rows.push({ type: 'section', label: t('Space 图标') })
  rows.push({ key: 'space-icon:default', label: t('默认'), checked: input.icon === null })
  for (const icon of SPACE_ICONS) {
    rows.push({ key: `space-icon:${icon}`, label: icon, checked: input.icon === icon })
  }
  return rows
}

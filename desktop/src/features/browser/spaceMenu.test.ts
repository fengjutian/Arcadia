import { describe, expect, it } from 'vitest'
import { spaceMenuRows, type SpaceMenuInput } from './spaceMenu'

const base: SpaceMenuInput = {
  spaces: [],
  collections: [],
  currentSpace: null,
  scope: null,
  color: null,
  icon: null,
}

describe('spaceMenuRows', () => {
  it('offers the save/manage actions and a disabled hint when no Space exists', () => {
    const rows = spaceMenuRows(base)
    expect(rows[0]).toMatchObject({ key: 'empty', disabled: true })
    expect(rows.some(row => 'key' in row && row.key === 'save')).toBe(true)
    expect(rows.some(row => 'key' in row && row.key === 'manage')).toBe(true)
    // Closes on the Space section: knowledge scope and colour only exist for a
    // named Space.
    expect(rows.some(row => row.type === 'section')).toBe(false)
    expect(rows.some(row => 'key' in row && row.key.startsWith('scope:'))).toBe(false)
  })

  it('lists saved Spaces with their tab counts and stable keys', () => {
    const rows = spaceMenuRows({ ...base, spaces: [{ id: 'sp-1', name: '研究', tabCount: 4 }] })
    expect(rows[0]).toEqual({ key: 'space:sp-1', label: '研究 · 4' })
  })

  it('marks the active scope and the active colour', () => {
    const rows = spaceMenuRows({
      ...base,
      spaces: [{ id: 'sp-1', name: '研究', tabCount: 2 }],
      collections: [{ id: 'col-1', name: '论文' }],
      currentSpace: { id: 'sp-1', name: '研究' },
      scope: 'col-1',
      color: '#3b6fd4',
      icon: '🔬',
    })
    expect(rows.some(row => 'key' in row && row.key === 'scope:all' && !row.checked)).toBe(true)
    expect(rows.some(row => 'key' in row && row.key === 'scope:col-1' && row.checked)).toBe(true)
    expect(rows.some(row => 'key' in row && row.key === 'space-color:default' && !row.checked)).toBe(true)
    const blue = rows.find(row => 'key' in row && row.key === 'space-color:#3b6fd4')
    expect(blue).toMatchObject({ checked: true, swatch: '#3b6fd4' })
    // Five more colours, all unchecked.
    expect(rows.filter(row => 'swatch' in row && row.swatch).length).toBe(6)
    const icon = rows.find(row => 'key' in row && row.key === 'space-icon:🔬')
    expect(icon).toMatchObject({ checked: true, label: '🔬' })
    expect(rows.some(row => 'key' in row && row.key === 'space-icon:default' && !row.checked)).toBe(true)
  })

  it('keeps the flat row shapes serialisable for the in-page renderer', () => {
    const rows = spaceMenuRows({
      ...base,
      spaces: [{ id: 'a', name: 'A', tabCount: 1 }],
      currentSpace: { id: 'a', name: 'A' },
    })
    for (const row of rows) {
      expect(['divider', 'section', 'item', undefined]).toContain(row.type)
      expect(() => JSON.stringify(row)).not.toThrow()
    }
  })
})

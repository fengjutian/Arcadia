import { describe, expect, it } from 'vitest'
import { NEW_TAB_RECENT_LIMIT, buildNewTabContext } from './newTabContext'

describe('buildNewTabContext', () => {
  it('is empty when there is no space, queue or saved page', () => {
    expect(buildNewTabContext({ spaceName: null, queuedCount: 0, documents: [] })).toEqual({ cards: [], isEmpty: true })
  })

  it('adds cards in priority order: space, queue, recent, today', () => {
    const context = buildNewTabContext({
      spaceName: '  Research  ',
      queuedCount: 4,
      documents: [{ id: 'd1', title: 'Alpha' }],
      todayVisits: 9,
      todaySites: 3,
    })
    expect(context.isEmpty).toBe(false)
    expect(context.cards.map(card => card.key)).toEqual(['space', 'queue', 'recent', 'today'])
    expect(context.cards[0]).toEqual({ key: 'space', name: 'Research' })
    expect(context.cards[3]).toEqual({ key: 'today', visits: 9, sites: 3 })
  })

  it('omits today when there are no visits', () => {
    const context = buildNewTabContext({ spaceName: null, queuedCount: 0, documents: [], todayVisits: 0, todaySites: 0 })
    expect(context.cards).toEqual([])
    expect(context.isEmpty).toBe(true)
  })

  it('caps recent documents and falls back to the id for a missing title', () => {
    const documents = Array.from({ length: 6 }, (_, index) => ({ id: `d${index}`, title: index === 0 ? '' : `Doc ${index}` }))
    const context = buildNewTabContext({ spaceName: null, queuedCount: 0, documents })
    const recent = context.cards.find(card => card.key === 'recent')
    expect(recent).toEqual({
      key: 'recent',
      documents: [
        { id: 'd0', title: 'd0' },
        { id: 'd1', title: 'Doc 1' },
        { id: 'd2', title: 'Doc 2' },
      ],
    })
    expect(NEW_TAB_RECENT_LIMIT).toBe(3)
  })

  it('does not emit zero-count or blank-space cards', () => {
    const context = buildNewTabContext({ spaceName: '   ', queuedCount: 0, documents: [] })
    expect(context.cards).toEqual([])
  })
})

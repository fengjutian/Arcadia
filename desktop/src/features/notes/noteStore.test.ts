import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PageNote } from '../../api'
import { fromPageNote, loadPageNotes, toPageNote } from './noteStore'
import type { NoteEntry } from './notes'

const state = vi.hoisted(() => ({
  desktop: true,
  stored: [] as PageNote[],
  saved: [] as PageNote[],
}))

vi.mock('../../api', () => ({
  isDesktopRuntime: () => state.desktop,
  listPageNotes: async () => state.stored,
  savePageNote: async (note: PageNote) => { state.saved.push(note) },
  deletePageNote: async () => {},
}))

const STORAGE_KEY = 'arcadia.notes.v1'

function entry(patch: Partial<NoteEntry> = {}): NoteEntry {
  return {
    id: 'note-1',
    url: 'https://example.com/article',
    title: 'Example',
    text: 'quoted text',
    comment: 'my thought',
    createdAt: 1_700_000_000_000,
    ...patch,
  }
}

function stored(patch: Partial<PageNote> = {}): PageNote {
  return {
    id: 'note-1',
    url: 'https://example.com/article',
    title: 'Example',
    quote: 'quoted text',
    comment: 'my thought',
    color: 'green',
    prefix: null,
    suffix: null,
    documentId: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    ...patch,
  }
}

beforeEach(() => {
  state.desktop = true
  state.stored = []
  state.saved = []
  localStorage.clear()
})

describe('toPageNote / fromPageNote', () => {
  it('maps highlight text to the quote column and defaults the colour', () => {
    const note = toPageNote(entry(), 1_700_000_200_000)
    expect(note.quote).toBe('quoted text')
    expect(note.color).toBe('yellow')
    expect(note.updatedAt).toBe(1_700_000_200_000)
    expect(fromPageNote(note)).toMatchObject({ text: 'quoted text', comment: 'my thought' })
  })

  it('round-trips colour and anchors', () => {
    const original = entry({ color: 'blue', prefix: 'before ', suffix: ' after' })
    expect(fromPageNote(toPageNote(original))).toMatchObject({
      color: 'blue',
      prefix: 'before ',
      suffix: ' after',
    })
  })
})

describe('loadPageNotes', () => {
  it('prefers SQLite when it already has notes', async () => {
    state.stored = [stored({ id: 'a' }), stored({ id: 'b' })]
    expect((await loadPageNotes()).map(note => note.id)).toEqual(['a', 'b'])
  })

  it('migrates legacy localStorage notes into SQLite once', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ id: 'legacy' })]))
    const loaded = await loadPageNotes()
    expect(loaded.map(note => note.id)).toEqual(['legacy'])
    expect(state.saved.map(note => note.id)).toEqual(['legacy'])
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]')
  })

  it('keeps the legacy payload when the archive table is empty and no notes exist', async () => {
    expect(await loadPageNotes()).toEqual([])
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('falls back to localStorage outside the desktop shell', async () => {
    state.desktop = false
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry({ id: 'preview' })]))
    expect((await loadPageNotes()).map(note => note.id)).toEqual(['preview'])
  })
})

/**
 * Durable storage for page notes.
 *
 * Notes used to live only in `localStorage` (capped at 500 entries, invisible to
 * search, backup and RAG). They now live in SQLite; this module keeps the React
 * side on the existing `NoteEntry` shape and performs a one-time migration of
 * the old localStorage payload.
 */

import {
  deletePageNote,
  isDesktopRuntime,
  listPageNotes,
  savePageNote,
  type PageNote,
} from '../../api'
import { readNotes, writeNotes, type NoteEntry } from './notes'

const DEFAULT_COLOR = 'yellow' as const

export function toPageNote(entry: NoteEntry, now = Date.now()): PageNote {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    quote: entry.text,
    comment: entry.comment,
    color: entry.color ?? DEFAULT_COLOR,
    prefix: entry.prefix ?? null,
    suffix: entry.suffix ?? null,
    documentId: null,
    createdAt: entry.createdAt,
    updatedAt: now,
  }
}

export function fromPageNote(note: PageNote): NoteEntry {
  return {
    id: note.id,
    url: note.url,
    title: note.title,
    text: note.quote,
    comment: note.comment,
    createdAt: note.createdAt,
    color: note.color,
    prefix: note.prefix ?? undefined,
    suffix: note.suffix ?? undefined,
  }
}

/**
 * Load notes from SQLite, migrating the legacy localStorage payload the first
 * time the table is empty. In the browser-only preview the localStorage store is
 * still authoritative so the UI keeps working without Tauri.
 */
export async function loadPageNotes(): Promise<NoteEntry[]> {
  if (!isDesktopRuntime()) return readNotes()
  const stored = await listPageNotes()
  if (stored.length > 0) return stored.map(fromPageNote)

  const legacy = readNotes()
  if (legacy.length === 0) return []
  let migrated = true
  for (const entry of legacy) {
    try {
      await savePageNote(toPageNote(entry))
    } catch {
      migrated = false
    }
  }
  // Only clear the old store once every entry made it into SQLite, otherwise the
  // next launch would silently drop the ones that failed.
  if (migrated) writeNotes([])
  return legacy
}

export async function persistPageNote(entry: NoteEntry): Promise<void> {
  if (!isDesktopRuntime()) return
  await savePageNote(toPageNote(entry))
}

export async function removePageNote(id: string): Promise<void> {
  if (!isDesktopRuntime()) return
  await deletePageNote(id)
}

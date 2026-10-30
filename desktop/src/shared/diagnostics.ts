import { redactLogLine } from '../features/browser/logRedaction'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface DiagnosticEntry {
  at: string
  level: DiagnosticLevel
  event: string
  details?: Record<string, unknown>
}

const STORAGE_KEY = 'arcadia-diagnostics.v1'
const MAX_ENTRIES = 300

function safeValue(value: unknown): unknown {
  if (value instanceof Error) return redactLogLine(`${value.name}: ${value.message}`)
  if (typeof value === 'string') return redactLogLine(value).slice(0, 1000)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(safeValue)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30).map(([key, item]) => [key, safeValue(item)]))
  return String(value).slice(0, 1000)
}

export function diagnosticLog(event: string, level: DiagnosticLevel = 'info', details?: Record<string, unknown>): void {
  const entry: DiagnosticEntry = {
    at: new Date().toISOString(),
    level,
    event,
    ...(details ? { details: safeValue(details) as Record<string, unknown> } : {}),
  }
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DiagnosticEntry[]
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...current.slice(-(MAX_ENTRIES - 1)), entry]))
  } catch { /* Diagnostics must never interrupt the user action being logged. */ }
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  writer(`[diagnostic] ${event}`, entry.details ?? '')
}

export function readDiagnosticLogs(): DiagnosticEntry[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as DiagnosticEntry[] }
  catch { return [] }
}


import { t } from '../../i18n'
export function parseStringMap(raw: string, label: string): Record<string, string> {
  if (!raw.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new Error(t("{value0}\u5FC5\u987B\u662F\u6709\u6548\u7684 JSON \u5BF9\u8C61",{value0:label}))}
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(t("{value0}\u5FC5\u987B\u662F JSON \u5BF9\u8C61",{value0:label}))
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim() || typeof value !== 'string') throw new Error(t("{value0}\u4E2D\u7684\u952E\u548C\u503C\u90FD\u5FC5\u987B\u662F\u5B57\u7B26\u4E32",{value0:label}))
    result[key] = value
  }
  return result
}

export function parseArguments(raw: string): string[] {
  return raw.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
}

export function formatStringMap(value: Record<string, string>): string {
  return Object.keys(value).length ? JSON.stringify(value, null, 2) : ''
}
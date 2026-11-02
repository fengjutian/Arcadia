/** Minimal JSON Schema support for MCP tool argument forms. */

export type ArgumentIssueReason =
  | 'required'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'enum'

export interface ArgumentIssue {
  field: string
  reason: ArgumentIssueReason
}

export interface SchemaField {
  name: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'unknown'
  required: boolean
  description?: string
  enumValues?: string[]
  default?: unknown
}

interface RawSchema {
  type?: unknown
  properties?: unknown
  required?: unknown
  enum?: unknown
  description?: unknown
  default?: unknown
  items?: unknown
}

function asSchema(value: unknown): RawSchema | null {
  return value && typeof value === 'object' ? (value as RawSchema) : null
}

export function fieldsFromSchema(schema: unknown): SchemaField[] {
  const root = asSchema(schema)
  if (!root || !root.properties || typeof root.properties !== 'object') return []
  const required = new Set(Array.isArray(root.required) ? root.required.filter((item): item is string => typeof item === 'string') : [])
  const fields: SchemaField[] = []
  for (const [name, raw] of Object.entries(root.properties as Record<string, unknown>)) {
    const property = asSchema(raw)
    const type = normalizeType(property?.type)
    const enumValues = Array.isArray(property?.enum)
      ? property.enum.map(item => (typeof item === 'string' ? item : JSON.stringify(item))).filter((item): item is string => typeof item === 'string')
      : undefined
    fields.push({
      name,
      type,
      required: required.has(name),
      description: typeof property?.description === 'string' ? property.description : undefined,
      enumValues: enumValues && enumValues.length > 0 ? enumValues : undefined,
      default: property?.default,
    })
  }
  return fields
}

function normalizeType(type: unknown): SchemaField['type'] {
  if (typeof type !== 'string') return 'unknown'
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array':
    case 'object':
      return type
    default:
      return 'unknown'
  }
}

export function initialArguments(schema: unknown): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const field of fieldsFromSchema(schema)) {
    if (field.default !== undefined) args[field.name] = field.default
  }
  return args
}

export function validateArguments(schema: unknown, args: Record<string, unknown>): ArgumentIssue[] {
  const root = asSchema(schema)
  if (!root) return []
  const fields = fieldsFromSchema(schema)
  const issues: ArgumentIssue[] = []
  for (const field of fields) {
    const value = args[field.name]
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      if (field.required) issues.push({ field: field.name, reason: 'required' })
      continue
    }
    if (field.enumValues && !field.enumValues.includes(String(value))) {
      issues.push({ field: field.name, reason: 'enum' })
      continue
    }
    switch (field.type) {
      case 'string':
        if (typeof value !== 'string') issues.push({ field: field.name, reason: 'string' })
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ field: field.name, reason: 'number' })
        break
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) issues.push({ field: field.name, reason: 'integer' })
        break
      case 'boolean':
        if (typeof value !== 'boolean') issues.push({ field: field.name, reason: 'boolean' })
        break
      case 'array':
        if (!Array.isArray(value)) issues.push({ field: field.name, reason: 'array' })
        break
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) issues.push({ field: field.name, reason: 'object' })
        break
      default:
        break
    }
  }
  return issues
}

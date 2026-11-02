import { describe, expect, it } from 'vitest'
import { fieldsFromSchema, initialArguments, validateArguments } from './schema'

const schema = {
  type: 'object',
  required: ['query'],
  properties: {
    query: { type: 'string', description: 'Search text' },
    limit: { type: 'integer', default: 5 },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    exact: { type: 'boolean' },
    tags: { type: 'array' },
    options: { type: 'object' },
  },
}

describe('mcp tool schema helpers', () => {
  it('extracts fields, required flags, enums and defaults', () => {
    const fields = fieldsFromSchema(schema)
    expect(fields.map(field => field.name)).toEqual(['query', 'limit', 'mode', 'exact', 'tags', 'options'])
    expect(fields[0]).toMatchObject({ name: 'query', type: 'string', required: true, description: 'Search text' })
    expect(fields[1]).toMatchObject({ name: 'limit', type: 'integer', default: 5 })
    expect(fields[2].enumValues).toEqual(['fast', 'slow'])
    expect(initialArguments(schema)).toEqual({ limit: 5 })
  })

  it('returns no fields for missing or non-object schemas', () => {
    expect(fieldsFromSchema(undefined)).toEqual([])
    expect(fieldsFromSchema({ type: 'string' })).toEqual([])
    expect(fieldsFromSchema({ properties: [] })).toEqual([])
  })

  it('reports required, type and enum violations', () => {
    expect(validateArguments(schema, {})).toEqual([{ field: 'query', reason: 'required' }])
    expect(validateArguments(schema, { query: 'x', limit: 1.5 })).toEqual([{ field: 'limit', reason: 'integer' }])
    expect(validateArguments(schema, { query: 'x', mode: 'medium' })).toEqual([{ field: 'mode', reason: 'enum' }])
    expect(validateArguments(schema, { query: 3 })).toEqual([{ field: 'query', reason: 'string' }])
    expect(validateArguments(schema, { query: 'x', exact: 'yes' })).toEqual([{ field: 'exact', reason: 'boolean' }])
    expect(validateArguments(schema, { query: 'x', tags: 'a' })).toEqual([{ field: 'tags', reason: 'array' }])
    expect(validateArguments(schema, { query: 'x', options: [] })).toEqual([{ field: 'options', reason: 'object' }])
  })

  it('accepts a valid payload', () => {
    expect(validateArguments(schema, {
      query: 'hello',
      limit: 3,
      mode: 'fast',
      exact: true,
      tags: ['a'],
      options: { deep: true },
    })).toEqual([])
  })
})

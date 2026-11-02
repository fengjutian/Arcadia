import { useMemo, useState } from 'react'
import { t } from '../../i18n'
import { Button, Input, InputNumber, Select, Switch } from '../../components/ui'
import { fieldsFromSchema, type SchemaField } from './schema'

interface ToolArgumentsEditorProps {
  schema: unknown
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  disabled?: boolean
}

/**
 * Renders a form from the tool's JSON Schema and falls back to a raw JSON
 * editor for schemas we cannot model (or when the user prefers JSON).
 */
export function ToolArgumentsEditor({ schema, value, onChange, disabled }: ToolArgumentsEditorProps) {
  const fields = useMemo(() => fieldsFromSchema(schema), [schema])
  const [mode, setMode] = useState<'form' | 'json'>(fields.length > 0 ? 'form' : 'json')

  return <div className="mcp-args">
    {fields.length > 0 && <div className="mcp-args__toolbar">
      <Button size="small" type={mode === 'form' ? 'primary' : 'default'} onClick={() => setMode('form')}>{t("表单")}</Button>
      <Button size="small" type={mode === 'json' ? 'primary' : 'default'} onClick={() => setMode('json')}>JSON</Button>
    </div>}
    {mode === 'form' && fields.length > 0
      ? <div className="mcp-args__fields">
          {fields.map(field => <FieldControl key={field.name} field={field} value={value[field.name]} disabled={disabled} onChange={next => onChange({ ...value, [field.name]: next })}/>)}
        </div>
      : <JsonArguments value={value} disabled={disabled} onChange={onChange}/>}
  </div>
}

function FieldControl({ field, value, disabled, onChange }: {
  field: SchemaField
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  return <div className="mcp-args__field">
    <div className="mcp-args__label">{field.name}{field.required && <span className="mcp-args__required"> *</span>}</div>
    {field.description && <p className="mcp-args__desc">{field.description}</p>}
    {field.enumValues
      ? <Select
          value={typeof value === 'string' ? value : undefined}
          options={field.enumValues.map(item => ({ label: item, value: item }))}
          onChange={next => onChange(next)}
          disabled={disabled}
          ariaLabel={field.name}
        />
      : field.type === 'boolean'
        ? <Switch checked={value === true} onChange={next => onChange(next)} disabled={disabled}/>
        : field.type === 'number' || field.type === 'integer'
          ? <InputNumber value={typeof value === 'number' ? value : null} onChange={next => onChange(next)} disabled={disabled}/>
          : field.type === 'string'
            ? <Input value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} disabled={disabled} aria-label={field.name}/>
            : <JsonValueField kind={field.type} value={value} disabled={disabled} onChange={onChange}/>}
  </div>
}

function JsonValueField({ kind, value, disabled, onChange }: {
  kind: SchemaField['type']
  value: unknown
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  const [draft, setDraft] = useState(() => value === undefined ? '' : JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)
  return <>
    <Input.TextArea
      rows={3}
      value={draft}
      disabled={disabled}
      className={invalid ? 'is-invalid' : ''}
      onChange={event => {
        const text = event.target.value
        setDraft(text)
        if (!text.trim()) {
          setInvalid(false)
          onChange(undefined)
          return
        }
        try {
          const parsed: unknown = JSON.parse(text)
          if (kind === 'array' && !Array.isArray(parsed)) throw new Error('array expected')
          if (kind === 'object' && (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))) throw new Error('object expected')
          setInvalid(false)
          onChange(parsed)
        } catch {
          setInvalid(true)
        }
      }}
    />
    {invalid && <small className="mcp-args__error">{t("JSON 格式错误")}</small>}
  </>
}

function JsonArguments({ value, disabled, onChange }: {
  value: Record<string, unknown>
  disabled?: boolean
  onChange: (value: Record<string, unknown>) => void
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)
  return <>
    <Input.TextArea
      rows={5}
      value={draft}
      disabled={disabled}
      className={invalid ? 'is-invalid' : ''}
      aria-label={t("工具参数")}
      onChange={event => {
        const text = event.target.value
        setDraft(text)
        try {
          const parsed: unknown = JSON.parse(text)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object expected')
          setInvalid(false)
          onChange(parsed as Record<string, unknown>)
        } catch {
          setInvalid(true)
        }
      }}
    />
    {invalid && <small className="mcp-args__error">{t("JSON 格式错误")}</small>}
  </>
}

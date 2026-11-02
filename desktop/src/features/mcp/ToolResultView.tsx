import { useMemo, useState } from 'react'
import { Alert, Button } from '../../components/ui'
import { t } from '../../i18n'
import { parseToolResult, type ResourceBlock, type ToolResultBlock } from './result'

const TEXT_LIMIT = 6000

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? String(value)
}

function TextBlockView({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = !expanded && text.length > TEXT_LIMIT
  return <div className="mcp-tool-result__block">
    {text.trim() ? <pre className="mcp-tool-result__text">{truncated ? `${text.slice(0, TEXT_LIMIT)}…` : text}</pre> : null}
    {text.length > TEXT_LIMIT && <Button size="small" onClick={() => setExpanded(current => !current)}>{expanded ? t("收起") : t("展开全文")}</Button>}
  </div>
}

function ResourceBlockView({ block }: { block: ResourceBlock }) {
  return <div className="mcp-tool-result__resource">
    <div className="mcp-tool-result__resource-head"><b>{block.uri ?? t("资源")}</b>{block.mimeType && <small>{block.mimeType}</small>}</div>
    {block.text ? <pre className="mcp-tool-result__text">{block.text.length > TEXT_LIMIT ? `${block.text.slice(0, TEXT_LIMIT)}…` : block.text}</pre> : null}
  </div>
}

function BlockView({ block }: { block: ToolResultBlock }) {
  switch (block.type) {
    case 'text':
      return <TextBlockView text={block.text}/>
    case 'image':
      return <figure className="mcp-tool-result__media">
        <img src={`data:${block.mimeType};base64,${block.data}`} alt={t("工具返回的图片")} loading="lazy"/>
        <figcaption>{block.mimeType}</figcaption>
      </figure>
    case 'audio':
      return <div className="mcp-tool-result__media">
        <audio controls src={`data:${block.mimeType};base64,${block.data}`}>{t("工具返回的音频")}</audio>
      </div>
    case 'resource':
      return <ResourceBlockView block={block}/>
    default:
      return <pre className="mcp-json">{stringify(block.value)}</pre>
  }
}

/** Renders MCP `content` blocks and keeps the raw JSON one click away. */
export function ToolResultView({ value, compact = false }: { value: unknown; compact?: boolean }) {
  const parsed = useMemo(() => parseToolResult(value), [value])
  const [raw, setRaw] = useState(false)
  return <div className={`mcp-tool-result${compact ? ' is-compact' : ''}`}>
    {!compact && <div className="mcp-tool-result__toolbar">
      <span>{t("渲染结果")}</span>
      <Button size="small" onClick={() => setRaw(current => !current)}>{raw ? t("渲染结果") : t("原始 JSON")}</Button>
    </div>}
    {parsed.isError && <Alert type="error" showIcon message={t("工具返回错误")}/>}
    {!compact && raw
      ? <pre className="mcp-json">{stringify(value)}</pre>
      : <>
          {parsed.blocks.map((block, index) => <BlockView key={index} block={block}/>)}
          {parsed.structured !== undefined && <div className="mcp-tool-result__structured">
            <b>{t("结构化结果")}</b>
            <pre className="mcp-json">{stringify(parsed.structured)}</pre>
          </div>}
        </>}
  </div>
}

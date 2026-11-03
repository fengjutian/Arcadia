/**
 * Types the conversation store shares with the controlled agent loop.
 *
 * The loop itself stays in the desktop app (it needs MCP and agent-run storage),
 * but a stored conversation turn embeds its steps, so the shape lives here.
 */

export interface AgentStep {
  index: number
  kind: 'search' | 'mcp_tool' | 'answer'
  summary: string
  detail?: string
  /** Structured MCP result, bounded before it reaches the conversation store. */
  result?: unknown
  at: string
}

import type { McpServerInput, McpTransport } from '../../api'

/**
 * Ready-made servers for the empty state.
 *
 * The workbench used to greet first-time users with a blank list and a
 * "添加 Server" button, which left them to hand-copy a JSON config from the
 * docs. These samples are the two shapes people actually need to see first:
 * a local `stdio` process and a remote `https` endpoint. Both are read-only,
 * need no credentials, and are maintained by the MCP project itself.
 *
 * Titles and descriptions are catalog ids (the Chinese source strings) and are
 * resolved through `t()` at render time so the cards follow the active locale.
 */
export interface SampleServer {
  key: string
  titleId: string
  descriptionId: string
  hintId: string
  name: string
  transport: McpTransport
  command?: string
  url?: string
  args: string[]
}

export const SAMPLE_SERVERS: readonly SampleServer[] = [
  {
    key: 'everything',
    name: 'everything',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    titleId: '示例 everything',
    descriptionId: '官方示例 Server，16 个工具、7 个资源、4 个提示词，用来确认整条链路是通的。',
    hintId: '首次运行需要 npx 下载，约 10–30 秒',
  },
  {
    key: 'deepwiki',
    name: 'deepwiki',
    transport: 'http',
    url: 'https://mcp.deepwiki.com/mcp',
    args: [],
    titleId: '示例 DeepWiki',
    descriptionId: '公开的远程 MCP 服务，免安装、免密钥，适合验证 HTTPS 传输。',
    hintId: '需要联网',
  },
]

/** Builds the payload the settings/DB layer expects, without mutating the sample. */
export function sampleServerInput(sample: SampleServer): McpServerInput {
  const stdio = sample.transport === 'stdio'
  return {
    name: sample.name,
    transport: sample.transport,
    enabled: true,
    command: stdio ? sample.command : undefined,
    url: stdio ? undefined : sample.url,
    args: [...sample.args],
    env: {},
    headers: {},
  }
}


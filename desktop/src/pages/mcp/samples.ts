import type { McpServerInput, McpTransport } from '../../api'

/**
 * Ready-made servers for the empty state.
 *
 * The workbench used to greet first-time users with a blank list and an
 * "添加 Server" button, which left them to hand-copy a JSON config from the
 * docs. The samples are picked to be things people keep using, not protocol
 * demos: browser automation and local documents — the two capabilities an
 * assistant inside a browser is asked for on day one. Both need no account,
 * no API key, and no server of your own.
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
  /**
   * The filesystem server refuses to start without at least one allowed
   * directory, so the caller appends the user's Documents folder at click time
   * instead of hard-coding a path that only exists on one machine.
   */
  needsDocumentsDir?: boolean
}

export const SAMPLE_SERVERS: readonly SampleServer[] = [
  {
    key: 'playwright',
    name: 'playwright',
    transport: 'stdio',
    command: 'npx',
    // `@latest` is what the Playwright docs recommend; a pinned version would
    // drift out of sync with the bundled Chromium.
    args: ['-y', '@playwright/mcp@latest'],
    titleId: '浏览器自动化',
    descriptionId: 'Playwright MCP：让助手打开网页、点击、填表、截图，再把结果读回来。',
    hintId: '首次运行会下载浏览器内核，约 1–2 分钟',
  },
  {
    key: 'filesystem',
    name: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    needsDocumentsDir: true,
    titleId: '本地文档',
    descriptionId: 'Filesystem MCP：读写「文档」目录里的文件，只授权这一个目录，写入仍需你逐次确认。',
    hintId: '自动使用你的「文档」目录',
  },
]

/** Builds the payload the settings/DB layer expects, without mutating the sample. */
export function sampleServerInput(sample: SampleServer, extraArgs: readonly string[] = []): McpServerInput {
  const stdio = sample.transport === 'stdio'
  return {
    name: sample.name,
    transport: sample.transport,
    enabled: true,
    command: stdio ? sample.command : undefined,
    url: stdio ? undefined : sample.url,
    args: [...sample.args, ...extraArgs],
    env: {},
    headers: {},
  }
}

/**
 * First-call suggestions for well-known servers.
 *
 * Connecting a server that exposes 25 Playwright tools leaves the user staring
 * at a wall of `browser_*` cards. Instead of documenting every tool, the
 * workbench points at the one call worth making first and pre-fills its
 * arguments, so the first successful invocation is two clicks away.
 *
 * Guides are matched by tool name (not server name) so renamed or
 * differently-configured servers still get them.
 */
export interface ToolGuide {
  toolName: string
  arguments: Record<string, unknown>
  /** Catalog ids, resolved with `t()` at render time. */
  titleId: string
  bodyId: string
  /** Hand-off text for "try it in the assistant"; the agent picks the tool. */
  assistantPromptId: string
}

export function guideFor(
  tools: readonly { name: string }[],
  options: { allowedDir?: string } = {},
): ToolGuide | null {
  const names = new Set(tools.map(tool => tool.name))

  if (names.has('browser_navigate')) {
    return {
      toolName: 'browser_navigate',
      arguments: { url: 'https://example.com' },
      titleId: '先从打开一个网页开始',
      bodyId: '参数已填好 https://example.com，点「审核并调用」就能看到结果。',
      assistantPromptId: '用 Playwright 打开 https://example.com，告诉我页面标题和主要内容。',
    }
  }

  if (names.has('list_directory')) {
    if (options.allowedDir) {
      return {
        toolName: 'list_directory',
        arguments: { path: options.allowedDir },
        titleId: '先看看授权的目录',
        bodyId: '已填好这个 Server 被授权的目录，点「审核并调用」即可列出文件。',
        assistantPromptId: '列出我「文档」目录里最近修改的 10 个文件。',
      }
    }
    return {
      toolName: 'list_directory',
      arguments: {},
      titleId: '先看看授权的目录',
      bodyId: '填入一个目录路径，就能列出里面的文件。',
      assistantPromptId: '列出我「文档」目录里最近修改的 10 个文件。',
    }
  }

  return null
}

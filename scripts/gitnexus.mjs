#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const usage = `GitNexus repository helper

Usage:
  node scripts/gitnexus.mjs [command] [arguments...]

Commands:
  analyze          Build or refresh the repository index
  status           Show index freshness and graph statistics (default)
  clean            Remove the current repository index
  wiki             Generate repository documentation from the graph
  list             List all indexed repositories
  impact           Inspect a symbol's upstream/downstream blast radius
  detect-changes   Analyze the graph impact of working-tree changes
  help             Show this help

Examples:
  node scripts/gitnexus.mjs status
  node scripts/gitnexus.mjs analyze --index-only
  node scripts/gitnexus.mjs analyze --force --embeddings --pdg
  node scripts/gitnexus.mjs impact save --direction upstream --repo .
  node scripts/gitnexus.mjs detect-changes --scope all --repo .
  node scripts/gitnexus.mjs wiki --model minimax/minimax-m2.5 --concurrency 3
  node scripts/gitnexus.mjs clean --force`

const supportedCommands = new Set([
  'analyze',
  'status',
  'clean',
  'wiki',
  'list',
  'impact',
  'detect-changes',
  'help',
])

const [command = 'status', ...commandArguments] = process.argv.slice(2)

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(usage)
  process.exit(0)
}

if (!supportedCommands.has(command)) {
  console.error(`Unknown command: ${command}\n\n${usage}`)
  process.exit(2)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(scriptDirectory)
const localRunner = join(repositoryRoot, '.gitnexus', 'run.cjs')
const windows = process.platform === 'win32'

function isAvailable(executable) {
  const probe = spawnSync(windows ? 'where.exe' : 'which', [executable], {
    cwd: repositoryRoot,
    stdio: 'ignore',
  })
  return probe.status === 0
}

let executable
let args

if (existsSync(localRunner)) {
  executable = process.execPath
  args = [localRunner, command, ...commandArguments]
} else if (isAvailable('gitnexus')) {
  executable = windows ? 'gitnexus.cmd' : 'gitnexus'
  args = [command, ...commandArguments]
} else if (isAvailable('pnpm')) {
  executable = windows ? 'pnpm.cmd' : 'pnpm'
  args = [
    '--allow-build=@ladybugdb/core',
    '--allow-build=gitnexus',
    '--allow-build=tree-sitter',
    'dlx',
    'gitnexus@latest',
    command,
    ...commandArguments,
  ]
} else if (isAvailable('npx')) {
  console.warn('Using npx fallback. npm 11 may fail while installing GitNexus; prefer pnpm or a global installation if that happens.')
  executable = windows ? 'npx.cmd' : 'npx'
  args = ['--yes', 'gitnexus@latest', command, ...commandArguments]
} else {
  console.error('GitNexus is unavailable. Install it globally, or install pnpm/npx so this script can bootstrap it.')
  process.exit(1)
}

const result = spawnSync(executable, args, {
  cwd: repositoryRoot,
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)

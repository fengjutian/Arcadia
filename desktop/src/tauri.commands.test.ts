import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Tauri v2 refuses any `invoke()` whose command is not listed in the window's
 * permission set, and the failure is easy to miss in development: the page just
 * logs `X not allowed. Command not found` while the UI silently renders empty.
 *
 * These tests keep the renderer, the permission file and the Rust handler list
 * in sync. They are deliberately string-based (no Tauri toolchain needed) so
 * they run in the normal `npm run test` pass.
 */

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(DESKTOP, 'src')
const RUST_SRC = path.join(DESKTOP, 'src-tauri', 'src')
const PERMISSIONS = path.join(DESKTOP, 'src-tauri', 'permissions', 'trusted-app.toml')

function walk(dir: string, accept: (name: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      out.push(...walk(full, accept))
    } else if (accept(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/** Every literal command name the renderer passes to `invoke()`. */
function invokedCommands(): string[] {
  const found = new Set<string>()
  const pattern = /invoke(?:<[^>]*>)?\(\s*'([a-z0-9_]+)'/g
  for (const file of walk(SRC, name => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name))) {
    const source = fs.readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) found.add(match[1])
  }
  return [...found].sort()
}

/** Commands allowed for the trusted app UI. */
function allowedCommands(): string[] {
  const toml = fs.readFileSync(PERMISSIONS, 'utf8')
  const found = new Set<string>()
  const pattern = /"([a-z0-9_]+)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(toml)) !== null) found.add(match[1])
  return [...found].sort()
}

/** Commands registered in any `tauri::generate_handler![...]` block. */
function registeredCommands(): Set<string> {
  const registered = new Set<string>()
  const files = walk(RUST_SRC, name => name.endsWith('.rs'))
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const marker = 'generate_handler!['
    let from = 0
    for (;;) {
      const start = source.indexOf(marker, from)
      if (start < 0) break
      let index = start + marker.length
      let depth = 1
      while (index < source.length && depth > 0) {
        const char = source[index]
        if (char === '[') depth += 1
        else if (char === ']') depth -= 1
        index += 1
      }
      const block = source.slice(start + marker.length, index - 1)
      for (const entry of block.split(',')) {
        const name = entry.trim().split('::').pop()?.trim() ?? ''
        if (/^[a-z0-9_]+$/.test(name)) registered.add(name)
      }
      from = index
    }
  }
  return registered
}

describe('Tauri command wiring', () => {
  const invoked = invokedCommands()
  const allowed = new Set(allowedCommands())
  const registered = registeredCommands()

  it('finds the command surface at all', () => {
    // A silent parser regression (renamed folder, different invoke style) would
    // make the assertions below vacuously pass.
    expect(invoked.length).toBeGreaterThan(100)
    expect(allowed.size).toBeGreaterThan(100)
    expect(registered.size).toBeGreaterThan(100)
  })

  it('allows every command the renderer invokes', () => {
    const missing = invoked.filter(command => !allowed.has(command))
    expect(missing, `add these to ${path.relative(DESKTOP, PERMISSIONS)}`).toEqual([])
  })

  it('registers every command the renderer invokes in Rust', () => {
    const missing = invoked.filter(command => !registered.has(command))
    expect(missing, 'these invoke() calls have no matching generate_handler! entry').toEqual([])
  })
})

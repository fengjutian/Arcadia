#!/usr/bin/env node
/**
 * Runs the Rust test suite with the Windows manifest workaround applied.
 *
 * Why this exists
 * ---------------
 * `tauri` enables `muda/common-controls-v6` and `tauri-plugin-dialog` hard-codes
 * `rfd/common-controls-v6`. Both crates therefore statically import
 * `comctl32!TaskDialogIndirect`, an export that only exists in the side-by-side
 * comctl32 v6 assembly.
 *
 * The application binary gets the required `Microsoft.Windows.Common-Controls`
 * manifest from `tauri-build`, but Cargo's test harness binaries do not. The
 * loader then binds the legacy comctl32 v5, cannot resolve the import, and the
 * process dies with STATUS_ENTRYPOINT_NOT_FOUND (0xC0000139) before any test
 * runs. There is no way to scope the manifest to `--lib` unit-test binaries
 * from `build.rs`: `cargo::rustc-link-arg-tests` only reaches `[[test]]`
 * targets, and a global `rustflags` entry breaks the application link because
 * `tauri-build` already embeds a MANIFEST resource (CVT1100: duplicate
 * resource).
 *
 * So: build the harnesses as usual, stamp the manifest into each executable
 * with `mt.exe`, then run them. No dependency patches, no global build flags,
 * no full rebuild.
 *
 * Usage: node scripts/run-rust-tests.mjs [-- <test binary args>]
 * The npm script is `npm run test:rust`.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const crateDir = join(scriptDir, '..', 'src-tauri')
const manifestPath = join(crateDir, 'test-manifest.xml')
const forwards = process.argv.slice(2)

function fail(message) {
  console.error(`\n[x] ${message}`)
  process.exit(1)
}

/** Node has no synchronous sleep; defer to a throwaway child process. */
function sleepSync(ms) {
  spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { stdio: 'ignore' })
}

/** Locates the newest x64 mt.exe shipped with the Windows SDK. */
function findMt() {
  if (process.platform !== 'win32') return null

  if (process.env.MT_EXE && existsSync(process.env.MT_EXE)) return process.env.MT_EXE

  const roots = [
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Kits', '10', 'bin'),
  ]

  for (const root of roots) {
    if (!existsSync(root)) continue
    const versions = readdirSync(root)
      .filter(name => /^\d+\.\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    for (const version of versions) {
      const candidate = join(root, version, 'x64', 'mt.exe')
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/**
 * `cargo test --no-run` and collect every produced test executable.
 *
 * Scoped to `--lib`: all 229 tests live in the library, and building the `bin`
 * target as well would relink `target/debug/ai-knowledge-browser.exe`, which
 * fails while the developer has the desktop app running. Add `--all` here if a
 * `tests/` directory or bin tests ever appear.
 */
function buildHarnesses() {
  console.log('[..] building Rust test harnesses')
  const result = spawnSync(
    'cargo',
    ['test', '--lib', '--no-run', '--message-format=json'],
    { cwd: crateDir, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  )

  if (result.error) fail(`could not run cargo: ${result.error.message}`)
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    fail(`cargo test --no-run failed with exit code ${result.status}`)
  }

  const executables = new Set()
  for (const line of (result.stdout ?? '').split(/\r?\n/)) {
    if (!line.startsWith('{')) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.reason !== 'compiler-artifact') continue
    if (!message.executable) continue
    if (!message.profile?.test) continue
    if (!existsSync(message.executable)) continue
    executables.add(message.executable)
  }
  return [...executables]
}

/** Stamps the comctl32 v6 manifest into each test executable. */
function stampManifests(executables) {
  if (process.platform !== 'win32') return true

  if (!existsSync(manifestPath)) {
    fail(`missing manifest at ${manifestPath}`)
  }
  const mt = findMt()
  if (!mt) {
    console.warn(
      '[!] mt.exe not found (install the Windows 10/11 SDK or set MT_EXE).\n' +
        '    Test binaries will fail to load with 0xC0000139. Attempting a run anyway.',
    )
    return false
  }

  for (const executable of executables) {
    // A just-finished previous run (or an antivirus scan) can briefly hold the
    // executable open, which makes mt.exe fail with a sharing violation.
    let stamped = null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      stamped = spawnSync(
        mt,
        ['-nologo', '-manifest', manifestPath, `-outputresource:${executable};#1`],
        { encoding: 'utf8' },
      )
      if (stamped.status === 0) break
      sleepSync(300 * (attempt + 1))
    }
    if (!stamped || stamped.status !== 0) {
      process.stderr.write(stamped?.stderr ?? stamped?.stdout ?? '')
      fail(`mt.exe could not stamp ${executable}`)
    }
  }
  console.log(`[ok] stamped ${executables.length} test executable(s) with the comctl32 v6 manifest`)
  return true
}

function main() {
  if (!existsSync(crateDir)) fail(`crate directory not found: ${crateDir}`)

  // Non-Windows has none of this problem; defer to cargo so filters and
  // dot-reporting behave exactly as developers expect.
  if (process.platform !== 'win32') {
    const passthrough = spawnSync('cargo', ['test', ...forwards], { cwd: crateDir, stdio: 'inherit' })
    process.exit(passthrough.status ?? 1)
  }

  const executables = buildHarnesses()
  if (executables.length === 0) fail('no test executables were produced')

  const stamped = stampManifests(executables)
  if (!stamped) {
    process.exit(1)
  }

  let failed = 0
  for (const executable of executables) {
    const started = Date.now()
    const run = spawnSync(executable, forwards, { stdio: 'inherit' })
    // Rust test binaries abort with 0xC0000139 (unsigned) when the manifest did
    // not take effect; surface that as a clear diagnostic instead of a raw code.
    if (run.status !== 0) {
      failed += 1
      const code = run.status ?? -1
      console.error(`\n[x] ${executable} exited with code ${code} (${Date.now() - started}ms)`)
      if (code === -1073741511) {
        console.error('    This is STATUS_ENTRYPOINT_NOT_FOUND: the comctl32 v6 manifest was not applied.')
      }
    }
  }

  if (failed > 0) {
    console.error(`\n[x] ${failed} test executable(s) failed`)
    process.exit(1)
  }
  console.log('\n[ok] all Rust test executables passed')
}

main()

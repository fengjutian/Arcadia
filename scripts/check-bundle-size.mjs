import { readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const assetsDirectory = join(root, 'desktop', 'dist', 'assets')
const budgets = new Map([
  ['.js', 600 * 1024],
  ['.css', 300 * 1024],
])

const assets = readdirSync(assetsDirectory, { withFileTypes: true })
  .filter(entry => entry.isFile() && budgets.has(extname(entry.name)))
  .map(entry => {
    const path = join(assetsDirectory, entry.name)
    return { path, bytes: statSync(path).size, budget: budgets.get(extname(entry.name)) }
  })
  .sort((left, right) => right.bytes - left.bytes)

const failures = assets.filter(asset => asset.bytes > asset.budget)
for (const asset of assets) {
  const size = (asset.bytes / 1024).toFixed(2)
  const budget = (asset.budget / 1024).toFixed(0)
  console.log(`${relative(root, asset.path)}: ${size} KiB / ${budget} KiB`)
}

if (failures.length > 0) {
  console.error(`Bundle budget exceeded by ${failures.length} asset(s).`)
  process.exitCode = 1
}

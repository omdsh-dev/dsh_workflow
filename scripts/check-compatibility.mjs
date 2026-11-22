import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 24 || (nodeMajor === 24 && nodeMinor < 9)) {
  throw new Error(`DSH requires Node >=24.9; running ${process.versions.node}. Select Node 24 before checking or launching DSH.`)
}
const require = createRequire(import.meta.url)

const compatibility = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))
const snapshot = resolve(process.env.DSH_SNAPSHOT_DIR ?? '../deepseek-harness')
if (!existsSync(resolve(snapshot, 'package.json'))) {
  throw new Error(`DSH snapshot not found at ${snapshot}; set DSH_SNAPSHOT_DIR to the checkout directory`)
}
const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: snapshot, encoding: 'utf8' }).trim()

if (actual !== compatibility.commit) {
  throw new Error(`DSH snapshot mismatch: expected ${compatibility.commit}, got ${actual}`)
}

const packageJson = JSON.parse(readFileSync(resolve(snapshot, 'package.json'), 'utf8'))
if (packageJson.version !== compatibility.version) {
  throw new Error(`DSH version mismatch: expected ${compatibility.version}, got ${packageJson.version}`)
}

const plugin = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
for (const [name, version] of Object.entries(plugin.devDependencies)) {
  if (!name.startsWith('@deepseek-ai/dsh-')) continue
  if (version !== compatibility.version) {
    throw new Error(`DSH development dependency mismatch: ${name} is ${version}, expected ${compatibility.version}`)
  }
  const installed = JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'))
  if (installed.version !== version) throw new Error(`Installed DSH dependency mismatch: ${name} is ${installed.version}, expected ${version}; run pnpm install`)
  if (plugin.peerDependencies[name] !== undefined && plugin.peerDependencies[name] !== `^${compatibility.version}`) {
    throw new Error(`DSH peer dependency mismatch: ${name} does not match the compatibility pin`)
  }
}

for (const vendor of ['cordis', 'schemastery']) {
  const expected = JSON.parse(readFileSync(resolve(snapshot, 'vendor', vendor, 'package.json'), 'utf8'))
  const installed = JSON.parse(readFileSync(require.resolve(`${expected.name}/package.json`), 'utf8'))
  if (plugin.devDependencies[expected.name] !== expected.version || installed.version !== expected.version) {
    throw new Error(`DSH vendor dependency mismatch: ${expected.name} must be ${expected.version}`)
  }
}

process.stdout.write(`DSH compatibility pin verified: ${compatibility.branch}@${actual.slice(0, 12)}\n`)

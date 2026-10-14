import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const compatibility = JSON.parse(readFileSync(new URL('../compatibility.json', import.meta.url), 'utf8'))
const snapshot = resolve(process.env.DSH_SNAPSHOT_DIR ?? '../deepseek-harness')
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
  if (plugin.peerDependencies[name] !== undefined && plugin.peerDependencies[name] !== `^${compatibility.version}`) {
    throw new Error(`DSH peer dependency mismatch: ${name} does not match the compatibility pin`)
  }
}

process.stdout.write(`DSH compatibility pin verified: ${compatibility.branch}@${actual.slice(0, 12)}\n`)

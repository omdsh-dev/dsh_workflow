import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { register } from 'tsx/esm/api'
import { setImmediate } from 'node:timers/promises'

const snapshot = resolve(process.env.DSH_SNAPSHOT_DIR ?? '../deepseek-harness')
const unregister = register({ tsconfig: resolve(snapshot, 'tsconfig.json') })
const { Context, Service } = await import(pathToFileURL(resolve(snapshot, 'vendor/cordis/src/index.ts')).href)
const { default: Loader } = await import(pathToFileURL(resolve(snapshot, 'vendor/loader/src/index.ts')).href)
const { default: Tools } = await import(pathToFileURL(resolve(snapshot, 'packages/core/tools/src/index.ts')).href)
const { default: SystemPrompt } = await import(pathToFileURL(resolve(snapshot, 'packages/core/system-prompt/src/index.ts')).href)
const { evaluatePluginCompatibility } = await import(pathToFileURL(resolve(snapshot, 'packages/boot/app-boot/src/plugin-compatibility.ts')).href)
const { readFileSync } = await import('node:fs')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const runtime = JSON.parse(readFileSync(resolve(snapshot, 'package.json'), 'utf8')).version
assert.equal(evaluatePluginCompatibility(manifest, {}, runtime), undefined)

class Subagents extends Service {
  constructor(ctx) { super(ctx, 'subagents') }
}
const ctx = new Context()
const loader = await ctx.plugin(Loader, { baseUrl: import.meta.url })
ctx.loader.builtins.subagents = Subagents
ctx.loader.builtins.tools = Tools
ctx.loader.builtins.systemPrompt = SystemPrompt
try {
  await ctx.loader.create({ id: 'subagents', name: 'cordis:subagents' })
  await ctx.loader.create({ id: 'systemPrompt', name: 'cordis:systemPrompt' })
  await ctx.loader.create({ id: 'tools', name: 'cordis:tools' })
  await ctx.loader.create({ id: 'workflow', name: new URL('../lib/index.js', import.meta.url).href, config: { approvalMode: 'never' } })
  await ctx.loader.await()
  assert.ok(ctx.get('dynamicWorkflows'), 'the Loader did not install the workflow service')
  assert.deepEqual(ctx.tools.schemas().map(tool => tool.name).sort(), ['run_workflow', 'workflow_list', 'workflow_manage'])
  const workflow = ctx.loader.resolve('workflow').fiber
  ctx.loader.remove('workflow')
  await workflow.dispose()
  const deadline = Date.now() + 1_000
  while (ctx.tools.schemas().length > 0 && Date.now() < deadline) await setImmediate()
  assert.equal(ctx.get('dynamicWorkflows'), undefined)
  assert.equal(ctx.tools.schemas().length, 0)
  console.log('DSH source Loader verified: compatible peers, service/tools installed, unload completed')
} finally {
  await loader.dispose()
  await unregister()
}

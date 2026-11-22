import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { register } from 'tsx/esm/api'

const snapshot = resolve(process.env.DSH_SNAPSHOT_DIR ?? '../deepseek-harness')
const unregister = register({ tsconfig: resolve(snapshot, 'tsconfig.json') })
const from = path => import(pathToFileURL(resolve(snapshot, path)).href)
const { Context } = await from('vendor/cordis/src/index.ts')
const { default: Loader } = await from('vendor/loader/src/index.ts')
const { mountAgentLoopTestDependencies } = await from('packages/test-support/agent-loop-testkit/src/index.ts')
const { default: AgentLoop } = await from('packages/core/agent-loop/src/index.ts')
const { default: Subagents } = await from('packages/subagent/subagent/src/index.ts')
const Spawn = await from('packages/subagent/subagent-spawn-in-process/src/index.ts')
const Persistence = await from('packages/session/session-persistence-jsonl/src/index.ts')
const { TestSessionQuery } = await from('packages/subagent/subagent/tests/test-session-query.ts')
const { MockAdapter, textResponse, toolCallResponse } = await from('packages/core/agent-loop/tests/mock-adapter.ts')
const { defineTool } = await from('packages/core/tools/src/index.ts')
const ToolFs = await from('packages/fs/tool-fs/src/index.ts')
const { default: Commands } = await from('packages/interaction/commands/src/index.ts')
const { default: Jobs } = await from('packages/jobs/jobs-local/src/index.ts')
const { default: SessionTitle } = await from('packages/session/session-title/src/index.ts')
const { createWorkflowCapsule, startWorkflowAgent } = await import(new URL('../lib/index.js', import.meta.url))
const prefix = fileURLToPath(new URL('../.tmp-profile-smoke-execution-', import.meta.url))
const results = []

async function scenario(name, script, run, options = {}) {
  const root = await mkdtemp(prefix)
  const ctx = new Context()
  let loop, runtime, persistence, workflow
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    persistence = await ctx.plugin(Persistence, { root: resolve(root, 'sessions') })
    loop = await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TestSessionQuery)
    runtime = await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 8 })
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(Commands)
    await ctx.plugin(Jobs)
    ctx.jobs.attachController('workflow compatibility smoke')
    await ctx.plugin(SessionTitle, { fallbackMaxWords: 12, fallbackMaxBytes: 120, maxTitleBytes: 120 })
    const { makeAdapter, ...config } = options
    const adapter = makeAdapter === undefined ? new MockAdapter(script) : makeAdapter(script)
    ctx.llm.registerAdapter(['mock'], adapter)
    await ctx.plugin(Loader)
    const workflowId = await ctx.loader.create({ id: 'workflow', name: new URL('../lib/index.js', import.meta.url).href, config: { approvalMode: 'never', ...config } })
    await ctx.loader.await()
    workflow = ctx.loader.resolve(workflowId).fiber
    assert.ok(ctx.get('dynamicWorkflows'))
    const parent = await ctx.agentLoop.create(`parent-${name}`, { provider: 'mock', model: 'mock' }, { cwd: root })
    await run({ ctx, parent, adapter, root, workflow })
    results.push(name)
    console.log(`DSH execution verified: ${name}`)
  } finally {
    await workflow?.dispose()
    await runtime?.dispose()
    await loop?.dispose()
    await persistence?.dispose()
    await ctx.fiber.dispose()
    assert.ok(root.startsWith(prefix))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

const manifest = { name: 'compatibility-smoke', description: 'Native execution regression.', phases: ['work'], readOnly: true, maxAgents: 2, maxConcurrency: 2, patterns: ['classify-and-act'] }
const moduleFor = source => ({ manifest, source, execution: 'capability-generated', capsule: createWorkflowCapsule({ minDshVersion: '0.2.2-rc.5', manifest, source }) })
const tool = (name, execute) => defineTool({ name, description: name, parameters: {}, output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute })

try {
  await scenario('read-only-native-tools', [
    toolCallResponse('denied-write', 'write', {}),
    toolCallResponse('denied-scoped-write', 'scoped_write', {}),
    toolCallResponse('allowed-read', 'read', {}),
    textResponse('read-only execution completed'),
  ], async ({ ctx, parent, adapter }) => {
    let writes = 0, reads = 0
    ctx.tools.register(tool('write', async () => { writes++; return 'wrote' }))
    ctx.tools.register(tool('read', async () => { reads++; return 'read' }))
    ctx.on('agent/created', ({ agent }) => {
      if (agent.id !== parent.id) agent.ctx.tools.register(tool('scoped_write', async () => { writes++; return 'wrote' }))
      return undefined
    }, { global: true, prepend: true })
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"reader",prompt:"read the workspace",readOnly:true});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.equal(snapshot.result.finalText, 'read-only execution completed')
    assert.equal(writes, 0)
    assert.equal(reads, 1)
    assert.ok(adapter.requests[0].tools.some(tool => tool.name === 'read'))
    assert.ok(!adapter.requests[0].tools.some(tool => tool.name === 'write'))
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('structured-output', [toolCallResponse('capture', 'structured_output', { answer: 'verified' })], async ({ ctx, parent }) => {
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"structured",prompt:"return the object",readOnly:true,outputSchema:{type:"object",properties:{answer:{type:"string"}},required:["answer"],additionalProperties:false}});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.deepEqual(snapshot.result.structured, { answer: 'verified' })
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('native-filesystem-evidence', [
    toolCallResponse('denied-native-write', 'write', { file_path: 'evidence.txt', content: 'modified' }),
    toolCallResponse('native-read', 'read', { file_path: 'evidence.txt' }),
    textResponse('Read the evidence file and completed the native filesystem check.'),
  ], async ({ ctx, parent, root }) => {
    await ctx.plugin(ToolFs, {})
    await writeFile(resolve(root, 'evidence.txt'), 'original evidence', 'utf8')
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"native-reader",prompt:"read evidence.txt",readOnly:true,verification:{enforcement:"hard",requiredReadPaths:["evidence.txt"],minFinalTextChars:20}});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.equal(snapshot.result.status, 'completed')
    assert.equal(snapshot.result.verification.ok, true)
    assert.equal(await readFile(resolve(root, 'evidence.txt'), 'utf8'), 'original evidence')
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('structured-output-repair', [textResponse('The answer is verified.'), toolCallResponse('capture-repair', 'structured_output', { answer: 'verified' })], async ({ ctx, parent }) => {
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"structured",prompt:"return the object",readOnly:true,outputSchema:{type:"object",properties:{answer:{type:"string"}},required:["answer"],additionalProperties:false}});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.deepEqual(snapshot.result.structured, { answer: 'verified' })
    assert.equal(snapshot.result.stopReason, 'completed-after-structured-repair')
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('stop-and-cleanup', ['hang'], async ({ ctx, parent, adapter }) => {
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"waiting",prompt:"wait",readOnly:true});}'))
    const deadline = Date.now() + 5_000
    while (adapter.requests.length === 0 && Date.now() < deadline) await delay(5)
    assert.equal(adapter.requests.length, 1)
    ctx.dynamicWorkflows.stop(parent, run.runId, 'compatibility cancellation')
    assert.equal((await run.done).status, 'stopped')
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('exact-activation-disposal', [textResponse('original completed'), 'hang'], async ({ ctx, parent, adapter }) => {
    const run = await startWorkflowAgent(ctx.subagents, 'spawn', { parent, prompt: [{ type: 'text', text: 'original task' }], signal: new AbortController().signal, toolFilter: { allow: [] } })
    assert.equal((await run.result).stopReason, 'completed')
    await ctx.subagents.sendMessage(parent, run.id, [{ type: 'text', text: 'independent later task' }], { signal: new AbortController().signal })
    const deadline = Date.now() + 5_000
    while (adapter.requests.length < 2 && Date.now() < deadline) await delay(5)
    assert.equal(adapter.requests.length, 2)
    await run.dispose()
    assert.equal(adapter.requests[1].signal.aborted, false, 'disposing the old activation cancelled an independent later continuation')
    assert.ok(ctx.agents.get(run.id))
  })
  await scenario('stop-owned-descendants', [toolCallResponse('delegate', 'launch_descendant', {}), 'hang', 'hang', 'hang'], async ({ ctx, parent, adapter }) => {
    ctx.tools.register(tool('launch_descendant', async (_args, exec) => {
      await ctx.subagents.startActivation({ provider: 'spawn', label: 'nested child', parent: exec.agent, prompt: [{ type: 'text', text: 'nested task' }], signal: exec.signal, delivery: 'caller' })
      return 'started'
    }))
    const module = moduleFor('async function run(wf,args){return await wf.runAgent({name:"delegator",prompt:"delegate a task",readOnly:false,verification:{enforcement:"warn"}});}')
    module.manifest = { ...module.manifest, readOnly: false }
    module.capsule = createWorkflowCapsule({ minDshVersion: '0.2.2-rc.5', manifest: module.manifest, source: module.source })
    const run = await ctx.dynamicWorkflows.startInline(parent, module)
    const deadline = Date.now() + 5_000
    while (adapter.requests.length < 3 && Date.now() < deadline) await delay(5)
    assert.equal(adapter.requests.length, 3)
    assert.equal(ctx.agents.list().length, 3)
    const unrelated = await ctx.subagents.startActivation({ provider: 'spawn', label: 'unrelated tree member', parent, prompt: [{ type: 'text', text: 'independent task' }], signal: new AbortController().signal, delivery: 'caller' })
    while (adapter.requests.length < 4 && Date.now() < deadline) await delay(5)
    assert.equal(adapter.requests.length, 4)
    ctx.dynamicWorkflows.stop(parent, run.runId, 'stop workflow branch')
    assert.equal((await run.done).status, 'stopped')
    assert.equal(ctx.agents.list().length, 2, 'workflow cancellation leaked descendants or stopped unrelated work')
    assert.ok(ctx.agents.get(unrelated.childId))
    assert.equal(adapter.requests[3].signal.aborted, false)
    await unrelated.dispose()
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('parallel-save-cache-and-rerun', [textResponse('first'), textResponse('second'), textResponse('saved-first'), textResponse('saved-second')], async ({ ctx, parent, adapter }) => {
    const module = moduleFor('async function run(wf,args){return await wf.parallel([()=>wf.runAgent({name:"first",prompt:"first",readOnly:true}),()=>wf.runAgent({name:"second",prompt:"second",readOnly:true})]);}')
    const first = await ctx.dynamicWorkflows.startInline(parent, module)
    assert.equal((await first.done).status, 'completed')
    assert.equal(adapter.requests.length, 2)
    await ctx.dynamicWorkflows.saveRun(parent, first.runId, 'native-saved', 'project')
    assert.ok((await ctx.dynamicWorkflows.list(parent)).entries.some(entry => entry.name === 'native-saved' && entry.valid))
    const resumed = await ctx.dynamicWorkflows.rerun(parent, first.runId, {}, undefined, true)
    const resumedSnapshot = await resumed.done
    assert.equal(resumedSnapshot.status, 'completed', resumedSnapshot.error)
    assert.ok(resumedSnapshot.result.every(result => result.origin === 'replayed-from-cache'))
    assert.equal(adapter.requests.length, 2)
    const saved = await ctx.dynamicWorkflows.startNamed(parent, 'native-saved', {})
    const savedSnapshot = await saved.done
    assert.equal(savedSnapshot.status, 'completed', savedSnapshot.error)
    assert.equal(adapter.requests.length, 4)
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('pause-and-resume', [textResponse('first completed'), textResponse('second completed')], async ({ ctx, parent, adapter }) => {
    const module = moduleFor('async function run(wf,args){const a=await wf.spawnAgent({name:"first",prompt:"first",readOnly:true});const b=await wf.spawnAgent({name:"second",prompt:"second",readOnly:true});return [await wf.wait(a.taskId),await wf.wait(b.taskId)];}')
    module.manifest = { ...module.manifest, maxConcurrency: 1 }
    module.capsule = createWorkflowCapsule({ minDshVersion: '0.2.2-rc.5', manifest: module.manifest, source: module.source })
    const run = await ctx.dynamicWorkflows.startInline(parent, module)
    const deadline = Date.now() + 5_000
    while (ctx.agents.list().length < 2 && Date.now() < deadline) await delay(5)
    assert.equal(ctx.dynamicWorkflows.pause(parent, run.runId), true)
    adapter.release()
    while (adapter.requests.length < 1 && Date.now() < deadline) await delay(5)
    await delay(30)
    assert.equal(adapter.requests.length, 1)
    assert.equal(ctx.dynamicWorkflows.resume(parent, run.runId), true)
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.equal(adapter.requests.length, 2)
    assert.equal(ctx.agents.list().length, 1)
  }, { makeAdapter: script => new class extends MockAdapter {
    gate = Promise.withResolvers()
    release = () => this.gate.resolve()
    async *stream(options) { if (this.requests.length === 0) await this.gate.promise; yield* super.stream(options) }
  }(script) })
  await scenario('same-child-verification-repair', [textResponse('short'), toolCallResponse('repair-write', 'write', {}), textResponse('The task is now complete with the requested verification evidence.'), textResponse('Workflow repair completed.')], async ({ ctx, parent, adapter }) => {
    let writes = 0
    const children = []
    ctx.tools.register(tool('write', async () => { writes++; return 'wrote' }))
    ctx.tools.register(tool('read', async () => 'read'))
    ctx.on('agent/created', ({ agent }) => { if (agent.id !== parent.id) children.push(agent.id); return undefined }, { global: true })
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){return await wf.runAgent({name:"verified",prompt:"finish the task",readOnly:true,verification:{enforcement:"hard",minFinalTextChars:40}});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.equal(snapshot.result.status, 'completed')
    assert.ok(snapshot.result.finalText.includes('verification evidence'))
    assert.equal(children.length, 2)
    assert.equal(children[0], children[1])
    assert.equal(writes, 0)
    assert.ok(!adapter.requests[1].tools.some(tool => tool.name === 'write'))
    await parent.whenIdle()
    assert.equal(ctx.agents.list().length, 1)
  })
  await scenario('background-job-ownership-and-result', [textResponse('background completed')], async ({ ctx, parent }) => {
    const source = 'async function run(wf,args){return await wf.runAgent({name:"background",prompt:"finish",readOnly:true});}'
    const result = await ctx.tools.get('run_workflow', parent).execute({ source, manifest, wait: false }, { agent: parent, signal: new AbortController().signal })
    assert.ok(result.jobId, 'the workflow did not register a native background job')
    const job = await ctx.jobs.wait(result.jobId, 5_000, parent.id)
    assert.equal(job.owner, parent.id)
    assert.equal(job.status, 'completed')
    const output = ctx.jobs.read(result.jobId, parent.id)
    assert.ok(JSON.stringify(output).includes('background completed'))
  })
  await scenario('effective-working-directory', [textResponse('new workspace')], async ({ ctx, parent, root }) => {
    const next = resolve(root, 'moved-workspace')
    await mkdir(next)
    await ctx.workingDirectory.set(parent, next)
    assert.equal(parent.session.header.cwd, root)
    const run = await ctx.dynamicWorkflows.startInline(parent, moduleFor('async function run(wf,args){const r=await wf.runAgent({name:"moved",prompt:"inspect",readOnly:true});return await wf.artifact("location",{text:r.finalText});}'))
    const snapshot = await run.done
    assert.equal(snapshot.status, 'completed', snapshot.error)
    assert.ok(snapshot.result.path.startsWith(next))
    await ctx.dynamicWorkflows.saveRun(parent, run.runId, 'moved-workflow', 'project')
    assert.ok((await ctx.dynamicWorkflows.list(parent)).entries.some(entry => entry.name === 'moved-workflow' && entry.valid))
  })
  const handoffSource = 'async function run(wf,args){return await wf.runAgent({name:"command-child",prompt:"inspect the workspace",readOnly:true});}'
  await scenario('command-main-agent-handoff', [
    toolCallResponse('run-inline', 'run_workflow', { source: handoffSource, manifest, wait: true }),
    textResponse('command child completed'),
    textResponse('Workflow finished.'),
  ], async ({ ctx, parent, adapter }) => {
    const command = await ctx.commands.execute(parent, '/workflow create inspect current workspace', [], new AbortController().signal)
    assert.equal(command.result.kind, 'success')
    await parent.whenIdle()
    const runs = ctx.dynamicWorkflows.runs(parent)
    assert.equal(runs.length, 1)
    assert.equal(runs[0].status, 'completed', runs[0].error)
    assert.equal(adapter.requests.length, 3)
    const events = parent.session.snapshotEvents()
    assert.ok(events.find(event => event.type === 'user/message' && event.data.source.kind === 'user')?.data.content.some(block => block.type === 'text' && block.text === 'inspect current workspace'))
    assert.ok(events.find(event => event.type === 'command/done').seq < events.find(event => event.type === 'tool-workflow/run-start').seq)
    assert.ok((await ctx.sessionTitle.refresh(parent.session))?.title.includes('inspect current workspace'))
  }, { approvalMode: 'generated-and-local' })
  console.log(`DSH execution scenarios passed: ${results.length}`)
} finally { await unregister() }

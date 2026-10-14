import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime, { type SubagentResult } from '@deepseek-ai/dsh-subagent'
import { describe, expect, it, vi } from 'vitest'
import { startWorkflowAgent } from '../src/dsh.js'

async function fixture() {
  const ctx = new Context()
  const live = new Map<string, Agent>()
  class Agents extends Service {
    constructor(ctx: Context) { super(ctx, 'agents') }
    get(id: string) { return live.get(id) }
  }
  class WorkingDirectory extends Service {
    constructor(ctx: Context) { super(ctx, 'workingDirectory') }
    async ensure() { return process.cwd() }
  }
  const sessions = await ctx.plugin(SessionStore)
  const agents = await ctx.plugin(Agents)
  const directory = await ctx.plugin(WorkingDirectory)
  const runtime = await ctx.plugin(SubagentRuntime, { maxDepth: 1, maxActiveSubagents: 8 })
  const session = ctx.sessions.create(SessionId('workflow-parent'), { meta: { cwd: process.cwd() } })
  const parentData: Partial<Agent> = { id: session.id, ctx, session, inject: vi.fn(), steer: vi.fn(), followup: vi.fn() }
  const parent = parentData as Agent
  live.set(parent.id, parent)
  let finish!: (result: SubagentResult) => void
  const result = new Promise<SubagentResult>(resolve => { finish = resolve })
  const dispose = vi.fn(async () => { finish({ output: [], stopReason: 'aborted' }) })
  const start = vi.fn(async () => ({ id: SessionId('workflow-child'), result, dispose }))
  ctx.subagents.registerProvider({
    name: 'external', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start,
  })
  return {
    ctx, parent, start, dispose, finish,
    async close() { await runtime.dispose(); await directory.dispose(); await agents.dispose(); await sessions.dispose() },
  }
}

describe('current DSH managed activations', () => {
  it('returns the managed child identity and result without injecting a settlement into the parent', async () => {
    const fx = await fixture()
    try {
      const run = await startWorkflowAgent(fx.ctx.subagents, 'external', {
        label: 'inspect', prompt: [{ type: 'text', text: 'inspect' }], parent: fx.parent, signal: new AbortController().signal,
      })
      expect(run.id).toBe('workflow-child')
      fx.finish({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' })
      expect(await run.result).toMatchObject({ stopReason: 'completed', output: [{ type: 'text', text: 'done' }] })
      expect(fx.dispose).toHaveBeenCalledOnce()
      expect(fx.parent.inject).not.toHaveBeenCalled()
      expect(fx.parent.steer).not.toHaveBeenCalled()
      expect(fx.parent.followup).not.toHaveBeenCalled()
    } finally { await fx.close() }
  })

  it('cancels an already published activation and awaits the real provider cleanup', async () => {
    const fx = await fixture()
    try {
      const controller = new AbortController()
      const run = await startWorkflowAgent(fx.ctx.subagents, 'external', {
        prompt: [{ type: 'text', text: 'wait' }], parent: fx.parent, signal: controller.signal,
      })
      controller.abort('workflow stopped')
      expect(await run.result).toMatchObject({ stopReason: 'aborted' })
      await run.dispose()
      expect(fx.dispose).toHaveBeenCalledOnce()
    } finally { await fx.close() }
  })
})

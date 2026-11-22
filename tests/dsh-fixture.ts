import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
import { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { vi } from 'vitest'
import type { WorkflowAgentStartRequest } from '../src/dsh.js'

type FixtureRun = { id: string; localAgent?: object | undefined; result: Promise<SubagentResult>; dispose(): Promise<void> }

export function fixtureContext(tools = { schemas: () => [{ name: 'read' }, { name: 'write' }, { name: 'shell' }] }): Context {
  const ctx = new Context()
  const partial: Partial<Context['tools']> = { schemas: () => tools.schemas().map(tool => ({ ...tool, description: '', parameters: {} })), restrict: vi.fn(() => () => {}), guard: vi.fn(() => () => {}) }
  ctx.provide('tools', partial as Context['tools'])
  return ctx
}

/** Model the current activation API while retaining explicit provider-dispatch assertions. */
export function activationRuntime(start: (provider: string, request: WorkflowAgentStartRequest) => Promise<FixtureRun>) {
  const children = new Map<string, Agent>()
  const historical = new Map<string, { child: Agent; parent: Agent }>()
  const release = (parent: Agent, child: Agent) => {
    children.delete(child.id)
    parent.ctx.emit('agent/disposed', { agent: child })
  }
  return {
    startActivation: vi.fn(async (spec: SubagentActivationSpec) => {
      const childCtx = fixtureContext()
      const session: Partial<Agent['session']> = { header: { version: SESSION_FORMAT_VERSION, id: spec.childId ?? SessionId('fixture-child'), createdAt: Date.now(), isSeeded: false }, snapshotEvents: () => [] }
      const temporary: Partial<Agent> = { id: spec.childId ?? SessionId('fixture-child'), ctx: childCtx, session: session as Agent['session'], whenIdle: async () => {}, cancel: vi.fn() }
      let child = temporary as Agent
      await spec.parent.ctx.serial('agent/created', { agent: child, source: 'startup' })
      const restriction = (childCtx.tools.restrict as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
      const run = await start(spec.provider, { ...spec, label: spec.label, signal: spec.signal, ...(restriction === undefined ? {} : { toolFilter: restriction }) })
      if (run.localAgent !== undefined) {
        const observed = (run.localAgent as Agent).session
        child = Object.assign(run.localAgent, { id: temporary.id, ctx: childCtx, session: { ...observed, header: observed.header ?? session.header } }) as Agent
        await spec.parent.ctx.serial('agent/created', { agent: child, source: 'startup' })
      }
      children.set(child.id, child)
      historical.set(child.id, { child, parent: spec.parent })
      const partial: Partial<Context['agents']> = { get: id => children.get(id) }
      if (spec.parent.ctx.get('agents') === undefined) spec.parent.ctx.provide('agents', partial as Context['agents'])
      const result = run.result.finally(() => release(spec.parent, child))
      return { childId: child.id, name: 'fixture', result, async dispose() { release(spec.parent, child); await run.dispose() } }
    }),
    sendMessage: vi.fn(async (_parent: Agent, childId: string, content: Parameters<typeof createUserMessage>[0]['content']) => {
      const record = historical.get(childId)!
      const { child, parent } = record
      children.set(childId, child)
      await parent.ctx.serial('agent/created', { agent: child, source: 'resume' })
      const message = createUserMessage({ source: { kind: 'dsh-external-workflow', plugin: '@dsh-external/workflow', form: 'relay' }, content })
      if (content[0]?.type === 'text' && content[0].text.startsWith('Verification failed.')) {
        child.followup(message)
        void child.whenIdle().then(() => release(parent, child))
      } else child.steer(message)
      return message.id
    }),
  }
}

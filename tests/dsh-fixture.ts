import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentActivationSpec, SubagentResult, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import { vi } from 'vitest'

type FixtureRun = { id: string; localAgent?: object | undefined; result: Promise<SubagentResult>; dispose(): Promise<void> }

/** Provider fixtures expose the current consumer API while keeping dispatch assertions explicit. */
export function activationRuntime(start: (provider: string, request: SubagentStartRequest) => Promise<FixtureRun>) {
  const children = new Map<string, Agent>()
  return {
    startActivation: vi.fn(async (spec: SubagentActivationSpec) => {
      const run = await start(spec.provider, { ...spec.request, label: spec.label, signal: spec.signal })
      if (run.localAgent !== undefined) {
        const child = run.localAgent as Agent
        children.set(run.id, child)
        const originalGet = spec.request.parent.ctx.get?.bind(spec.request.parent.ctx)
        spec.request.parent.ctx.get = ((key: string) => key === 'agents' ? { get: (id: string) => children.get(id) } : originalGet?.(key)) as typeof spec.request.parent.ctx.get
      }
      return { childId: SessionId(run.id), result: run.result, dispose: () => run.dispose() }
    }),
    [deliverSubagentPrompt]: vi.fn(async (_parent: Agent, childId: string, content: Parameters<typeof createUserMessage>[0]['content'], source: MessageSource, _signal: AbortSignal, delivery: 'queue' | 'steer') => {
      const child = children.get(childId)!
      const message = createUserMessage({ source, content })
      if (delivery === 'queue') child.followup(message)
      else child.steer(message)
      return message.id
    }),
    drainChildren: vi.fn(async () => {}),
  }
}

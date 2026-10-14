import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentRun, SubagentRuntime, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { queueHostSubagentPrompt, steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'

const relaySource = { kind: 'dsh-external-workflow', plugin: '@dsh-external/workflow', form: 'relay' } as const

/** Workflow-owned handle retaining local session evidence after activation teardown. */
export interface WorkflowAgentRun extends SubagentRun {
  localAgent?: Agent
}

/** Start a caller-delivered activation and retain cancellation until it settles. */
export async function startWorkflowAgent(subagents: SubagentRuntime, provider: string, request: SubagentStartRequest): Promise<WorkflowAgentRun> {
  const { label, signal, ...input } = request
  const activation = await subagents.startActivation({ provider, label: label ?? 'workflow-agent', request: input, signal, delivery: 'caller' })
  const localAgent = request.parent.ctx.get('agents')?.get(activation.childId)
  const run: WorkflowAgentRun = {
    id: activation.childId,
    ...(localAgent === undefined ? {} : { localAgent }),
    result: activation.result,
    dispose: () => activation.dispose(),
  }
  const abort = () => { void run.dispose().catch(error => request.parent.ctx.logger.warn(`workflow child teardown failed: ${String(error)}`)) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  void run.result.finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined)
  return run
}

/** Resume the same cataloged child for a verification repair, then release its activation. */
export async function repairWorkflowAgent(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, prompt: string, signal: AbortSignal): Promise<void> {
  await queueHostSubagentPrompt(subagents, parent, run.id, [{ type: 'text', text: prompt }], relaySource, signal)
  const child = parent.ctx.get('agents')?.get(run.id)
  if (child === undefined) throw new Error('workflow verification repair requires a local child agent')
  run.localAgent = child
  const abort = () => { child.cancel({ kind: 'parent' }) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try { await child.whenIdle() } finally {
    signal.removeEventListener('abort', abort)
    await subagents.drainChildren(parent, [run.id])
  }
}

/** Deliver workflow-authored context through DSH's managed local-child messaging. */
export async function sendWorkflowMessage(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, content: string, signal: AbortSignal): Promise<void> {
  await steerHostSubagentPrompt(subagents, parent, run.id, [{ type: 'text', text: content }], relaySource, signal)
}

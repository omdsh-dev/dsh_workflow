import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRun, SubagentRuntime, SubagentStartRequest } from '@deepseek-ai/dsh-subagent';
/** Workflow-owned handle retaining local session evidence after activation teardown. */
export interface WorkflowAgentRun extends SubagentRun {
    localAgent?: Agent;
}
/** Start a caller-delivered activation and retain cancellation until it settles. */
export declare function startWorkflowAgent(subagents: SubagentRuntime, provider: string, request: SubagentStartRequest): Promise<WorkflowAgentRun>;
/** Resume the same cataloged child for a verification repair, then release its activation. */
export declare function repairWorkflowAgent(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, prompt: string, signal: AbortSignal): Promise<void>;
/** Deliver workflow-authored context through DSH's managed local-child messaging. */
export declare function sendWorkflowMessage(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, content: string, signal: AbortSignal): Promise<void>;

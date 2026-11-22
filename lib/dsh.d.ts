import type { Agent } from '@deepseek-ai/dsh-agent';
import { type SubagentRun, type SubagentRuntime, type SubagentStartRequest } from '@deepseek-ai/dsh-subagent';
import type { ToolRestriction } from '@deepseek-ai/dsh-tools';
/** Resolve the Session's effective execution directory, including host workspace moves. */
export declare function workflowCwd(agent: Agent): string;
/** Workflow-owned restriction applied before a local child's first model request. */
export interface WorkflowAgentStartRequest extends SubagentStartRequest {
    readonly toolFilter?: ToolRestriction;
}
/** Retains session evidence and observes exact child teardown, including continuation repair. */
export interface WorkflowAgentRun extends SubagentRun {
    localAgent?: Agent;
    disposalOf?(agent: Agent): Promise<void>;
}
/** Start a managed activation and own cancellation, scoped restrictions, and observation. */
export declare function startWorkflowAgent(subagents: SubagentRuntime, provider: string, request: WorkflowAgentStartRequest): Promise<WorkflowAgentRun>;
/** Repair through the supported same-tree messaging API and await that child's teardown. */
export declare function repairWorkflowAgent(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, prompt: string, signal: AbortSignal): Promise<void>;
/** Deliver task context through DSH's supported same-tree agent messaging. */
export declare function sendWorkflowMessage(subagents: SubagentRuntime, parent: Agent, run: WorkflowAgentRun, content: string, signal: AbortSignal): Promise<void>;

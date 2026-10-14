import { queueHostSubagentPrompt, steerHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal';
const relaySource = { kind: 'dsh-external-workflow', plugin: '@dsh-external/workflow', form: 'relay' };
/** Start a caller-delivered activation and retain cancellation until it settles. */
export async function startWorkflowAgent(subagents, provider, request) {
    const { label, signal, ...input } = request;
    const activation = await subagents.startActivation({ provider, label: label ?? 'workflow-agent', request: input, signal, delivery: 'caller' });
    const localAgent = request.parent.ctx.get('agents')?.get(activation.childId);
    const run = {
        id: activation.childId,
        ...(localAgent === undefined ? {} : { localAgent }),
        result: activation.result,
        dispose: () => activation.dispose(),
    };
    const abort = () => { void run.dispose().catch(error => request.parent.ctx.logger.warn(`workflow child teardown failed: ${String(error)}`)); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    void run.result.finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined);
    return run;
}
/** Resume the same cataloged child for a verification repair, then release its activation. */
export async function repairWorkflowAgent(subagents, parent, run, prompt, signal) {
    await queueHostSubagentPrompt(subagents, parent, run.id, [{ type: 'text', text: prompt }], relaySource, signal);
    const child = parent.ctx.get('agents')?.get(run.id);
    if (child === undefined)
        throw new Error('workflow verification repair requires a local child agent');
    run.localAgent = child;
    const abort = () => { child.cancel({ kind: 'parent' }); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    try {
        await child.whenIdle();
    }
    finally {
        signal.removeEventListener('abort', abort);
        await subagents.drainChildren(parent, [run.id]);
    }
}
/** Deliver workflow-authored context through DSH's managed local-child messaging. */
export async function sendWorkflowMessage(subagents, parent, run, content, signal) {
    await steerHostSubagentPrompt(subagents, parent, run.id, [{ type: 'text', text: content }], relaySource, signal);
}

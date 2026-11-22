import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent';
/** Resolve the Session's effective execution directory, including host workspace moves. */
export function workflowCwd(agent) {
    const cwd = agent.ctx.get('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd;
    if (cwd === undefined)
        throw new Error('workflow requires a parent session with an absolute cwd');
    return cwd;
}
const observations = new WeakMap();
/** Start a managed activation and own cancellation, scoped restrictions, and observation. */
export async function startWorkflowAgent(subagents, provider, request) {
    const { label, signal, toolFilter, ...input } = request;
    const local = subagents.getProvider(provider)?.prepareContinuable !== undefined;
    if (toolFilter !== undefined && !local)
        throw new Error('workflow tool restrictions require a local continuable subagent provider');
    const childId = local ? SessionId(randomUUID()) : undefined;
    let run;
    let latest;
    let expectingCreation = 1;
    const disposals = new Map();
    const active = new Map();
    const offCreated = childId === undefined ? () => { } : request.parent.ctx.on('agent/created', ({ agent }) => {
        const parentId = agent.session.header.parentSession;
        const ownedParent = parentId === undefined ? undefined : active.get(parentId);
        const rootCreation = agent.id === childId && expectingCreation > 0;
        if (!rootCreation && (ownedParent === undefined || request.parent.ctx.get('agents')?.get(ownedParent.id) !== ownedParent))
            return undefined;
        active.set(agent.id, agent);
        if (rootCreation) {
            latest = agent;
            if (run !== undefined)
                run.localAgent = agent;
        }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        disposals.set(agent, { promise, resolve });
        if (toolFilter !== undefined) {
            const globalNames = new Set(agent.ctx.tools.schemas().map(tool => tool.name));
            const allowed = toolFilter.allow === undefined ? undefined : new Set(toolFilter.allow);
            const denied = new Set(toolFilter.deny ?? []);
            agent.ctx.tools.restrict({
                ...(allowed === undefined ? {} : { allow: [...allowed].filter(name => globalNames.has(name)) }),
                deny: [...denied].filter(name => globalNames.has(name)),
            });
            agent.ctx.tools.guard(exec => {
                if (request.outputSchema !== undefined && exec.name === STRUCTURED_OUTPUT_TOOL)
                    return undefined;
                return (allowed === undefined || allowed.has(exec.name)) && !denied.has(exec.name)
                    ? undefined : 'Tool is outside the workflow task allowed capabilities.';
            });
        }
        return undefined;
    }, { global: true });
    const offDisposed = childId === undefined ? () => { } : request.parent.ctx.on('agent/disposed', ({ agent }) => {
        if (active.get(agent.id) === agent)
            active.delete(agent.id);
        disposals.get(agent)?.resolve();
    }, { global: true });
    const cleanupActive = async () => {
        const outcomes = await Promise.allSettled([...active.values()].map(async (agent) => {
            if (request.parent.ctx.get('agents')?.get(agent.id) !== agent)
                return;
            agent.cancel({ kind: 'parent' });
            await agent.whenIdle();
            await disposals.get(agent)?.promise;
        }));
        const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
        if (errors.length > 0)
            throw new AggregateError(errors, 'workflow child branch teardown failed');
    };
    let activation;
    try {
        activation = await subagents.startActivation({ ...input, provider, label: label ?? 'workflow-agent', signal, delivery: 'caller', ...(childId === undefined ? {} : { childId }) });
        expectingCreation -= 1;
    }
    catch (error) {
        offCreated();
        offDisposed();
        throw error;
    }
    if (toolFilter !== undefined && latest === undefined) {
        try {
            await activation.dispose();
        }
        finally {
            offCreated();
            offDisposed();
        }
        throw new Error('workflow child was published without applying its tool restriction');
    }
    run = {
        id: activation.childId,
        ...(latest === undefined ? {} : { localAgent: latest }),
        result: activation.result.then(async (result) => { await cleanupActive(); return result; }, async (error) => { await cleanupActive(); throw error; }),
        disposalOf: agent => disposals.get(agent)?.promise ?? Promise.resolve(),
        async dispose() {
            signal.removeEventListener('abort', abort);
            try {
                const outcomes = await Promise.allSettled([activation.dispose(), cleanupActive()]);
                const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
                if (errors.length > 0)
                    throw new AggregateError(errors, 'workflow activation teardown failed');
            }
            finally {
                offCreated();
                offDisposed();
                observations.delete(run);
            }
        },
    };
    const abort = () => { void run.dispose().catch(error => request.parent.ctx.logger.warn(`workflow child teardown failed: ${String(error)}`)); };
    observations.set(run, { begin: () => { expectingCreation += 1; }, end: () => { expectingCreation -= 1; } });
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    void activation.result.finally(() => signal.removeEventListener('abort', abort)).catch(() => undefined);
    return run;
}
/** Repair through the supported same-tree messaging API and await that child's teardown. */
export async function repairWorkflowAgent(subagents, parent, run, prompt, signal) {
    await sendWorkflowMessage(subagents, parent, run, prompt, signal);
    const child = run.localAgent;
    if (child === undefined)
        throw new Error('workflow verification repair requires a local child agent');
    const abort = () => { child.cancel({ kind: 'parent' }); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        abort();
    try {
        await child.whenIdle();
        await run.disposalOf?.(child);
    }
    finally {
        signal.removeEventListener('abort', abort);
    }
}
/** Deliver task context through DSH's supported same-tree agent messaging. */
export async function sendWorkflowMessage(subagents, parent, run, content, signal) {
    const observation = observations.get(run);
    observation?.begin();
    try {
        await subagents.sendMessage(parent, run.id, [{ type: 'text', text: content }], { signal });
    }
    finally {
        observation?.end();
    }
}

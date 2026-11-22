# DSH 0.2.2-rc.5 validation

Validated on 2026-11-22 against the supplied DeepSeek Harness checkout at commit `2e39e70496aa02986ca6a820c5d497e816b69d7e`. Plugin version: `0.1.6`; Node: `24.22.2` on Windows; pnpm: `11.28.5`; Cordis: `4.1.0`; Schemastery: `3.19.0`.

## Commands

Select Node 24 before using pnpm or starting DSH. This repository's `.node-version` selects `24.22.2` for fnm; it does not change the machine's default runtime.

```powershell
fnm use
$env:DSH_SNAPSHOT_DIR = 'C:\Works\PubProj\deepseek-harness'
pnpm install --frozen-lockfile
pnpm check
pnpm test:coverage
pnpm pack
```

The DSH checkout needs its own `pnpm install --frozen-lockfile`. The tests load matching published dependencies. Compatibility checks compare the checkout commit/version, declared and installed DSH dependencies, and vendor versions. Both production and test TypeScript programs check dependency declarations.

## Execution checks

`pnpm check:dsh-execution` loads the built plugin through the supplied checkout's real Cordis Loader. It mounts real AgentLoop, native tool dispatch, in-process spawn, Session projections/persistence/query, commands, titles, and jobs. Only model transport responses are scripted; no external model request or credential is used.

| Scenario | Assertions |
| --- | --- |
| Read-only native tools | Global write tool hidden; scoped write tool denied by the executor; read tool executes; no child remains. |
| Native filesystem evidence | Real read tool produces verification evidence; an attempted native write leaves the evidence file unchanged. |
| Structured output | Native `structured_output` works with the read-only mask and returns validated JSON. |
| Structured repair | A completed turn without structured capture receives one tool-free format repair and returns validated JSON. |
| Stop and cleanup | Cancelling an active workflow aborts the model call and waits for child teardown. |
| Exact activation disposal | Disposing an old activation leaves an independent later continuation under the same Session id running. |
| Stop owned descendants | Workflow cancellation stops the delegated child branch, preserves an unrelated active tree member, and leaves the parent alive. |
| Parallel/save/cache/rerun | Parallel children finish; a saved capsule is discoverable; cache resume avoids model calls; named rerun executes again. |
| Pause/resume | A queued second child cannot start while paused; resuming admits it and reaches completion. |
| Same-child verification repair | Cold resume preserves the child Session id and read-only policy; the repaired final result passes verification. |
| Background job | The native job is owned by the calling Session and exposes the completed workflow result. |
| Effective working directory | After a directory change, child execution, artifacts, catalog save, and discovery use the current directory. |
| Command handoff | `/workflow create` ends its command lifecycle before execution; the main Agent calls the registered workflow tool through the native pipeline; the user message and title remain correct. |

`pnpm check` also verifies background-run projection through the current UI assembler and plugin installation/unload through the current Loader. The unit suite has 183 tests; global coverage must meet 80% for statements, branches, functions, and lines.

## Packed consumer

The `0.1.6` tarball was installed in a fresh isolated consumer with exact DSH `0.2.2-rc.5` peers, without source aliases. The consumer strictly compiled imports of the public `WorkflowAgentStartRequest` and `WorkflowAgentRun` types, imported the package through its published ESM entry, mounted the service and three tools using the published Cordis/tool packages, and verified that unloading removed the tools.

## Scope

These checks validate plugin behavior against this exact DSH release on Windows. They do not validate external model account connectivity or third-party remote subagent implementations. Read-only and tool-free operations deliberately reject transports whose tool policy cannot be enforced locally. Existing custom dispatch and isolation adapters remain deployment-owned.

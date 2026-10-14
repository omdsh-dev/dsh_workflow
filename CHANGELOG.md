# Changelog

## [Unreleased]

---

## [0.1.5] - 2026-10-14

### Changed

- Target DeepSeek Harness `0.2.1-alpha.2` at `master@d74326738864`, with matching published DSH, Cordis, and Schemastery dependencies. Older DSH release trains are no longer supported.
- Use managed, caller-delivered subagent activations; preserve cancellation after publication and retain local session evidence after cleanup. Live messages and same-child verification repairs use DSH's continuation manager.
- Read immutable Session event snapshots, consume tool-result messages directly, declare the plugin's own message-source kind, and register background jobs under the owning Session id with the current `JobOutcome.result` field.
- Apply per-task reasoning effort through native DSH Agent options without requiring a dispatch adapter; reject providers that cannot apply those options before child startup.
- Emit the current native workflow event fields; the current client keeps background runs alive after normal step/turn closure without a `turn: null` override.
- Test against published packages, check UI projection against current checkout source, and verify the built plugin through the current Cordis Loader including unload. Add real managed-activation completion and cancellation regressions.

---

## [0.1.4] - 2026-09-05

### Changed

- Declare `@deepseek-ai/dsh-*` peer ranges against the current public harness release train (`^0.1.3-alpha.1`) so installs stop warning about unmet peers, and compile development against the same published versions.
- Move the compatibility baseline to [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) `master@d347e70390` (`0.1.3-alpha.1`), verified by a full `pnpm dsh web` boot with the bundle installed.

---
## [0.1.3] - 2026-08-14

### Changed

- Move the compatibility baseline from the private beta snapshot repository to the public [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) repository at `master@47f943859b` (`0.1.0-rc.5`), accept the public `0.1.x` DSH package family, and compile development code against the published npm packages instead of a machine-local beta checkout.

---

## [0.1.2] - 2026-08-13

### Fixed

- Smoke-validate command-authored inline workflows with the engine's shared child-task and deterministic admission contract before consuming the one-shot handoff grant. Invalid metadata, input schemas, read-only/agent/token limits (including concurrent reservations), provider capabilities/adapters, nested workflows, and concurrency now fail before any child starts, and the current Agent can correct the source in the same turn without falling into a disabled approval prompt.
- Publish dynamic workflow starts as session-scoped native events so a background run remains `running` after its launching tool step or turn closes; only the matching terminal `tool-workflow/run-end` decides completion, failure, or cancellation.
- State the exact `modelHint` values (`fast`, `balanced`, `deep`) in both workflow-authoring prompts.

---

## [0.1.1] - 2026-08-13

### Fixed

- Preserve the original `/workflow` query as a visible human Session message so DSH can render it, generate a session title, and identify the conversation in its Workspace.
- Keep workflow authoring instructions in separate plugin context while retaining exact one-shot approval semantics.
- Document DSH Web's manual-order five-session collapse and the “Last updated” view workaround.

---

## [0.1.0] - 2026-08-13

### Added

- Initial KodaX-parity dynamic workflow layer for DeepSeek Harness.

<!-- last-sync: 47966d66b344f833f7f627f1bd5e203463b5662e -->

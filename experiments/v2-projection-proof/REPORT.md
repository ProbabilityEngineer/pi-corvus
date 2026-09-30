# Pi 0.99.1 migration and bounded V2 projection proof

## Scope and preserved baseline

The released/default `index.ts` was not changed (SHA-256 remains
`a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`).
No Pi source was modified. The working tree began clean at pi-corvus HEAD
`2c79d327121afcb9cd8bd02a8ee5d1429c83e8f2`; no publish, tag, or commit was
performed.

## Pi 0.87.1 → 0.99.1 compatibility map

| Area | 0.87.1 dependency/API used by V1 | Pi 0.99.1 source | Result |
|---|---|---|---|
| Extension registration | `ExtensionAPI.on`, `appendEntry`, `registerCommand` | `packages/coding-agent/src/core/extensions/types.ts` retains these | Compatible; no V1 adaptation |
| Context hook | `context` carries non-system `AgentMessage[]`; handler returns changed messages | `ContextEvent` / `ContextEventResult` retain that contract; `context_with_system` is an additional hook | Compatible; V1 remains on `context` |
| Tool observation | `tool_result` has tool name/id, input, content, error state | `ToolResultEvent` remains discriminated; `ReadToolResultEvent` retains `input`, content and `isError` | Compatible |
| Read completeness | V1 validates exact full text result and read args/result | Read details/input types remain; V1's existing conservative output validation still passes | Compatible |
| Session metadata | `session_start` context exposes session manager; branch custom entries replayed | `SessionStartEvent` and session-manager branch APIs remain | Compatible |
| Message/provider conversion | `AgentMessage`, tool result IDs; `convertToLlm` | `packages/coding-agent/src/core/messages.ts::convertToLlm` still passes user/assistant/toolResult and converts custom messages | Compatible |
| Boundary additions | Not used by V1 | `turn_end`, `agent_before_settle`; `SessionBoundaryDraft`, `ContextEditEntryDraft`, `CustomMessageEntryDraft` added | New V2 API; does not alter V1 |
| Projection | Not used by V1 | `session-manager.ts::buildSessionProjection` plus append-only context edits and custom messages | New V2 capability |

The source package manifests identify coding-agent and agent-core as 0.99.1.
The installed dependencies were upgraded to 0.99.1; the full released V1
validation passed without changing `index.ts` or synchronization logic.

## Stage 1 — V1 compatibility gate

Changed package metadata only: development dependencies are pinned to 0.99.1,
and peer requirements now state `>=0.99.1`. Lockfile updated accordingly.
Package version remains 0.1.2. No CORVUS runtime adaptation was needed.

Results on Pi 0.99.1:

- unchanged historical A, external A→B, stable B, A→B→A non-resurrection;
- repeated-read single authority;
- partial/image/error/binary/oversized fail-open cases;
- BOM, line-ending and exact-content checks;
- raw canonical history and resume/branch tests;
- Codex/OpenAI Responses/Anthropic conversion pairing and no missing-result repair.

The existing released suite covers these cases and passed: 21 tests.

## Gate A — source/API findings and atomicity blocker

Inspected Pi 0.99.1 source:

- `packages/coding-agent/src/core/extensions/types.ts`: draft types and
  `turn_end`/`agent_before_settle` declarations.
- `packages/coding-agent/src/core/agent-session.ts::_dispatchTurnEndBoundary`,
  `_applyBoundaryDrafts`, `_createBoundaryPreviewManager`,
  `_buildBoundaryContext`, `_commitBoundaryDrafts`.
- `packages/coding-agent/src/core/extensions/runner.ts::emitBoundary`.
- `packages/coding-agent/src/core/session-manager.ts`: `ContextEditEntry`,
  `CustomMessageEntry`, `appendContextEdit`,
  `appendCustomMessageEntry`, `buildSessionProjection`.
- `packages/coding-agent/src/core/messages.ts::convertToLlm`.

The boundary runner rebuilds a temporary in-memory session with all proposed
drafts and calls `buildSessionProjection()` plus `convertToLlm()` before
dispatch completion. If preview throws, `emitBoundary()` returns no entries;
the turn-end caller then commits that empty draft list. Thus a rejected preview
does not partially append drafts. Context edits preserve the raw target entry;
custom messages become projected user messages, and provider conversion
accepts the resulting standard message types.

**Blocker:** successful validation and actual commit are separate operations.
`_commitBoundaryDrafts()` calls `_applyBoundaryDrafts()` against the real
session manager, which appends each draft sequentially and has no transaction,
rollback, or atomic batch-append API. If a commit-time append fails after the
retirement draft but before the anchor draft (or vice versa), Pi exposes no
mechanism for reverting the first append. Preview success makes ordinary
validation failures unlikely, but it does not establish the requested
all-or-none semantics in the face of a commit-time failure. Testing the
private append internals or simulating rollback in the extension would not
prove the public boundary's atomicity.

Gate A was therefore not declared passed. No Gate B or C transition logic was
implemented. No early-placement or reminder strategy was added.

## Validation

- `npm run check` — pass.
- `npm test` — pass, 21 tests.
- `npm run bench` — pass (synthetic serialized-byte benchmark only).

The temporary Pi install reported 3 npm audit findings (2 moderate, 1 high);
no audit fixes were applied. No live-provider, compaction, or V2 lifecycle
tests were run.

## Files changed and remaining risk

- `package.json`, `package-lock.json`: target Pi 0.99.1.
- `experiments/v2-projection-proof/REPORT.md`: migration findings and stop
  rationale.
- Released/default `index.ts` and npm runtime file list unchanged.

Pi core changes would be needed to provide transactional batch commit or
rollback for related context-edit + custom-message drafts. The 0.99.1 source
is not sufficient evidence to recommend it as V2's minimum supported version.
Independent review should first decide whether commit-time atomicity is a hard
requirement and, if so, whether Pi should expose a transactional boundary API.

NO-GO — Pi boundary drafts have preview validation but no atomic commit/rollback for paired retirement and promotion

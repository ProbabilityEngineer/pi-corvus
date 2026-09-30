# V2a single-write durable-anchor proof

## Scope / prior paired-write finding

This is a test-only experiment. The released/default `index.ts` is unchanged
(SHA-256 `a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`);
Pi source at `~/git/agents/pi` was read-only. The previous
`v2-projection-proof/REPORT.md` finding is confirmed by
`packages/coding-agent/src/core/agent-session.ts`:
`_commitBoundaryDrafts()` calls `_applyBoundaryDrafts()` sequentially on the
live manager and offers no transaction/rollback. This experiment avoids the
paired persistent `context_edit` + anchor and proposes a single
`custom_message` draft.

## Architecture tested

`experiments/v2-single-anchor/extension.ts` wraps the unchanged V1 extension's
public hooks. V1 remains responsible for eligible reads, exact direct disk
checks, paired stale-read markers, stale observation metadata, and safe
request-tail snapshots. A test-only resolver then:

1. reads durable anchors from the current session branch;
2. selects the highest-generation anchor for the canonical path;
3. compares exact anchor content with freshly decoded disk content (hash is
   metadata only);
4. request-side replaces non-current/stale anchors with a compact superseded
   marker;
5. removes V1's tail snapshot only when a durable anchor has byte-for-byte
   identical decoded content and no later fresh eligible read supersedes it;
6. records a pending tail transition and returns a single anchor draft only
   at `turn_end` with `outcome === "completed"` after re-reading the file.

Metadata includes schema, generation, canonical path, SHA-256, byte length,
and predecessor anchor entry ID. Superseded anchors and historical reads
remain in raw history. No prompt reminders, early placement, context edits,
compaction, or live provider work were added.

## Pi API/source locations

Inspected against Pi 0.99.1:

- `packages/coding-agent/src/core/extensions/types.ts`: custom-message
  boundary draft and `turn_end` event outcome.
- `packages/coding-agent/src/core/agent-session.ts::_dispatchTurnEndBoundary`,
  `_buildBoundaryContext`, `_createBoundaryPreviewManager`,
  `_commitBoundaryDrafts`.
- `packages/coding-agent/src/core/extensions/runner.ts::emitBoundary`.
- `packages/coding-agent/src/core/session-manager.ts::appendCustomMessageEntry`,
  `buildSessionProjection`, and `CustomMessageEntry`.
- `packages/coding-agent/src/core/messages.ts::convertToLlm`.

Pi previews the entire draft list in a temporary SessionManager, projects it,
converts it to LLM messages, then commits returned drafts. With one draft,
there is no paired-write partial-commit state; a failed preview produces an
empty draft list. The experiment's tests use public SessionManager projection,
append and conversion APIs, but **do not drive a real AgentSession
turn_end/commit lifecycle** (see unresolved items).

## Results

The focused mock-hook/session-projection tests cover:

- unchanged historical A and no duplicate anchor/snapshot;
- A→B request-side stale paired marker + one tail snapshot, no pre-turn
  anchor, one completed-turn custom-message draft;
- following projection with durable B, no tail duplicate, raw A preserved;
- B→C first request with B request-side superseded marker + one C tail, then
  one generation-2 C draft, followed by durable C and superseded B;
- aborted/error outcomes do not produce promotion drafts;
- A→B→A returns A in a later generation rather than restoring the old read;
- fresh complete B read after durable B suppresses synthetic duplication and
  makes the later historical read authoritative;
- tool call/result pairing after conversion;
- chronological anchor before later conversation, with the provider-converted
  prefix through B and C unchanged after conversation is appended.

The test helper preview creates an in-memory SessionManager, applies one
custom-message draft, calls `buildSessionProjection()` and `convertToLlm()`,
then appends that single message to the test session. Raw session history keeps
historical A and all anchors; only request messages carry compact replacement
content.

These tests establish the single-write **data-shape hypothesis**, not the
entire Pi extension lifecycle. Stable-C prefix position was checked in the
following projection; a separate byte-prefix growth assertion was made for B.
No provider cache-hit claim is made.

## Validation

- Focused: `npx vitest --run test/v2-single-anchor.test.ts` — 5 passed.
- `npm run check` — pass.
- `npm test` — 21 released tests pass (the package script intentionally
  excludes experimental suites).
- `npm run bench` — pass; synthetic serialized-byte benchmark only.
- `npm pack --dry-run` — seven expected release files only; both experimental
  directories and the focused test are excluded.

## Limitations / unresolved

- Extension hook registration was exercised through the repository's mock
  ExtensionAPI harness; Pi's real `AgentSession` boundary-preview/commit path
  was source-inspected but not invoked end-to-end. Thus boundary rejection,
  commit-time append failure, and extension-runner exception behavior have not
  been integration-tested.
- Multi-process/session reload, branch semantics, and other gates remain out
  of scope.
- **Compaction is unsolved and explicitly untested.** Raw stale entries and
  anchors remain in canonical history, so this is not a compaction solution.
- No Pi-core change is apparent for the single-anchor append itself, but a
  passing real-lifecycle test is needed before claiming V2a feasibility.
- Package metadata still targets Pi 0.99.1 from Stage 1; pi-corvus version
  remains 0.1.2. The npm runtime allowlist excludes this experimental code.

INCONCLUSIVE — the single-anchor data-shape tests pass, but Pi's real boundary lifecycle and failure paths remain unverified

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

## Genuine released-V1 multi-path regression

The adversarial review found that the former code removed the **whole**
combined V1 snapshot if *any* path had a matching durable anchor. Because V1
serializes several snapshots into one user message, an uncovered path's
current bytes could disappear. The first attempted hand-built fixture was
invalid: it supplied fabricated V1-like state/snapshot data without normal
path canonicalization and registration. That is a test-fixture error, not
evidence about production synchronization. The failing placeholder was
replaced; no fake snapshot is used by the regression below.

The review also notes that unchanged V1 persists `corvus-v1` stale-observation
metadata during request transformation. Thus this fix establishes per-path
request correctness; it does not assert that the full V1+V2a transition has
exactly one total CORVUS session-entry append. Only the V2a promotion itself
uses one custom-message draft.

`test/v2-single-anchor.test.ts::filters combined tails per synchronized path
and preserves V1 framing` builds a `SessionManager`, installs the released V1
extension through its normal event hooks, and for each file:

1. writes a real complete text file;
2. appends a paired model `read` tool call/result;
3. invokes V1's normal `tool_result` handler;
4. checks `rebuild(getBranch())` has a registration with exactly one
   observation;
5. edits the real files and invokes V1's actual registered `context` handler.

The pre-V2a output is parsed from that handler's actual serialized snapshot:
`[{path: A-canonical, content: A1}, {path: B-canonical, content: B1}]`.
The order is asserted as emitted by V1. V2a receives the V1 output plus the
original input array (so it can distinguish a newly appended V1 snapshot from
ordinary user text). It now computes covered paths by exact canonical path
and exact decoded content, filters entries individually, and rewrites the
existing V1-framed snapshot only when some paths remain. The covered path is
removed; uncovered entries retain their ordering and exact path/content. An
empty remainder removes the generated tail; no coverage leaves the output
unchanged. Snapshot-looking user content is not treated as a generated tail.

The durable A1 record is produced by V2a's normal `createAnchorDraft()` path,
then appended through the previously used test projection/promotion helper;
it is not an arbitrary custom message. The same mechanism builds durable B/C
anchors in the matrix.

### Matrix

| Case | Result |
|---|---|
| Durable A1 + V1 tail [A1,B1] | A1 tail item removed; exact B1 retained; one authority per path |
| Durable A1 + tail B1 + durable C1 | B1 alone remains in V1 tail; A1/B1/C1 each counted once |
| No durable anchors, V1 tail [X1,Y1] | Actual V1 output retained unchanged |
| Durable A1 and B1 + V1 tail [A1,B1] | Redundant combined tail removed; both durable authorities remain |
| Durable A1 stale; current A2 and B1 | Old A1 request-side superseded marker; tails A2 and B1 both retained |
| Fresh later complete A1 read; B needs tail | Fresh A read remains authority; A anchor is superseded; B1 tail remains |
| A refresh deleted; B refresh succeeds | A fails open (raw historical/anchor text retained); exact B1 tail remains |
| Ordinary user content resembles snapshot framing | Not classified/rewritten as a generated V1 tail |

The authority assertion reports `path: expected 1 current authority, observed N`
and counts full durable anchors plus exact matching snapshot entries. Compact
stale markers do not count. The fresh-read case separately verifies the
complete read result is retained and no A snapshot is injected.

### Path identity audit

The fixture calls V1 with relative `A.ts`/`B.ts` read arguments. It records:

- original tool path, e.g. `A.ts`;
- V1's `resolveLocalPath` result, equivalent to `resolve(cwd, "A.ts")`;
- realpath/canonical path;
- the V1 registration path from `corvus-v1` replay;
- actual V1-generated snapshot path;
- V2a anchor metadata path from `createAnchorDraft`;
- retained-tail path after V2a filtering.

All registered, anchor, generated-tail, and retained-tail paths equal the same
realpath canonical identity. No new normalization rule was needed.

For the primary A/B case, the test asserts both direct identities and content:
V1's actual array has `(A-canonical,A1)` and `(B-canonical,B1)`; after the
anchor match, V2a has durable `(A-canonical,A1)` plus retained
`(B-canonical,B1)`. Authority counts are one for each path, and the former
A0/B0 full bodies are absent (their paired markers are not counted).

### Implementation correction

`resolveV2aRequest()` now tracks exact covered paths instead of using an
aggregate `some()` decision to remove the entire snapshot message. It only
filters a snapshot proven to have been appended by V1 (one extra final message
relative to the original context); a user message with similar framing is
left alone. The released/default `index.ts` was not changed.

## Validation

- Focused: `npx vitest --run test/v2-single-anchor.test.ts` — 6 passed,
  including the genuine V1 multi-path matrix.
- `npm run check` — pass.
- `npm test` — 21 released tests pass (the package script intentionally
  excludes experimental suites).
- `npm run bench` — pass; synthetic serialized-byte benchmark only.
- `npm pack --dry-run` — seven expected release files only; both experimental
  directories and the focused test are excluded.

## Limitations / unresolved

- A focused native Pi 0.99.1 faux-provider test now exercises one real
  AgentSession A→B request and completed turn through the real V1/V2a context
  handlers and turn-end preview/validation/commit. It observes V1 read and
  stale entries, one B request-tail snapshot before completion, and one V2a
  anchor after completion. Continued native tests pass post-promotion B,
  B→C and real multi-path requests, throwing-draft preview rejection, and a
  faux aborted outcome. Anchor failure shows live/disk divergence; full
  reloaded-AgentSession recovery remains unverified. A concrete NO-GO was
  found: failure of V1's stale-metadata persistence causes the actual provider
  to receive unmarked stale read bytes without the current tail. No fix was
  made; bounded chronology was stopped. See `AGENTSESSION-INTEGRATION.md`.
- Multi-process/session reload, branch semantics, and other gates remain out
  of scope.
- **Compaction is unsolved and explicitly untested.** Raw stale entries and
  anchors remain in canonical history, so this is not a compaction solution.
- No Pi-core change is apparent for the single-anchor append itself, but a
  passing real-lifecycle test is needed before claiming V2a feasibility.
- Package metadata still targets Pi 0.99.1 from Stage 1; pi-corvus version
  remains 0.1.2. The npm runtime allowlist excludes this experimental code.

PASS — genuine V1 multi-path regression passes with corrected V2a per-path filtering

# V2a AgentSession integration evidence

## Disposable Pi bootstrap and native control

The Pi 0.99.1 source has npm workspaces and a root `package-lock.json`.
`packages/ai/src/providers/data/` is gitignored generated data. Neither
`npm ci --ignore-scripts` nor running normal npm lifecycle hooks generates it.
`packages/ai/package.json` defines `hydrate-model-data` as
`node scripts/generate-models.ts --strict --data-only`; root `hydrate:model-data`
delegates to it. The generator fetches the public catalogs expected by Pi and
writes/validates the provider data directory. This indicates source archive
incompleteness, not a missing installation hook.

In `/tmp/pi-corvus-v2a-pi-test`:

```sh
npm ci --ignore-scripts
npm run hydrate:model-data
npm run check:model-data
```

The generator completed using models.dev, NVIDIA NIM, OpenRouter, Vercel AI
Gateway, and Radius public endpoints, without credentials. It generated
`amazon-bedrock.json` plus sibling provider JSON and reported 177 Bedrock chat
models. `npm run check:model-data` passed (“Generated model data is valid.”).
No Pi production source was changed.

Before adding V2a tests, this unmodified Pi native control passed:

```sh
npm --prefix packages/coding-agent test -- test/suite/agent-session-boundaries.test.ts
```

Result: 29 tests passed. The V2a harness uses Pi's `createHarness` and faux
provider, adding only the copied V1/V2a extension sources and a test-only
complete-read tool/file mutation. No SoL-Pi, Observation Pack, unrelated
context transformers, or compaction extensions are loaded.

## Gate 1: real AgentSession A→B

Test:
`packages/coding-agent/test/suite/corvus-v2a-agent-session.test.ts` in the
disposable copy. The source test uses the actual V2a factory; its V1 import
resolves to an unmodified copy of released `index.ts`.

The faux provider issues a real `read` tool call through AgentSession. A
test-only tool reads A; after the real V1 `tool_result` callback registers
the complete read, a later test callback changes the file to B. AgentSession
then runs V1/V2a context transforms before its next provider request. The
provider-bound request includes the historical tool result marked
“superseded” and one generated snapshot whose exact content is B. The test
asserts that snapshot content occurs exactly once, and no V2a custom-message
anchor exists when the provider is about to consume B.

The faux model completes successfully. Pi's real AgentSession then traverses
the `turn_end` boundary dispatch, ExtensionRunner boundary handler/preview,
validation, and commit. Post-turn branch assertions find two `corvus-v1`
custom entries (read registration followed by stale-operation write) and
exactly one `corvus-v2a-state` custom-message anchor. The original paired
tool-result A remains in the raw branch. The next authority observation is
the single B snapshot before promotion; this initial test does not yet issue
a second post-promotion model request or verify B's persisted anchor position
in a following provider-bound request.

This is execution through real `AgentSession`, ExtensionRunner, request
context transform, faux provider, turn_end, preview/validation/commit and
SessionManager branch. `AgentSession` invokes its normal
`_dispatchTurnEndBoundary` → `emitBoundary` → preview/context validation →
`_commitBoundaryDrafts`; Agent processes context through Pi's real projection
and `convertToLlm` pipeline. The test does not individually spy on every
private function or explicitly assert `_persist` invocation.

The standalone test passed initially and was subsequently extended in place:

```sh
npm --prefix packages/coding-agent test -- test/suite/corvus-v2a-agent-session.test.ts
```

Result: 1 test passed. Together with the unmodified control, the final focused
native command passed 30 tests across 2 files.

## Continued native lifecycle gates

The existing harness was extended with one test-only option selecting
`SessionManager.create(tempDir, tempDir/sessions)` rather than the in-memory
manager. All integration phases now run against an actual on-disk JSONL
session. Pi production implementation remains unchanged. The test reads
actual bytes with `readFileSync`; the later tool-result observer changes the
file only after V1's real registration handler.

### Gate 1 post-promotion

An actual following `session.prompt`/faux-provider request sees exactly one
text B, no V1 request-tail snapshot, and the superseded A marker. The original
B anchor ID retains its branch index before the new user/assistant entries.
The historical raw A tool result remains in the session. Pi's normal provider
conversion runs; no pairing error occurs (an explicit general pairing checker
was not added).

### Gate 2 B→C

In the same session, the file is externally changed to C. The next actual
provider callback sees one exact C snapshot, no full B anchor text, and a
superseded marker. There is still only one anchor before completion. The
completed turn commits a second anchor (generation 2, predecessor B). The
following provider request contains exactly one text C, no full B and no
generated V1 tail. B precedes C in append-only history.

### Gate 3 multi-path

With durable current C on the first path, the model issues a real complete
read of a second path. That file changes from OLD-SECOND to CURRENT-SECOND
after V1 registration. The next actual provider request contains exactly one
complete C and one exact CURRENT-SECOND snapshot; OLD-SECOND is marked rather
than supplied as current. Thus the corrected per-path filtering survives the
real lifecycle. Current first-path C is equivalent to the gate's durable A
role; path names/content labels are not an algorithm change.

### Gate 4 preview rejection

Test-only wrapping of V2a's actual returned draft makes its `content` getter
throw `TEST invalid anchor content getter`. This is deliberately not a
no-draft result. Pi calls `_buildBoundaryContext` →
`_createBoundaryPreviewManager` → `_applyBoundaryDrafts`, where reading the
invalid anchor content throws. `ExtensionRunner.emitBoundary` catches it in
its **buildContext validation catch**, returns empty invalid drafts, and the
live manager receives no anchor. A following actual provider request still
supplies REJECTED-STATE through the V1 tail.

Limitation: this proves preview rejection of a throwing draft, not schema
validation of JSON-serializable malformed content. Inspection/testing showed
an unknown draft type can be ignored and null custom-message content can be
committed; neither was counted as a successful rejection.

### Gate 5 non-completed

The recovery callback returns a faux assistant with `stopReason: "aborted"`.
No new anchor is committed. This exercises Pi's real non-completed outcome,
not a manual boundary event. A separate cancellation signal, model error and
boundary-handler exception were not tested.

### Gates 6–7 anchor persistence failure

The second path already has a successful persisted V1 stale operation. Its
new REJECTED-STATE candidate is consumed successfully, then instance-level
`manager._persist` throws specifically for the actual V2a custom-message
append. No Pi production method was edited.

Observed:

- `_appendEntry` has mutated memory before the failing `_persist`; the live
  branch retains the failed anchor ID.
- JSONL has **no entry with that ID**. A subsequent persisted error assistant
  can refer to that ID as its parent; searching the raw file for the ID alone
  would falsely count that parent reference as a persisted anchor.
- `SessionManager.open` omits the failed anchor from its branch.
- AgentSession records an error assistant with `stopReason: "error"` and
  `errorMessage: "TEST anchor persist failure"`.
- After restoring persistence, the same running AgentSession's actual next
  provider request supplies REJECTED-STATE. This test only asserts presence,
  not whether live memory uses the unpersisted anchor versus a safe tail.

This matches Pi's general single-entry mutation-before-persist ordering. It
does not establish stronger durability or prove the complete reload/recovery
gate: **a fresh reloaded AgentSession provider request was not exercised**.
The on-disk stale-success/anchor-failure state is observed, but the intended
reload V1 fallback remains unverified. Do not claim the old atomicity blocker
fully resolved from this partial failure test.

### Gate 8 — correctness blocker: stale state exposure

A third real complete-read tool lifecycle registers STALE-THIRD; the
post-registration observer changes its bytes to CURRENT-THIRD. Instance-level
`_persist` throws only on an actual `corvus-v1` `op: "stale"` entry. The next
actual faux-provider request receives complete **STALE-THIRD**, with no stale
marker for that result and **no CURRENT-THIRD**.

The assertions for that unsafe exposure pass deterministically. This is not
an absent-anchor issue or a synthetic fixture. Released V1 applies the stale
operation in memory, then its `update` calls `pi.appendEntry`. The failure is
caught by V1's `context` handler, which returns the original untransformed
messages. V2a has no anchor for this path and therefore does not recover the
missing current snapshot. The provider consumes the old complete read as if
current.

The failed stale entry exists in live memory but is absent as an entry in
JSONL. After restoring persistence, the next actual request recovers:
STALE-THIRD is absent as complete text and exactly one CURRENT-THIRD snapshot
is supplied. Recovery does not undo the unsafe first request. A fresh reload
request for this case was not run.

This is a separate **released-V1 durability correctness issue**, exposed by
the composed real lifecycle before model completion. Pi's normal append
failure risk alone does not justify request-side stale-state exposure. No
implementation was fixed. Gate 9 was not run because this stop condition
fired.

## Durable entry ordering

Observed chronological sequence: first-path V1 read registration → raw A
tool result → V1 stale operation → completed response → V2a B → later
response → V2a C; second-path V1 registration → raw OLD-SECOND tool result →
V1 stale operation → response → V2a CURRENT-SECOND; rejected/aborted turns
append no V2a anchor; failed later anchor is live-only; third-path V1
registration succeeds and its later stale write is live-only on failure.
No additional V1 stale write occurs solely for B→C: the original observation
was already stale. V2a promotion itself uses one custom-message append; the
whole transition does not have only one total CORVUS write.

## pi-corvus validation

- `npm run check` — passed.
- `npm test` — 21 released tests passed.
- `npm run bench` — passed; synthetic serialized-byte benchmark only.
- `npm pack --dry-run` — seven expected release files; experiments excluded.
- `npx vitest --run test/v2-single-anchor.test.ts` — 6 passed.
- Released/default `index.ts` SHA-256 remains
  `a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`.
- Disposable Pi focused native tests: boundary control 29 passed and V2a
  AgentSession test 1 passed (30 total).

Compaction remains unsolved and explicitly untested.

NO-GO — V1 stale-metadata persistence failure exposes an unmarked stale
complete read to the actual provider and omits current file content.

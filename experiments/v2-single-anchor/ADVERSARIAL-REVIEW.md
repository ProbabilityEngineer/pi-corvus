# CORVUS V2a adversarial review against Pi 0.99.1

## Scope and verdict

This is a source review only. No CORVUS or Pi production code was changed; no provider, compaction, or persistence-failure experiment was run. The requested `pi-corvus-v2-source-design.md` was not present in the searched workspace, so this review uses the V2a report/extension/tests and the installed Pi 0.99.1 source.

The remaining uncertainty is **not just a test-harness limitation or ordinary Pi persistence risk**. A real `AgentSession` lifecycle test is practical, and Pi persistence has ordinary append-only failure limits. Separately, source inspection finds a concrete V2a multi-file request bug and a hidden V1 durable write that contradicts the broad “one durable CORVUS append per transition” claim.

## 1. Pi lifecycle: preview, validation, commit

Pi’s `AgentSession` turn-end boundary runs after the agent turn has produced its outcome. It resolves the relevant persisted message/tool-result entry IDs, calls `ExtensionRunner.emitBoundary`, commits valid returned drafts, refreshes finalized context, and only then decides whether to continue. This is the real lifecycle the V2a test does not currently exercise.

`emitBoundary` starts with an empty draft list, builds a preview, invokes handlers in order, accepts each handler’s returned `entries`/`continue`, and rebuilds the preview after each handler. Handler exceptions are caught and reported; preview/entry validation failures mark the result invalid and cause an empty, non-continuing result. The boundary commit is downstream of this runner behavior, not an ordinary extension event callback.

Important consequence: a context transform can run while Pi builds a boundary preview. Context handlers also run for actual model requests. Thus an `appendEntry` performed inside a context transform is a real immediate session append; it is not part of the returned boundary draft batch.

## 2. V2a lifecycle-test feasibility and present test limits

Pi provides a suitable native test foundation: `packages/coding-agent/test/suite/agent-session-boundaries.test.ts` and `test/suite/harness.ts` create real `AgentSession`s with extension factories, a local/faux provider, and session machinery. Existing cases exercise boundary drafts, preview context, validation, and commit behavior. A focused test can use an `openai-codex-responses` faux model/provider configuration and V2a’s extension factory; no live provider is needed. For actual persistence, use a temporary on-disk `SessionManager` rather than the harness’s in-memory manager.

The current `test/v2-single-anchor.test.ts` is useful as an algorithm/projection test, but it manually constructs extension API behavior and drives `SessionManager`/projection operations itself. It does not execute `AgentSession`’s turn-end boundary dispatch, `emitBoundary` preview/validation, or the real commit call. Consequently, its passing tests do not establish lifecycle ordering or append-failure behavior. This is a test boundary, not evidence that Pi makes the proposed test impractical.

The existing V2a tests cover important request-transform cases (including branch changes, fresh reads, and completed versus non-completed outcomes), but they do not establish real `AgentSession` integration, session-file durability, or write-failure recovery. No explicit SessionManager persistence-failure test was found in the inspected Pi test suite.

## 3. Single-write claim: hidden V1 writes

V2a itself returns one `custom_message` boundary draft only when the outcome is completed, exactly one tail snapshot is pending, and its final canonical path/content reread still matches. It then records generation/predecessor metadata. That is a single V2a anchor draft in that narrow success case.

However, the adapter deliberately runs the released V1 extension unchanged. In `index.ts`, its `update` applies an operation to in-memory state and immediately calls `pi.appendEntry`. During `synchronize`, stale observations cause `onStale({ op: "stale", ... })`; the V1 extension passes `update` as that callback. Therefore, a changed file can cause a durable `corvus-v1` stale-operation entry during request-context transformation, before V2a later promotes its boundary anchor. There can be one such entry per affected file, in addition to the V2a anchor. These writes are not boundary drafts and are not covered by V2a’s one-entry assertion.

So “V2a adds one anchor entry” is accurate; “a transition has only one durable CORVUS state append” is not accurate for the unchanged V1+V2a composition. The existing V2a test’s custom-type count does not detect the V1 stale-operation entries. This is a concrete architectural/accounting gap, not a Pi persistence caveat.

## 4. Concrete V2a multi-file request defect

`resolveV2aRequest` removes the entire V1 snapshot user message when **any** latest anchor matches **any** tail snapshot (`some(...)`). V1 can put snapshots for multiple paths in that one message. If path A has a matching durable anchor but path B has a current tail snapshot and no matching anchor, the `some` condition is still true and the filter drops B’s snapshot too. V1 may already have replaced B’s historical read with a superseded marker, leaving B’s current content absent from the request.

This case is independent of anchor promotion: the turn-end handler refuses to promote when `pending.length !== 1`, but request filtering occurs before that and can still drop the multi-path snapshot message. The current single-path projection cases do not rule it out. It is a correctness issue in V2a’s request semantics.

Other reviewed V2a semantics are directionally sound for a single path: anchors are selected from the active branch, exact disk bytes/content—not hashes alone—are used for authority, and a later complete read can supersede an anchor. Those checks do not cure the all-or-nothing multi-path filter above.

## 5. Persistence and failure injection

Pi’s `SessionManager._appendEntry` mutates its in-memory entry list, ID/tree indexes, and leaf before calling `_persist`. For an already-flushed session, `_persist` appends to the session file synchronously; initial creation uses exclusive file creation and writes entries. The inspected implementation provides no rollback of those in-memory mutations if persistence throws, no atomic batch transaction for boundary drafts, and no demonstrated `fsync` durability guarantee. This is ordinary Pi append-only session persistence risk and applies to ordinary user/assistant entries as well as extension entries.

At the V2a commit point, a persistence exception is outside `emitBoundary`’s handler/preview catches. It can escape the boundary dispatch into the agent run’s failure path. Because SessionManager has already mutated memory, the failed anchor append may remain visible in the live manager even though it is absent from the session file; there is no automatic rollback established by the inspected code. The precise post-error AgentSession context/retry behavior should be observed in the proposed integration test rather than inferred from the manual harness.

There is also a CORVUS-specific failure edge at the hidden V1 stale write: V1 applies the stale operation to its in-memory state before `pi.appendEntry`. If that append throws during a context transform, the transform can fail before returning its rewritten messages/current snapshot; Pi’s context runner catches handler errors and keeps the prior message list. This is not evidence of a Pi transaction defect, but it means the composed extension’s stale-write failure path deserves explicit assertion.

Deterministic failure injection is feasible without a provider or sleep:

1. Run a real AgentSession with a persistent temporary SessionManager and a barrier in a turn-end extension handler.
2. Once the handler is blocked, make the session log’s next append fail (for example, temporarily replace the log path with a directory on platforms where `appendFileSync` then fails with `EISDIR`), then release the barrier.
3. Assert the observed run outcome, in-memory branch/projection, on-disk JSONL after restoring the path, and a fresh SessionManager reload. Also inject a failure specifically on a V1 stale-operation append and verify whether the request contains current file state or stale historical content.

An instance-level `_persist` stub can be used as a deterministic first seam, but a filesystem-level append error better validates the actual persistence path.

## 6. Compaction boundary

V2a is a request-time projection adapter; it does not reduce or rewrite Pi’s native compaction input. Pi’s auto-compaction path takes the raw active branch, calls `prepareCompaction`, then emits `session_before_compact` and invokes either the extension result or the default compactor. It does not first run the ordinary provider-request `context` transform. The durable custom-message anchor can therefore be part of session projection, but V1’s request-only stale/read replacement is not applied to native compaction input. This matches the stated V1 limitation; do not infer compaction-input savings or stale-read exclusion from V2a request tests.

## 7. One next experiment

In a disposable Pi 0.99.1 test checkout, add one focused real-AgentSession test using a faux Codex-compatible model and persistent temporary SessionManager. Exercise: (a) A→B with one stale read and assert all `corvus-v1` and V2a entries, their order, and the actual next provider request; (b) two paths where A has a matching anchor and B needs a current tail snapshot; and (c) a barrier-controlled anchor-append failure followed by live-manager and reload inspection. This single test would settle the lifecycle feasibility and failure behavior while directly falsifying or confirming the one-write and multi-path concerns. It requires no live provider and no compaction experiment.

## Required disposition

**NOT READY to accept V2a as a single-durable-write architecture: first correct and test the multi-path snapshot filtering, account for V1 stale-operation appends, and run the real AgentSession persistence-boundary experiment.**

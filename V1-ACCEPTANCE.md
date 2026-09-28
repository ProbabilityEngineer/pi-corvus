# CORVUS V1 acceptance disposition: NOT ACCEPTED

Validated against Pi 0.87.1, without changing Pi core. This is a controlled experiment, not a validated provider-compatible replacement for ordinary file history.

## Passed (local tests)

- Successful bounded, full local text reads register; failed, image, partial (`offset`/`limit`), binary and oversized reads do not.
- Repeated reads yield one current snapshot; file edits are reflected in the next request without another read. Missing/renamed/binary/over-budget files leave affected history unchanged. LRU eviction and branch-local custom-entry reconstruction work in the test harness, including resume, fork, and tree navigation.
- Mixed assistant text, opaque signed reasoning, `read` plus `bash` calls, and both results survive Pi's `convertToLlm()` and actual `transformMessages()` / OpenAI Responses conversion. Codex conversion preserves paired function calls/outputs, emits no synthetic `No result provided` or duplicate/orphan result, and retains encrypted reasoning. The Anthropic adapter constructs its cross-model request body without synthetic results or leaking opaque reasoning.
- A locally simulated Codex SSE transport accepts the complete request emitted by Pi's actual Codex `stream()` path, with a real `SessionManager` JSONL containing the old body. The wire request has only the new body, once. The raw session and canonical projection retain the original body; request-time compaction savings are **not** claimed.
- A transform exception returns the original context. A non-destructive context extension works in either order. Snapshot paths and contents are JSON-encoded; aggregate budget counts encoded workspace-message bytes.

## Failed / not demonstrated

- **Live provider acceptance:** no real Codex/OpenAI request was sent; the successful SSE response was local. A mocked transport proves Pi's request construction, not server-side validation or semantic correctness of a model response.
- **Full end-to-end Pi agent loop:** extension registration is exercised through event hooks backed by a real `SessionManager`, not a Pi TUI/agent-loop invocation with a model-issued built-in `read`. The provider-bound test does use Pi's production converter and Codex stream request builder, but it supplies a persisted read transcript instead of invoking the tool via the agent.
- **Arbitrary context-extension order:** a later extension can drop CORVUS's snapshot after historical bodies have been replaced. Pi's `packages/coding-agent/src/core/extensions/runner.ts` applies `context` handlers in load order, accepting each returned message array; the public API offers no final, exclusive context-transform slot or request-wide invariant enforcement. Tests cover benign transforms in both orders, not a destructive one. Do not claim safety alongside unknown context-rewriting extensions.
- **Native compaction:** `packages/coding-agent/src/core/agent-session.ts` prepares the canonical projection before request-time `context` transformation. `ExtensionContext.sessionManager` is read-only and `ExtensionAPI` has no public `appendContextEdit` method (`packages/coding-agent/src/core/extensions/types.ts`). We did not bypass this boundary.
- No live provider token/cache/cost, workload-success, extension-load-order diagnostics, or adversarial-provider validation has been measured. `/corvus status` lists files and observations but not refresh-failure reasons or per-file request bytes.

## Validation and benchmark

`npm run check`; `npm test` (15 passing tests); `npm run bench`.

Synthetic 10-request, 20 repeated-read workload: baseline **622,410 serialized bytes**, enabled **142,200** (delta **480,210**). Pi's heuristic `estimateTokens`: baseline **134,800**, enabled **19,280**. These are **not** provider-billed tokens or cached-token measurements. Canonical compaction input still contains the original observations.

## Recommendation

Do **not** mark V1 accepted yet. A manually supervised coding session is reasonable only with CORVUS as the sole context-transforming extension, disposable files/session, and provider request capture; do not use it for unattended or cost-critical work. Live provider validation and a real Pi agent-loop read-to-request test are still required before general use. V2 is out of scope.

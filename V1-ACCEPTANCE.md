# CORVUS V1 acceptance disposition: CONTROLLED USE ACCEPTED; GENERAL COMPOSITION NOT ACCEPTED

**Historical report:** the original implementation always replaced even unchanged observations. That behavior was incorrect. Its snapshot counts, benchmark numbers and economic results below describe that earlier implementation. See [V1-CORRECTION.md](V1-CORRECTION.md) for the corrected semantics and new measurements; unchanged current observations now remain intact.

Validated against Pi 0.87.1 and live `openai-codex/gpt-6-luna`, without changing Pi core. Use only with CORVUS as the sole context-transforming extension; request-time elision is not a general replacement for Pi's canonical history.

## Live validation attempt (stopped before the read)

The offline-tested implementation and this report were preserved at commit `33eba4776` with the local tag `corvus-v1-offline-validated` before the experiment. The disposable workspace was `/tmp/pi-corvus-live.QtAYNa`; Pi ran in JSON print mode with an isolated session directory, built-in `read,edit,write`, CORVUS as the sole **context-transforming** extension, and a separate provider-request observer that did not transform context.

The first real Codex request using `openai-codex/gpt-5.3-codex-spark` was rejected: **“The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.”** Pi emitted one turn, one provider-bound request and a session file, but **zero tool calls**, no read observations, no provider usage accounting (Pi reported zero input/output tokens), and no compaction. The provider rejected model selection before CORVUS could synchronize a file. This is not a CORVUS correctness failure, but it does not validate V1.

Per that attempt's stop-on-provider-failure rule, no alternative model was tried **during that attempt**. This was an unsupported-model test-configuration failure, not a CORVUS failure. The authenticated Luna retry below is a separate experiment.

## Live Luna control and CORVUS validation

On 2026-09-28, the same Pi CLI/auth path with CORVUS **disabled** made one real built-in `read` and returned the correct baseline values (`AMBER-BASELINE`, `17`, `north`). Both model turns completed successfully (Pi-reported input: 2,095 uncached, 0 cache-read tokens). This control establishes that the provider and instrumentation work.

The CORVUS run used an isolated disposable workspace (`/tmp/pi-corvus-luna.dmJXoK/corvus`), isolated persisted Pi session, `gpt-6-luna`, and the normal Pi built-in `read,edit,write` tools. A separate observer captured *provider-bound request inputs* and tool/response events; it registered **no** context handler. CORVUS was the sole context-transforming extension. The model issued three genuine built-in whole-file reads and three edits across three cycles:

| Cycle | Persisted read observed | Current result after edit |
|---|---|---|
| 1 | `AMBER-BASELINE`, `17`, `north` | `COBALT-FIRST`, `29`, `north` |
| 2 | `COBALT-FIRST`, `29`, `north` | `JADE-SECOND`, `29`, `west` |
| 3 | `JADE-SECOND`, `29`, `west` | `VIOLET-THIRD`, `41`, `west` |

A fourth model turn **without tools** answered `VIOLET-THIRD`, `41`, `west`. The canonical JSONL retains all three original read bodies and three branch-local CORVUS state entries. While the file existed, every provider-bound request after registration contained **one** current workspace snapshot and one marker per eligible historical read (up to three); none contained an obsolete body in a `read` **result output**. All converted function-call outputs paired with function calls, with no duplicate outputs or `No result provided` repair. The old *values* can still occur in user prompts and `edit` call arguments, which CORVUS intentionally does not rewrite. The provider accepted the transformed requests and returned correct answers. One interim WebSocket error occurred after an edit; Pi recovered and completed the request through its transport fallback. There was no observed stale-state mistake or compaction event.

For the failure case, `fixture.ts` was deleted externally between turns. The next provider-bound request had **zero** CORVUS markers and **zero** workspace snapshots; it retained the three raw historical read results, with all call/result pairs intact and no synthetic repair. The model attempted a built-in `read`, received `ENOENT`, and answered that the file was missing. This is the specified fail-open behavior, not a stale-file claim.

Pi-reported cumulative provider usage over the CORVUS scenario (including the deletion turn): **14,279 uncached input**, **4,608 cache-read input**, **470 output** tokens over 13 requests/assistant messages, one recovered transport error, four built-in reads (three successful), three edits, and zero compactions. These are observed Pi provider-usage fields, not an estimate of token savings.

## Small disposable coding-task comparison

Identical starting code, tests, prompt, model, tools, and Pi flags were used in fresh `task-off` and `task-on` workspaces. The task fixed `parseEndpoint()` to trim whitespace and reject extra delimiters. In both modes the model used built-in `read` on the implementation and tests, used `edit`, ran `node --test endpoint.test.mjs` using `bash`, read the final implementation again, and passed all **three** tests. There were **no** stale-state mistakes or compaction events.

| Mode | Requests / assistant turns | Built-in reads (repeat of implementation) | Uncached input | Cache-read input | Total input including cache | Output | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Off | 5 | 3 (1 repeat) | 5,566 | 3,072 | 8,638 | 430 | 3/3 tests |
| On | 5 | 3 (1 repeat) | 7,738 | 1,536 | 9,274 | 363 | 3/3 tests |

This tiny workload shows **no token reduction**: enabled mode consumed 636 more total input tokens, likely reflecting marker/snapshot overhead for short files. These are Pi's provider-reported `usage.input` and `usage.cacheRead`, not a claim about billed cost or statistical performance. No heuristic token estimate is used for this comparison.

## Passed (local tests)

- Successful bounded, full local text reads register; failed, image, partial (`offset`/`limit`), binary and oversized reads do not.
- Repeated reads yield one current snapshot; file edits are reflected in the next request without another read. Missing/renamed/binary/over-budget files leave affected history unchanged. LRU eviction and branch-local custom-entry reconstruction work in the test harness, including resume, fork, and tree navigation.
- Mixed assistant text, opaque signed reasoning, `read` plus `bash` calls, and both results survive Pi's `convertToLlm()` and actual `transformMessages()` / OpenAI Responses conversion. Codex conversion preserves paired function calls/outputs, emits no synthetic `No result provided` or duplicate/orphan result, and retains encrypted reasoning. The Anthropic adapter constructs its cross-model request body without synthetic results or leaking opaque reasoning.
- A locally simulated Codex SSE transport accepts the complete request emitted by Pi's actual Codex `stream()` path, with a real `SessionManager` JSONL containing the old body. The wire request has only the new body, once. The raw session and canonical projection retain the original body; request-time compaction savings are **not** claimed.
- A transform exception returns the original context. A non-destructive context extension works in either order. Snapshot paths and contents are JSON-encoded; aggregate budget counts encoded workspace-message bytes.

## Remaining limits / not demonstrated

- **Arbitrary context-extension order:** a later extension can drop CORVUS's snapshot after historical bodies have been replaced. Pi's `packages/coding-agent/src/core/extensions/runner.ts` applies `context` handlers in load order, accepting each returned message array; the public API offers no final, exclusive context-transform slot or request-wide invariant enforcement. Tests cover benign transforms in both orders, not a destructive one. Do not claim safety alongside unknown context-rewriting extensions.
- **Native compaction:** `packages/coding-agent/src/core/agent-session.ts` prepares the canonical projection before request-time `context` transformation. `ExtensionContext.sessionManager` is read-only and `ExtensionAPI` has no public `appendContextEdit` method (`packages/coding-agent/src/core/extensions/types.ts`). We did not bypass this boundary.
- Neither general extension composition nor long-running workloads and provider-cache impact were validated. `/corvus status` lists files and observations but not refresh-failure reasons or per-file request bytes. The experiment did not enable compaction; zero compaction events occurred.

## Validation and benchmark

`npm run check`; `npm test` (15 passing tests); `npm run bench`.

Synthetic 10-request, 20 repeated-read workload: baseline **622,410 serialized bytes**, enabled **142,200** (delta **480,210**). Pi's heuristic `estimateTokens`: baseline **134,800**, enabled **19,280**. These are **not** provider-billed tokens or cached-token measurements. Canonical compaction input still contains the original observations.

## Recommendation

**Accepted for controlled, supervised use** with CORVUS as the sole context-transforming extension, disposable or backed-up workspace/session, and provider-request observation. **Not accepted for general extension composition or as a token-savings guarantee.** Do not use it for unattended or cost-critical work; short-file workloads may cost more. V2 is out of scope.

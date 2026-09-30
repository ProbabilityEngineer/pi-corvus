# One bounded early snapshot + late temporal reminder experiment

## Decision

The reminder repaired the primary **current-state B→C** answer in this trajectory:
Luna answered `V2`, not old `V1`. A later transition to D also answered correctly.
Stable C and D reused 9,728 tokens on subsequent turns.

But the preregistered historical-only question failed: asked what the original
model-issued read observed, Luna answered **current V3**, not **historical V0**.
The matched released-tail control answered V0. Correctness includes this
historical/current distinction; cache gains and repaired current-state answers
cannot override its failure. Live work stopped immediately, without retry,
wording/position/configuration changes, or further benchmarking.

The previous early-only report and its disposition are unchanged. This is a
separate intervention, not a reinterpretation of that result.

## Baseline and scope

2026-09-30; installed Pi 0.87.1; `openai-codex/gpt-6-luna`, `--thinking minimal`,
built-in read/edit. Released baseline:
`dbcd8e9ccd09644380ad2197a6b221691e88b5f4`, version **0.1.2**.
`index.ts` SHA-256:
`a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`.
All tracked files remained identical to HEAD; preserved index/package/lockfile
hashes pass verification. No Pi core/default/package/version modifications,
new synchronization policies, commits, pushes, tags, publication or V2.

Raw artifact root: `/tmp/corvus-temporal-experiment.aZmuwB`.
It contains released archive/hashes, frozen source hashes (`live-started`),
per-arm full `requests.jsonl` logical provider payloads, canonical sessions,
per-invocation JSON output, `summary.json`, `live.log`, and `STOP.json`.
`measurements.json` here preserves the offline analysis of both arms, including
every measured B/C/D request's indices, all snapshot/prefix hashes and first
differing item/path/byte; it includes the failed final answer.
`offline/` preserves exact converted test inputs.
No credentials were captured. Raw temporary artifacts are local, not guaranteed
permanent storage.

## Frozen reminder and placement

Frozen in [PLAN.md](PLAN.md) before implementation/live requests:

> [CORVUS temporal-authority reminder] The CORVUS workspace snapshot earlier in this request was refreshed for this request and represents current filesystem state for synchronized paths. Canonical conversation positioned after that snapshot may describe older states; historical discussion does not supersede the current snapshot.

One synthetic `user` message, one text block, timestamp 0; no filenames, task
values, suggested answer or benchmark hints. Immediately before the latest
canonical user turn, leaving the user's actual request last on no-tool turns.
On tool continuations it remains before that same user turn, with subsequent
assistant/tool groups intact. Only generated when a current synthetic snapshot
exists. Unchanged historical authority needs neither synthetic item. A context
without any canonical user retains released tail output rather than inventing
a turn. No alternative wording, role or placement was tested.

## Implementation and request structure

`extension.ts` is explicitly test-only, excluded from package entry points and
the `files` allowlist (verified with `npm pack --dry-run`). Its public-API proxy
registers released CORVUS once, intercepting only the returned `context` array.
It reuses the previous `moveNewSnapshot` boundary/helper, moving the **same**
newly generated released snapshot without editing its framing/content or
deterministic combined-file ordering, then inserts the frozen reminder.

All registration, retirement, refresh, exact-content identity, partial-read
rejection, resume/branch metadata and fail-open rules remain released behavior.
There is no omission/memoization: both synthetic items are reconstructed each
request, never sent through a persistence API.

Exact observed Codex logical structure on the primary C request:

```text
payload.instructions / tools / model / reasoning: restored Pi request state
payload.input[0]: user/input_text, one complete current C JSON snapshot
payload.input[1..18]: canonical chronology
  original read call and compact paired stale-A output remain paired
  earlier assistant answers include V0 and V1
payload.input[19]: user/input_text, exact frozen reminder
payload.input[20]: user/input_text, current C question
```

Snapshot framing remains:
`Current synchronized workspace files (request-time; authoritative for these paths; JSON-encoded content):`
followed by JSON with canonical absolute path and complete decoded contents.
The provider's initial instructions/tools are not synthetic conversational
items. Full non-input provider fields plus prefix-through-snapshot are
byte/structurally equal across each stable B, C and D series; the reminder does
not enter that prefix. Tail control snapshots move with conversation growth.

## Offline validation

Before live: `npm ci --ignore-scripts`, `npm run check`, `npm test` (**21 released
tests**), focused suites (**8 new + 7 previous experimental tests**), and
`npm run bench` pass. A TypeScript library mismatch in the new test helper was
fixed before live; it did not change reminder/design. LSP diagnostics for the
experimental entry point are clean. Final reruns also pass.

New focused coverage in `test/temporal-reminder.test.ts`:

| Required case | Result |
|---|---|
| Unchanged A | Original array/body retained; no snapshot/reminder |
| A→B, stable B | Sole current B; exact stable converted prefix |
| B→C, stable C | Sole new C; changed prefix then 3 exact-prefix follow-ups |
| A→B→A | Original A retired, not resurrected |
| Multiple synchronized files | Deterministic combined snapshot |
| One file changes | Changed only that file's current representation |
| New synchronized file | Fresh historical authority, then snapshot after change |
| Fresh complete read after synthetic authority | Fresh read supplies that path; no duplicate snapshot for it |
| Mixed text/reasoning/multiple calls | Blocks preserved; signed Codex reasoning retained |
| Tool/result pairing | Same IDs/order, unique outputs, no fabricated repairs |
| Resume | Retirement replayed through actual experimental factory |
| Fork/tree | Inherited registration/retirement, sibling isolation |
| Deletion/rename/invalid/oversized refresh | Fail open unchanged |
| Partial reads / content identity | Rejected registration; exact content rules inherited |
| Canonical-history audit | Neither synthetic item persists after normal response |
| Codex/OpenAI Responses/Anthropic | Converted inputs valid; exact captures saved |
| Tool continuations / no-user boundary | Reconstructed request-only reminder; no split groups |

Released tests additionally retain error/image/binary/BOM/line-ending,
transformation-exception fail-open and local Codex SSE wire-conversion coverage.
The benchmark remains a synthetic serialized-byte comparison, not provider
economics. No new limits or policies were introduced.

## Live method and semantic results

One fresh trajectory per matched arm: tail first, temporal second. Each used an
isolated workspace/session directory, identical 38,000-byte file fixture and
primary prompts copied from the previous experiment, sole selected transformer
plus a read-only observer, no unrelated extensions/skills/context files/
templates/themes, compaction explicitly disabled. `--offline` disables catalog
lookup, **not** live provider requests. There were 18 user invocations and
19 provider requests per arm (initial read requires two); **38 total**.
Every follow-up was no-tool; no rereads, edits or compaction occurred.

| Test | Released tail | Early + reminder |
|---|---|---|
| Initial A / 3 unchanged A | V0, correct | V0, correct |
| External B / 4 B turns | V1 on all | V1 on all |
| **First B→C current-state gate** | **V2** | **V2 — passed** |
| 2 stable C follow-ups | V2 | V2 |
| External D / 3 D turns | V3 | V3 |
| Old B and current D JSON | V1 / V3 | V1 / V3 |
| Historical B→C comparison + current | V1→V2 / V3 | V1→V2 / V3 |
| Explicit old answers/edit + unrelated formatting instruction | PREFIX:V3:SUFFIX | PREFIX:V3:SUFFIX |
| **Original read, historical-only question** | **V0** | **V3 — failed; STOP** |

The primary C request had one exact authoritative C, zero stale file bodies,
valid pairing, no model-issued read, and zero cached tokens on the transition.
Its snapshot's file-content SHA-256:
`35b6580fcb331aab3bcac85f5ff7323cac768ccd0ed33cb8e04aa18779919ae7`.
The first provider difference was `$.input.0.content.0.text`, as expected when
the early snapshot changes. Stable C retained the complete prefix.
D similarly changed the snapshot immediately and remained correct.

The final frozen question was:

> What version did the original model-issued read observe, before the external updates? This is a historical question, not a current-state question. Without tools, reply only that old value.

Temporal response: **V3**, with no tools. Correct historical answer: **V0**.
The request retained the original assistant answer `Version: **V0**.` and three
later V0 answers, so the relevant historical value was still available in
conversation even though the original raw file body was appropriately elided.
The sole current D snapshot was complete; its content hash:
`26b3f4d3d342ac7a2287d2d90a557c2f29268bccd4a44a6d5aefcc5a8b3f14bc`.
Snapshot index 0; reminder index 37; historical question index 38.
This is an interpretation failure, not evidence of stale/missing current data.
No attempt was made to explain it away or repeat the question.

## Cache measurements

Input total = uncached + cache-read. Costs are Pi usage accounting in USD,
not independently verified invoices. Input/context bytes below are serialized
logical provider input / pre-conversion context. Output was 6 tokens on each
listed request. Indices are zero-based; `S/R` = snapshot/reminder.

| Arm/turn | Total input | Cache-read | Uncached | Cost | Input bytes | Context bytes | S/R |
|---|---:|---:|---:|---:|---:|---:|---|
| Tail B1 | 9,753 | 0 | 9,753 | .00097830 | 41,269 | 43,744 | 11/— |
| Tail B2 | 9,791 | 0 | 9,791 | .00098210 | 41,694 | 44,612 | 13/— |
| Tail B3 | 9,829 | 0 | 9,829 | .00098590 | 42,119 | 45,480 | 15/— |
| Tail B4 | 9,867 | 0 | 9,867 | .00098970 | 42,544 | 46,336 | 17/— |
| Temporal B1 | 9,814 | 0 | 9,814 | .00098440 | 41,660 | 44,157 | 0/11 |
| Temporal B2 | 9,852 | 0 | 9,852 | .00098820 | 42,085 | 45,025 | 0/13 |
| Temporal B3 | 9,890 | 0 | 9,890 | .00099200 | 42,510 | 45,881 | 0/15 |
| Temporal B4 | 9,928 | 0 | 9,928 | .00099580 | 42,935 | 46,735 | 0/17 |
| Tail C1 | 9,906 | 0 | 9,906 | .00099360 | 42,975 | 47,198 | 19/— |
| Tail C2 | 9,945 | 0 | 9,945 | .00099750 | 43,406 | 48,072 | 21/— |
| Tail C3 | 9,984 | 0 | 9,984 | .00100140 | 43,837 | 48,958 | 23/— |
| Temporal C1 | 9,967 | 0 | 9,967 | .00099970 | 43,366 | 47,597 | 0/19 |
| Temporal C2 | 10,006 | 9,728 | 278 | .00012808 | 43,797 | 48,459 | 0/21 |
| Temporal C3 | 10,045 | 9,728 | 317 | .00013198 | 44,228 | 49,334 | 0/23 |

Unchanged-A follow-ups: both arms `[8704,8704,8704]`; measured input totals
`9559,9592,9625`, output 6 each, effectively equal reported costs.

B aggregate: tail input/uncached **39,240**, cache 0, cost **$0.003936**;
temporal input/uncached **39,484**, cache 0, cost **$0.0039604**.
C aggregate: tail input/uncached **29,835**, cache 0, cost **$0.0029925**;
temporal input **30,018**, cache **19,456**, uncached **10,562**, cost
**$0.00125976**. Each C series output 18 tokens.
D cache-read: tail `[0,0,0]`, temporal `[0,9728,9728]`.
The four chronology probes also reported 9,728 cached tokens each in temporal,
including the failed answer; tail reported zero.

The reminder increased measured input by 61 tokens and serialized input by
391 bytes per matched B/C/D request. It did not structurally destroy the large
prefix and meaningful reuse occurred for C/D, **but B had no cache hits despite
an exact stable prefix**. This differs from the previous early-only B observation
and must be reported, not tuned until favorable.

Stable temporal hashes (each identical across its entire unchanged series):

| State | Snapshot item SHA-256 | Complete prefix SHA-256¹ |
|---|---|---|
| B | `96ee1b8118988f8e90fc207c28dd61518171ae7bdcc79592304f3ed27e5eefda` | `25341c94b533c1304505c5e0a06c33d1e015985721b7e5ea69df96efb4889967` |
| C | `6a644651e6ac27a2c86cde78e9809450ef175f216a39d30e7aa2daa5cb9e1bce` | `84d5c8072b55eda34de5b7f85bebfb54854756b42056529d8c701c48fbabda5a` |
| D | `0b98bc206a2ff754745346fc7a4bbd00e1fef15404847a8feb2af17e3844bd8b` | `4fc4c193e0f1e5e79dc0f66b1e05161ddc00930fb458d2fcd2db37b7abf004e1` |

¹ SHA of serialized non-input logical provider fields plus input through the
snapshot; analyzer also verifies direct string equality, not hashes alone.
Input-only prefix hashes and every tail hash are in `measurements.json`.
Stable temporal B differences begin at reminder positions `11,13,15`, C at
`19,21`; path `$.input.<index>.content.0.text`. Tail B growth differs at
`11,13,15`, C at `19,21`; path `$.input.<index>.role`. Transitions in temporal
differ first at item 0's snapshot text; the late reminder never changes that
early prefix.

## Canonical-history audit

All 38 requests passed authority/pairing audits. Each successfully refreshed
path had exactly one complete current representation, no stale authoritative
read body, no pairing repair. Original canonical message prefixes remained
unchanged after every inference. Final persisted session files retain the
complete 38,000-byte original V0 read; neither snapshot nor reminder occurs
anywhere in those files. Normal user/assistant/tool entries and released
branch-local `corvus-v1` metadata remain the only added session state.
Resume/fork offline tests separately confirm request-only reconstruction and
that a normally persisted response does not persist either synthetic item.

## Uncertainties and recommendation

- One trajectory per arm, tail-first order, stochastic answers and independent
  sessions/paths: no statistical reliability or causal backend diagnosis.
- Correct first C/D answers do not establish general temporal correctness;
  the historical failure directly violates a required success criterion.
- B cache misses despite identical logical prefix demonstrate that structural
  stability alone does not guarantee provider hits.
- Captures are logical converted provider bodies, not server-internal prompts
  or an independently instrumented transport/invoice.
- Live multi-file/fork/refresh-failure/provider diversity was not benchmarked;
  those validations are offline. No stronger reminder or alternative role/
  placement, additional repetition or longer trajectory was tried.
- Findings concern this Codex/Luna placement strategy only. Synchronization
  semantics remain provider-neutral; no provider-independent claim follows.

Retain released/default tail placement. Do not merge the experimental entry
point. The bounded intervention improved current-state/cache behavior on C/D
but did not preserve reliable historical-versus-current interpretation.

NO-GO — late reminder did not make early placement semantically reliable

# V1 correctness correction: unchanged observation reuse

Follow-up: [V1-CACHE.md](V1-CACHE.md) reports three bounded paired repetitions and exact full-payload prefix analysis. Unchanged-A controls had 12/12 follow-up hits in each arm; stable-B requests had 0/12. That report supersedes interpreting the single-run unchanged cost percentages below as performance characterizations.

## Semantics

For each successfully refreshed synchronized file, a request contains one authoritative complete current representation: either an untouched, eligible historical read whose actual contents exactly match the refreshed file, or one current snapshot. Tool calls, result IDs, unrelated blocks, and canonical Pi messages remain unchanged.

- Registration still requires a successful whole local text read that exactly matches the file. Offset/limit, truncated, image, invalid UTF-8, binary, and over-limit observations fail open under existing V1 rules. No limits, eviction, or truncation policies were added or changed.
- Stored SHA-256 authenticates the original read body. Authority requires direct string equality against a fresh, lossless UTF-8 decode (including BOM, CRLF, and trailing newline), not hash equality alone.
- Select the **earliest read in the trailing consecutive run of eligible current observations**. This preserves the longest historical prefix while exposing just one full copy. Replace other eligible synchronized read bodies with paired compact markers. If no eligible authority exists in the current context, inject a current snapshot.
- Once an observation is verified to differ from current contents, retire it permanently from authority in branch-local `corvus-v1` custom metadata. Retirement is replayed on resume/tree/fork and does not rewrite canonical messages. A→B→A therefore supplies a new A snapshot instead of resurrecting A at an old chronological position, even if B was never model-read. A fresh complete A read may become authority.
- After A→B, if no new read occurs, every request still supplies B once. There is no snapshot memoization/omission, LRU change, active-set policy, new cap, V2, or provider-placement optimization.
- Missing/deleted/invalid/over-budget refreshes retain V1 fail-open behavior. The authority invariant is not claimed when refresh fails, nor alongside destructive later context transforms.

## Regression validation

`npm ci --ignore-scripts`; `npm run check`; `npm test` (**21 passing**); `npm run bench`.

Coverage: unchanged A returns original messages without injection; external A→B; unchanged B over repeated requests; repeated identical reads choose one authority; stale older/current newer reads; repeated A→B→C; independent changed/unchanged files; A→B→A without resurrection; retirement across resume; deletion/rename fail-open; partial/image/error/binary/oversized rejection; BOM/line-ending identity; canonical history preservation; branch isolation; Codex/OpenAI Responses/Anthropic conversion; exact unchanged Codex prefix; complete paired outputs without synthetic repair.

Synthetic benchmark: baseline 622,410 serialized bytes → corrected 143,610; heuristic Pi tokens 134,800 → 19,850. Neither is provider accounting.

## Corrected real Luna measurements

2026-09-30, installed Pi 0.87.1, `openai-codex/gpt-6-luna`, minimal thinking, built-in read/edit. Fresh isolated sessions/workspaces, identical prompts/fixture bytes/flags within each workload. CORVUS was the only context transformer; the observer returned no context modifications. `--offline` disables catalog lookup, **not live provider calls**.

Reproduce with authenticated Pi:

```sh
node scripts/luna-measure.mjs /absolute/new/output-directory
```

The harness records raw provider input arrays, serialized pre-conversion context/input sizes, usage, reported cost, first differing input-item index, and pairing/authority audits. It rejects partial reads, provider errors, broken pairing, or any synchronized request with other than one exact current representation. Output contains disposable fixture contents; credentials are not captured.

Final implementation run: `/tmp/corvus-corrected-final-20260930`. Values are cumulative over each bounded workload; USD cost is Pi's provider/model usage cost, including output, **not an independently verified invoice**. Input total = uncached + cache-read.

| Workload | Mode | Requests | Total input | Cache-read | Uncached | Reported cost | Context bytes¹ | Provider input bytes¹ |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Unchanged large, initial read + 3 follow-ups | Off | 5 | 39,285 | 26,112 | 13,173 | $0.00162442 | 163,309 | 158,018 |
| Same | Corrected | 5 | 39,255 | 17,408 | 21,847 | $0.00239078 | 167,495 | 157,920 |
| Small file, 8 read/edit cycles | Off | 17 | 37,863 | 20,992 | 16,871 | $0.00214402 | 257,994 | 113,079 |
| Same | Corrected | 17 | 32,135 | 12,288 | 19,847 | $0.00235458 | 229,936 | 86,111 |
| Large file, 2 read/edit cycles | Off | 5 | 56,771 | 35,328 | 21,443 | $0.00257558 | 245,909 | 235,939 |
| Same | Corrected | 5 | 39,965 | 0 | 39,965 | $0.00407450 | 171,109 | 161,137 |

¹ Sum of serialized sizes across requests, not peak context or tokenizer estimates. Pre-conversion context can include Pi custom/state material excluded by provider conversion. Fixture bodies are 700 bytes (small) and 38,000 bytes (large).

Matched trajectory counts were correct: 1 read/0 edits, 8 reads/8 edits, 2 reads/2 edits. All final corrected requests passed exact-content authority and pairing audits. No model-issued reads occurred during external-change follow-ups.

Cost differences in this final run: unchanged **+47.2%**, small edits **+9.8%**, large edits **+58.2%**. These are single-trajectory observations, not statistical claims.

### Unchanged A: cache reuse is possible, not guaranteed

There were **zero markers and zero snapshots** on every unchanged-A request. The provider prefix stayed intact: successive first differing item indices (zero-based) were `1,3,5,7`, each at appended conversation material, not an altered read output.

Baseline follow-ups each reported 8,704 cached tokens. Corrected follow-ups reported `0,8704,8704`: the first missed despite the unchanged provider prefix. Therefore cache-read reuse is restored structurally and observed on subsequent turns, but an identical prefix is not sufficient to guarantee a hit.

A separate first corrected run, before adding persistent stale retirement (which does not affect unchanged A), in `/tmp/corvus-corrected-20260930`, reported all three unchanged-A follow-ups at 8,704 cached tokens in both modes:

| Mode | Total input | Cache-read | Uncached | Reported cost | Context bytes | Provider input bytes |
|---|---:|---:|---:|---:|---:|---:|
| Off | 39,244 | 26,112 | 13,132 | $0.00160432 | 163,144 | 157,883 |
| Corrected | 39,274 | 26,112 | 13,162 | $0.00162132 | 163,241 | 158,006 |

That run's cost difference was +1.1%; output wording/usage varied. Both runs are reported to avoid selecting only favorable cache behavior.

### External A→B, stable B, then B→A

Final corrected run, immediately after the unchanged-A workload:

| Request | Total / uncached input | Cache-read | Reported cost | Context bytes | Provider input bytes |
|---|---:|---:|---:|---:|---:|
| First external B | 9,763 | 0 | $0.00098030 | 45,162 | 41,254 |
| Unchanged B, second turn | 9,799 | 0 | $0.00098390 | 46,003 | 41,652 |
| Unchanged B, third turn | 9,835 | 0 | $0.00098750 | 46,856 | 42,050 |
| External return to A | 9,868 | 0 | $0.00099080 | 47,679 | 42,442 |

Each contained one marker and exactly one full current snapshot. Luna answered V1 on all B turns and V0 after return to A, without tools. Original A was never re-promoted after retirement.

On the first B request the prefix diverged at input item **2**, the original read output becoming a marker. On subsequent unchanged-B requests the first difference was at **11**, then **13**: the previous end-of-request synthetic snapshot was displaced by appended assistant/user conversation, and an identical B snapshot appeared later. B remained authoritative but did **not** become a stable cacheable large prefix without a new read. No contents were omitted to improve cache behavior.

### Repeated edits

For small edits, corrected stale-transition differences occurred at items `2,6,10,14,18,22,26,30` (read outputs becoming markers); baseline only appended items. For large edits they occurred at `2,6`. After a new complete current read, the historical observation supplied authority and the duplicate snapshot disappeared. Once the next edit made that observation stale, a single current snapshot was supplied again.

This explains the structural loss of otherwise reusable prefixes at stale transitions. It is consistent with lower total input but greater uncached input/cost. Provider cache behavior also varies independently, as the unchanged-prefix miss demonstrates; we do not claim prefix mutation is the sole causal mechanism for every miss.

## Disposition

The prior **+160.5% unchanged-large-file** result measured **incorrect always-replace/always-reinject behavior** and must not characterize corrected V1. The prior +24.7% small-edit and +58.6% large-edit comparisons likewise describe the old implementation, not these corrected runs.

The correctness correction is implemented and tested. Unchanged historical authority preserves the provider prefix and permits cache reuse; current synthetic B snapshots still move and did not regain cache hits in these runs. No further optimization or release is forced. Package version remains unchanged; no commit, tag, publication, V2, or new synchronization policy was introduced.

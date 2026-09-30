# Narrow post-change prompt-cache investigation

## Decision

**Recommend shipping the semantic correction alone as 0.1.2**, with no cost-saving guarantee. Unchanged historical authority consistently reused cache in these controlled repetitions. Stable synthetic B did not; its full text is identical but its position in the prefix changes as normal conversation grows.

No CORVUS semantics, placement, limits, eviction, truncation or omission policy was changed during this investigation. `index.ts` remained SHA-256 `a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`. No release, version bump, commit, or V2 was performed.

## Experiment

2026-09-30; installed Pi 0.87.1; authenticated `openai-codex/gpt-6-luna`, minimal thinking, built-in read/edit tools. Three independent paired repetitions, alternating baseline/corrected order. Each used fresh isolated sessions/workspaces and identical non-secret 38,000-byte fixtures:

1. Model-issued complete read of A (`V0`), no offset/limit.
2. Four identical-prompt no-tool follow-ups while A remains unchanged.
3. Corrected arm only: externally replace A with B (`V1`).
4. Four identical-prompt no-tool requests while B remains unchanged.

Bound: **48 provider requests**, including initial read continuations; 12 unchanged-A follow-ups per arm, 12 B requests (9 subsequent to first B injection). No adaptive retries or outcome-based tuning. All requests completed; every corrected synchronized request passed exact-content authority/pairing checks. Every B answer was `V1`, without tools.

Reproduce:

```sh
node scripts/luna-cache-repeat.mjs /absolute/new/output-directory
node scripts/luna-cache-analyze.mjs /absolute/new/output-directory
```

Artifacts: `/tmp/corvus-cache-repeats-20260930`; `analysis.json`, per-arm `summary.json`, `requests.jsonl` (full payloads), per-turn events, and raw sessions. The observer is read-only. It captures the complete logical provider body at `before_provider_request`, including instructions, tools, model/settings and cache key, before transmission. It does not capture authorization headers.

Each follow-up invokes a fresh Pi process, retaining its session ID on resume. Thus there is no prior socket continuation state on those requests: the inspected adapter sends the full body, not a `previous_response_id` input delta. The default transport may wrap this as `{"type":"response.create", ...body}` or compress the same JSON for SSE. Byte offsets below refer to the captured logical JSON body, **not compressed/framed network bytes**. Neither static wrapping nor compression establishes model token-prefix boundaries.

## Repeated unchanged-A control

Totals include the initial two-request read plus four follow-ups per repetition. Input total = cache-read + uncached; costs are Pi's reported usage/model cost including output, not an independently verified invoice. Sizes sum across requests.

| Repeat | Mode | Total input | Cache-read | Uncached | Reported USD | Context bytes | Provider input bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | Baseline | 48,926 | 34,816 | 14,110 | 0.00179016 | 206,115 | 198,373 |
| 1 | Corrected | 48,918 | 34,816 | 14,102 | 0.00178836 | 206,249 | 198,341 |
| 2 | Baseline | 48,918 | 34,816 | 14,102 | 0.00178836 | 206,245 | 198,337 |
| 2 | Corrected | 48,918 | 34,816 | 14,102 | 0.00178836 | 206,245 | 198,337 |
| 3 | Baseline | 48,922 | 34,816 | 14,106 | 0.00178926 | 206,197 | 198,349 |
| 3 | Corrected | 48,926 | 34,816 | 14,110 | 0.00179016 | 206,115 | 198,373 |

Every A follow-up in both arms reported **8,704 cache-read tokens**: 12/12 hits in each arm. Corrected versus baseline costs were −0.10%, 0.00%, +0.05%; aggregate $0.00536688 versus $0.00536778. Minor output variation explains the tiny input/cost differences.

There were no A markers or synthetic snapshots. Earlier provider items were byte-identical within each session; only appended conversation changed the request. Non-input body fields were stable. This bounded test supports parity for unchanged observations, not general economic performance. The previous corrected +47.2% and +1.1% single-run results in [V1-CORRECTION.md](V1-CORRECTION.md) remain recorded, but are not reliable performance characterizations: one missed cache hit can dominate cost.

## Repeated stable-B accounting

Totals below include the first request after external change and three subsequent stable-B requests.

| Repeat | Total input | Cache-read | Uncached | Reported USD | Context bytes | Provider input bytes |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 39,426 | 0 | 39,426 | 0.00395460 | 183,974 | 169,196 |
| 2 | 39,426 | 0 | 39,426 | 0.00395460 | 183,970 | 169,192 |
| 3 | 39,434 | 0 | 39,434 | 0.00395540 | 185,116 | 169,228 |

Per-request uncached input: `[9798,9837,9876,9915]` in repetitions 1/2; `[9800,9839,9878,9917]` in repetition 3. Cache-read input: `[0,0,0,0]` in all three. No cache hit was observed in any of the **9 later stable-B requests**.

Every request had one authoritative B snapshot and one paired stale-A marker, no duplicate current file representation or synthetic missing-result repair.

## Exact structural/byte cause

Within each repetition:

- B file contents remained exactly byte-identical (38,000 bytes; SHA-256 `1fdaf056a2099787dde952fa8e5cd43545004530945242581ec9feddb4cee8e5`).
- The **entire converted B user-message item**, including path, framing and JSON-encoded content, remained byte-identical.
- Snapshot input index changed **13 → 15 → 17 → 19** (zero-based).
- Its surrounding position was not identical. Earlier canonical items stayed identical, but each new assistant reply and user prompt was inserted **before** the newly appended request-only snapshot.
- Non-input body fields were identical: instructions, tools/schema/order, model, reasoning, text verbosity, cache key, store/stream flags and other settings.
- No timestamp was transmitted on the B user item. Pi's Responses converter drops the AgentMessage `timestamp`; CORVUS's fresh `Date.now()` is not the observed cause.
- Existing tool/message IDs and signatures stayed stable. Newly generated assistant IDs appeared only on newly appended conversation items. There was no reformatting, regenerated old ID, or reordering of preserved history.

Example: repetition 1, captured body serialized with `JSON.stringify`; all byte offsets zero-based:

| Request | B index | First differing structural path vs previous request | First differing body byte | First differing input-array byte | Bytes before B¹ |
|---|---:|---|---:|---:|---:|
| First B | 13 | `$.input.2.output` | 3,021 | 458 | 2,532 |
| Second B | 15 | `$.input.13.role` | 5,097 | 2,534 | 2,962 |
| Third B | 17 | `$.input.15.role` | 5,527 | 2,964 | 3,392 |
| Fourth B | 19 | `$.input.17.role` | 5,957 | 3,394 | 3,822 |

¹ Serialized array of preceding items, including its delimiters; not a token count.

The first B request necessarily changes the old A read output at item 2 into a marker. On the next request, item 13 was previously the B `user` snapshot, but is now a newly appended assistant `message`; B moves to item 15. The same displacement recurs at 15, then 17. Snapshot item SHA-256 is constant within repetition 1: `a636c62da665ef2f3ca2f5b6e214976cb588e48bddf71e57b187479fb25e5803`. Other repetitions have different paths, but likewise constant item hashes within their sessions.

The previous pre-B history is a prefix of the next pre-B history; however, **the previous full prefix through B is not a prefix of the next request**. New conversation material occupies the previous B position. Identical text elsewhere later in the prompt is not reusable as a prefix.

At the source level, CORVUS appends its snapshot after the canonical messages with `output.push(...)`, but does not persist that snapshot as a canonical conversation message. On the next turn, Pi appends the assistant reply/user prompt to canonical history, then CORVUS appends B again. Pi/provider conversion preserves this order. Therefore:

- **Determined:** current request construction plus ordinary conversation growth prevents reuse of an existing cached prefix *containing B*.
- **Not determined:** why no shorter pre-B prefix receives any cache-read accounting. Cache eligibility/boundaries, hidden rendering, routing, and backend policy are not fully observable.
- Repetitions strongly support a deterministic structural obstacle for B, not a one-off random miss. They do not prove every zero-cache token is solely caused by placement, nor rule out provider-side cache variability.

## Cache documentation and limits of inference

Official [OpenAI prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching), retrieved 2026-09-30:

- The cached prefix includes rendered instructions, tools, settings and conversation, not just a file's raw text.
- Cache reuse requires the entire rendered prefix to match through an eligible breakpoint.
- The guide currently specifies a **1,024-visible-token minimum for GPT-5.6 and later**; hidden system tokens do not count. Earlier models' minimum varies with settings, and earlier cached-token reporting rounds down to multiples of 128.
- For newer models, implicit breakpoints are placed at the latest eligible message (including user messages); explicit breakpoint support is described for the public API. Older models use model-dependent interval boundaries.
- Identical prefixes still require an available eligible cache entry; routing, availability, retention and backend behavior can matter.

Those statements explain why identical B alone cannot produce a cache hit and why a short pre-B prefix might yield none. We **did not establish the exact eligible-token length or cache-breakpoint policy of ChatGPT's Codex/Luna backend**. It uses `https://chatgpt.com/backend-api`, not the public Responses endpoint documented by that guide. All observed A hits were 8,704 tokens, a multiple of 128; that observation alone does not identify the backend algorithm.

The inspected Pi Codex adapter supplies a stable session-derived `prompt_cache_key`, but no explicit `prompt_cache_options`/breakpoints. We did not add undocumented options, change retention, pad prefixes, switch cache keys, tune traffic, or modify settings to chase cache results. Reported cost remains Pi's model-price calculation, not proof that every public-API pricing/breakpoint detail applies to Codex.

## Could public-API placement preserve semantics?

**Appears technically possible, but not validated here.** Pi's public `context` hook can return a reordered request-only message array. Its Responses conversion supports ordinary user text messages before historical tool-call groups.

A candidate is to place the same authoritative request-time snapshot at a **fixed early user-message position**, after initial system instructions but before growing canonical conversation, rather than at the tail. Keep all current contents, keep stale-read markers, preserve all call/result groups, and leave canonical history unchanged. While B stays identical, that layout could keep a stable prefix through B; a future change to C would necessarily invalidate that prefix.

An alternative is a persistent branch-local anchor at the first stale transition, but it adds more bookkeeping/chronology complexity and is not proposed as part of this correction.

**No trivial formatting/metadata/conversion bug was found.** Tail placement has a real cache consequence, but moving an authoritative snapshot earlier is not a proven no-risk fix: precedence relative to later conversation, signed reasoning, provider pairing, changes-back, multiple files, resume/tree/compaction, and real model answers would need tests. Provider acceptance and cache benefit would also need live validation. This is a proposal only; no placement variant was implemented or sent in these repetitions.

The corrected semantics should not be held hostage to an unvalidated placement optimization. Ship 0.1.2 as a correctness correction if the existing controlled-use scope is acceptable; retain explicit fail-open/composition limitations and no promised savings. Do not combine a placement change or another optimization policy into that release on this evidence alone.

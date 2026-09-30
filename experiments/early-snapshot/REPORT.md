# Bounded early-snapshot placement experiment

## Summary

Early request-only placement preserved a stable provider prefix and obtained
cache reads for B. It failed current-state evaluation at the next change:
**the request contained authoritative C (`V2`), but Luna answered B (`V1`)**.
The matched released-tail arm answered C correctly.

The preregistered stop-on-semantic-failure rule ended the experiment immediately.
No prompt/framing revision, outcome-based retry, further repetition, or placement
merge was attempted. Retain released tail placement.

## Preserved state and scope

- Released baseline: `dbcd8e9ccd09644380ad2197a6b221691e88b5f4`, version 0.1.2.
- Preserved git archive and hashes outside the repository before changes.
- `index.ts` remained SHA-256
  `a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11`.
  Package metadata/lockfile and all tracked released files are unchanged.
- Only untracked experiment source/report and one new test file were added.
- No Pi core change, default/released behavior change, new synchronization policy,
  version bump, commit, push, tag, publication, or V2.
- Raw requests/sessions/events remain outside the repository at
  `/tmp/corvus-early-experiment.qQ0xfm`; they are not npm package files.

## Candidate insertion rule, documented before implementation

See [PLAN.md](PLAN.md). Pi's public `context` hook receives conversation without
initial prompt/tool system messages; Pi restores system/instruction state
afterward. Insert the newly generated synthetic snapshot at the **start of this
conversation-only boundary**, not at an arbitrary position inside history.
In direct helper tests with explicit leading system messages, leave that entire
leading system run first.

The effective provider request is:

```text
stable initial instructions/tools
authoritative current snapshot (when required)
canonical conversation, in its original internal order
```

Never split a tool-call/result group. Leave later instruction updates in their
original chronological positions. For the real Codex requests here, initial
instructions are a separate stable `instructions` body field, and the snapshot
is input item 0.

## Test-only implementation

`extension.ts` is an explicit experimental entry point, excluded from the
package manifest and npm file list. It invokes the released factory through a
public-API proxy and intercepts only its returned `context` result.

It recognizes a newly appended snapshot by the additional message count and
exact released framing, then moves the **same message object** to the boundary.
It does not classify/reorder arbitrary canonical text. Original conversation
order and all call/result objects remain unchanged apart from the released
paired stale markers.

Everything else remains released semantics: direct exact-content equality,
complete-read registration, unchanged historical authority, retirement metadata,
A→B→A non-resurrection, new-read authority, limits and fail-open behavior. No
contents, framing, timestamps, snapshot formatting, or state rules were edited.

Multiple synthetic files remain the released **one combined JSON-array message**,
in deterministic registration-recency order. No new sorting/selection policy was
introduced.

## Offline gate

Before any live request:

```sh
npm run check
npm test
CORVUS_EARLY_CAPTURE=<disposable-root>/offline \
  npx vitest --run test/early-placement.test.ts
npm run bench
```

All **21 released tests plus 7 experimental test groups** passed. Check, benchmark,
and experiment script syntax checks passed.

Experimental groups cover:

1. Unchanged A remains untouched with no duplicate injection; A→B; stable B across
   conversation growth; B→C changes the prefix; A→B→A does not restore old authority.
2. Placement after explicit initial system state; later instructions retained;
   mixed text/signed-reasoning and multiple tool calls remain ordered and paired.
3. Multiple files, one changed file, new file registration, and fresh complete
   reads replacing synthetic authority without duplicates.
4. Deletion/rename, invalid/binary/oversized refresh fail open; canonical copied
   snapshot-looking text is not mistaken for a generated snapshot.
5. Repeated identical observations expose one full authority; partial old text
   cannot supply full changed-file state.
6. Codex/OpenAI Responses and Anthropic conversions preserve content and pairing,
   without synthetic missing-result repair; opaque cross-provider reasoning is
   handled by the existing converter.
7. Actual experimental factory lifecycle: complete-read registration, partial
   rejection, persistent retirement on resume, tree/fork isolation, changes-back,
   and original canonical read preservation.

Captured exact converted inputs:
`offline/offline-stable-B-and-C.json` and `offline/offline-multiple-files.json`.
For B, input through snapshot item 0 was exactly identical on subsequent requests.
C changed that prefix as required. Structural correctness alone did not predict
the live current-state failure.

### Multiple-file implications

Offline B1/B2/B3 remained deterministically ordered and prefix-identical through
the combined message while unchanged. Changing B2 produced B1/C2/B3, without
stale B2 authority. A newly read unchanged file supplied historical authority
without altering existing synthetic entries; making it stale appended its
snapshot deterministically. A fresh B1 read removed B1 from the synthetic message
and supplied one historical B1 copy.

A change/addition/authority switch alters the combined message and invalidates
the complete cached prefix through it. Contents before the first differing byte
can remain identical; later snapshot contents cannot reuse the old *full* prefix
through that difference. Actual shorter-prefix cache eligibility is
backend-dependent. Multi-file live cache/chronology behavior was not tested after
the stop condition.

## Live design and actual bound

Known-working `openai-codex/gpt-6-luna`, minimal thinking, built-in read/edit,
fresh isolated sessions/workspaces, context files/skills/templates/themes and
other extensions disabled. The selected CORVUS arm was the **sole context
transformer**; the observer returned no context changes. Disposable trusted
project settings explicitly set `compaction.enabled=false`; zero compaction
events were observed.

Preregistered maximum:

- Two repetitions rotating baseline/tail/fixed order.
- Initial large A read + 3 unchanged-A no-tool follow-ups.
- External A→B + 4 identical no-tool requests; B→C + 3 identical no-tool requests.
- Four small-file complete-read/edit cycles; two large-file cycles.
- Separate fixed-arm chronology/late-instruction tests per repetition.
- Abort on authority, pairing, current-answer, or chronology failure.

**Actually executed: 62 provider requests in the first repetition.** Baseline and
tail completed their stable and edit workloads. Fixed completed A and all four B
requests, then failed the first C request. The remaining fixed C requests, fixed
small/large edit workloads, dedicated chronology probes, and all second-repetition
arms were **not run**, rather than continuing after a semantic failure.

Every completed corrected request had one exact current representation, no stale
read body, valid unique paired outputs and no synthetic missing-result repair.
Original canonical tool-result contents were preserved; no snapshot was persisted
as a canonical user message. No extra model reads occurred on no-tool follow-ups.

The observer captures full logical provider bodies before transmission, not auth
headers or compressed/socket-framed bytes. Fresh print-mode processes on resume
prevent socket-scoped previous-response deltas on follow-ups. The full current C
item was present in the failing request. All non-input body fields remained
identical within each session.

## Measurements

USD values are Pi-reported usage/model costs, not independently verified billing.
Input total = uncached + cache-read. Byte sizes sum across provider requests,
not peak context. Synthetic fixtures: 700 bytes small, 38,000 bytes large.

### Workload A: unchanged historical authority

Includes initial read (two requests) plus three follow-ups (five total).

| Arm | Total input | Cache-read | Uncached | Output | Cost USD | Context bytes | Input bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 39,274 | 17,408 | 21,866 | 54 | 0.00238768 | 163,237 | 157,940 |
| Tail | 39,269 | 26,112 | 13,157 | 54 | 0.00160382 | 163,256 | 157,937 |
| Fixed | 39,275 | 26,112 | 13,163 | 56 | 0.00160542 | 163,276 | 157,964 |

Tail and fixed each had **3/3 unchanged-A follow-up hits of 8,704 tokens**;
baseline had `[0,8704,8704]`. No synthetic snapshots/markers were used in this
control. The experimental wrapper did not regress unchanged authority here;
the baseline miss also illustrates nondeterminism outside snapshot placement.
This aborted first repetition is not a reliable general performance comparison.

### Workload B: external A→B, four stable-B requests

| Arm | Total input | Cache-read | Uncached | Output | Cost USD | Context bytes | Input bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| Baseline | 38,904 | 26,112 | 12,792 | 24 | 0.00155232 | 176,893 | 164,206 |
| Tail | 39,316 | 0 | 39,316 | 24 | 0.00394360 | 180,380 | 167,694 |
| Fixed | 39,324 | 28,160 | 11,164 | 24 | 0.00141000 | 180,522 | 167,738 |

Baseline retained historical A and answered **V0**, not current B; its lower cost
is not a correctness-equivalent synchronized comparison.

Tail answered V1 with cache-read `[0,0,0,0]`. Fixed answered V1 with
cache-read **`[0,8704,9728,9728]`** and uncached
`[9774,1108,122,160]`. Thus fixed obtained hits on **3/3 subsequent stable-B turns**
and substantially reduced uncached input in this trajectory. Total input was
almost unchanged. These encouraging cache observations do not override the
subsequent semantic failure.

### Workload E: transition B→C

| Arm / subset | Requests | Total input | Cache-read | Uncached | Output | Cost USD | Context bytes | Input bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline, all C turns | 3 | 29,601 | 28,160 | 1,441 | 36 | 0.00044370 | 142,243 | 127,749 |
| Tail, all C turns | 3 | 29,892 | 0 | 29,892 | 18 | 0.00299820 | 144,363 | 130,269 |
| Fixed, first C only | 1 | 9,927 | 0 | 9,927 | 6 | 0.00099570 | 47,356 | 43,003 |

Baseline said it could not verify current state without tools. Tail answered V2
on all three turns. Fixed answered **V1** on its first C turn and was stopped.
For the directly matched first C turn, tail input was 9,925 uncached, output 6,
cost $0.00099550; it answered V2. Fixed had no stale cache read on the failure.

### Workloads C/D: edits completed before the stop

| Workload / arm | Requests | Total input | Cache-read | Uncached | Output | Cost USD | Context bytes | Input bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Small, baseline | 9 | 14,458 | 3,072 | 11,386 | 250 | 0.00129432 | 68,095 | 31,259 |
| Small, tail | 9 | 13,785 | 0 | 13,785 | 306 | 0.00153150 | 65,021 | 27,719 |
| Large, baseline | 5 | 56,806 | 35,328 | 21,478 | 156 | 0.00257908 | 245,980 | 235,939 |
| Large, tail | 5 | 40,031 | 0 | 40,031 | 156 | 0.00408110 | 171,157 | 161,197 |

All expected reads/edits occurred (4/4 small, 2/2 large), with correct final
versions. **Fixed-placement edit measurements are unavailable**, because the
earlier current-state failure stopped that arm. Do not infer an edit-workload
benefit or extrapolate the motivating +58.2% single-run result.

## Exact provider prefix analysis

B contents were identical across tail/fixed:
SHA-256 `1fdaf056a2099787dde952fa8e5cd43545004530945242581ec9feddb4cee8e5`.
Paths differ between arms, so complete item hashes are compared within sessions.

| B request | Tail snapshot index | Tail preceding bytes¹ | Fixed index | Fixed preceding bytes¹ | Fixed first difference vs prior request |
|---|---:|---:|---:|---:|---|
| 1 | 11 | 2,154 | 0 | 2 | `$.input.0.content.0.text` (new B snapshot) |
| 2 | 13 | 2,579 | 0 | 2 | `$.input.12` (appended conversation) |
| 3 | 15 | 3,004 | 0 | 2 | `$.input.14` (appended conversation) |
| 4 | 17 | 3,429 | 0 | 2 | `$.input.16` (appended conversation) |

¹ Serialized preceding input array, including delimiters; not rendered token
counts. Fixed `2` means `[]`: instructions/tool definitions are outside input
and stayed identical.

Fixed B complete item hash:
`a8a6152f870e7cfadc0e3ba709939a07d563bdc37d67fa27103a20aff91092fd`.
Fixed prefix-through-B hash:
`05f2d840e3161e868935c224d84f9d26acf02384cfe1210884bd6f87000b44f7`.
Both were exactly identical for all four B requests.

Tail B item hash was also constant:
`de6e432fb7b6c526b8200898f01e0105f50c1c3a000cd3f4fb2b71461947b8a0`,
but its prefix hash changed each turn. Differences occurred at the stale read
output (item 2), then displaced prior snapshot positions (items 11,13,15).
Tail prevented reuse of a prefix containing B; this does **not** establish that
it “blows the entire cache.”

On fixed C, the first difference was
`$.input.0.content.0.text`, logical serialized body byte **2,865**. C item hash:
`7003f03b9c19c0a356753b9cb3e29a061a46c44e44e22173e20cc0922210bc31`.
C content/current-file hash:
`35b6580fcb331aab3bcac85f5ff7323cac768ccd0ed33cb8e04aa18779919ae7`.
The new prefix changed as required; provider accounting reported **zero cached
tokens**. Authority audit: one exact C copy, zero stale read bodies, valid pairs.

## Chronology/current-state failure

The failing prompt was identical to the tail control:

> The file was externally updated again before this series. Without tools,
> report its current version from authoritative synchronized contents.
> Reply only its value.

The early snapshot explicitly said **“request-time; authoritative for these
paths”** and contained `export const version = "V2";`. Later canonical
conversation contained the earlier V1 answers from stable B. Luna returned V1.
The actual provider-bound representation was current and cache invalidation
occurred; this was not omitted C, an unrefreshed file, an authority-count bug,
or an observed stale-cache reuse.

This is a material current-state/chronology failure under the specified success
criteria. Earlier placement may have allowed later historical answers to dominate
current workspace state, but Luna's internal causal reasoning is unobservable.
One observed failure is enough for the preregistered stop; it is not a statistical
claim that early placement always fails.

The dedicated probes about actual edits, historical A versus B, later
instructions, and changes-back were not reached. Their absence is explicitly
recorded, not treated as a pass. Offline preservation of those structures is
not evidence that Luna will interpret them reliably.

## Uncertainties and recommendation

- Stable-B cache gains were observed in one matched repetition only; the second
  was aborted, so performance reliability/generalization is unknown.
- Fixed repeated-edit, later stable-C, dedicated chronology, and live multiple-file
  measurements are missing because the semantic stop criterion took precedence.
- Exact Codex/Luna hidden rendering, cache boundaries/eligibility, routing and
  retention remain partly unobservable. No undocumented provider option was used.
- Model behavior caused the failed answer despite correct data exposure. A
  different framing/instruction scheme might change behavior, but that would be
  another experiment and was not attempted here.
- Retain released tail placement. Do not merge this cache-positive but
  current-state-unreliable variant, weaken full-current authority, or continue
  optimizing after this result.

All experimental files remain test-only and uncommitted. Released 0.1.2 remains
unchanged.

NO-GO — retain tail placement

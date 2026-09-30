# Bounded persistence-semantics investigation and proposed contract

This supplements, rather than replaces, `V1-PERSISTENCE-SAFETY.md`. The
candidate remains unreleased and its failing convergence test is not fixed.
No production/candidate code, V2a, version or Pi implementation was changed.

## Sources and execution evidence

Read the candidate diff, released V1, `test/extension.test.ts`,
`V1-CORRECTION.md`, `V1-CACHE.md`, freeze record and failure report. Pi 0.99.1
reference paths inspected:

- `packages/coding-agent/src/core/session-manager.ts`: `_appendEntry`,
  `_persist`, `_loadEntries`, `_buildIndex`, `appendMessage`,
  `appendCustomEntry`, `getBranch`, and `loadEntriesFromFile`.
- `src/core/agent-session.ts`: extension runtime `appendEntry` delegates to
  `sessionManager.appendCustomEntry`; notification occurs only after return.
- `src/core/extensions/loader.ts`: forwards `pi.appendEntry` to runtime.
- `src/core/extensions/runner.ts`: `emitContext` catches handler errors,
  reports them, and retains the prior context.

Additionally ran `/tmp/corvus-parent-evidence.mjs` against installed Pi 0.99.1
SessionManager, using isolated on-disk managers and deterministic
instance-level `_persist` failures. It compares ordinary message appends
with custom appends. This is a storage experiment, not an AgentSession
integration claim. The earlier real provider-exposure evidence remains in
the frozen integration report.

## 1. Exact state machine

Let O be the registered complete observation A; P is its raw tool-result
entry. CORVUS metadata before P has registered O with its digest. Let Q be
the retirement custom entry and R a retry. Registration itself succeeded.

| Phase | Filesystem | CORVUS memory | Pi manager memory | JSONL | Model input |
|---|---|---|---|---|---|
| Before change | A | O eligible | registered call/result | same | complete A |
| Normal refresh | B | O retired | Q child of P, leaf Q | Q present | paired A marker + exact B tail |
| Released failure | B | O already retired | Q retained, leaf Q | Q absent | original complete A; B absent |
| Candidate failure | B | O retired; Q operation pending | Q retained, leaf Q | Q absent | paired A marker + exact B tail |
| Candidate retry succeeds | B | pending cleared | R child of Q, leaf R | R present; Q absent | refresh remains safe in live process |
| Fresh load of failed Q, before R | B | replay does not retire O | disk prefix ending P | original registration/P | refresh rediscovers B |
| Fresh load after R | B | replay of active branch lacks registration | active branch R only | P and R parse | no tracked O on active branch |

Released V1 `update` first applies the operation to CORVUS state and then
calls `pi.appendEntry`. Pi allocates Q using the current leaf as parent,
pushes Q into `fileEntries`, adds it to `byId`, advances `leafId`, and calls
`_persist`. The injected failure occurs here, not before mutation.
There is no rollback at either layer. Released V1's outer context catch
returns `event.messages`; this is the unsafe authority fallback. The
candidate catches the retirement append separately, continues transformation
and retries the **operation**, not the original entry ID.

The candidate's local mutation is enough for current content/non-resurrection
while that closure is coherent. It is not sufficient for disk consistency.
Its restore currently clears pending retirements and rebuilds solely from
branch metadata: this also loses failed local knowledge on a tree restore.

## 2. Absent-parent graph: exact meaning

Fresh minimal custom-entry experiment:

```text
MEMORY: P 0030d205 -> Q 6cc2dbde -> R 80829402
DISK:   P 0030d205
        R 80829402 parentId=6cc2dbde   (Q absent)
RELOAD getEntries: [P, R]
RELOAD getBranch:  [R]
```

Q was the failed `corvus-v1` stale entry. R is a newly allocated custom
entry carrying the same stale operation. R **does reach disk**. Reload parses
both P and R and indexes them; it neither drops nor reattaches R. `_buildIndex`
chooses the last parsed entry as leaf. `getBranch` follows R's parent lookup,
finds no Q, and stops. P is still in the raw entries but is absent from the
active branch. Consequently registration and original history can vanish
from active context. This truncates connectivity, not the timestamp/physical
order of JSONL. A raw file search for Q's ID can find R's parent reference;
that does not mean Q exists.

In the larger regression P has registered ancestry; the same missing link
explains why `rebuild(getBranch()).files[0]` is absent after retry. It is not
evidence that parsing discarded the retry.

Ordinary-entry control:

```text
MEMORY: P e049f39e -> Q 74ac5b97 -> R 9fc18cd6
DISK:   P e049f39e; R 9fc18cd6 parentId=74ac5b97
RELOAD entries [P,R]; active branch [R]
```

Thus this is possible for ordinary Pi message writes, not CORVUS-specific.
CORVUS's automatic swallowed-error retry makes it more likely to extend the
broken chain without user intervention. The manager must be considered
**durability-degraded/unsafe for further CORVUS appends** after any append
exception: extension API does not reveal whether mutation occurred, partial
bytes were written, or the error preceded mutation.

Stopping CORVUS writes prevents its own R. It does **not** prevent ordinary
Pi assistant/user/error writes from creating other descendants of Q.
A claim of globally intact Pi JSONL after continued turns would therefore be
false. This limitation must be surfaced, not hidden by calling it recovery.

## 3. Unrecoverable information proof

Consider two worlds at reload:

- X: successful registration/read A; file continuously A.
- Y: same registration/read A; file B; retirement never persisted; process
  state lost; file returned to A.

By assumption, both have identical persisted session bytes, identical
current file bytes and identical released metadata. Every deterministic
algorithm using those inputs returns the same answer in both worlds.
Randomization cannot reliably recover the missing event either.

Therefore a lost stale transition is not reconstructible. Retry cannot
repair evidence no longer available. A *successful* retirement/checkpoint,
write-ahead record, or other durable representation distinguishing Y from X
is required. Merely attempting independent storage is insufficient if its
write also fails. An unconditional “survives all failed writes and process
loss” guarantee cannot be obtained by adding another fallible store.

No separate evidence of “durability lost” can be inferred after restart if
that indication also failed persistence. If an indication does persist,
reload can conservatively refuse historical authority and require fresh
reads. This is a possible stronger design, not implemented here.

## 4. Pi versus CORVUS guarantees

Pi `_persist` returns immediately for in-memory sessions; initial flushing
uses exclusive open and writes all entries; later flushing uses synchronous
append. The inspected path contains no fsync, transaction, rollback or
repair of missing parents. A thrown append fails the calling operation.
The manager object remains usable and can subsequently append; the native
AgentSession experiment even persisted an error assistant beneath a failed
anchor. “Pi always treats failure as fatal and makes later writes impossible”
is not supported by source or evidence.

Partial writes, system crash, buffered filesystem durability and orphan
ancestry are ordinary Pi limits. CORVUS need not solve these generally.
But deciding current B then returning original A because bookkeeping failed
is a **CORVUS request correctness bug**, not an acceptable Pi durability
limitation. The two must be documented separately.

## 5. Evaluated four levels

1. **Current request — MUST.** For successfully refreshed, eligible paths
   within released limits/ambiguity rules, known-different A must be marked
   and exact B supplied once. Candidate passes the single-path failing-write
   assertion; multi-path, pre-mutation failure and real native post-fix
   confirmation remain implementation acceptance tests. Unexpected errors
   after a known stale determination must not trigger raw-context fallback.
2. **Same coherent process/branch — MUST.** Retire O locally immediately,
   keep that knowledge independently of failed persistence. B→A supplies a
   new snapshot, not old authority. Branch/tree replay must not erase failed
   local retirement on revisiting the same branch. A poisoned disk manager
   is not trustworthy for further durable appends, but its observed file
   content and branch-local retirement knowledge can still support safe
   ephemeral requests. Do not assert general session integrity.
3. **Successful persistence/restart — MUST within Pi's storage model.**
   Released normal retirement/reload tests support this. Meaning: record is
   in a valid connected on-disk branch and survives reload. A successful R
   call below absent Q is not equivalent to this condition; nor is return
   from append an fsync guarantee. Normal 0.1.2 semantics stay unchanged.
4. **Failed persistence plus process loss — not guaranteed.** Impossible
   from the stipulated observations. This is an explicit contract boundary,
   not an algorithm fix. No release may silently retain the unconditional
   wording “permanently” across this boundary.

## 6. Strongest argument for Level 4

Non-resurrection was a conservative temporal-authority rule, not just a
byte-saving optimization. A historically early A can precede discussion,
edits, inferred decisions or tool calls that depended on later B. Returning
exact A does not make that earlier observation chronologically new.
An agent may wrongly infer nothing changed. The published
`V1-CORRECTION.md` explicitly promises retirement across resume/tree/fork,
even when B was never model-read. Relaxing this silently would contradict
that behavior. A durable degradation flag/fresh-read policy would preserve
conservative chronology when the flag is available.

## 7. Strongest argument against Level 4

Byte-identical A is not stale with respect to *current file content*;
historical attribution is the remaining risk. CORVUS does not claim a
complete audit of every filesystem transition and cannot observe changes
between requests anyway. No durable record means no restart knowledge.
Pi itself can lose ordinary entries; requiring CORVUS to reconstruct failed
writes demands an unavailable guarantee, and a second storage write cannot
make arbitrary storage failure infallible. Normal successfully persisted
retirement must remain strict, but temporal history lost during an explicitly
reported storage failure is reasonably outside Pi's ordinary contract.

## 8. Recommended contract (requires explicit acceptance before release)

Adopt Levels 1–3, with Level 2 scoped to coherent process/branch knowledge;
exclude unconditional Level 4. Surface each first failure prominently and
state that continuing the contaminated session can lose durable history.
Do not promise automatic persistence convergence on the same manager.
Recovery requires an explicit verified connected-session boundary; creating
a new session and establishing fresh reads is the smallest safe supported
fallback if reconciliation is unavailable.

This is a **proposed explicit durability qualification**, not approval to
weaken 0.1.2 wording. If uninterrupted same-file convergence or Level 4 is
mandatory, this small design does not meet that stronger requirement.

## 9. Smallest proposed implementation

- Separate deterministic refresh/transformation from optional retirement
  persistence. Collect retirement operations while constructing safe output.
  Apply local retirement; return safe output regardless of append failure.
  Never throw bookkeeping failures into a catch that returns raw known-stale
  history. Preserve all pairing/path/exact-content rules and existing
  refresh-failure limits.
- On first append exception, latch degraded state for this session-manager
  identity and notify visibly. **Remove automatic same-manager retries.**
  No further CORVUS durable writes of any kind (read/drop/clear/on/off/stale)
  while degraded. Multiple paths still refresh and retire locally.
- Keep branch-scoped local failed retirements, including across branch
  revisits; do not smear sibling state. Fresh reads can supply current
  authority locally, without claiming persisted registration. Bound this
  state under existing observation/path policies, not a new LRU.
- Other transform errors retain normal fail-open only where no unsafe known
  stale authority would be exposed. If construction itself cannot provide
  safe output for a known change, abort/deny that request by a supported
  lifecycle hook rather than relying on a throwing `context` callback
  (runner catches throws). The eventual implementation must prove this path;
  bookkeeping catches alone should not become a blanket guarantee.

## 10. Parent-chain recovery

Do not reach into Pi private indexes, change leaf behind AgentSession's back,
rewrite JSONL, or retry Q using a new ID under its missing ID.

Public `pi.appendEntry` returns void and gives no transaction/rollback seam;
the extension context exposes read-only manager state. No supported automatic
rollback was established. A same-manager retry is rejected by design.

After storage is available:

1. keep degraded state until explicit operator recovery; mere availability
   does not prove a connected graph;
2. preserve the original file as evidence; inspect a fresh manager/raw entry
   graph for missing ancestors (reload alone does not repair them);
3. if the graph is connected and local knowledge can be carried through a
   coordinated replacement, replay pending retirement only under a verified
   durable leaf before resuming durable CORVUS writes;
4. otherwise use a **new session**, with fresh reads establishing authority;
   do not pretend orphaned conversation is repaired or discard it silently.

The minimal release need not automate step 3. An explicit new-session/
fresh-read recovery policy is sufficient for the recommended contract.
An extension-only global ban on ordinary Pi writes cannot be claimed.
Automatic lossless repair of the contaminated manager is a separate, larger
Pi storage/reconciliation task.

## 11. Eventual acceptance matrix

All authority checks inspect actual provider conversion/paired context,
count exactly one complete current representation, and retain raw history.

| Case | Required result |
|---|---|
| Normal A→B | MUST: unchanged released behavior; connected durable retirement |
| Failure before manager mutation | MUST: A marker/B once; degraded surfaced |
| Failure after memory mutation | MUST: same safe request; live-only Q observed |
| Next same-process B request | MUST: B once; no further CORVUS append attempted |
| Persistence becomes available | MUST: no blind retry; explicit recovery required |
| Fresh reload while disk B | MUST on connected prefix: rediscover B safely |
| A→B→A same coherent process | MUST: no historical A resurrection; new A tail |
| A→B→A after persisted retirement/reload | MUST: non-resurrection unchanged |
| A→B→A after lost record/process loss | Document impossible Level 4, not pass strict invariant |
| Missing-parent Q then later R | MUST: CORVUS never writes its R in degraded manager |
| Ordinary Pi descendant after Q | Document Pi limit; detect disconnected recovery graph, don't claim repair |
| Multiple paths, one write failure | MUST: both exact current authorities; local retirement on both |
| Reload/raw graph | MUST: classify entries versus active branch; no silent reparenting |
| Branch/fork/revisit after failure | MUST: scoped local stale state; prohibit durable writes in contaminated manager |
| New-session recovery | MUST: preserve old file; fresh reads; normal writes on clean manager |
| Ordinary append control | Same mutation-before-persist graph; no CORVUS stronger-storage claim |
| Native AgentSession regression | MUST: same Gate 8 provider request safe; stop before V2a until release |

The existing failing automatic-convergence assertion should be replaced
only after the explicit contract is accepted, with a no-retry/quarantine and
clean recovery assertion—not simply deleted or changed to ignore divergence.

## 12. Classification and frozen V2a impact

**A: small 0.1.3 correction under the recommended explicit contract.**
Request safety and quarantine of *CORVUS* writes require no new durable store.
It is not a lossless same-manager recovery release. If Level 4 or automatic
global graph repair is required, classify as larger storage redesign/Pi-core
dependency respectively; this design does not claim either.

V2a remains frozen, unreconciled and unreleased. Its promotions must not
continue committing into a degraded manager: the later reconciliation must
account for the V1 degraded state and boundary writes explicitly. No V2a
semantics are changed here; that compatibility is not yet established.
Compaction remains unsolved and untested.

DESIGN READY — small 0.1.3 V1 fix can satisfy the recommended durability contract

# Frozen primary temporal-reminder experiment

Baseline: released dbcd8e9ccd09644380ad2197a6b221691e88b5f4, 0.1.2.
Previous early-only disposition remains NO-GO — retain tail placement.
This is one new intervention, not tuning that experiment.

## Freeze before implementation and live requests

Exact text (single text block, no interpolations):

> [CORVUS temporal-authority reminder] The CORVUS workspace snapshot earlier in this request was refreshed for this request and represents current filesystem state for synchronized paths. Canonical conversation positioned after that snapshot may describe older states; historical discussion does not supersede the current snapshot.

Role: synthetic `user` message, request-only; not a system override or canonical
user instruction. Use timestamp 0 (excluded by provider conversion).

Insertion: only when released CORVUS produces a new synthetic snapshot, move that
same snapshot using the frozen previous early boundary (after leading system
run, before canonical conversation). Insert exactly one reminder immediately
before the last canonical user message (the current user turn). Preserve every
canonical message's internal order and every call/result group. On tool
continuations, the reminder stays before that same latest user turn; subsequent
assistant/tool items remain after it. If no canonical user exists, leave the
released tail result unchanged rather than invent a current user turn. No
reminder is needed when historical authority alone suffices or refresh fails
without a snapshot. Never persist either synthetic message.

No alternative wording/role/position will be tested, even following failure.

## Offline gate

Reuse released synchronization and previous early-placement machinery without
editing either. Cover unchanged A, A→B/stable B, B→C/stable C, A→B→A retirement,
multiple files/change/addition/fresh read, mixed reasoning/text/calls, pairing,
resume/fork, deletion/rename/failure and canonical persistence. Capture exact
Codex, OpenAI Responses and Anthropic inputs and stable B/C complete prefixes.
Run released check/tests and new focused tests before live requests.

## One bounded live trajectory per matched arm

Released tail control first, then early+reminder; no baseline required.
Exact previous Luna configuration: openai-codex/gpt-6-luna, minimal thinking,
same 38,000-byte fixture and primary prompts, built-in read/edit, fresh isolated
workspaces/sessions, sole transformer, read-only observer, disabled compaction,
no unrelated extensions/skills/context files/templates/themes.

Read A (V0), 3 unchanged-A turns, external B (V1), 4 stable-B turns, first
external C (V2) current-state request. Require exact sole C, no stale B body,
paired results, no tools, correct V2, request-only reminder and unchanged raw
history. On first stale answer STOP all live work immediately; no retry/tuning.
Any other semantic or structural failure also stops.

Only if gate passes: 2 more identical C turns, external D (V3), 3 D turns,
then four chronology probes in the same session: old vs current, B→C
comparison, explicit old answers plus unrelated new instruction, and old-only
question. Frozen probe prompts will be in run.mjs before execution.
Maximum 20 user invocations / 21 provider requests per arm (42 overall).
Capture failures before throwing; never overwrite an already started root.

Record usage/cost/bytes, indices/hashes/differences, canonical audit and exact
logical provider payloads. Byte/token/cost observations are not invoice claims
or provider-independent conclusions. No default changes, new policies, Pi core
changes, version bumps, commits, pushes, tags, publishing or V2.

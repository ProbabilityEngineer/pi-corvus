# Test-only early snapshot placement

Before implementation: release baseline is `dbcd8e9ccd09644380ad2197a6b221691e88b5f4`,
version 0.1.2. A git archive and hashes are preserved in the disposable experiment
root; production `index.ts` and package metadata must remain unchanged.

## Insertion rule

The public `context` hook receives conversation without prompt/tool system
messages; Pi restores those after context transformation. Move only the synthetic
message newly appended by released CORVUS to the beginning of that conversation.
For direct helper tests with explicit leading system messages, keep the complete
leading system run first. Do not insert inside a tool-call/result group.

This is a transcript boundary, not an arbitrary fixed numeric index: it is after
initial required instructions and before the entire internally ordered canonical
conversation. Leave later system/instruction updates in their chronological
positions. Provider conversion and instruction-precedence tests must confirm
that this is valid.

Use the exact released message object/content/framing, moving it without editing
timestamps, paths, JSON, or text. Keep the released combined snapshot array's
deterministic registration-recency order. Multiple files remain one combined
synthetic message; a change/addition/authority switch can invalidate its prefix
at the first changed content, including cacheability of later files.

The wrapper invokes released CORVUS handlers with the real public API, including
branch-local retirement persistence. It intercepts only the returned context
array. No second context-transforming extension is needed.

## Preregistered live bound

Only after offline validation, run **two repetitions** of three matched arms:
baseline, released tail, test-only early. Rotate arm order between repetitions.
Use Luna/minimal thinking, complete built-in reads/edits, isolated fresh sessions,
no context files/extensions except the selected CORVUS and read-only observer.
Explicitly disable compaction in disposable project settings.

- Large A initial read + three unchanged no-tool follow-ups (control).
- External A→B + four identical no-tool requests; external B→C + three
  identical no-tool requests (primary stable-B and stable-C tests).
- Small file, four required complete-read/edit cycles.
- Large file, two required complete-read/edit cycles.
- One separate fixed-arm chronology scenario per repetition: genuine A→B edit,
  distinguish historical A/current B and later instructions, then change back
  to A without a new read. This is evaluation, not tuning.

Capture full logical provider bodies, input/context bytes, usage and costs,
snapshot indexes/hash/prefix differences, exact authority counts, call/output
pairing, tool behavior, and canonical session preservation. Baseline external
follow-ups have no synchronization guarantee and may report A; count/label these
as controls, not CORVUS semantic failures.

No adaptive extension until a desired hit. Abort live testing for structural or
authority failure. Cache success cannot override chronology/semantic failure.
No commit, version bump, publishing, default placement change, or new policy.

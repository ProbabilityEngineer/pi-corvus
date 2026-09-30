# V1 persistence-safety correction — unreleased candidate

Design follow-up: [V1-PERSISTENCE-DESIGN.md](V1-PERSISTENCE-DESIGN.md)
separates request safety, absent-parent connectivity and unrecoverable
transition knowledge. It proposes an explicit contract and quarantine design;
it does not fix or supersede the failed candidate evidence below.

## Freeze

See `V2A-FREEZE.md`. V2a implementation, tests and research reports remain
unchanged during this work. Exact copies also exist outside the working tree.
Package version is still 0.1.2. No release commit/tag/push was made.

## Permanent blocker regression

Added to the normal released suite in `test/extension.test.ts`.
The test drives the actual released factory's `tool_result` registration and
`context` handler with a persistent SessionManager. It injects an
instance-level `_persist` throw only for `corvus-v1` stale operations, after
SessionManager has mutated memory. This is the same seam used in the native
AgentSession experiment, not an artificial transform exception.

Before modification, the regression failed on the authority assertion: the
returned model-context messages still contained complete HISTORICAL_READ
and no CURRENT_B. This reproduces the established native-provider exposure.

## Candidate correction

`index.ts` now separates local retirement from persistence:

1. deterministically refresh disk and detect stale read;
2. retain local stale state even if append fails;
3. catch only retirement-append failures and visibly warn;
4. continue building the paired stale marker and exact current snapshot;
5. retain failed retirement operations for retry on the next request.

Other update operations and exact-content/path rules are unchanged. Pending
operations are session-local and cleared on session/branch restore.

The first safety assertions pass after this modification: stale A is absent
as full authority, the compact marker exists, and current B is present.
Live SessionManager retains the failed stale entry; disk/reload does not.
Fresh reload while disk is B can independently rediscover the change and
construct safe context.

## Stop condition: durability/recovery is not clean

The release regression still fails at convergence after restoring
persistence and retrying. The persisted retry descends from the failed
in-memory-only entry. Reload does not reconstruct the expected CORVUS
registration/retirement branch (`files[0]` is absent). This is Pi's ordinary
mutation-before-persist/orphan-parent window, but a blind retry does not solve
it. A safe request alone is not evidence of clean disk/branch recovery.

A second test documents the independent non-resurrection limit: if B was
observed while retirement persistence failed, then disk returns to A before
a fresh reload, the disk session contains no evidence of that transition.
The resumed extension treats the historical A as unchanged authority.
Current bytes are correct but historical non-resurrection is not preserved.
This observation is explicitly not an accepted weakening of the rule.
Some durable evidence or a separately approved conservative recovery policy
is needed to distinguish this history. It cannot be inferred from identical
disk/session bytes after restart.

No database-style durability is claimed. Pi mutation-before-persist behavior
is general, but the required convergence/non-resurrection guarantees have
not been established by this candidate.

## Validation and disposition

Before fix: focused extension suite 7 passed, new authority regression failed.
After candidate: authority assertions pass, convergence/reload assertion
fails. This is a deliberate failing release gate, not a green release.
Full release validation, bump, README release note, smoke, commit, push,
tag and npm verification were not performed because the gate failed.
V2a was not rerun or reconciled. Compaction remains unsolved and untested.

NO-GO — V1 persistence-safety correction is insufficient; do not resume V2a.

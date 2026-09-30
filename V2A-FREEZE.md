# V2a freeze before V1 persistence correction

HEAD: `bfa54c404b9f2b3acdad2712d6dba0cc39b0d033`.
Recoverable exact copies, metadata and native integration test:
`/tmp/pi-corvus-v2a-freeze-20260930/`.

Working tree: modified V2a extension, focused test and REPORT; untracked
AGENTSESSION-INTEGRATION report. These pre-existing changes are not V1 fixes.

SHA-256:

| File | Hash |
|---|---|
| index.ts | a984066e57d5e43ac57382dbf77b44e9effaca49db9cc0e9ef9969f9f114cf11 |
| V2a extension | 0d3ab959b954b16a29e2a5f7243bd1be64e171f01c2eb7ed2a2cae31dd5843c6 |
| focused test | 27a9bf8fadda25831ef022427091d6470786345b5524545e63b2f7fa9cd7e1bd |
| REPORT | bf568c05a992215f513bc1cf9d6a49cc7985b392105205a84d68c9f940583909 |
| AGENTSESSION-INTEGRATION | f334ffcd4425bb10005a09596173ffb7ff0210e0a29c71785a7c1c6d3884b898 |
| ADVERSARIAL-REVIEW | 91760ae82f5afb5b51210d25245df8e26da83cbeb4a1a9694405914fc5b7f65d |

Installed Pi peers: agent-core/coding-agent 0.99.1. TypeScript 5.9.3,
Vitest 4.1.9, Node types 25.9.1. Package version remains 0.1.2.

Native evidence: A→B, following B, B→C, following C, multi-path,
throwing-draft preview rejection and faux-aborted outcome passed.
Anchor append failure shows live-only state; full reload request unverified.
V1 stale append failure exposes stale authority (NO-GO). Gate 9 stopped.
Compaction untested/unsolved. V2a is frozen until V1 release is verified.

# pi-corvus agent guidance

Standalone Pi extension package. This repository is **not** the Pi monorepo. `index.ts` is the extension, `test/` holds focused tests, and `scripts/bench.ts` is a synthetic byte benchmark. Do not vendor Pi source or configure `earendil-works/pi` as this repository's remote.

## Working method

- Read Pi's installed `docs/extensions.md` and `docs/packages.md` when changing the extension or its package layout. Use the public `@earendil-works/pi-coding-agent` extension API.
- Use LSP for known symbols/types, AST-grep for code shape, and ripgrep for exact strings and verification. Avoid scanning dependency/build directories.
- Install with `npm ci --ignore-scripts`; run `npm run check` and `npm test` after code changes. Run `npm run bench` for a synthetic serialized-byte comparison, not a provider-token benchmark. Runtime Pi packages are peers, not bundled.
- Preserve tool-call/result pairing and raw sessions. Only suppress historical content when its current replacement is included in the request. Partial/truncated/image reads fail open. V1 does not reduce native compaction input.

## Git and local state

- Git uses local `main` by default. Do not add a remote without the user's URL. Inspect status/diff before and after changes. Do not commit without explicit user request; stage only explicit paths. Never force-push or discard other agents' changes.
- Use `clu ready` and `clu claim --context` at the start of substantial tracked work; leave incomplete follow-ups in `clu`. Use Turnlog for decisions, experiments, and handoff.
- Track `.clu/config.yaml` and `.clu/templates/`; ignore mutable `.clu/data.sqlite`, WAL/SHM and backups. Ignore `.pi/` and `.turnlog/`. Do not delete local agent state without asking.

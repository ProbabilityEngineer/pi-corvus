# pi-corvus

Experimental Pi package that synchronizes bounded, complete local text `read` observations with the current workspace.

Install locally with `pi install ./` from this directory, or load for one run with `pi -e ./index.ts`. Controls: `/corvus status`, `/corvus clear`, `/corvus drop <path>`, `/corvus on`, `/corvus off`.

Successful unpaged, untruncated local UTF-8 reads of at most 64 KiB are registered. Each request refreshes up to 12 active files (256 KiB combined, most recently read first), replaces paired historical read-result bodies with markers, and injects a single current workspace message. Pi's persisted session retains the original read bodies; registry changes are branch-local custom entries. Failed refreshes, missing files, images, oversized files, and partial reads fail open. This does not reduce canonical/native compaction input. Other context-transforming extensions can alter the request after CORVUS.

Run `npm test` for focused extension tests; `npm run check` for types; `npm run bench` for a synthetic serialized-byte comparison (not a provider token benchmark).

# pi-corvus npm / pi.dev release readiness

**Status: prepared locally; not published.**

## Package proposal

- Name: `pi-corvus`. The npm registry currently returns `E404` for `pi-corvus` and `pi-corvus@0.1.0`, indicating no published package was found at check time. Recheck immediately before publishing; npm `whoami` is unauthenticated (`E401`), so definitive reservation status/publish permission is not established.
- Initial version: `0.1.0`, reflecting an experimental controlled-use V1.
- Repository: `https://github.com/ProbabilityEngineer/pi-corvus`.
- License: MIT.
- Published files: `index.ts`, `README.md`, `V1-ACCEPTANCE.md`, `LICENSE`.
- Runtime dependencies: none. Pi-supplied `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent` are peer dependencies (`*`); Node `>=22.19.0`.
- Pi manifest: `pi.extensions: ["./index.ts"]`.

Install / try / remove:

```sh
pi install npm:pi-corvus
pi -e npm:pi-corvus
pi remove npm:pi-corvus
```

## pi.dev discovery

The installed Pi package documentation (`docs/packages.md`) says npm packages need the `pi-package` keyword for package-gallery eligibility. `pi.dev/packages` pages and package examples state that public npm publishing is the discovery mechanism and no separate submission is required. After publish, verify gallery indexing at `https://pi.dev/packages/pi-corvus`; indexing/refresh timing is external to this package.

## Checks performed

- Accepted source baseline preserved in Git commit `2cfa16e48` and local tag `corvus-v1-accepted-baseline`.
- `npm run check` passes; `npm test` passes (15 tests).
- `npm pack --dry-run --json` reports exactly 5 files: `package.json` (npm-included), `index.ts`, `README.md`, `V1-ACCEPTANCE.md`, and `LICENSE`. The actual tarball is 9.1 kB packed / 22.5 kB unpacked. It contains no tests, fixtures, benchmark, credentials, session logs, or local path references.
- Installed the packed tarball with `npm install <tarball>` in a disposable directory, then installed the extracted package into a clean Pi agent directory using `pi install <local-package-path>`. `pi list` discovered it. A real `gpt-6-luna` Pi run loaded the packed extension, used built-in `read`, persisted a `corvus-v1` registry entry, and answered correctly (750 provider input tokens, 18 output tokens). The isolated smoke agent used a temporary copy of local auth; no credentials are in the package.
- `pi remove <local-package-path>` removed the package entry; `pi list` showed no installed packages. A subsequent real Luna request succeeded normally with the package removed.
- `npm view pi-corvus` and `npm view pi-corvus@0.1.0 version` returned `E404` at check time. This establishes no published version was found; it does not rule out npm account permissions/reservations. `npm whoami` returned `E401`.

The Pi CLI does not accept a `.tgz` path directly as a package source (it treats it as an extension file and reports unknown `.tgz`). The validated local packed-tarball route was: `npm install <tgz>` into a clean prefix, then `pi install <prefix>/node_modules/pi-corvus`. After publication, the user-facing route is the standard `pi install npm:pi-corvus`.

## User-owned publication steps

npm publish requires valid npm authentication, and `npm whoami` currently fails with `E401`. The user must run `npm login` (complete any browser/OTP prompts), verify `npm whoami`, and ensure that account is authorized to publish the unscoped `pi-corvus` name. Recheck `npm view pi-corvus` and then explicitly authorize publication. The exact publish command is `npm publish --access public` from this repository root. **Do not run it until authentication/name ownership is established and the user explicitly authorizes publication.** No npm package has been published.

Once that public npm publish succeeds, Pi's docs and pi.dev package examples indicate the `pi-package` keyword makes it eligible for gallery discovery; there is no separate listing submission. Verify `https://pi.dev/packages/pi-corvus` after the gallery index refreshes. Package search/gallery propagation is external.

# Repository guidelines

## Formatting

- Always run `pnpm format` after making code changes, then commit the result. Formatting is Prettier across the repo (`**/*.{ts,tsx,js,mjs,cjs,json,md}`); committing the formatted output keeps CI green.

## Publishing

- **Publish only with pnpm — never `npm publish`/`yarn publish`.** Each package's top-level `exports`/`main`/`types` point at `./src/*.ts` for live-TS development inside the monorepo; the publishable `./dist/*.js` paths live under `publishConfig`. **Only pnpm applies `publishConfig` field overrides when packing.** npm/yarn ignore them and ship the `./src/*.ts` paths verbatim — but the tarball only contains `dist/` (see each package's `files`), so every consumer hits `ERR_MODULE_NOT_FOUND`. This is exactly how `@whatworks/payload-heading-field@1.0.0` shipped broken.
- **Release via `pnpm release`** (runs `pnpm build` then `changeset publish`, which invokes `pnpm publish` per package). CI's `release.yml` does this on push to `main`. Add a changeset (`pnpm changeset`) with every consumer-affecting change.
- A `prepublishOnly` guard (`scripts/guard-publish.mjs`) hard-fails any publish whose client isn't pnpm. Keep it in new publishable packages' `prepublishOnly`. It does **not** catch `npm pack` followed by `npm publish <tarball>` (publishing a prebuilt tarball runs no lifecycle scripts) — so still always release through `pnpm release`.
- `scripts/sync-publish-config.mjs` derives each `publishConfig` from the top-level `exports`; run `pnpm sync:publish-config` after changing an `exports` map. CI's `check:publish-config` fails on drift, and `check:exports` runs `attw` against the pnpm-packed tarball.

## Package conventions

- `scripts/sync-package-scripts.mjs` keeps every package's `scripts` block on the shared conventions (build/lint/typecheck/dev:payload/etc. values are enforced; `dev` and `test:peer` must exist but may vary). Run `pnpm sync:package-scripts` after adding a package or changing scripts; CI's `check:package-scripts` fails on drift. Note `test:peer` is what CI runs (check job + pinned-payload peer matrix) — a package whose tests only live under a `test` script is invisible to CI.
- Dev sandboxes (`dev/payload.config.ts`) build on `buildDevConfig` from `@whatworks/dev-fixture/dev-config`, which supplies the shared boilerplate: autoLogin dev user, `users` auth collection, dev-user seeding, local-Mongo fallback (`dbName`), import map + generated types rooted in `dev/`, and disabled telemetry. Pass regular Payload config keys to override any of it (see `packages/sitemap` for a custom-db example, `packages/switch-env` for heavy overrides).

## Adding a package: places that enumerate every package

Most tooling auto-discovers `packages/*`, but these files list packages by name and must be updated by hand when a package is added (or renamed/removed):

- `README.md` — the Packages table.
- `.github/ISSUE_TEMPLATE/bug_report.yml` — the package dropdown `options`.
- `.github/ISSUE_TEMPLATE/feature_request.yml` — the package dropdown `options`.

If you introduce a new file that enumerates package names, add it to this list.

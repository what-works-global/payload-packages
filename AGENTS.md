# Repository guidelines

## Formatting

- Always run `pnpm format` after making code changes, then commit the result. Formatting is Prettier across the repo (`**/*.{ts,tsx,js,mjs,cjs,json,md}`); committing the formatted output keeps CI green.

## Publishing

- **Publish only with pnpm — never `npm publish`/`yarn publish`.** Each package's top-level `exports`/`main`/`types` point at `./src/*.ts` for live-TS development inside the monorepo; the publishable `./dist/*.js` paths live under `publishConfig`. **Only pnpm applies `publishConfig` field overrides when packing.** npm/yarn ignore them and ship the `./src/*.ts` paths verbatim — but the tarball only contains `dist/` (see each package's `files`), so every consumer hits `ERR_MODULE_NOT_FOUND`. This is exactly how `@whatworks/payload-heading-field@1.0.0` shipped broken.
- **Release via `pnpm release`** (runs `pnpm build` then `changeset publish`, which invokes `pnpm publish` per package). CI's `release.yml` does this on push to `main`. Add a changeset (`pnpm changeset`) with every consumer-affecting change.
- A `prepublishOnly` guard (`scripts/guard-publish.mjs`) hard-fails any publish whose client isn't pnpm. Keep it in new publishable packages' `prepublishOnly`. It does **not** catch `npm pack` followed by `npm publish <tarball>` (publishing a prebuilt tarball runs no lifecycle scripts) — so still always release through `pnpm release`.
- `scripts/sync-publish-config.mjs` derives each `publishConfig` from the top-level `exports`; run `pnpm sync:publish-config` after changing an `exports` map. CI's `check:publish-config` fails on drift, and `check:exports` runs `attw` against the pnpm-packed tarball.

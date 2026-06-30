#!/usr/bin/env node
// Refuse to publish any package with a client other than pnpm.
//
// WHY THIS EXISTS
// ---------------
// Every package's top-level `exports`/`main`/`types` point at `./src/*.ts` so that
// in-repo consumers (each package's `dev/` app, sibling packages) resolve live TypeScript
// source — no build step needed for local development. The publishable `./dist/*.js`
// paths live under `publishConfig`, which `scripts/sync-publish-config.mjs` derives
// automatically and CI verifies with `check:publish-config`.
//
// The catch: `publishConfig` field overrides for `exports`/`main`/`types` are ONLY applied
// by pnpm when it packs/publishes. `npm publish` (and `npm pack`) ignore them and ship the
// top-level `./src/*.ts` paths verbatim. Because the tarball only contains `dist/` (see each
// package's `files`), every consumer of an npm-published build hits ERR_MODULE_NOT_FOUND on
// `./src/index.ts`. This is exactly how @whatworks/payload-heading-field@1.0.0 shipped broken.
//
// `check:exports` (attw) can't catch this: it packs with pnpm, so it only ever inspects a
// correctly-substituted tarball. The only reliable defense is to ensure publish always runs
// through pnpm — which this guard enforces.
//
// Sanctioned release path: `pnpm release` (build + `changeset publish`, which invokes
// `pnpm publish` per package). CI's release workflow uses it.
//
// Escape hatch (discouraged, for genuine emergencies only):
//   ALLOW_NON_PNPM_PUBLISH=1 npm publish

const ua = process.env.npm_config_user_agent || ''
const client = ua.split(' ')[0] || '(unknown)'

if (process.env.ALLOW_NON_PNPM_PUBLISH === '1') {
  console.warn(
    `⚠ guard-publish: ALLOW_NON_PNPM_PUBLISH=1 set — skipping the pnpm publish guard ` +
      `(client: ${client}). Confirm the published exports point at ./dist before relying on it.`,
  )
  process.exit(0)
}

if (!ua.startsWith('pnpm/')) {
  console.error(
    [
      '',
      `✘ guard-publish: refusing to publish with "${client}".`,
      '',
      '  Publish only with pnpm (`pnpm release` → changesets → `pnpm publish`).',
      '  pnpm applies publishConfig and rewrites exports/main/types from ./src/*.ts to',
      '  ./dist/*.js. npm/yarn ignore publishConfig and ship the dev src paths, which are',
      '  not in the tarball — breaking every consumer (this shipped heading-field@1.0.0).',
      '',
      '  Escape hatch (discouraged): ALLOW_NON_PNPM_PUBLISH=1',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

# @whatworks/payload-switch-env

## 1.4.2

### Patch Changes

- e346163: Postgres copy no longer strips a managed target's schema grants. `restorePostgres` rebuilds the target with `DROP SCHEMA ... CASCADE` + `CREATE SCHEMA`, which discarded the schema's ACL and default privileges. On a Supabase/Neon target that wiped the grants for the platform's API roles (`anon`/`authenticated`/`service_role`), so PostgREST found no accessible exposed schema and every REST request failed with `3F000 schema "pg_pgrst_no_exposed_schemas" does not exist`. The restore now captures the target schema's grants + default privileges before the drop and replays them (before the table DDL, so recreated tables inherit the default privileges). Provider-agnostic — a plain local target with no extra grants is unaffected.

## 1.4.1

### Patch Changes

- 606e697: Copy on Postgres no longer replays production extensions that live outside the copied schema. Previously every extension in `pg_extension` was recreated with the target's `search_path` pinned to the copied schema — so a provider-managed extension that happens to be available locally (e.g. Supabase's `pg_stat_statements`) was installed into the development schema, planting extension-owned views that every subsequent Drizzle push (including Payload's boot-time push, leaving the dev server unable to start) tried and failed to `DROP VIEW`. Only extensions installed inside the copied schema are now captured. For productions that genuinely have a view-owning extension in the copied schema (RDS-style `CREATE EXTENSION` defaults to `public`), the reconcile push now skips the un-droppable `DROP VIEW` (SQLSTATE 2BP01) with a warning instead of failing the copy.

  If a previous copy already planted `pg_stat_statements` in your local database (symptom: the dev server fails to boot with `Failed query: DROP VIEW "public"."pg_stat_statements_info"`), run `DROP EXTENSION pg_stat_statements;` against your development database once.

- efc21f8: Log a skipped production extension (e.g. Supabase's `supabase_vault`, Neon's `neon` — provider extensions with no local binaries) as a single warning line during copy, instead of dumping the full database error and stack trace, which made a routine, expected skip read like a failed copy.

## 1.4.0

### Minor Changes

- f05a0d0: Copying production to development on SQL adapters now works when the local schema has progressed past production (added/removed fields, new or deleted collections).

  - **Postgres**: the copy now captures production's schema DDL from the system catalogs (enums, sequences, tables, constraints, indexes) and rebuilds the development schema as production's — `DROP SCHEMA ... CASCADE` + replay inside one transaction — before loading rows, instead of loading production rows into the (possibly diverged) local code schema. Extension-owned objects (e.g. postgis's `spatial_ref_sys`) are excluded from both DDL capture and row backup; provider extensions that don't exist locally (e.g. Neon's `neon`) are skipped with a warning.
  - **Both SQL adapters**: after loading, pending local migration files are applied (as before), then the dev schema is reconciled with a non-interactive Drizzle push. This replaces `pushDevSchema`, which prompts on stdin (and can `process.exit`) when the diff carries data-loss warnings — warnings are now logged and applied instead. The push statements are also executed with two drizzle-kit generation warts smoothed over (duplicate CREATE INDEX after a SQLite table recreate; Postgres DROP CONSTRAINT for a constraint already removed by DROP TABLE CASCADE).
  - **Rename-shaped drift pauses the reconcile instead of guessing.** An unmigrated rename is indistinguishable from a remove+add (drizzle-kit would prompt "created or renamed?" on stdin — impossible in an endpoint, and a wrong guess silently empties the field). When the reconcile detects a table/column/enum that was both created and deleted, it skips the push and reports the pairs in the response, leaving the development database as a lossless production replica plus applied migrations. Resolve by restarting the dev server (Payload's boot-time push prompts in the terminal) or adding a migration for the rename; on staging deployments, deploying the missing migrations resolves the difference in place. Unambiguous drift (additions, removals, migrated renames) always reconciles automatically.

## 1.3.5

### Patch Changes

- 720c9fd: Fix payload version auto-detection still failing on Vercel in pnpm monorepos.

  The primary detection strategy asked payload's own `getDependencies` to resolve
  payload from `process.cwd()`. In a pnpm monorepo deployed to Vercel the function's
  cwd is the workspace root, which has no top-level `payload` symlink (pnpm only links
  payload into the consuming app's own `node_modules`), so `getDependencies` resolved
  nothing and the filesystem fallback — defeated by the same relocated trace layout —
  also missed, leaving deployments with the "Could not auto-detect the installed payload
  version" warning.

  Detection now resolves payload from the directory of the module that imported it (and
  the executing chunk's path), not just `process.cwd()`. That directory is the exact base
  from which the plugin's own `import('payload')` already succeeds, so Node's resolver
  mirrors the working resolution wherever payload loads. `process.cwd()` is kept as a last
  resort. The shared candidate-directory logic is exported as `getRuntimeDirs`.

## 1.3.4

### Patch Changes

- dcf8dcc: Fix SQL (Postgres/SQLite) projects being unable to switch to production when the schema contains `numeric` columns with a numeric `DEFAULT` (e.g. Payload's auth `login_attempts`, or any `number` field with a `defaultValue`).

  drizzle-kit's `pushSchema` diff — which the switch-to-production drift gate uses to detect whether production has drifted from the local schema — is not perfectly idempotent: for numeric-default columns it re-emits a no-op `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT <n>` on every run, even when the live column already carries that exact default. The gate counted those phantom statements as real drift and refused the switch with "the production database schema does not match your local schema. Deploy a migration first." No migration could ever clear them — applying the statement changes nothing, so the next diff reports it again — permanently blocking the switch.

  The gate now establishes a baseline by diffing the same code schema against the live development database (which `push` keeps in sync with the code), then subtracts those exact statements from the production drift. Anything drizzle-kit emits against an already-in-sync database is its own noise, not drift, so only genuine code-vs-production differences remain. A real missing column/table/index in production is absent from the development baseline and is therefore preserved, still blocking the switch and prompting a migration. This is layered on top of the existing filename-index reshape exclusion; Mongo is unaffected (schemaless, no gate).

## 1.3.3

### Patch Changes

- 5d486c4: Fix SQL (Postgres/SQLite) projects being unable to switch back to production when an upload collection uses development cloud-storage mode with a storage `prefix`.

  In that setup the plugin scopes filename uniqueness to the prefix by setting `upload.filenameCompoundIndex`, so the live development schema carries a compound `unique(filename, prefix)` index where production — built from migrations, which deliberately suppress the compound index — only has the default single-field `unique(filename)`. The switch-to-production drift gate diffed the live schema against production, saw that reshape as schema drift, and refused the switch with "the production database schema does not match your local schema. Deploy a migration first." No migration could clear it: generating one would push the prefix-scoped index to production, which is exactly what must not happen.

  The drift gate now subtracts the plugin's own filename-index reshape before deciding, so it only blocks on genuine user schema changes. The exclusion is restricted to the index DDL for collections the plugin actually reshaped and never touches column or table drift; Mongo is unaffected (schemaless, no gate).

## 1.3.2

### Patch Changes

- e59d03f: Keep generated migrations clean: don't declare the compound `(filename, prefix)` upload index while payload is generating a migration.

  In development cloud-storage mode the plugin scopes upload filename uniqueness to the storage prefix by setting `upload.filenameCompoundIndex = ['filename', 'prefix']`. That declaration is correct at runtime — the development database picks the compound index up via the schema push that runs after a copy — but it also leaked into `payload migrate:create`'s schema diff, producing a migration that drops the default single-field `filename` unique index and adds the compound one. Because migrations describe the production / file-system baseline and run against production, that swap was wrong there (and surfaced whenever migrations were authored with a staging-flavoured environment active).

  The plugin now suppresses `filenameCompoundIndex` when payload's CLI is running a migration command (detected the same way payload's own bin resolves it — the first positional arg starting with `migrate`), so generated migrations keep the single-field unique index regardless of which environment they're authored in. Runtime config is unchanged, so the development cloud-storage database still gets the compound index. The `createdDuringDevelopment` / storage-mode upload fields are unaffected.

## 1.3.1

### Patch Changes

- 0ed3bca: Make the database copy resilient when on-disk migration files can't be loaded.

  During a copy the plugin calls `db.migrate()` to apply any pending migration files. Payload's generated migrations import types as values (`import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-*'`), and when the migration files are dynamically imported at runtime (outside Payload's own transpiling CLI) the ESM loader cannot resolve those type-only names — throwing e.g. `does not provide an export named 'MigrateDownArgs'` and aborting the entire copy.

  Running migration files isn't required for a copy: the development schema is reconciled with `pushDevSchema` immediately afterwards. The migrate step is now best-effort — a load failure is logged as a warning and the copy continues — so prod→dev copies succeed on both SQLite and Postgres regardless of how the consuming app's migration files transpile.

## 1.3.0

### Minor Changes

- adfb9c8: Support the database copy flow on Postgres (`@payloadcms/db-postgres`).

  The `copy` button and switch-with-copy both route SQL adapters through a backup/restore step that was implemented only for SQLite's libSQL client — on Postgres it failed immediately with `expected SQLite adapter with a libSQL client` (it reached for `sqlite_master`, `PRAGMA`, and `?` placeholders that don't exist there).

  The SQL path now dispatches by adapter: SQLite keeps replaying captured DDL, while Postgres materializes the development schema with Drizzle's push, truncates it, and bulk-loads production's rows over a `pg` pool. Foreign-key enforcement is suspended for the load with `SET LOCAL session_replication_role = 'replica'`, JSON/JSONB columns are re-serialized so node-postgres doesn't mangle them, and identity sequences are advanced past the restored rows so later development inserts don't collide. Restore only ever writes to the development database; production is never mutated.

  Adds a Postgres integration suite (mirroring the SQLite one, backed by an in-process `embedded-postgres` cluster) covering field-type round-trips, copy-config modes, side tables, migration rows, and sequence reset.

## 1.2.10

### Patch Changes

- d176e21: Stop `onInit` from crashing on a fresh SQL database whose schema has not been pushed yet.

  On a brand-new database the `switch_env` global's table may not exist by the time the plugin's `onInit` runs — most notably a fresh remote libsql/Turso database, where Drizzle's dev schema-push does not create tables. `getEnv(payload)` queried the global anyway, and the driver threw `no such table: switch_env` (SQLite) / `does not exist` (Postgres), taking down the whole app at init.

  `getEnv` now treats a missing global table as "no persisted switch state" and returns `development` instead of throwing. Other query errors still propagate unchanged, and MongoDB (which returns `null` rather than throwing) is unaffected.

## 1.2.9

### Patch Changes

- 510aa5b: Fix the superseded-`filename`-index cleanup never running on the databases it targets.

  1.2.8 added automatic dropping of the orphaned single-field `filename` unique index, but routed it through `model.init()` first. On exactly the databases that need healing, `model.init()` rejects: autoIndex can't build the schema's non-unique `filename` index while the stale unique index still occupies the `filename_1` name, so the drop never executed and the plugin instead logged a misleading `Could not drop the superseded single-field filename unique index … An existing index has the same name as the requested index` warning.

  The cleanup now works the native collection directly instead of going through `model.init()`/autoIndex, and ensures the compound `(filename, prefix)` replacement index exists — creating it from the configured fields if autoIndex never managed to (it stops at the failed `filename_1` build, so the compound is often absent) — before dropping the old single-field unique index. A not-yet-created collection (`NamespaceNotFound`) is now treated as a silent no-op rather than a warning. Guards are unchanged: development environment, `cloud-storage` mode, and the mongoose adapter only.

## 1.2.8

### Patch Changes

- d18fbdf: Automatically drop the superseded single-field `filename` unique index on MongoDB in `cloud-storage` mode.

  Scoping upload filename uniqueness to `(filename, prefix)` makes payload build a compound `{ filename: 1, prefix: 1 }` unique index instead of the single-field `{ filename: 1 }` one. But a database first indexed before that change keeps the orphaned unique `filename_1` index: mongoose's `autoIndex` only _creates_ missing indexes, it never drops ones that have left the schema, and the new non-unique `filename_1` it wants (from the field's `index: true`) collides by name with the old unique one, so the old one simply lingers. That leftover global unique index keeps rejecting same-filename/different-prefix documents — including production documents copied into development under their original prefix — with a duplicate-key error surfaced as `ValidationError: filename`, defeating the compound-index fix on already-provisioned databases.

  The plugin now drops that superseded index itself, on init and after a runtime switch into development, for every upload collection it scopes with `filenameCompoundIndex`. It is best-effort and tightly guarded: development environment only (never the production database, where the single-field unique index is legitimate), `cloud-storage` mode only, the mongoose adapter only (drizzle reconciles indexes via schema push), and only once the compound replacement index already exists — so the collection is never left without filename uniqueness. This removes the manual "drop the old unique index on MongoDB" migration step noted previously.

## 1.2.7

### Patch Changes

- 25db10a: Scope upload filename uniqueness to `(filename, prefix)` in `cloud-storage` mode.

  In `cloud-storage` mode one database holds documents under different storage prefixes (development uploads under the development prefix, copied or production documents under the original prefix), and payload's duplicate-filename check is scoped to the incoming document's prefix. The default collection-wide unique index on `filename` doesn't match that layout: uploading a filename that exists under another prefix failed with "The following field is invalid: filename" even though the storage keys don't collide.

  The plugin now sets `upload.filenameCompoundIndex: ['filename', 'prefix']` on every upload collection listed in `developmentFileStorage.collections` with a `prefix` (unless `filenameCompoundIndex` is already set). The same filename can then exist under different prefixes, while duplicates within a prefix still deduplicate normally (`file-1.zip`, `file-2.zip`, ...).

  This changes the collection's indexes. If the plugin is disabled in some environments, set `filenameCompoundIndex` explicitly in the collection config so the schema is identical with and without the plugin. Existing databases keep their old unique index until migrated — a schema migration on SQL adapters; on MongoDB the old unique index must be dropped manually. See the README section "Duplicate filenames in `cloud-storage` mode".

## 1.2.6

### Patch Changes

- 664848b: Fix duplicate upload filenames failing with "The following field is invalid: filename" in development cloud-storage mode.

  Payload's duplicate-filename check (`generateFileData` → `getSafeFileName`) runs before any `beforeChange` hook and filters its lookup by the incoming `data.prefix`. The plugin used to apply the development prefix in a `beforeChange` hook — after that check — so the lookup compared the admin form's baked collection prefix (e.g. `private`) against documents stored under the development prefix (e.g. `staging/private`), found nothing, and the insert tripped the collection-wide unique `filename` index instead of deduplicating to `file-1.zip`.

  The `createdDuringDevelopment`/`developmentStorageMode` flags and the prefix rewrite are now consolidated into a single `beforeOperation` hook, which runs before the operation starts. Payload's own dedup then sees the same prefix new documents are stored under and increments duplicates normally. This also removes the dead `modifyPrefix` export and a latent bug where a partial Local API update of a development document without `prefix` in its data would overwrite the stored prefix with the bare development prefix.

  Duplicates against documents copied from production (which keep their original prefix) remain subject to the collection-wide unique index; the README now documents scoping uniqueness with `upload.filenameCompoundIndex: ['filename', 'prefix']` for that case.

## 1.2.5

### Patch Changes

- 370e350: Fix payload version auto-detection still failing in Vercel deployments.

  The filesystem walk introduced previously could still miss the installed payload package in traced serverless bundles, leaving deployments with the "Could not auto-detect the installed payload version" warning. Detection now asks payload itself first: it calls `getDependencies` (exported from `payload` since 3.0.0) to resolve payload's own package.json with Node's resolver. Because that helper executes inside the payload package — which Next.js keeps in `serverExternalPackages` and never bundles — it always runs with real runtime paths, so resolution works anywhere payload itself loads. The filesystem walk remains as a fallback, and `detectPayloadVersion` is now async (the plugin callback already was).

## 1.2.4

### Patch Changes

- 9bf9fa3: Fix file-system mode serving files from cloud storage instead of the local disk in development.

  In `file-system` mode the plugin wraps the cloud storage plugin's static handler so that, in the development environment, files that exist in the collection's static directory are served from disk instead of cloud storage. The wrapper was being pushed onto a spread copy of `collection.upload.handlers` that was never assigned back, so the unwrapped cloud storage handler always ran. For collections served through payload's `/api/<collection>/file/<filename>` endpoint (i.e. without `disablePayloadAccessControl`), requests for files created during development went to cloud storage — where the file never existed — and returned a 500 (S3 responds 403 for missing keys without `s3:ListBucket`).

  The wrapper is now installed on the live handlers array, so development requests fall through to payload's local file serving when the file exists on disk.

## 1.2.3

### Patch Changes

- ccbd17f: Fix client uploads landing outside the development prefix on payload >= 3.83.0.

  Since payload 3.83.0 (payload#16230) the admin form sends the doc `prefix` field value as `docPrefix` with client uploads, and a non-empty `docPrefix` overrides the collection prefix in the storage key computation. The default doc prefix is baked from the original collection prefix at config build time — before this plugin rewrites prefixes — so signed-URL uploads went to `<collection-prefix>/<file>` while the stored doc (and the generated URL) carried `<dev-prefix>/<collection-prefix>/<file>`, producing 404s on read.

  The plugin now wraps the cloud storage plugin's signed-URL endpoint(s) and pins the development prefix onto `docPrefix` at request time. This covers default, user-defined, and function-generated doc prefixes, and is a no-op in production and on payload < 3.83.0 (which ignores `docPrefix`).

  Because `docPrefix` overrides the collection prefix on >= 3.83.0, `developmentFileStorage.collections` no longer has to be the same object reference passed to the cloud storage plugin on those versions — sharing the object is still required on older payloads and remains the safe default.

## 1.2.2

### Patch Changes

- 5403171: Make payload version auto-detection work in bundled serverless deployments (e.g. Vercel), and stop crashing the app when detection fails.

  In a traced lambda bundle the previous detection found nothing: bundlers inline `import.meta.url` to a build-machine path that doesn't exist at runtime, and file tracing resolves pnpm symlinks to their real store paths, so the bundle contains `node_modules/.pnpm/payload@<version>/node_modules/payload` without a top-level `node_modules/payload` symlink for the walk to find. Detection now also derives a start directory from the runtime stack trace (which carries the executing chunk's real path) and scans the pnpm virtual store at every level of the walk.

  If detection still finds nothing, the plugin now logs a warning and treats the version as unknown instead of throwing at boot — version gates assume a current payload release in that case, so pass `payloadVersion` explicitly when running payload < 3.83.0 in such an environment.

## 1.2.1

### Patch Changes

- 6cf50ef: Import `@payloadcms/drizzle` lazily so Mongo-only consumers don't need it installed. `@payloadcms/drizzle` is an optional peer dependency, but `restoreSql` imported it statically at module load time, so any consumer without it installed (e.g. using `@payloadcms/db-mongodb`) crashed with `ERR_MODULE_NOT_FOUND` as soon as the plugin loaded — including during `payload generate:importmap`. The package is now resolved with a dynamic `import()` only on the SQL restore path, before any destructive work, with a clear error message if it is missing.

## 1.2.0

### Minor Changes

- e397880: Auto-detect the installed Payload version. The `payloadVersion` plugin argument is now optional and acts as an override; when omitted, the plugin resolves the installed `payload` package's version at config build time by locating its package.json on the filesystem (no module resolution, so bundlers don't try to externalize or rewrite the lookup). This removes the drift risk of a hand-maintained version string silently selecting the wrong compatibility branch (hook timing at 3.70.0, client upload context at 3.83.0). If detection fails and no override is provided, the plugin throws a clear error at config build time.

### Patch Changes

- 0676fbc: Fix client upload validation failing in cloud-storage mode on Payload >= 3.83.0 (e.g. `File type text/plain (from extension zip) is not allowed.`).

  Payload validates client uploads by reading the file back from cloud storage. Since Payload 3.83.0 (#16230) `clientUploadContext.prefix` carries the doc prefix instead of the collection prefix, and a non-empty doc prefix replaces the collection prefix in the storage key computation. Joining the development prefix onto it therefore resolved a key missing the collection prefix (`staging/<file>` instead of `staging/private/<file>`), the read-back found no file, and mime type validation rejected the upload.

  The injected upload handler now mirrors the signed-URL key computation on >= 3.83.0 (pin an empty doc prefix to the rewritten collection prefix, leave a non-empty one untouched), gated via the existing `payloadVersion` argument so the previous behavior is kept for older Payload versions. Make sure `payloadVersion` matches your installed Payload version.

## 1.1.0

### Minor Changes

- 823e148: feat(switch-env): protect production schema on SQL adapters

  Two SQL-only safeguards (SQLite/Postgres; Mongo is schemaless and unaffected) so
  the only path to change a production schema is a proper migration:

  - **Never push to production.** The production database adapter is now built with
    `push: false`, so `connect()` never runs `pushDevSchema` against production —
    not on switch, and not on a hot-reload reconnect while connected to production.
    This sits upstream of `PAYLOAD_FORCE_DRIZZLE_PUSH`, so it cannot be overridden.
  - **Block switching to production on schema drift.** Before switching to
    production, the plugin runs a drizzle-kit dry-run diff (reading
    `statementsToExecute`, which also catches additive changes) and refuses the
    switch if the production schema does not match the local schema, listing the
    pending changes. Nothing is applied.

## 1.0.2

### Patch Changes

- d7b981d: fix(switch-env): preserve the RSC `'use client'` boundary and honour Next.js `basePath`

  Two fixes:

  1. The client export mixes async server components (`AdminButton`, `DangerBar`,
     `SwitchDbConnectionView`) with the `'use client'` components they render.
     Bundling collapsed them into a single module and stripped the per-file
     directives, so `SwitchEnvButtonClient`/`CopyDbButtonClient` were executed on
     the server and threw `Attempted to call useConfig() from the server`. The
     build now emits one file per source module (`unbundle`), keeping each
     `'use client'` directive intact.
  2. Endpoint and thumbnail URLs were hand-built as `${serverURL}${apiRoute}/…`,
     which drops a Next.js `basePath`. Under a configured `basePath` the switch /
     copy-db POSTs (and admin thumbnails) 404'd. They now use Payload's
     `formatAdminURL`, which prepends `process.env.NEXT_BASE_PATH` exactly like
     Payload's own admin requests. (`formatAdminURL` has shipped in
     `payload/shared` since 3.27.0, well within the `>=3.54.0` peer range.)

## 1.0.1

### Patch Changes

- c67e83b: Compile JSX with the React automatic runtime

## 1.0.0

### Major Changes

- | 984f6b8:                                                                                                                 | Old Package / Repo                                                                                                                                                 | New Package / Repo |
  | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
  | [github.com/elliott-w/payload-plugin-switch-env](https://github.com/elliott-w/payload-plugin-switch-env)                 | [github.com/what-works-global/payload-packages/tree/main/packages/switch-env](https://github.com/what-works-global/payload-packages/tree/main/packages/switch-env) |
  | [npmjs.com/package/@elliott-w/payload-plugin-switch-env](https://npmjs.com/package/@elliott-w/payload-plugin-switch-env) | [npmjs.com/package/@whatworks/payload-switch-env](https://npmjs.com/package/@whatworks/payload-switch-env)                                                         |

  Bumped minimum payload version to 3.54.0

  Add SQL adapter support (SQLite/Postgres) for copy and switch operations.

  - Dispatch copy/switch endpoints by adapter, with a new `openAdapter` helper
  - SQL backup/restore preserves relationships, globals, latest-x versioning, and per-collection document mode overrides
  - Restore pushes the dev schema and runs pending migrations so unmigrated dev columns survive; migrate is skipped when no `migrationDir` exists on disk
  - Target database is wiped and SQL migration history is copied as part of restore
  - Add `dev:sqlite` and `dev:mongo` scripts, kitchen-sink field test coverage, and adapter-parameterized copy scenarios

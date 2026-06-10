# @whatworks/payload-switch-env

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

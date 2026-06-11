# @whatworks/payload-switch-env

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

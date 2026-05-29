# @whatworks/payload-switch-env

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

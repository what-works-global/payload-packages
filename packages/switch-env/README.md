# @whatworks/payload-switch-env

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-switch-env" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

A Payload plugin that lets you switch your local admin panel between your **development** and **production** databases — and copy production into development — at the press of a button.

Two common uses:

- **Edit production data locally.** Point the admin panel at the production database to enter or fix data — without losing business-as-usual updates (orders, form submissions, client edits) that a clone-and-overwrite workflow would clobber. On SQL adapters this is **data-only**: the schema must already match (see [SQL adapters](#sql-adapters-postgres--sqlite)).
- **Replicate production into development.** Copy the production database to your local database in one click. Upload documents keep referencing the files in your production cloud storage, so nothing needs to be synced to disk. Documents not created during development are protected from edits/deletes.

## Demo

[demo.webm](https://github.com/user-attachments/assets/37e889c0-e0e9-472c-bdce-fc7f76166100)

## Install

```bash
pnpm i @whatworks/payload-switch-env
```

## Requirements & limitations

- Payload `3.0.2`+. On Payload < `3.6.0`, the development flags are not applied when using **Duplicate** on upload collections (the duplicated document is treated as a production document).
- Databases: MongoDB, or a Drizzle SQL adapter — Postgres (`@payloadcms/db-postgres`) or SQLite (`@payloadcms/db-sqlite`). See [SQL adapters](#sql-adapters-postgres--sqlite) for the extra schema rules that apply.
- Production uploads must use a cloud storage adapter (e.g. `@payloadcms/storage-s3`). Production setups relying solely on local file storage are not supported.
- In development, uploads can use either the local file system or cloud storage (see `developmentFileStorage`).

## Plugin ordering

> ⚠️ The `switchEnvPlugin` must be **last** in the `plugins` array, and your cloud storage plugin must be **second last**.

<details>
<summary>Why?</summary>

The cloud storage plugin adds `url` fields plus `beforeChange`/`afterDelete` hooks to upload collections. `switchEnv` modifies the `afterRead` hooks on those `url` fields and assumes the cloud storage hooks are last in the array. Keeping cloud storage second-last ensures no other plugin breaks that assumption.

</details>

## Usage

```ts
// payload.config.ts
import { type Args, mongooseAdapter } from '@payloadcms/db-mongodb'
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig } from 'payload'
import { switchEnvPlugin, adminThumbnail } from '@whatworks/payload-switch-env'

const dbArgs: Args = {
  url: process.env.DATABASE_URI!,
}

export default buildConfig({
  db: mongooseAdapter(dbArgs),
  plugins: [
    // Cloud storage plugin: second last
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      collections: { media: true },
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        region: process.env.S3_REGION,
      },
    }),
    // switchEnvPlugin: last
    switchEnvPlugin({
      payloadVersion: '3.70.0',
      enable: process.env.NODE_ENV === 'development',
      db: {
        function: mongooseAdapter,
        productionArgs: dbArgs,
        developmentArgs: {
          ...dbArgs,
          url: process.env.DEVELOPMENT_DATABASE_URI || '',
        },
      },
      copy: {
        versions: {
          default: { mode: 'latest-x', x: 3 },
        },
      },
    }),
  ],
  collections: [
    {
      slug: 'media',
      fields: [{ name: 'alt', type: 'text' }],
      upload: {
        // Optional: link admin thumbnails directly to cloud storage
        adminThumbnail: adminThumbnail({
          basePath: `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`,
          imageSize: 'thumbnail',
        }),
        imageSizes: [{ name: 'thumbnail', width: 300, height: 300 }],
      },
    },
  ],
})
```

## Options

| Option                   | Type                                                 | Default                   | Description                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                     | object                                               | **required**              | Database adapter `function` plus `productionArgs` and `developmentArgs`.                                                                                                                                                                                                                                                                                        |
| `payloadVersion`         | string                                               | **required**              | Installed Payload version (e.g. `'3.70.0'`), used for hook-timing compatibility.                                                                                                                                                                                                                                                                                |
| `buttonMode`             | `'switch' \| 'copy'`                                 | `'switch'`                | `'switch'` toggles between production and development; `'copy'` shows a button that copies the production DB into development (useful for staging).                                                                                                                                                                                                             |
| `enable`                 | boolean                                              | `true`                    | Enable or disable the plugin.                                                                                                                                                                                                                                                                                                                                   |
| `quickSwitch`            | `false \| { overwriteDevelopmentDatabase: boolean }` | `false`                   | Skip the confirmation modal and switch immediately (`'switch'` mode only).                                                                                                                                                                                                                                                                                      |
| `developmentFileStorage` | object                                               | `{ mode: 'file-system' }` | Where dev uploads go: `{ mode: 'file-system' }` or `{ mode: 'cloud-storage', prefix, collections }`. In `cloud-storage` mode, `collections` mirrors the storage plugin's collection options; on Payload < 3.83.0 it must be the _same object_ you pass to the storage plugin (so prefix rewrites are visible to it), on >= 3.83.0 a separate object also works. |
| `developmentSafetyMode`  | boolean                                              | `true`                    | When `NODE_ENV=development`, throws if `developmentArgs.url` is not `localhost`/`127.0.0.1`.                                                                                                                                                                                                                                                                    |
| `logDatabaseSize`        | boolean                                              | `false`                   | Logs the serialized backup size when copying the DB (adds a serialization cost).                                                                                                                                                                                                                                                                                |
| `copy`                   | object                                               | —                         | Control which documents and versions are copied to development. See below.                                                                                                                                                                                                                                                                                      |

### `copy`

Limit how much data is copied when replicating production to development. Both `documents` and `versions` accept a `default` mode plus per-`collections`/`globals` overrides:

- `{ mode: 'all' }` — copy everything.
- `{ mode: 'latest-x', x: number }` — copy only the latest `x` (documents, or versions per document).
- `{ mode: 'none' }` — copy nothing (for `versions`, keeps only each document's latest version).

```ts
copy: {
  documents: {
    default: { mode: 'all' },
    collections: { logs: { mode: 'latest-x', x: 50 } },
  },
  versions: {
    default: { mode: 'latest-x', x: 3 },
  },
}
```

### Duplicate filenames in `cloud-storage` mode

In `cloud-storage` mode a single database holds documents under different storage prefixes: development uploads under the development prefix (e.g. `staging/private/file.zip`) and documents copied from production under their original prefix (e.g. `private/file.zip`). Payload's duplicate-filename check is scoped to the incoming document's prefix, but by default the unique index on `filename` spans the whole collection — so uploading a filename that exists under _another_ prefix would fail with `The following field is invalid: filename` even though the storage keys don't collide.

The plugin therefore sets

```ts
upload: {
  filenameCompoundIndex: ['filename', 'prefix'],
}
```

on every upload collection it manages (those listed in `developmentFileStorage.collections` with a `prefix`), unless you set `filenameCompoundIndex` yourself. Uniqueness is then scoped to `(filename, prefix)`: the same filename can exist under different prefixes (they are different storage keys), while uploading a duplicate filename _within_ a prefix still deduplicates normally (`file-1.zip`, `file-2.zip`, ...).

Because this changes the collection's indexes, two things to note for existing setups:

- If the plugin is disabled in some environments (e.g. `enable: process.env.NODE_ENV === 'development'`), set `filenameCompoundIndex` explicitly in the collection config instead, so the schema is identical with and without the plugin — otherwise uploads in those environments still hit the collection-wide unique index.
- Existing databases keep their old unique index on `filename` until migrated. On MongoDB the plugin handles this for you: in the development `cloud-storage` environment it creates the new compound index and drops the superseded single-field `filename` unique index automatically (on init and after a runtime switch). On SQL adapters it is a schema migration through your normal pipeline (the plugin refuses to switch to production until production's schema matches).

## SQL adapters (Postgres / SQLite)

MongoDB is schemaless, so switching to production with locally-changed fields just works. SQL adapters are schema-bound, so the plugin enforces that **the only way to change a production schema is a proper migration** — never a switch. Two safeguards make this safe:

1. **Production is never schema-pushed.** The production adapter is built with `push: false`, so connecting to production never runs Drizzle's dev schema push — not on switch, and not when the dev server hot-reloads while you're connected to production. So if you edit a collection in prod mode, your change is **not** applied to the production database.
2. **Switching to production is blocked on schema drift.** Before switching, the plugin runs a Drizzle dry-run diff against production. If the production schema doesn't match your local schema, the switch is refused and the pending changes are listed. Nothing is applied.

Because of this, the workflow for a feature that needs both code and data is **migrate first, then populate**:

1. Ship the schema migration to production through your normal migration pipeline.
2. Once production matches your local schema, switch to production and enter/fix the data.

If you edit a field while connected to production, queries touching the new column will error (e.g. `no such column`) until production is migrated and the schemas line up again. This is intentional — it fails loudly instead of silently mutating production.

> These rules are SQL-only; nothing here changes MongoDB behavior. The `copy` flow (replicating production into development) is unaffected — it only ever writes to your development database.

### How `copy` works on SQL adapters

Both Drizzle adapters are supported. The flow reads from production and rewrites your development database in place — it never mutates production. It also works when your development schema has **progressed past production** (added/removed fields, new or deleted collections): the copy recreates production's schema first, loads the data into it, then brings the schema forward to match your local code.

1. **Capture.** Production's schema DDL is captured alongside its rows — from `sqlite_master` on SQLite, from the system catalogs on Postgres (extensions, enums, sequences, tables, constraints, indexes — a `pg_dump` equivalent with no external binary required). Only extensions installed _inside_ the copied schema are carried over; provider-managed extensions living in their own schemas (Supabase's `extensions`/`vault`, Neon's `neon`) are not part of the replica and are skipped with a warning if they can't be recreated locally.
2. **Replay.** The development database is wiped (every table on SQLite; `DROP SCHEMA ... CASCADE` on Postgres, inside a transaction so a failed copy rolls back untouched) and production's DDL is replayed — production's rows always fit exactly, regardless of local schema drift.
3. **Load.** Rows are bulk-loaded. On Postgres, foreign-key enforcement is suspended with `SET LOCAL session_replication_role = 'replica'` (requires a sufficiently privileged role on the **development** connection — the local user you normally develop against is fine), and identity sequences are advanced past the restored rows so later inserts don't collide.
4. **Migrate forward.** Local migration files that production hasn't run yet are applied (best-effort), so their renames and backfills transform the production data the way the migration author intended.
5. **Reconcile.** Remaining unmigrated dev-only schema changes are applied with a **non-interactive** Drizzle push. Data-loss warnings are logged instead of prompted — it's your development database, which the copy just deliberately rewrote. Unambiguous drift (added fields, removed fields, new or deleted collections, and any rename covered by a migration file) always reconciles automatically. Views owned by an extension installed in the schema itself (e.g. `pg_stat_statements` on setups where `CREATE EXTENSION` defaulted to `public`) can never be dropped by a push; the reconcile skips them with a warning instead of failing.

An _unmigrated_ rename is the one thing the reconcile refuses to guess: it is indistinguishable from a remove+add, and drizzle-kit's push would normally stop and ask "created or renamed?" on stdin — impossible inside an endpoint, and answering wrong silently empties the renamed field. When the reconcile detects that shape (a table, column, or enum type that was both created and deleted), it **pauses**: the reconcile is skipped and the response lists the ambiguous pairs. Your development database is left as a pure production replica (plus applied migrations), so nothing is lost. Then either:

- **In development** — restart the dev server: Payload's own boot-time schema push resolves the renames interactively in your terminal. Or add a migration for the rename and copy again.
- **On a staging deployment** (`buttonMode: 'copy'`, where Payload never runs its dev push) — a pause means this environment is missing the migrations for those schema changes. Deploy them; `payload migrate` runs against the freshly copied database and resolves the difference in place, no re-copy needed.

## Caution

In `'switch'` mode the admin panel writes directly to your production database. Make sure everyone on the project understands when they are in "production" mode.

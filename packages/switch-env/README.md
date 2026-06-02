# @whatworks/payload-switch-env

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

- Payload `3.0.2`+.
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

| Option                   | Type                                                 | Default                   | Description                                                                                                                                         |
| ------------------------ | ---------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`                     | object                                               | **required**              | Database adapter `function` plus `productionArgs` and `developmentArgs`.                                                                            |
| `payloadVersion`         | string                                               | **required**              | Installed Payload version (e.g. `'3.70.0'`), used for hook-timing compatibility.                                                                    |
| `buttonMode`             | `'switch' \| 'copy'`                                 | `'switch'`                | `'switch'` toggles between production and development; `'copy'` shows a button that copies the production DB into development (useful for staging). |
| `enable`                 | boolean                                              | `true`                    | Enable or disable the plugin.                                                                                                                       |
| `quickSwitch`            | `false \| { overwriteDevelopmentDatabase: boolean }` | `false`                   | Skip the confirmation modal and switch immediately (`'switch'` mode only).                                                                          |
| `developmentFileStorage` | object                                               | `{ mode: 'file-system' }` | Where dev uploads go: `{ mode: 'file-system' }` or `{ mode: 'cloud-storage', prefix, collections }`.                                                |
| `developmentSafetyMode`  | boolean                                              | `true`                    | When `NODE_ENV=development`, throws if `developmentArgs.url` is not `localhost`/`127.0.0.1`.                                                        |
| `logDatabaseSize`        | boolean                                              | `false`                   | Logs the serialized backup size when copying the DB (adds a serialization cost).                                                                    |
| `copy`                   | object                                               | —                         | Control which documents and versions are copied to development. See below.                                                                          |

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

## SQL adapters (Postgres / SQLite)

MongoDB is schemaless, so switching to production with locally-changed fields just works. SQL adapters are schema-bound, so the plugin enforces that **the only way to change a production schema is a proper migration** — never a switch. Two safeguards make this safe:

1. **Production is never schema-pushed.** The production adapter is built with `push: false`, so connecting to production never runs Drizzle's dev schema push — not on switch, and not when the dev server hot-reloads while you're connected to production. So if you edit a collection in prod mode, your change is **not** applied to the production database.
2. **Switching to production is blocked on schema drift.** Before switching, the plugin runs a Drizzle dry-run diff against production. If the production schema doesn't match your local schema, the switch is refused and the pending changes are listed. Nothing is applied.

Because of this, the workflow for a feature that needs both code and data is **migrate first, then populate**:

1. Ship the schema migration to production through your normal migration pipeline.
2. Once production matches your local schema, switch to production and enter/fix the data.

If you edit a field while connected to production, queries touching the new column will error (e.g. `no such column`) until production is migrated and the schemas line up again. This is intentional — it fails loudly instead of silently mutating production.

> These rules are SQL-only; nothing here changes MongoDB behavior. The `copy` flow (replicating production into development) is unaffected — it only ever writes to your development database.

## Caution

In `'switch'` mode the admin panel writes directly to your production database. Make sure everyone on the project understands when they are in "production" mode.

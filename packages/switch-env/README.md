# Payload plugin switch env

## Demo

[demo.webm](https://github.com/user-attachments/assets/37e889c0-e0e9-472c-bdce-fc7f76166100)

## Install

```
pnpm i @whatworks/payload-switch-env
```

## Example Config

⚠️ Warning: The switchEnv plugin must come last in the plugins array. Your cloud storage plugin must be second last. <details>
<summary>Why?</summary>
The cloud storage plugin adds url fields to upload collections and the switchEnv plugin needs to modify the afterRead hooks on these fields.
The cloud storage plugin also adds `beforeChange` and `afterDelete` hooks to upload collections (for uploading/deleting files from cloud storage) and the switchEnv plugin assumes they are the last hook in the array, thus you need to have the cloud storage plugin second last so that no other plugins break this assumption.
</details>

<br />

```ts
// payload.config.ts
import { type Args, mongooseAdapter } from '@payloadcms/db-mongodb'
import { buildConfig } from 'payload'
import { switchEnvPlugin, adminThumbnail } from '@whatworks/payload-switch-env'
import { s3Storage } from '@payloadcms/storage-s3'

const dbArgs: Args = {
  url: process.env.DATABASE_URI!,
}

export default buildConfig({
  db: mongooseAdapter(dbArgs),
  plugins: [
    // Your cloud storage plugin must come second last in the plugins array
    s3Storage({
      bucket: process.env.S3_BUCKET!,
      collections: {
        media: true,
      },
      config: {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
        region: process.env.S3_REGION,
      },
    }),
    // The switchEnvPlugin must come last in the plugins array
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
      fields: [
        {
          name: 'alt',
          type: 'text',
        },
      ],
      upload: {
        // Helper function if you want admin thumbnails to link directly to cloud storage
        adminThumbnail: adminThumbnail({
          basePath: `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`,
          imageSize: 'thumbnail',
        }),
        imageSizes: [
          {
            name: 'thumbnail',
            width: 300,
            height: 300,
          },
        ],
      },
    },
  ],
})
```

## Plugin Options

- `db` (**required**): Database adapter function + production/development args.
- `payloadVersion` (**required**): Installed Payload version string (for hook compatibility), e.g. `'3.70.0'`.
- `buttonMode` (default: `'switch'`):
  - `'switch'`: toggle between production and development.
  - `'copy'`: show a dedicated button to copy production DB to development DB. Useful for staging environments.
- `enable` (default: `true`): Enable/disable plugin behavior.
- `quickSwitch` (default: `false`): Skip the switch modal and switch immediately in `'switch'` mode.
- `logDatabaseSize` (default: `false`): Logs serialized backup size when copying DB.
- `developmentSafetyMode` (default: `true`): Throws if `developmentArgs.url` is not localhost/127.0.0.1 during development.
- `developmentFileStorage`:
  - `{ mode: 'file-system' }` (default)
  - `{ mode: 'cloud-storage', prefix, collections }`
- `copy`: Allows you to copy only a subset of documents to your development database. See type hints for more information.

## Limitations

Does not support database migrations.

Only works with:

- payload 3.0.2 and higher
- mongodb
- production setups using a cloud storage adapter for uploads

Notes:

- Development upload behavior can be either local file system or cloud storage via `developmentFileStorage`.
- The plugin does not support production environments that rely solely on local file storage uploads.

&nbsp;

## Why this plugin?

### Scenario #1

You're working with a production database that is getting frequently updated and you want to push a feature that requires code + database changes.

#### Option #1

Quickly clone the database to your local machine, make the data changes and then overwrite the production database with your local database.

Pros

- It works (maybe)

Cons

- Depending on how frequently the database (i.e. website) is updated, you might lose some data changes (e.g. e-commerce orders, form submissions, content entry changes from the client or other developers, etc) made to the production database in the time it took you to do all that.

#### Option #2

Make the code (i.e. field structure) changes on your local machine then use this plugin to switch the database connection to your production database to make data/content updates.

Pros:

- Never lose any business-as-usual updates made to your production database
- You can have the data component of a feature requiring code + data primed and ready in the production database, so that when the code is eventually deployed, the code can assume that the data exists in the database
- You could change your db connection string environment variable, but pressing a button in the admin dashboard is quicker and less prone to error

Cons:

- You have to train all developers on a project using this plugin to be careful when in "production environment" mode.

### Scenario #2

You want to replicate the production environment to your development environment as quickly and simply as possible.

#### Option #1

Do a manual database dump and restore on your local machine. Make a copy of all the upload collection files on your local machine or in the cloud somehow.

Pros

- It works

Cons

- Depending on your setup, can be confusing/time consuming for new developers

#### Option #2

Use this plugin to quickly copy your production database to local, with all the upload collection documents still referencing the files in your production cloud storage

Pros

- Copy production environment to development environment at the press of a button
- Your production cloud storage files are safe because this plugin prevents you from updating/deleting upload collection documents that were NOT created during development
- Images/files don't have to be synced/copied to your local machine

Cons

- The plugin does not currently work for production environments using local file storage (although it may be possible to add this as a feature in the future)

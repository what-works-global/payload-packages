---
'@whatworks/payload-switch-env': patch
---

Make the database copy resilient when on-disk migration files can't be loaded.

During a copy the plugin calls `db.migrate()` to apply any pending migration files. Payload's generated migrations import types as values (`import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-*'`), and when the migration files are dynamically imported at runtime (outside Payload's own transpiling CLI) the ESM loader cannot resolve those type-only names — throwing e.g. `does not provide an export named 'MigrateDownArgs'` and aborting the entire copy.

Running migration files isn't required for a copy: the development schema is reconciled with `pushDevSchema` immediately afterwards. The migrate step is now best-effort — a load failure is logged as a warning and the copy continues — so prod→dev copies succeed on both SQLite and Postgres regardless of how the consuming app's migration files transpile.

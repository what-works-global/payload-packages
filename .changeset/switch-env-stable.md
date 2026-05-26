---
'@whatworks/payload-switch-env': major
---

Migrated from https://github.com/elliott-w/payload-plugin-switch-env and https://npmjs.com/package/@elliott-w/payload-plugin-switch-env
to https://github.com/what-works-global/payload-packages/tree/main/packages/switch-env and https://npmjs.com/package/@whatworks/payload-switch-env

Bumped minimum payload version to 3.54.0

Add SQL adapter support (SQLite/Postgres) for copy and switch operations.

- Dispatch copy/switch endpoints by adapter, with a new `openAdapter` helper
- SQL backup/restore preserves relationships, globals, latest-x versioning, and per-collection document mode overrides
- Restore pushes the dev schema and runs pending migrations so unmigrated dev columns survive; migrate is skipped when no `migrationDir` exists on disk
- Target database is wiped and SQL migration history is copied as part of restore
- Add `dev:sqlite` and `dev:mongo` scripts, kitchen-sink field test coverage, and adapter-parameterized copy scenarios

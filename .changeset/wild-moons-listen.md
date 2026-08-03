---
'@whatworks/payload-switch-env': minor
---

feat(switch-env): add `copy.unregistered` to copy MongoDB collections that aren't registered in `payload.config.ts`

A Mongo copy only walked the collections the Payload config registers, so anything else in production (a sibling deployment's conditionally-registered collections, collections owned by another app, leftovers from a removed collection) was skipped — and since the restore rewrites the whole target database, those collections ended up empty in development/staging.

Set `copy.unregistered: { default: { mode: 'all' } }` to copy them too, with optional per-collection overrides keyed by database collection name. Unregistered `_<name>_versions` collections are copied with version semantics (bounded by `copy.versions.default`), globals whose `globalType` the config doesn't register are copied as well, and indexes are recreated. `system.*` collections and views are never copied. Default behavior is unchanged (`{ mode: 'none' }`); Postgres/SQLite copies already replicate every table in the schema.

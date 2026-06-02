---
'@whatworks/payload-switch-env': minor
---

feat(switch-env): protect production schema on SQL adapters

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

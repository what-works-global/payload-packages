---
'@whatworks/payload-switch-env': patch
---

Copy on Postgres no longer replays production extensions that live outside the copied schema. Previously every extension in `pg_extension` was recreated with the target's `search_path` pinned to the copied schema — so a provider-managed extension that happens to be available locally (e.g. Supabase's `pg_stat_statements`) was installed into the development schema, planting extension-owned views that every subsequent Drizzle push (including Payload's boot-time push, leaving the dev server unable to start) tried and failed to `DROP VIEW`. Only extensions installed inside the copied schema are now captured. For productions that genuinely have a view-owning extension in the copied schema (RDS-style `CREATE EXTENSION` defaults to `public`), the reconcile push now skips the un-droppable `DROP VIEW` (SQLSTATE 2BP01) with a warning instead of failing the copy.

If a previous copy already planted `pg_stat_statements` in your local database (symptom: the dev server fails to boot with `Failed query: DROP VIEW "public"."pg_stat_statements_info"`), run `DROP EXTENSION pg_stat_statements;` against your development database once.

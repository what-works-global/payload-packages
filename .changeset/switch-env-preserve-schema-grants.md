---
'@whatworks/payload-switch-env': patch
---

Postgres copy no longer strips a managed target's schema grants. `restorePostgres` rebuilds the target with `DROP SCHEMA ... CASCADE` + `CREATE SCHEMA`, which discarded the schema's ACL and default privileges. On a Supabase/Neon target that wiped the grants for the platform's API roles (`anon`/`authenticated`/`service_role`), so PostgREST found no accessible exposed schema and every REST request failed with `3F000 schema "pg_pgrst_no_exposed_schemas" does not exist`. The restore now captures the target schema's grants + default privileges before the drop and replays them (before the table DDL, so recreated tables inherit the default privileges). Provider-agnostic — a plain local target with no extra grants is unaffected.

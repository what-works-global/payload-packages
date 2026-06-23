---
'@whatworks/payload-switch-env': patch
---

Fix SQL (Postgres/SQLite) projects being unable to switch to production when the schema contains `numeric` columns with a numeric `DEFAULT` (e.g. Payload's auth `login_attempts`, or any `number` field with a `defaultValue`).

drizzle-kit's `pushSchema` diff — which the switch-to-production drift gate uses to detect whether production has drifted from the local schema — is not perfectly idempotent: for numeric-default columns it re-emits a no-op `ALTER TABLE ... ALTER COLUMN ... SET DEFAULT <n>` on every run, even when the live column already carries that exact default. The gate counted those phantom statements as real drift and refused the switch with "the production database schema does not match your local schema. Deploy a migration first." No migration could ever clear them — applying the statement changes nothing, so the next diff reports it again — permanently blocking the switch.

The gate now establishes a baseline by diffing the same code schema against the live development database (which `push` keeps in sync with the code), then subtracts those exact statements from the production drift. Anything drizzle-kit emits against an already-in-sync database is its own noise, not drift, so only genuine code-vs-production differences remain. A real missing column/table/index in production is absent from the development baseline and is therefore preserved, still blocking the switch and prompting a migration. This is layered on top of the existing filename-index reshape exclusion; Mongo is unaffected (schemaless, no gate).

---
'@whatworks/payload-switch-env': patch
---

Fix SQL (Postgres/SQLite) projects being unable to switch back to production when an upload collection uses development cloud-storage mode with a storage `prefix`.

In that setup the plugin scopes filename uniqueness to the prefix by setting `upload.filenameCompoundIndex`, so the live development schema carries a compound `unique(filename, prefix)` index where production — built from migrations, which deliberately suppress the compound index — only has the default single-field `unique(filename)`. The switch-to-production drift gate diffed the live schema against production, saw that reshape as schema drift, and refused the switch with "the production database schema does not match your local schema. Deploy a migration first." No migration could clear it: generating one would push the prefix-scoped index to production, which is exactly what must not happen.

The drift gate now subtracts the plugin's own filename-index reshape before deciding, so it only blocks on genuine user schema changes. The exclusion is restricted to the index DDL for collections the plugin actually reshaped and never touches column or table drift; Mongo is unaffected (schemaless, no gate).

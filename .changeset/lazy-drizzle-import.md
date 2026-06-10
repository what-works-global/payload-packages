---
'@whatworks/payload-switch-env': patch
---

Import `@payloadcms/drizzle` lazily so Mongo-only consumers don't need it installed. `@payloadcms/drizzle` is an optional peer dependency, but `restoreSql` imported it statically at module load time, so any consumer without it installed (e.g. using `@payloadcms/db-mongodb`) crashed with `ERR_MODULE_NOT_FOUND` as soon as the plugin loaded — including during `payload generate:importmap`. The package is now resolved with a dynamic `import()` only on the SQL restore path, before any destructive work, with a clear error message if it is missing.

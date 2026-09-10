---
'@whatworks/payload-switch-env': patch
---

fix(switch-env): stop production-copied uploads rendering as "Nothing found" in the development admin

1.4.5 made the development upload guard throw a public 403 whenever a request identified documents that were not created during development. Payload evaluates the same `update`/`delete` access function as a _permission probe_ — the admin's document view (and the REST `/access/:id` endpoint) asking "may this user update or delete this document?" to build its permissions object — and that probe always identifies the document by id. Throwing there is not a refusal Payload can act on: `getDocumentPermissions` catches the error, continues with no permissions at all, and the document view falls back to "Nothing found". Every upload copied from production became unopenable in staging and local development, where 1.4.1 had opened it read-only.

The guard now reserves the descriptive 403 for requests that actually mutate (REST `POST`/`PATCH`/`PUT`/`DELETE`, which covers the admin's saves and bulk actions) and answers a plain `false` to everything else — the admin render, the `/access/:id` endpoint and local-API calls, none of which carry an HTTP method. The stored-flag logic from 1.4.5 is unchanged, so trash deletes of development-created documents keep working.

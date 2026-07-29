---
'@whatworks/payload-switch-env': patch
---

Never write Payload's `batch = -1` dev-push marker when copying into a migration-managed database.

The SQL copy flow finished with a non-interactive equivalent of Payload's `pushDevSchema`, which always upserts a `payload_migrations` row with `name = 'dev'`, `batch = -1`. On a hosted staging environment — whose schema comes from `payload migrate` in the build — that row made the next build stop on Payload's interactive _"It looks like you've run Payload in dev mode … data loss will occur"_ prompt, which a CI/Vercel build can never answer. Accepting the prompt once doesn't help: Payload never removes the row.

A target is now treated as **migration-managed** whenever Payload's own adapters would refuse to push to it (`push: false`, or `NODE_ENV=production`, or `PAYLOAD_MIGRATING=true` — the exact inverse of the gate in `connect()`). For those targets the copy restores the replica, applies pending migrations, and then stops: no schema push, no dev marker. Local development databases are unaffected and still reconcile by push exactly as before. Re-copying repairs a database that an earlier version left marked.

Also in this release:

- A source database carrying its own `batch = -1` row is refused before the destructive restore begins, rather than having the marker silently stripped — its schema isn't described by its migration history, so neither carrying the marker over nor dropping it would be truthful.
- Migration failures are no longer indistinguishable from success. Both failure modes are captured — a migration file that can't be loaded, and a migration that throws (which Payload's runner answers with `process.exit(1)`, previously killing the server mid-request) — and reported as `status: 'incomplete'` on the copy/switch endpoints. Migration completeness is verified by comparing `migrationDir` against the recorded `payload_migrations` rows.
- The copy and switch buttons now surface the endpoint's message. Refusals (`success: false`, e.g. the production schema-drift block) and incomplete copies previously produced no UI feedback at all.

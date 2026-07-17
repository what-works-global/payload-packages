---
'@whatworks/payload-redirects': minor
---

The redirects list view now shows a resolved **destination** column in place of the raw `to.type` / `to.url` field. A new `RedirectDestinationCell` (shipped from the `@whatworks/payload-redirects/rsc` export) renders an internal reference target as its resolved document path, linked to that document in the admin, and a custom-URL target as the URL, linked externally — except a regex destination that references capture groups (`$1`, `$2`, …), which is incomplete until match time and is shown as plain text.

Consumers should regenerate their admin import map (`payload generate:importmap`) so the new cell resolves. `@payloadcms/ui`, `react`, and `react-dom` are declared as optional peer dependencies (only the admin `./rsc` entry imports them; the middleware/resolver bundles do not).

The minimum supported Payload version is raised to **3.54.0** (from 3.32.0). The plugin never actually worked on the older floor: the `orderable` redirects collection relies on Payload's `_order` fractional-index handling, which mis-generated duplicate keys for a collection with `unique`/`group` fields until it was reworked, and the endpoint-secret hardening and cache-rebuild paths likewise depended on request/query behaviour that only settled in 3.54.0. This matches `@whatworks/payload-switch-env`'s floor.

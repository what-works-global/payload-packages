---
'@whatworks/payload-redirects': minor
---

Admin editing and list-view improvements for the redirects collection, plus richer destination options.

**Resolved destination column.** The list view shows a **To** column (`RedirectDestinationCell`, from the `@whatworks/payload-redirects/rsc` export) in place of the raw `to.type` / `to.url` field: internal references render as their resolved document path (linked to the doc in the admin), custom URLs link externally, and a regex destination that references capture groups (`$1`, `$2`, …) is shown as plain text since it's incomplete until match time.

**Test a redirect in place.** A **Test Redirect** button on the edit-form sidebar and a **Test Redirect** column in the list view (both from the new `@whatworks/payload-redirects/client` export) open a redirect's `From` URL in a new tab. Root-relative paths open against the admin's own origin; the action is disabled when `From` isn't a concrete URL — a regex pattern, or a `contains` / `endsWith` fragment that isn't a path.

**Destination query parameters.** A new `queryParams` array field (rows of `name` / `value`) on the `to` group is applied when the cache is built — names and values are URL-encoded automatically, a row wins over a param already on the destination with the same name, and any fragment (from **Scroll To Element** or a custom URL) is preserved after the query (`/sale` + `utm_source=nl` + `#plans` → `/sale?utm_source=nl#plans`). Revealed by **Show advanced settings** (and shown whenever a redirect already carries params). New helpers `applyQueryParams` and `normalizeQueryParams` (shared/edge-safe entry) and `validateQueryParamKey` are exported for building your own fields.

**Optional admin peer deps.** `@payloadcms/ui`, `react`, and `react-dom` are declared as optional peer dependencies — only the admin `./rsc` and `./client` entries import them; the middleware / resolver bundles do not. Consumers should regenerate their admin import map (`payload generate:importmap`) so the new cells and button resolve.

**Minimum Payload raised to 3.54.0** (from 3.32.0). The plugin never actually worked on the older floor: the `orderable` redirects collection relies on Payload's `_order` fractional-index handling, which mis-generated duplicate keys for a collection with `unique` / `group` fields until it was reworked, and the endpoint-secret hardening and cache-rebuild paths likewise depended on request/query behaviour that only settled in 3.54.0. This matches `@whatworks/payload-switch-env`'s floor.

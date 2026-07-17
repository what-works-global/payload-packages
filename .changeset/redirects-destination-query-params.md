---
'@whatworks/payload-redirects': minor
---

Redirects can now append **query parameters** to the destination, alongside the existing **Scroll To Element** fragment. A new `queryParams` array field (rows of `name` / `value`) on the `to` group is applied when the cache is built: names and values are URL-encoded automatically, a row wins over any param already on the destination with the same name, and any fragment is preserved after the query (`/sale` + `utm_source=nl` + `#plans` → `/sale?utm_source=nl#plans`). The field is revealed by **Show advanced settings** (and stays visible whenever a redirect already carries params).

New helpers are exported for building your own fields: `applyQueryParams` and `normalizeQueryParams` (from the shared/edge-safe entry) and `validateQueryParamKey` (validates a single parameter name).

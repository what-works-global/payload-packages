---
'@whatworks/payload-audit-fields': minor
---

The collection list view now shows the resolved user label for `createdBy` / `lastModifiedBy` in place of the raw relationship ID, matching the document view. A new `AuditUserCell` (shipped from the `@whatworks/payload-audit-fields/rsc` export) resolves the attributed user through `resolveUserLabel` (default: email → username → ID), links to the user document, and falls back to the raw ID when the viewing user cannot read the users collection. Because the list-cell render path has no `req`, the viewing user is recovered from the request headers so access control stays consistent with the document view and versions column.

Consumers should regenerate their admin import map (`payload generate:importmap`) so the new cell resolves.

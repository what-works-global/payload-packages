# @whatworks/payload-audit-fields

## 0.2.0

### Minor Changes

- 854b2ec: The collection list view now shows the resolved user label for `createdBy` / `lastModifiedBy` in place of the raw relationship ID, matching the document view. A new `AuditUserCell` (shipped from the `@whatworks/payload-audit-fields/rsc` export) resolves the attributed user through `resolveUserLabel` (default: email → username → ID), links to the user document, and falls back to the raw ID when the viewing user cannot read the users collection. Because the list-cell render path has no `req`, the viewing user is recovered from the request headers so access control stays consistent with the document view and versions column.

  Consumers should regenerate their admin import map (`payload generate:importmap`) so the new cell resolves.

## 0.1.1

### Patch Changes

- e84816e: Widen the `payload` / `@payloadcms/ui` / `@payloadcms/translations` peer ranges from `>=3.84.0` to `>=3.27.0`. Every API the plugins use exists at 3.27 (`formatAdminURL` in `payload/shared` is the floor); newer, version-gated behaviour degrades gracefully — trash/restore events only occur on Payload ≥ 3.49 where trash exists, and the versions view tolerates the absence of newer view props. Verified by building and running the smoke tests plus a live Payload boot (both plugins, login/create/update/delete, audit fields, status loader) against pinned 3.27.0 and 3.30.0.

## 0.1.0

### Minor Changes

- 6b746c8: Initial release. Tracks `createdBy` / `lastModifiedBy` on every collection and global by default (opt-out via `collections`/`globals` selections), supports multiple auth collections, extends into `payload-folders`/`payload-jobs` via Payload's override hooks, and replaces the versions list view with a recreation of Payload's own view that adds a per-version "Modified By" column linking to the user. Data-compatible with `@payload-bites/audit-fields`.

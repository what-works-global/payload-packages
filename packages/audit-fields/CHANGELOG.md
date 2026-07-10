# @whatworks/payload-audit-fields

## 0.1.0

### Minor Changes

- 6b746c8: Initial release. Tracks `createdBy` / `lastModifiedBy` on every collection and global by default (opt-out via `collections`/`globals` selections), supports multiple auth collections, extends into `payload-folders`/`payload-jobs` via Payload's override hooks, and replaces the versions list view with a recreation of Payload's own view that adds a per-version "Modified By" column linking to the user. Data-compatible with `@payload-bites/audit-fields`.

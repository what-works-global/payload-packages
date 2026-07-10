# @whatworks/payload-activity-log

## 0.1.0

### Minor Changes

- 91b3a37: Initial release of `@whatworks/payload-activity-log` — a chronological activity feed for Payload.

  - Logs document creates, updates, trashes, restores, and permanent deletes across all collections and globals (opt-out selection), plus user logins and logouts.
  - Stores document titles and user labels at event time so the feed shows names instead of IDs and survives deletion; list cells link to the affected document and to the version diff the change produced.
  - No full-document snapshots by default — only permanent deletes store one (configurable via `snapshot`).
  - Records changed field names on updates, skips autosaves by default, supports multiple auth collections with polymorphic actor references, custom `resolveUser`/`resolveUserLabel`/`resolveDocumentLabel` resolvers, optional retention pruning, opt-in IP address tracking (`ipAddress`), and composes with `@whatworks/payload-audit-fields`.

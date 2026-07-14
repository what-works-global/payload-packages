# @whatworks/payload-activity-log

## 0.2.0

### Minor Changes

- 3b9b983: Add opt-in request host tracking. Set `requestHost: true` to store the host each request was addressed to (`x-forwarded-host` → `host` by default) on every log entry, or pass a resolver function for full control. Mirrors the existing `ipAddress` option and is handy for attributing activity in multi-tenant / multi-domain deployments.

## 0.1.1

### Patch Changes

- e84816e: Widen the `payload` / `@payloadcms/ui` / `@payloadcms/translations` peer ranges from `>=3.84.0` to `>=3.27.0`. Every API the plugins use exists at 3.27 (`formatAdminURL` in `payload/shared` is the floor); newer, version-gated behaviour degrades gracefully — trash/restore events only occur on Payload ≥ 3.49 where trash exists, and the versions view tolerates the absence of newer view props. Verified by building and running the smoke tests plus a live Payload boot (both plugins, login/create/update/delete, audit fields, status loader) against pinned 3.27.0 and 3.30.0.

## 0.1.0

### Minor Changes

- 91b3a37: Initial release of `@whatworks/payload-activity-log` — a chronological activity feed for Payload.

  - Logs document creates, updates, trashes, restores, and permanent deletes across all collections and globals (opt-out selection), plus user logins and logouts.
  - Stores document titles and user labels at event time so the feed shows names instead of IDs and survives deletion; list cells link to the affected document and to the version diff the change produced.
  - No full-document snapshots by default — only permanent deletes store one (configurable via `snapshot`).
  - Records changed field names on updates, skips autosaves by default, supports multiple auth collections with polymorphic actor references, custom `resolveUser`/`resolveUserLabel`/`resolveDocumentLabel` resolvers, optional retention pruning, opt-in IP address tracking (`ipAddress`), and composes with `@whatworks/payload-audit-fields`.

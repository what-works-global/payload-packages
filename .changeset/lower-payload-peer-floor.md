---
'@whatworks/payload-activity-log': patch
'@whatworks/payload-audit-fields': patch
---

Widen the `payload` / `@payloadcms/ui` / `@payloadcms/translations` peer ranges from `>=3.84.0` to `>=3.27.0`. Every API the plugins use exists at 3.27 (`formatAdminURL` in `payload/shared` is the floor); newer, version-gated behaviour degrades gracefully — trash/restore events only occur on Payload ≥ 3.49 where trash exists, and the versions view tolerates the absence of newer view props. Verified by building and running the smoke tests plus a live Payload boot (both plugins, login/create/update/delete, audit fields, status loader) against pinned 3.27.0 and 3.30.0.

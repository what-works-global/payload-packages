---
'@whatworks/payload-activity-log': minor
---

Add opt-in request host tracking. Set `requestHost: true` to store the host each request was addressed to (`x-forwarded-host` → `host` by default) on every log entry, or pass a resolver function for full control. Mirrors the existing `ipAddress` option and is handy for attributing activity in multi-tenant / multi-domain deployments.

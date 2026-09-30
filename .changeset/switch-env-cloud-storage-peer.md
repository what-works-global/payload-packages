---
'@whatworks/payload-switch-env': patch
---

Drop the unused `@payloadcms/plugin-cloud-storage` peer dependency. switch-env never imports it, but the peer made package managers keep a separate top-level copy of it. That copy could stay on an old version after a Payload upgrade and hold an old `@payloadcms/ui` with it, so the upgraded `@payloadcms/*` packages each installed their own `@payloadcms/ui` and the admin crashed with `useUploadHandlers must be used within UploadHandlersProvider`.

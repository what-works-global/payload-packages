---
'@whatworks/payload-utilities': patch
---

`@payloadcms/ui` is now a peer dependency (`>=3.29.0 <4`) instead of a dependency pinned to 3.84.1. The pinned copy installed a second `@payloadcms/ui` next to your app's, so `traverseDocument` built its schema map with a different Payload version than the rest of the app. It now uses your app's `@payloadcms/ui`, which every Payload admin already installs.

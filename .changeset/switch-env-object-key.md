---
'@whatworks/payload-switch-env': major
---

feat(switch-env)!: require Payload 3.90, keep the `staging/<prefix>` layout, and fix uploads broken by 3.90

**Breaking changes**

- Requires Payload `>=3.90.0` (`payload` and every `@payloadcms/*` peer). Stay on `@whatworks/payload-switch-env@1` for older versions.
- The `payloadVersion` option is removed, along with payload version detection and every version-dependent code path. Delete `payloadVersion` from your `switchEnvPlugin()` call.
- In `switch` mode with cloud storage, or when `developmentFileStorage.collections` is not the object you pass to your storage plugin, development uploads are now nested inside the collection prefix (`public/staging/…`), not placed around it (`staging/public/…`). Payload 3.90 contains every new upload beneath the storage plugin's collection prefix, so the old placement can't be written consistently there. Documents uploaded earlier keep resolving from their stored prefix.

**Fixes for Payload 3.90**

- **Admin uploads in development cloud-storage mode.** Payload 3.90 contains each new upload beneath the collection prefix the storage plugin read when the config was built. The development prefix (`staging/public`) sat outside it, so admin client uploads were written to one key, read back from another, and rejected ("File type text/plain … is not allowed"). Each attempt also left an orphaned object in the bucket. In `copy` mode the plugin now gives the shared storage collection options the development prefix as soon as `switchEnvPlugin({...})` is called, before `buildConfig` applies the storage plugin. The storage plugin then works under `staging/public` itself, which keeps the `staging/public/…` layout. Pass the same `collections` object to your storage plugin and to `developmentFileStorage.collections`; the plugin warns on init when the storage plugin didn't pick up the prefix.
- **Admin thumbnails.** Client uploads are stored in a per-upload `_objectKey` folder, with their image sizes alongside. `adminThumbnail()` built `${basePath}/${prefix}/${filename}`, so `thumbnailURL` and admin thumbnails pointed at a missing object for every client upload, in every environment. It now includes the `_objectKey` folder.

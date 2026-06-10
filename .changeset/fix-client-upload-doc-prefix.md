---
'@whatworks/payload-switch-env': patch
---

Fix client uploads landing outside the development prefix on payload >= 3.83.0.

Since payload 3.83.0 (payload#16230) the admin form sends the doc `prefix` field value as `docPrefix` with client uploads, and a non-empty `docPrefix` overrides the collection prefix in the storage key computation. The default doc prefix is baked from the original collection prefix at config build time — before this plugin rewrites prefixes — so signed-URL uploads went to `<collection-prefix>/<file>` while the stored doc (and the generated URL) carried `<dev-prefix>/<collection-prefix>/<file>`, producing 404s on read.

The plugin now wraps the cloud storage plugin's signed-URL endpoint(s) and pins the development prefix onto `docPrefix` at request time. This covers default, user-defined, and function-generated doc prefixes, and is a no-op in production and on payload < 3.83.0 (which ignores `docPrefix`).

Because `docPrefix` overrides the collection prefix on >= 3.83.0, `developmentFileStorage.collections` no longer has to be the same object reference passed to the cloud storage plugin on those versions — sharing the object is still required on older payloads and remains the safe default.

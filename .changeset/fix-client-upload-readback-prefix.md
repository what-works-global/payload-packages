---
'@whatworks/payload-switch-env': patch
---

Fix client upload validation failing in cloud-storage mode on Payload >= 3.83.0 (e.g. `File type text/plain (from extension zip) is not allowed.`).

Payload validates client uploads by reading the file back from cloud storage. Since Payload 3.83.0 (#16230) `clientUploadContext.prefix` carries the doc prefix instead of the collection prefix, and a non-empty doc prefix replaces the collection prefix in the storage key computation. Joining the development prefix onto it therefore resolved a key missing the collection prefix (`staging/<file>` instead of `staging/private/<file>`), the read-back found no file, and mime type validation rejected the upload.

The injected upload handler now mirrors the signed-URL key computation on >= 3.83.0 (pin an empty doc prefix to the rewritten collection prefix, leave a non-empty one untouched), gated via the existing `payloadVersion` argument so the previous behavior is kept for older Payload versions. Make sure `payloadVersion` matches your installed Payload version.

---
'@whatworks/payload-switch-env': patch
---

Fix file-system mode serving files from cloud storage instead of the local disk in development.

In `file-system` mode the plugin wraps the cloud storage plugin's static handler so that, in the development environment, files that exist in the collection's static directory are served from disk instead of cloud storage. The wrapper was being pushed onto a spread copy of `collection.upload.handlers` that was never assigned back, so the unwrapped cloud storage handler always ran. For collections served through payload's `/api/<collection>/file/<filename>` endpoint (i.e. without `disablePayloadAccessControl`), requests for files created during development went to cloud storage — where the file never existed — and returned a 500 (S3 responds 403 for missing keys without `s3:ListBucket`).

The wrapper is now installed on the live handlers array, so development requests fall through to payload's local file serving when the file exists on disk.

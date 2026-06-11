---
'@whatworks/payload-switch-env': patch
---

Fix duplicate upload filenames failing with "The following field is invalid: filename" in development cloud-storage mode.

Payload's duplicate-filename check (`generateFileData` → `getSafeFileName`) runs before any `beforeChange` hook and filters its lookup by the incoming `data.prefix`. The plugin used to apply the development prefix in a `beforeChange` hook — after that check — so the lookup compared the admin form's baked collection prefix (e.g. `private`) against documents stored under the development prefix (e.g. `staging/private`), found nothing, and the insert tripped the collection-wide unique `filename` index instead of deduplicating to `file-1.zip`.

The `createdDuringDevelopment`/`developmentStorageMode` flags and the prefix rewrite are now consolidated into a single `beforeOperation` hook, which runs before the operation starts. Payload's own dedup then sees the same prefix new documents are stored under and increments duplicates normally. This also removes the dead `modifyPrefix` export and a latent bug where a partial Local API update of a development document without `prefix` in its data would overwrite the stored prefix with the bare development prefix.

Duplicates against documents copied from production (which keep their original prefix) remain subject to the collection-wide unique index; the README now documents scoping uniqueness with `upload.filenameCompoundIndex: ['filename', 'prefix']` for that case.

# @whatworks/payload-utilities

## 3.0.1

### Patch Changes

- 0e6f5a4: `@payloadcms/ui` is now a peer dependency (`>=3.29.0 <4`) instead of a dependency pinned to 3.84.1. The pinned copy installed a second `@payloadcms/ui` next to your app's, so `traverseDocument` built its schema map with a different Payload version than the rest of the app. It now uses your app's `@payloadcms/ui`, which every Payload admin already installs.

## 3.0.0

### Major Changes

- d17dc89: Overhaul build, test, and release pipeline. Packages are now built with [tsdown](https://github.com/rolldown/tsdown) (rolldown-based) instead of swc, and emit a single ESM output with sourcemaps and bundled `.d.ts` files. Module resolution, bundled vs externalized deps, and tree-shaking behaviour may differ from prior releases — verify your build against the new output.

  Additionally, `@whatworks/payload-utilities` raises its peer-dep range for `payload`, `@payloadcms/richtext-lexical`, and `@payloadcms/translations` from `>=3.0.2` to `>=3.29.0`. The new floor reflects what the source actually requires: `@payloadcms/ui/utilities/getSchemaMap` was introduced in 3.2.0 and `@payloadcms/richtext-lexical/plaintext` was introduced in 3.29.0 — the package never worked on versions below the new floor.

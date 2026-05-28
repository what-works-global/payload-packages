# @whatworks/payload-select-search-field

## 3.1.0

### Minor Changes

- 10f1376: Add `relation` arg to `selectSearchField`. When provided, the field is stored as a Payload `relationship` instead of a `text` field, so list-view cells render the related document's title (via the default relationship cell) and existing data from a prior `relationship` field stays compatible.

  Honor `readOnly` in the client component so field-level access rules (e.g. `access: { update: () => false }`) actually disable the input.

## 3.0.2

### Patch Changes

- 2f27d35: Add 'use client' to client exports

## 3.0.1

### Patch Changes

- c67e83b: Compile JSX with the React automatic runtime

## 3.0.0

### Major Changes

- d17dc89: Overhaul build, test, and release pipeline. Packages are now built with [tsdown](https://github.com/rolldown/tsdown) (rolldown-based) instead of swc, and emit a single ESM output with sourcemaps and bundled `.d.ts` files. Module resolution, bundled vs externalized deps, and tree-shaking behaviour may differ from prior releases — verify your build against the new output.

  Additionally, `@whatworks/payload-utilities` raises its peer-dep range for `payload`, `@payloadcms/richtext-lexical`, and `@payloadcms/translations` from `>=3.0.2` to `>=3.29.0`. The new floor reflects what the source actually requires: `@payloadcms/ui/utilities/getSchemaMap` was introduced in 3.2.0 and `@payloadcms/richtext-lexical/plaintext` was introduced in 3.29.0 — the package never worked on versions below the new floor.

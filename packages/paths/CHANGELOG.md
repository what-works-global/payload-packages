# @whatworks/payload-paths

## 0.2.0

### Minor Changes

- 4ae402f: Initial release: stored, queryable document paths for Payload page trees. A computed `path` field with per-path (and per-tenant) uniqueness enforced at publish time, hierarchy cascades for nested-docs / bare `parent` / flat collections, prefix-free storage with a virtual `url`, an `onInit` backfill plus `backfillPaths`/`verifyPathIntegrity`, and a framework-agnostic resolver (`@whatworks/payload-paths/resolver`) with a Next.js layer (`@whatworks/payload-paths/next`) supporting Next 15 and 16.

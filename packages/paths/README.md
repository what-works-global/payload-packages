# @whatworks/payload-paths

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-paths" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Stored, queryable document paths for [Payload](https://payloadcms.com) page trees.

Instead of a globally-unique `slug` and rebuilding each document's URL at request time, this plugin stores a computed, indexed `path` on every document and resolves a URL with a single indexed query. That one change removes the unique-slug constraint — `/about/contact` and `/contact` can finally coexist — and comes with the safety rails a stored path needs: publish-time uniqueness, hierarchy cascades, drift repair, and a framework-agnostic resolver.

- **Duplicate slugs at different levels** — uniqueness moves from `slug` to the full `path`, enforced per document (and per tenant, if you scope it). Two siblings can't silently claim the same URL; a nested page and a root page can share a slug.
- **Works with or without nested-docs** — auto-detects its strategy: `@payloadcms/plugin-nested-docs` (it owns the cascade), a bare `parent` relationship (the plugin runs its own cascade), or flat. Paths are computed from the parent chain, never from parsed breadcrumb strings.
- **Multi-tenant** — scope the path space by a `tenant` (or any) field; uniqueness and resolution are per scope.
- **Prefix without rewrites** — paths are stored prefix-free; a `/blog` prefix is applied at the edges (a virtual `url` field on read, the resolver strips it on the way in). Changing a prefix is pure config — no stored data to migrate.
- **Multiple collections on one route** — compose per-collection resolvers into a chain (`pages` + `posts` from one `[[...slug]]`), ranked by array order for segments and by prefix specificity for pathnames.
- **Pluggable routing policy** — the `/page/N` pagination scheme is the default, not the law: rename the segment, drop the page-1 redirect, swap in your own scheme, or turn pagination off — per resolver.
- **Publish-time integrity** — drafts (including autosave) never block on collisions; the check fires when a document would go public, with a friendly error on the slug field. Re-parenting under a descendant, cycles, and subtree-move collisions are all caught before the save.
- **Draft-aware, correctly** — the Next resolver reads `draftMode()` itself and always passes `draft` explicitly, so it needs nothing from a draft-aware `getPayload` wrapper and never double-filters. Pass a plain instance.
- **Self-healing** — an `onInit` pass repairs documents with a null `path` (created before install, imported directly, or left by a bypassed hook); `backfillPaths`, `verifyPathIntegrity`, and `checkPathsAdoption` are exposed for scripts and CI.
- **Framework-agnostic serving** — a WHATWG-only resolver returns `found` / `not-found` / `redirect` as values for any framework; a thin `@whatworks/payload-paths/next` layer adds `draftMode`, `notFound()`, `redirect()`, `generateStaticParams`, and cache wiring for Next 15 and 16.
- **Pluggable cache** — no-op by default (always correct), in-memory, the Next.js `unstable_cache`/`revalidateTag` adapter, or your own.

## Why not just a unique slug?

The common Payload setup makes `slug` globally unique and, at request time, rebuilds each document's path (often by parsing `breadcrumbs[last].url`) to match the URL — then loads the document by its leaf slug. That only works because slugs are unique, so `/about/contact` and `/contact` cannot both exist, and a forgotten `select: { breadcrumbs: true }` silently yields a wrong path. Storing the path instead makes resolution a single indexed `path` lookup, lets the database enforce real URL uniqueness, and turns "did you select breadcrumbs?" into a loud error.

## Install

```sh
pnpm add @whatworks/payload-paths
```

`next` and `react` are optional peer dependencies — needed only for the `@whatworks/payload-paths/next` entry. The core plugin, resolver, and cache adapters import neither. Requires `payload >= 3.54`.

## Entry points

| Import                                 | Contains                                                                                                            | Pulls in `next`?        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `@whatworks/payload-paths`             | The plugin (`pathsPlugin`), config helpers, field helpers, and every script utility (backfill, adoption, integrity) | No                      |
| `@whatworks/payload-paths/resolver`    | The framework-agnostic resolver (`createPathsResolver`, `createResolverChain`) and pagination primitives            | No                      |
| `@whatworks/payload-paths/cache`       | Framework-free cache adapters (`noopPathsCache`, `memoryPathsCache`)                                                | No                      |
| `@whatworks/payload-paths/next/plugin` | Config-side Next sugar for `payload.config.ts`: `nextPathsPlugin`, `nextPathsCache`, `revalidatePathsOnChange`      | Yes (`next/cache` only) |
| `@whatworks/payload-paths/next`        | Request-time Next sugar: `createPathResolver`, `createMultiPathResolver`, `createGenerateStaticParams`              | Yes (incl. navigation)  |

> **Why the plugin has its own entry.** A Payload config is imported by the REST route handlers, which Next bundles as `app-route` route modules. `next/navigation` (used by the request-time resolver in `/next`) resolves an `app-router-context` that Next only vendors for `app-page`/`pages` — not `app-route` — so importing anything from `/next` into `payload.config.ts` crashes the API with `MODULE_UNPARSABLE`. Import `nextPathsPlugin` from `/next/plugin` (which only touches `next/cache`) in the config; import the resolver from `/next` in your pages. The config helpers are still re-exported from `/next` for back-compat, but don't import them there from a Payload config.

## Quick start

Define the shared config once, in a module imported by **both** your Payload config and your route handler, so prefixes and home slugs can never drift:

```ts
// paths.config.ts
import { definePathsConfig } from '@whatworks/payload-paths'

export const pathsConfig = definePathsConfig({
  collections: {
    pages: {}, // nested-docs or parent auto-detected; served at the root
    posts: { prefix: '/blog' }, // flat collection under /blog
  },
})
```

```ts
// payload.config.ts
import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { createNestedDocsGenerateURL } from '@whatworks/payload-paths'
import { nextPathsPlugin } from '@whatworks/payload-paths/next/plugin'
import { pathsConfig } from './paths.config'

export default buildConfig({
  // ...
  plugins: [
    nestedDocsPlugin({
      collections: ['pages'],
      // Keep the admin breadcrumb URLs matching the stored paths:
      generateURL: createNestedDocsGenerateURL({ homeSlug: 'home' }),
    }),
    // MUST come after nestedDocsPlugin so the breadcrumbs field exists.
    nextPathsPlugin(pathsConfig),
  ],
})
```

```tsx
// app/(frontend)/[[...slug]]/page.tsx
import config from '@payload-config'
import { createGenerateStaticParams, createPathResolver } from '@whatworks/payload-paths/next'
import { getPayload } from 'payload'
import { pathsConfig } from '../../../paths.config'

const getPayloadInstance = () => getPayload({ config })

const resolvePage = createPathResolver({
  collection: 'pages',
  config: pathsConfig,
  getPayload: getPayloadInstance,
})

export const generateStaticParams = createGenerateStaticParams({
  collection: 'pages',
  config: pathsConfig,
  getPayload: getPayloadInstance,
})

export default async function Page({ params }: PageProps<'/[[...slug]]'>) {
  // Single indexed `path` lookup; notFound()/redirect() handled internally.
  const { doc, pageNumber } = await resolvePage({ params })
  // render doc…
}
```

That's it: `createPathResolver` runs a single indexed `path` lookup (deduped per request with React `cache`, draft-aware via `draftMode()`), handles `/page/N` pagination, and calls `notFound()` / `redirect()` for you. It returns `{ collection, doc, draft, pageNumber?, path, url }`.

> **Typing the doc.** `createPathResolver<Page>({ … })` types `doc` as your generated `Page`. To key the type off the collection slug automatically, use Payload's `DataFromCollectionSlug<'pages'>` as the type argument.

Not on Next.js? Use `createPathsResolver` from `@whatworks/payload-paths/resolver` and `pathsPlugin` from the core entry — [see below](#framework-agnostic-usage).

## How resolution works

For each request the resolver:

1. **Normalizes** the input — either a `[[...slug]]` param (segments) or an already-built `pathname` — stripping the collection prefix and any trailing slash.
2. **Tries an exact match** on the stored `path` (a single indexed query). A real document at `/docs/page/2` therefore always beats pagination parsing.
3. **On a miss, applies the pagination strategy** (default `/page/N`). `/…/page/1` becomes a `redirect` to the canonical bare path; `/…/page/2+` resolves the base document and returns its `pageNumber`; anything else is `not-found`.

Public reads filter `_status: published` and are served through the cache; **draft reads** (preview) bypass the cache and read the latest version. The Next layer detects draft mode from `draftMode()` — you always pass a plain Payload instance, never a draft-aware wrapper.

## Strategies

The `strategy` is auto-detected per collection, or set explicitly:

| Strategy      | Hierarchy                | Cascade owner          | When                                                               |
| ------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------ |
| `flat`        | none (`/slug`)           | —                      | no parent field                                                    |
| `nested-docs` | `parent` + `breadcrumbs` | the nested-docs plugin | nested-docs manages the collection                                 |
| `parent`      | `parent` only            | this plugin            | nesting without nested-docs (`createParentField` builds the field) |

For the `parent` strategy without nested-docs, add the self-referencing field with the helper:

```ts
import { createParentField } from '@whatworks/payload-paths'

const Docs: CollectionConfig = {
  slug: 'docs',
  fields: [
    /* … */
    createParentField('docs'), // indexed relationship, blocks self-parent
  ],
}
```

## Configuration

Author the shared config with `definePathsConfig` (for inference), then spread it into `pathsPlugin`/`nextPathsPlugin` and every resolver.

### Per-collection options

| Option                | Default         | Purpose                                                                                       |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `prefix`              | `''`            | URL prefix (`'/blog'`). **Not stored** — applied at the edges, so changing it is pure config. |
| `strategy`            | `'auto'`        | `'auto'` \| `'flat'` \| `'nested-docs'` \| `'parent'`.                                        |
| `homeSlug`            | inherits plugin | Slug of the document that becomes the root (`path: '/'`); `false` to disable.                 |
| `slugField`           | `'slug'`        | Field the path segments are built from.                                                       |
| `parentField`         | `'parent'`      | Self-referencing relationship for `nested-docs`/`parent`.                                     |
| `breadcrumbsField`    | `'breadcrumbs'` | Field name used only for `'auto'` strategy detection.                                         |
| `scopeField`          | —               | Multi-tenant partition field; uniqueness and resolution become per-scope.                     |
| `urlField`            | `'url'`         | Name of the injected virtual URL field, or `false` to skip it.                                |
| `duplicateSlugSuffix` | `'-copy'`       | Suffix appended on document duplicate so the copy gets its own path; `false` to leave slugs.  |

### Plugin options

Everything above, plus:

| Option                     | Default  | Purpose                                                                                             |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `homeSlug`                 | `'home'` | Default `homeSlug` for all collections.                                                             |
| `cache`                    | no-op    | Cache invalidated on path changes. `nextPathsPlugin` defaults this to the `unstable_cache` adapter. |
| `onPathChanged`            | —        | Handler (or array) fired after any path change, including cascaded descendants.                     |
| `backfill`                 | `'fix'`  | Boot-time null-path repair: `'fix'` \| `'check'` \| `'off'`. A healthy collection costs one count.  |
| `backfillLimit`            | `1000`   | Max documents repaired per collection per boot.                                                     |
| `maxCascadePreflight`      | `500`    | Subtrees larger than this skip the pre-save collision pre-flight (with a warning).                  |
| `dropStaleSlugUniqueIndex` | `true`   | On Mongo, drop a legacy unique slug index the config no longer declares. No-op on SQL.              |
| `disabled`                 | `false`  | Register fields/indexes but skip hooks and backfill (keeps the schema stable for migrations).       |

## Pagination

The `/page/N` scheme is the default `PaginationStrategy`, applied by the resolver only after an exact-path lookup misses. Configure or replace it per resolver via the `pagination` option:

```ts
import { pagePathPagination } from '@whatworks/payload-paths/next'

createPathResolver({
  collection: 'posts',
  config: pathsConfig,
  getPayload,
  // Rename the keyword (`/blog/p/2`), cap the page number, and serve page 1
  // in place (no redirect to the canonical path):
  pagination: pagePathPagination({ segment: 'p', maxPageNumber: 500, redirectFirstPage: false }),
})
```

- `pagination: false` — disable pagination entirely; a `/page/N` URL then only resolves if a real document is stored at that literal path.
- **Custom scheme** — pass any `PaginationStrategy`, i.e. `{ parse: (segments) => PaginatedSlugSegments }`. Return `{ documentSegments: segments }` (no `pageNumber`) to decline and let the resolver report not-found; return `pageNumber`, or `redirectToDocumentPath: true`, or `invalidPage: true` to shape the outcome.

For building pagination **links**, the default scheme is exposed as pure functions: `getPathnameWithPageNumber('/guides', 3)` → `/guides/page/3`, and `getPathnameWithoutPageNumber('/guides/page/3')` → `/guides`. (`parsePaginatedSlugSegments` is the same default frozen as a standalone parser.) These use the built-in `/page/N` scheme regardless of a custom strategy — mirror your own scheme in link building if you change it.

## Multiple collections on one route

To serve more than one collection from a single route — e.g. `pages` and `posts` both under `[[...slug]]` — compose them with the multi-collection helpers. The resolved `collection` tells the page which renderer to use.

```tsx
// app/(frontend)/[[...slug]]/page.tsx
import {
  createMultiGenerateStaticParams,
  createMultiPathResolver,
} from '@whatworks/payload-paths/next'

const resolvePage = createMultiPathResolver({
  collections: ['pages', 'posts'], // priority order (see below)
  config: pathsConfig,
  getPayload: getPayloadInstance,
})

export const generateStaticParams = createMultiGenerateStaticParams({
  collections: ['pages', 'posts'],
  config: pathsConfig,
  getPayload: getPayloadInstance,
})

export default async function Page({ params }: PageProps<'/[[...slug]]'>) {
  const { collection, doc } = await resolvePage({ params })
  return collection === 'posts' ? <Post doc={doc} /> : <PageView doc={doc} />
}
```

Ordering rules (implemented by `createResolverChain`, which both helpers use and which you can call directly for non-Next apps):

- **By segments** (a catch-all param): resolvers are tried in the given order, first `found`/`redirect` wins. List the higher-priority collection first.
- **By pathname**: only resolvers whose `prefix` the pathname falls under are tried, most-specific (longest) prefix first — so `/blog/hello` resolves against the `/blog` collection before a root collection, the way a router ranks a specific route above a catch-all.

`createResolverChain` returns a `PathsResolver` itself, so chains compose: `listPaths` is the deduped union of the children's paths, and `prefix` is their shared prefix (or `''` when they differ).

### Prefixed collection on its own route

Alternatively, give a prefixed collection a dedicated folder and let the folder eat the prefix — stored paths and route params stay prefix-free:

```tsx
// app/(frontend)/blog/[[...slug]]/page.tsx
const resolvePosts = createPathResolver({ collection: 'posts', config: pathsConfig, getPayload })
```

## Static params

`createGenerateStaticParams` (and the multi-collection variant) is driven by the stored paths; emitted segments never include the prefix — the route folder supplies it.

| Option      | Default                | Purpose                                                                                                            |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `limit`     | all                    | Cap the number of paths prerendered; `0` disables prerendering (everything renders on demand).                     |
| `paramName` | `'slug'`               | The bracket folder name — `'path'` for `[[...path]]`. Must match the folder **and** the resolver.                  |
| `routeType` | `'optional-catch-all'` | `'optional-catch-all'` (`[[...slug]]`, root emitted as `[]`), `'catch-all'` (`[...slug]`), `'dynamic'` (`[slug]`). |
| `scope`     | all (deduped)          | Prerender one tenant's paths for a scoped collection.                                                              |
| `where`     | —                      | Extra filter **AND-merged** with the built-in constraints (published, non-null path, scope).                       |

`where` can only _narrow_ the set — drafts and null-path documents are never prerendered — so `{ hideFromPrerender: { not_equals: true } }` excludes flagged pages from the build while they still render on demand under `dynamicParams`.

## Caching

Lookups are single indexed queries, so caching is optional. Three adapters ship, plus the `PathsCache` contract (`wrap` + `invalidate`) if you want your own:

- **`noopPathsCache()`** (core default) — no caching, always correct, works anywhere.
- **`memoryPathsCache({ maxEntries, ttlMs })`** — in-process, tag-invalidated. Correct only when the writer (hooks) and reader (routes) share one long-lived process **and** the same instance — tests, a single self-hosted server.
- **`nextPathsCache()`** (`@whatworks/payload-paths/next/plugin`, also re-exported from `/next`) — backed by `unstable_cache`/`revalidateTag`; the default for `nextPathsPlugin` and `createPathResolver`. Works on Next 15 & 16, self-hosted and on Vercel.

The plugin invalidates by tag on every path change; the Next plugin additionally `revalidatePath`s the affected URLs (full-route/ISR cache) via the built-in `revalidatePathsOnChange` handler.

## Framework-agnostic usage

Outside Next.js, use `pathsPlugin` from the core entry and `createPathsResolver` from `@whatworks/payload-paths/resolver`. No `next` import; `not-found` and `redirect` come back as **values** you map onto your own framework's primitives:

```ts
import { createPathsResolver } from '@whatworks/payload-paths/resolver'

const resolver = createPathsResolver({ collection: 'pages', config: pathsConfig, getPayload })

const result = await resolver.resolve({ pathname: url.pathname })
switch (result.type) {
  case 'found':
    return render(result.doc, { pageNumber: result.pageNumber, url: result.url })
  case 'redirect':
    return Response.redirect(result.redirectTo, 308)
  case 'not-found':
    return new Response('Not found', { status: 404 })
}
```

`resolve` accepts either `segments` (from a catch-all param) or a full `pathname`, plus optional `draft` and `scope`. `listPaths({ limit?, scope?, where? })` returns the collection's stored paths for your own static-generation step.

## Adoption & migration

Moving a collection off unique-slug + request-time path building:

1. **Add the plugin.** Leave your `slug` field in place; drop its `unique: true`, keep `index: true`.
2. **Check readiness** with `checkPathsAdoption` (below) — resolve any missing slugs and collisions it reports first.
3. **Boot once.** The `onInit` pass drops the stale unique slug index (Mongo), builds the new `path` indexes, and backfills every existing document's `path`. On SQL, generate/run the Drizzle migration for the dropped constraint as usual.
4. **Swap the request path.** Replace your `ensureDocumentExists`/`getPath` logic with `createPathResolver`.

### Readiness check

`checkPathsAdoption(payload, { legacyUrlFor })` does one read-only pass and reports, per collection: documents with no slug (unroutable), documents whose `path` is still null (need backfilling), **published path collisions**, stale unique indexes the plugin will drop, and — when you supply `legacyUrlFor` — every document whose public URL _changes_ under the new scheme, so you can create redirects before old links break (the backfill writes paths silently and fires no `onPathChanged`).

```ts
// scripts/check-paths.ts — run with `payload run`
import { checkPathsAdoption } from '@whatworks/payload-paths'

const report = await checkPathsAdoption(payload, {
  legacyUrlFor: (doc) => oldUrlForDoc(doc), // omit to skip URL-change detection
})
if (!report.ok) process.exit(1)
```

`findPathCollisions(payload)` returns just the collision groups if that's all you need.

### Integrity & backfill

- `backfillPaths(payload, { mode, limit, collections })` — repair null paths from a script (`mode: 'check'` to only count). Writes go through the database adapter, so no hooks, versions, or revalidation storms fire.
- `verifyPathIntegrity(payload, { fix })` — recompute every path and report (or repair) drift from bypassed hooks, direct DB edits, or failed cascades. Handy in CI or after a bulk import.
- `reconcileSlugIndexes` / `findStaleSlugUniqueIndexes` — the Mongo index reconciliation the plugin runs on boot, exposed for manual use.

## Helpers

From the core entry:

- `getDocPath(doc)` / `getDocUrl(doc, { prefix })` — typed accessors for a document's stored path/URL; they **throw** if `path` wasn't selected (a loud error instead of a silently-wrong URL).
- `createNestedDocsGenerateURL({ homeSlug, prefix })` — a `generateURL` for nested-docs that mirrors this package's path semantics, so admin breadcrumb URLs match the real stored paths.
- Path primitives: `composeUrl`, `stripPrefix`, `normalizePrefix`, `segmentsToPath`, `pathToSegments`, `appendSegment`, `collectionTag`, `pathTag`.

## Multi-tenant

Set `scopeField` on a collection (typically a `tenant` relationship). Uniqueness is enforced per scope, so two tenants can both own `/about`; the resolver then requires a `scope` argument to disambiguate, and `listPaths`/`generateStaticParams` accept a `scope` (or return every tenant's paths deduped).

## License

MIT

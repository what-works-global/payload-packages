# @whatworks/payload-algolia-search

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Algolia Search" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Algolia search sync for Payload with defaults that hold up in production: draft-aware indexing, a best-effort text extractor that turns any collection into lean search records with **zero per-collection code**, admin reindex buttons, and index settings managed as code.

- **Best-effort records by default.** The plugin walks each collection's field config alongside the document and compresses every `text`, `textarea`, and `richText` value — through tabs, groups, rows, collapsibles, arrays, and blocks — into a single `content` attribute, in document order. Add a block with a text field and it's searchable the moment an editor saves. `title`, `path`, and `breadcrumbs` come along automatically.
- **Draft- and autosave-aware.** First drafts are never indexed, autosaves on top of a published doc don't overwrite the published record, unpublishing/trashing/deleting removes the record. Safe with `autosave` intervals in the hundreds of milliseconds.
- **Reindex from the admin.** An icon in the admin header opens a modal to rebuild the whole index or a single collection, plus an access-controlled endpoint and a programmatic `runAlgoliaReindex(payload)` for scripts and cron. Full reindexes are **atomic** (`replaceAllObjects`) — search keeps working mid-rebuild and stale records are pruned.
- **Index settings live in code.** `searchableAttributes`, snippeting, and faceting are pushed to Algolia on every reindex, so relevance config is reviewable and reproducible instead of hand-edited in the dashboard.
- **Headless frontend search.** A `/react` entry ships `useAlgoliaSearch` (debounced search-as-you-type, typed to the record shape), `useHitCursor` (keyboard navigation), and dependency-free `<Highlight>`/`<Snippet>` components — a complete quick-search UI without `react-instantsearch`, with zero styling imposed.
- **Serverless-safe.** Algolia writes are awaited inside hooks by default, so they aren't frozen when the response is sent.

## Installation

```sh
pnpm add @whatworks/payload-algolia-search
```

Requires Payload **3.39.0+** — earlier versions don't pass the request to admin header actions,
so the reindex icon's access gate would silently hide it for everyone.

## Usage

```ts
import { algoliaSearchPlugin } from '@whatworks/payload-algolia-search'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    algoliaSearchPlugin({
      algolia: {
        appId: process.env.ALGOLIA_APP_ID || '',
        apiKey: process.env.ALGOLIA_ADMIN_API_KEY || '', // admin key — server-side only
        index: process.env.ALGOLIA_INDEX || '',
      },
      collections: {
        pages: true,
        news: true,
      },
      getPath: ({ collection, doc }) => getPath(collection.slug, doc),
    }),
  ],
})
```

Then regenerate the import map so the admin panel can resolve the reindex header action:

```sh
payload generate:importmap
```

Missing credentials don't crash the boot: the plugin logs a warning and pauses sync, while hooks, endpoint, and admin components stay registered so the generated import map is identical across environments.

## The record shape

Every document becomes one lean, text-only record:

```jsonc
{
  "objectID": "news:6a45d3f153222a49f8454d1f", // <collection>:<id> — collision-proof across collections
  "collection": "news",
  "title": "Weather info",
  "path": "/news/weather-info",
  "breadcrumbs": ["Learn More", "Weather info"], // only when the doc has a trail
  "content": "…all indexable text, compressed, in document order…",
}
```

- `title` — the collection's `useAsTitle` field (falls back to `doc.title`).
- `path` — your `getPath` result, falling back to the **last breadcrumb's `url`** (nested-docs stores the full path there).
- `breadcrumbs` — nested-docs labels, only when there's more than one (ancestors + own title).
- `content` — the best-effort extraction, capped at `contentLimit` (default 4000 chars) to stay well under Algolia's record size limit.

The matching default index settings (pushed on every reindex):

```ts
{
  searchableAttributes: ['title', 'breadcrumbs', 'content'], // order = ranking priority
  attributesToHighlight: ['title', 'breadcrumbs'],
  attributesToSnippet: ['content:20'],
  attributesForFaceting: ['filterOnly(collection)'],
  snippetEllipsisText: '…',
}
```

With `react-instantsearch` this gives you title highlighting and a match-centred `content` excerpt (`<Snippet attribute="content" hit={hit} />`) with no extra work.

## Searching from the frontend

For the common quick-search case you don't need `react-instantsearch` at all — the `/react` entry is a headless layer typed to the record shape above, built on the Algolia lite client the package already depends on:

```tsx
'use client'

import {
  Highlight,
  Snippet,
  useAlgoliaSearch,
  useHitCursor,
} from '@whatworks/payload-algolia-search/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export const Search: React.FC = () => {
  const router = useRouter()

  const { query, setQuery, hits } = useAlgoliaSearch({
    appId: process.env.NEXT_PUBLIC_ALGOLIA_APP_ID ?? '',
    indexName: process.env.NEXT_PUBLIC_ALGOLIA_INDEX ?? '',
    searchApiKey: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_KEY ?? '', // search-only key — never the admin key
  })

  const { activeItemRef, cursor, onKeyDown, setCursor } = useHitCursor(hits, {
    onSelect: (hit) => hit.path && router.push(hit.path),
  })

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      {hits.map((hit) => (
        <Link
          data-active={hit.objectID === cursor || undefined}
          href={hit.path ?? ''}
          key={hit.objectID}
          onMouseEnter={() => setCursor(hit.objectID)}
          ref={hit.objectID === cursor ? activeItemRef : undefined}
        >
          <Highlight attribute="title" hit={hit} />
          {hit.breadcrumbs && <div>{hit.breadcrumbs.join(' / ')}</div>}
          <Snippet attribute="content" hit={hit} />
        </Link>
      ))}
    </div>
  )
}
```

- **`useAlgoliaSearch`** — debounced search-as-you-type: typed hits, out-of-order responses dropped, no request for an empty query. Options: `filters` (e.g. `'collection:news'`), `hitsPerPage`, `debounceMs`, `enabled` (pause while a modal is closed), and raw `searchParams`. Extra attributes added by a `record` transform are typed via the generic: `useAlgoliaSearch<SearchHit & { section: string }>({ … })`.
- **`useHitCursor`** — wrap-around ArrowUp/ArrowDown keyboard cursor, Enter-to-select, and an `activeItemRef` that keeps the active hit scrolled into view (attach it to the active element only, as above).
- **`<Highlight>` / `<Snippet>`** — render `_highlightResult`/`_snippetResult` as React nodes, matches wrapped in `<mark>` — no `dangerouslySetInnerHTML`. Style via `className`/`highlightedTag`; array attributes like `breadcrumbs` are joined with `separator`. Snippeting `content` works out of the box because the plugin's default index settings request it.

Everything is unstyled — the components render a single `<span>` and you own all surrounding markup. If you need facets, pagination, or Algolia Insights, reach for `react-instantsearch` instead; the records and index settings work with it as-is.

## Controlling what gets indexed

**Global and per-collection exclude lists.** By default these field names are skipped at any depth: `slug`, `meta` (the SEO plugin's group), `metadata`, `breadcrumbs`, `filename`, `mimeType`, `url`, `thumbnailURL`, `apiKey` — plus each collection's `useAsTitle` field, which is indexed separately as `title`. Entries match a field name at any depth (`'internalNotes'`) or a dot-path from the document root (`'hero.eyebrow'`).

```ts
import { algoliaSearchPlugin, defaultExcludeFields } from '@whatworks/payload-algolia-search'

algoliaSearchPlugin({
  // ...
  excludeFields: [...defaultExcludeFields, 'legalDisclaimer'], // global (replaces the default list)
  collections: {
    pages: true,
    news: {
      excludeFields: ['slug', 'excerpt'], // replaces the effective list for news only
    },
  },
})
```

**Field-level flags beat every list.** On any field:

```ts
{
  name: 'internalNotes',
  type: 'textarea',
  custom: { algoliaSearch: false }, // never indexed
},
{
  name: 'region',
  type: 'select', // non-text types are skipped by default…
  custom: { algoliaSearch: true }, // …unless opted in (value is stringified)
  options: [...],
}
```

**Per-collection record shaping.** The `record` transform receives the default record and the doc — typed from your generated Payload types for that collection. Return `undefined` to keep the default, a record to index (spread `defaultRecord` to extend), or `null` to keep the doc out of the index entirely — existing records are removed, so a `hideFromSearch` checkbox works retroactively:

```ts
collections: {
  pages: {
    record: ({ defaultRecord, doc }) => {
      if (doc.hideFromSearch) return null
      return { ...defaultRecord, section: doc.section }
    },
  },
},
```

**Rich text.** Lexical states go through the official `convertLexicalToPlaintext` when `@payloadcms/richtext-lexical` is installed (it's an optional peer). Pass `richTextConverters` to teach it custom nodes (e.g. blocks inside rich text), or replace extraction entirely with `richTextToText: (value) => string`. Without the package, a dependency-free extractor collects text nodes from Lexical and Slate states alike, including stringified ones.

## Reindexing

- **Admin header action** — an icon next to the other header controls opens the reindex modal: rebuild everything atomically, reindex one collection at a time, and see per-collection record counts as runs finish. Hide it for everyone with `reindex.button: false`.
- **Endpoint** — `POST /api/algolia-search/reindex` (all collections, atomic) or `POST /api/algolia-search/reindex?collection=pages`. Default access: any authenticated user; override with `reindex.access`, which both guards the endpoint and decides whether a given user sees the header icon.
- **Programmatic** — from a script, migration, or cron job:

  ```ts
  import { runAlgoliaReindex } from '@whatworks/payload-algolia-search'

  const result = await runAlgoliaReindex(payload) // or (payload, { collection: 'pages' })
  // { indexed: { pages: 42, news: 128 }, mode: 'all', total: 170 }
  ```

Only published documents are fetched for drafts-enabled collections; trashed documents are skipped.

## All options

```ts
algoliaSearchPlugin({
  // appId / apiKey / index may be undefined (e.g. straight off process.env) —
  // sync pauses with a warning until they're set
  algolia: { appId, apiKey, index, clientOptions? },

  collections: {
    pages: true,  // defaults
    drafts: false, // same as omitting — handy for conditional config
    news: {
      excludeFields?: string[],       // replace the effective exclude list
      contentLimit?: number,          // per-collection content cap
      getPath?: ({ collection, doc, req }) => string | null | undefined, // override the global getPath
      record?: ({ collection, doc, req, defaultRecord }) => record | null | undefined,
      // ^ doc is typed from your generated Payload types in both callbacks
    },
  },

  getPath?: ({ collection, doc, req }) => string | null | undefined,
  excludeFields?: string[],           // replace defaultExcludeFields
  contentLimit?: number,              // default 4000
  awaitSync?: boolean,                // default true — await Algolia writes in hooks (see below)
  waitUntil?: (promise) => void,      // scheduler for background writes when awaitSync: false (auto-detected on Vercel)
  enabled?: boolean,                  // false returns the config untouched
  indexSettings?: IndexSettings | false, // merged over defaultIndexSettings; false = never write
  richTextConverters?: {...},         // forwarded to convertLexicalToPlaintext
  richTextToText?: (value) => string, // replace rich text extraction

  reindex?: boolean | {               // true/omitted = defaults, false disables all of it
    path?: string,                    // default '/algolia-search/reindex'
    access?: ({ req }) => boolean | Promise<boolean>, // guards the endpoint + header icon; default: any authenticated user
    batchSize?: number,               // default 100
    depth?: number,                   // default 0
    button?: boolean,                 // false hides the admin header icon
  },
})
```

## Blocking vs background sync (`awaitSync`)

By default hooks await the Algolia write, so every save waits one Algolia round trip. That is
durable everywhere, which is why it's the default. Set `awaitSync: false` to let saves return
immediately and sync in the background — but only where background work is guaranteed to finish:

- **Vercel** — works out of the box; no `waitUntil` option needed:

  ```ts
  algoliaSearchPlugin({
    // ...
    awaitSync: false, // that's it — waitUntil is picked up automatically
  })
  ```

  The plugin reads the runtime's request context (`Symbol.for('@vercel/request-context')` — the
  same global `@vercel/functions` reads) and hands the write to its `waitUntil`, which keeps the
  invocation alive until the write lands without delaying the response. Passing the official
  `@vercel/functions` export via the `waitUntil` option also works, but is redundant.

- **Long-lived servers** (Docker, VPS, `next start` self-hosted) — safe; the process outlives the
  request anyway.
- **Other platforms with a `waitUntil` primitive** — pass it via the `waitUntil` option, e.g.
  Cloudflare Workers via OpenNext: `waitUntil: (p) => getCloudflareContext().ctx.waitUntil(p)`.
- **Runtimes that freeze after the response** (bare AWS Lambda and anything built on it) and
  **scripts that exit immediately** (seeds using the Local API) — keep the default. There is no
  after-response hook to attach to, so background writes can be silently dropped.

The promise handed to `waitUntil` never rejects — sync failures are logged through
`payload.logger` either way.

## How draft handling works

| Event                                      | Index action                          |
| ------------------------------------------ | ------------------------------------- |
| First draft (never published)              | ignored                               |
| Autosave/draft save over a published doc   | ignored — published record stays live |
| Publish / restore published version        | record saved                          |
| Unpublish (no published version remains)   | record removed                        |
| Trash (`deletedAt`)                        | record removed                        |
| Permanent delete                           | record removed                        |
| Collection `record` transform returns null | record removed                        |

Sync failures never block a save — errors are logged through `payload.logger` and the document operation succeeds.

## Credits

Draft/unpublish semantics adapted from [`payload-plugin-algolia`](https://github.com/wkentdag/payload-plugin-algolia) by Will Kent-Daggett (MIT).

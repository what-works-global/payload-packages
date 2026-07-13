import type { algoliasearch } from 'algoliasearch'
import type {
  CollectionSlug,
  DataFromCollectionSlug,
  Field,
  PayloadRequest,
  SanitizedCollectionConfig,
} from 'payload'

import type { SearchRecord } from './shared.js'

export type { SearchRecord } from './shared.js'

export type AlgoliaClient = ReturnType<typeof algoliasearch>

export type AlgoliaClientOptions = NonNullable<Parameters<typeof algoliasearch>[2]>

export type AlgoliaIndexSettings = NonNullable<
  Parameters<AlgoliaClient['setSettings']>[0]['indexSettings']
>

/** Map of registered blocks (`payload.blocks`) used to resolve `blockReferences`. */
export type BlocksMap = Record<string, { fields: Field[] }>

/**
 * The `doc` handed to per-collection callbacks. Options declared under
 * `collections` pin `TSlug` to their key, so `doc` resolves to that
 * collection's generated Payload type. At the global level — or when types
 * haven't been generated — documents from every configured collection flow
 * through, so it stays `Record<string, unknown>`.
 */
export type DocFromCollectionSlug<TSlug extends CollectionSlug> = CollectionSlug extends TSlug
  ? Record<string, unknown>
  : DataFromCollectionSlug<TSlug>

export interface SearchRecordArgs<TSlug extends CollectionSlug = CollectionSlug> {
  collection: SanitizedCollectionConfig
  /** What the default builder produced (title / path / breadcrumbs / content). */
  defaultRecord: SearchRecord
  doc: DocFromCollectionSlug<TSlug>
  /** Present when invoked from a live hook or the reindex endpoint. */
  req?: PayloadRequest
}

/**
 * Per-collection record shaping. Return:
 * - `undefined` — keep `defaultRecord` as-is
 * - a record — index it (spread `defaultRecord` to extend rather than replace)
 * - `null` — keep this document out of the index (existing records are removed)
 *
 * `objectID` and `collection` on the returned record are always overwritten
 * with the canonical values so deletes and per-collection reindexes keep working.
 */
export type SearchRecordTransform<TSlug extends CollectionSlug = CollectionSlug> = (
  args: SearchRecordArgs<TSlug>,
) => null | Promise<null | SearchRecord | undefined> | SearchRecord | undefined

export interface CollectionSearchOptions<TSlug extends CollectionSlug = CollectionSlug> {
  /** Override the global `contentLimit` for this collection. */
  contentLimit?: number
  /**
   * Replace the effective exclude list (global `excludeFields` /
   * `defaultExcludeFields`) for this collection. Entries match a field name at
   * any depth (`'internalNotes'`) or a dot-path from the document root
   * (`'hero.eyebrow'`).
   */
  excludeFields?: string[]
  /** Override the global `getPath` for this collection. */
  getPath?: GetDocumentPath<TSlug>
  record?: SearchRecordTransform<TSlug>
}

/**
 * Resolve the pathname indexed as `path`. Return `null`/`undefined` to fall
 * back to the last breadcrumb's `url` (nested-docs style) when present.
 */
export type GetDocumentPath<TSlug extends CollectionSlug = CollectionSlug> = (args: {
  collection: SanitizedCollectionConfig
  doc: DocFromCollectionSlug<TSlug>
  /** Present when invoked from a live hook or the reindex endpoint. */
  req?: PayloadRequest
}) => null | string | undefined

/**
 * Who may reindex. Enforced by the endpoint and also decides whether the
 * admin header icon is rendered. Default: any authenticated user.
 */
export type ReindexAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

export interface ReindexConfig {
  /** See {@link ReindexAccess}. Default: any authenticated user. */
  access?: ReindexAccess
  /** Page size used when paginating documents out of Payload. Default 100. */
  batchSize?: number
  /**
   * `false` hides the admin header icon that opens the reindex modal.
   * Default: shown next to the other header actions.
   */
  button?: boolean
  /** `depth` used when fetching documents for reindexing. Default 0. */
  depth?: number
  /** Root endpoint path (mounted under `/api`). Default `/algolia-search/reindex`. */
  path?: string
}

/**
 * One rich text plaintext converter: a function from a serialized node to
 * text, or a literal string. Structural stand-in for Lexical's converter type
 * so configs type-check without `@payloadcms/richtext-lexical` installed
 * (it's an optional peer).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the optional peer's type; `any` keeps Lexical's `PlaintextConverters` assignable
export type RichTextConverter = ((args: any) => string) | string

/**
 * Structural stand-in for Lexical's `PlaintextConverters`, which can't be
 * imported here without making the optional `@payloadcms/richtext-lexical`
 * peer required. Keyed by node type; the `blocks` / `inlineBlocks` entries are
 * nested maps keyed by block slug. Lexical's real `PlaintextConverters` type
 * is assignable to this — annotate your object with it for full checking.
 */
export type RichTextConverters = Record<
  string,
  Record<string, RichTextConverter | undefined> | RichTextConverter | undefined
>

export interface AlgoliaSearchPluginConfig {
  algolia: {
    /**
     * Admin API key with write access. Server-side only — never ship it to a
     * browser. `undefined` or empty (e.g. straight off `process.env`) pauses
     * sync with a warning instead of erroring — see `enabled`.
     */
    apiKey: string | undefined
    /** Algolia application ID. `undefined`/empty pauses sync — see `apiKey`. */
    appId: string | undefined
    clientOptions?: AlgoliaClientOptions
    /**
     * Name of the (single, shared) index all collections sync into.
     * `undefined`/empty pauses sync — see `apiKey`.
     */
    index: string | undefined
  }
  /**
   * Await Algolia writes inside hooks. Default `true` — durable in every
   * environment. `false` lets saves return without waiting on Algolia; the
   * write is handed to `waitUntil` (config-provided, or Vercel's request
   * context when running there) so the invocation stays alive until it lands.
   * Only set `false` when such a scheduler exists or the process is
   * long-lived — runtimes that freeze after the response (e.g. bare AWS
   * Lambda) and scripts that exit immediately can otherwise drop writes.
   */
  awaitSync?: boolean
  /**
   * Collections to index, keyed by slug. `true` uses the defaults; an object
   * tunes the record for that collection — its callbacks receive a `doc`
   * typed from your generated Payload types. `false`/`undefined` keeps the
   * collection out of the index (handy for conditional config).
   */
  collections: { [TSlug in CollectionSlug]?: boolean | CollectionSearchOptions<TSlug> }
  /** Character budget for the compressed `content` attribute. Default 4000. */
  contentLimit?: number
  /**
   * `false` returns the config untouched (no hooks, endpoint, or admin
   * components). Prefer leaving the plugin enabled without credentials — sync
   * simply pauses — so the generated import map stays stable across environments.
   */
  enabled?: boolean
  /** Replace `defaultExcludeFields`. Spread the export to extend it instead. */
  excludeFields?: string[]
  getPath?: GetDocumentPath
  /**
   * Merged over `defaultIndexSettings` and pushed to Algolia at the start of
   * every reindex (settings live in code, not the dashboard). `false` never
   * writes settings.
   */
  indexSettings?: AlgoliaIndexSettings | false
  /**
   * Reindex endpoint + admin button. `true`/omitted uses the defaults; pass
   * an object to tune it. `false` disables all of it.
   */
  reindex?: boolean | ReindexConfig
  /**
   * `PlaintextConverters` forwarded to Lexical's `convertLexicalToPlaintext`
   * so custom nodes (e.g. blocks inside rich text) contribute text. Ignored
   * when `richTextToText` is set or `@payloadcms/richtext-lexical` isn't
   * installed.
   */
  richTextConverters?: RichTextConverters
  /**
   * Replace rich text extraction entirely. Receives the raw field value; the
   * default parses stringified states, uses Lexical's official plaintext
   * converter when available, and falls back to a generic text-node walker.
   */
  richTextToText?: (value: unknown) => string
  /**
   * Scheduler that keeps background writes alive when `awaitSync` is `false`.
   * Defaults to Vercel's request-context `waitUntil` when present. Provide one
   * on other platforms with an equivalent primitive, e.g. Cloudflare Workers
   * via OpenNext: `(promise) => getCloudflareContext().ctx.waitUntil(promise)`.
   * Receives a promise that never rejects — failures are already logged.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

/** Resolved runtime context stored on `config.custom[pluginKey]`. */
export interface AlgoliaSearchContext {
  awaitSync: boolean
  collections: Record<string, CollectionSearchOptions>
  /** `false` when credentials are missing — sync and reindex pause with a warning. */
  configured: boolean
  contentLimit: number
  excludeFields: string[]
  getClient: () => AlgoliaClient
  getPath?: GetDocumentPath
  indexName: string
  indexSettings: AlgoliaIndexSettings | false
  reindex: {
    access: ReindexAccess
    batchSize: number
    depth: number
    endpointEnabled: boolean
    path: string
  }
  /** Resolved rich text extraction (user-supplied or the tiered default). */
  richTextToText: (value: unknown) => string
  waitUntil?: (promise: Promise<unknown>) => void
}

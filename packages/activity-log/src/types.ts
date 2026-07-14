import type {
  CollectionConfig,
  CollectionSlug,
  GlobalSlug,
  JsonObject,
  PayloadRequest,
} from 'payload'

/**
 * The kinds of events the plugin records. On collections with `trash: true`,
 * moving a document to the trash and restoring it are updates in Payload's terms
 * but are classified as `'trash'` / `'restore'` here; `'delete'` always means the
 * document is permanently gone.
 */
export type ActivityOperation =
  | 'create'
  | 'delete'
  | 'login'
  | 'logout'
  | 'restore'
  | 'trash'
  | 'update'

/**
 * A polymorphic reference to the user who performed an activity.
 * Matches the value shape Payload stores for polymorphic relationship fields.
 */
export type ActivityUserRef = {
  relationTo: string
  value: number | string
}

/**
 * Which collections/globals the plugin applies to.
 * - `true` — every entity in the config (the default).
 * - `string[]` — only these slugs.
 * - `{ exclude }` — every entity except these slugs.
 */
export type ActivityEntitySelection<TSlug extends string> = { exclude: TSlug[] } | true | TSlug[]

/**
 * Custom actor resolver. Return:
 * - an {@link ActivityUserRef} to attribute the event to that user,
 * - `null`/`undefined` to skip logging this event entirely.
 *
 * When omitted, events are attributed to `req.user`, and writes without a user
 * (seeds, migrations, job runners, local API calls without `user`) are not logged.
 */
export type ResolveActivityUser = (args: {
  collectionSlug?: string
  /** The document after the change (or the deleted document). */
  doc?: JsonObject
  globalSlug?: string
  operation: ActivityOperation
  req: PayloadRequest
}) => ActivityUserRef | null | Promise<ActivityUserRef | null | undefined> | undefined

/**
 * Resolves the label stored for the acting user at the time of the event. May be
 * async. Return `null`/`undefined`/`''` to fall back to the user's ID.
 *
 * Defaults to `user.email`, falling back to `user.username`, then the ID — or, when
 * `@whatworks/payload-audit-fields` is registered, to that plugin's
 * `resolveUserLabel` so both plugins display users identically.
 */
export type ResolveActivityUserLabel = (args: {
  /** Slug of the user collection the acting user belongs to. */
  relationTo: string
  req: PayloadRequest
  /** The acting user's document. */
  user: JsonObject
}) => (null | string | undefined) | Promise<null | string | undefined>

/**
 * Resolves the title stored for the affected document at the time of the event, so
 * the activity feed shows names instead of IDs — including for deleted documents.
 * May be async. Return `null`/`undefined`/`''` to fall back to the document ID.
 *
 * Defaults to the collection's `admin.useAsTitle` value, falling back to
 * `title` → `name` → `email` → `username` → the ID. For globals, the global's label.
 */
export type ResolveActivityDocumentLabel = (args: {
  collectionSlug?: string
  /** The affected document (after the change, or the deleted document). */
  doc: JsonObject
  globalSlug?: string
  req: PayloadRequest
}) => (null | string | undefined) | Promise<null | string | undefined>

/**
 * Resolves the IP address stored on log entries when the `ipAddress` option is
 * enabled. May be async. Return `null`/`undefined` to store nothing for that
 * event.
 */
export type ResolveActivityIpAddress = (args: {
  req: PayloadRequest
}) => (null | string | undefined) | Promise<null | string | undefined>

/**
 * Resolves the request host stored on log entries when the `requestHost` option
 * is enabled. May be async. Return `null`/`undefined` to store nothing for that
 * event.
 */
export type ResolveActivityRequestHost = (args: {
  req: PayloadRequest
}) => (null | string | undefined) | Promise<null | string | undefined>

/**
 * Per-event toggles. Anything not listed here (reads, autosaves unless enabled) is
 * never logged.
 */
export type ActivityLogEvents = {
  /**
   * Log autosaved draft updates. Off by default — with autosave enabled these fire
   * every few seconds while editing and would drown the feed.
   *
   * @default false
   */
  autosave?: boolean
  /** @default true */
  create?: boolean
  /**
   * Permanent deletion — including "empty trash" on collections with
   * `trash: true`.
   *
   * @default true
   */
  delete?: boolean
  /** @default true */
  login?: boolean
  /** @default true */
  logout?: boolean
  /**
   * Restoring a document from the trash (collections with `trash: true`).
   *
   * @default true
   */
  restore?: boolean
  /**
   * Moving a document to the trash (collections with `trash: true`).
   *
   * @default true
   */
  trash?: boolean
  /** @default true */
  update?: boolean
}

/**
 * When to store a full JSON snapshot of the affected document on the log entry.
 *
 * - `'delete'` (default) — only on delete, where the document (and its versions)
 *   are gone and the snapshot is the only surviving record.
 * - `'always'` — on every logged change. Consider your database size; prefer
 *   versions + the stored version link instead.
 * - `'never'` — never store document data.
 */
export type ActivitySnapshotMode = 'always' | 'delete' | 'never'

export type ActivityLogPluginConfig = {
  /**
   * Escape hatch to customize the generated activity log collection — access
   * control, labels, admin options, extra fields.
   */
  collectionOverride?: (collection: CollectionConfig) => CollectionConfig
  /**
   * Which collections have their document changes logged.
   *
   * Defaults to `true`: every collection present in the config when the plugin runs —
   * your own collections plus any added by plugins registered before this one.
   * Payload's internal collections are created after plugins run and are never
   * included. The activity log collection itself is always excluded.
   *
   * @default true
   */
  collections?: ActivityEntitySelection<CollectionSlug>
  /**
   * Slug of the collection log entries are stored in.
   *
   * @default 'activity-log'
   */
  collectionSlug?: string
  /**
   * Enables or disables the plugin entirely.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Per-event toggles. See {@link ActivityLogEvents}.
   */
  events?: ActivityLogEvents
  /**
   * Which globals have their changes logged. Same semantics as `collections`.
   *
   * @default true
   */
  globals?: ActivityEntitySelection<GlobalSlug>
  /**
   * Opt-in IP address tracking. When enabled, an `ipAddress` field is added to
   * the log collection and every log entry stores the requesting client's
   * address.
   *
   * - `false` (default) — nothing is stored.
   * - `true` — read from the standard reverse-proxy headers
   *   (`cf-connecting-ip` → `x-real-ip` → first `x-forwarded-for` entry).
   * - a function — resolve it yourself (see {@link ResolveActivityIpAddress}),
   *   e.g. when your proxy chain makes those headers untrustworthy.
   *
   * IP addresses are personal data under most privacy regimes — consider
   * pairing this with `retention`.
   *
   * @default false
   */
  ipAddress?: boolean | ResolveActivityIpAddress
  /**
   * Opt-in request host tracking. When enabled, a `requestHost` field is added
   * to the log collection and every log entry stores the host the request was
   * addressed to.
   *
   * - `false` (default) — nothing is stored.
   * - `true` — read from the standard headers (`x-forwarded-host` → `host`).
   * - a function — resolve it yourself (see {@link ResolveActivityRequestHost}),
   *   e.g. when your proxy chain makes those headers untrustworthy.
   *
   * @default false
   */
  requestHost?: boolean | ResolveActivityRequestHost
  /**
   * Custom label for the affected document, stored on the log entry at event time.
   * See {@link ResolveActivityDocumentLabel}.
   */
  resolveDocumentLabel?: ResolveActivityDocumentLabel
  /**
   * Custom actor resolver, e.g. to attribute queue/job or webhook writes to a
   * dedicated bot user. See {@link ResolveActivityUser}.
   */
  resolveUser?: ResolveActivityUser
  /**
   * Custom label for the acting user, stored on the log entry at event time. See
   * {@link ResolveActivityUserLabel}.
   */
  resolveUserLabel?: ResolveActivityUserLabel
  /**
   * Automatically delete log entries older than `maxAgeDays`. Pruning runs
   * opportunistically after log writes, at most once per hour per process.
   *
   * Off by default — nothing is ever deleted unless you opt in.
   */
  retention?: {
    maxAgeDays: number
  }
  /**
   * When to store a full JSON snapshot of the affected document.
   * See {@link ActivitySnapshotMode}.
   *
   * @default 'delete'
   */
  snapshot?: ActivitySnapshotMode
  /**
   * Auth-enabled collections whose users can appear as actors (and whose
   * logins/logouts are logged). Defaults to every auth-enabled collection in the
   * config, falling back to `admin.user`.
   */
  userCollections?: CollectionSlug[]
}

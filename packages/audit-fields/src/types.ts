import type {
  CollectionSlug,
  GlobalSlug,
  JsonObject,
  PayloadRequest,
  RelationshipField,
} from 'payload'

/**
 * Label for an audit field. Either:
 * 1. A string, e.g. `'Created By'`.
 * 2. An object mapping locales to localized labels, e.g. `{ en: 'Created By', it: 'Creato da' }`.
 * 3. A function that receives the collection/global slug and returns either of the above.
 */
export type AuditFieldLabel =
  | ((slug: string) => Record<string, string> | string)
  | Record<string, string>
  | string

/**
 * A polymorphic reference to the user a change is attributed to.
 * Matches the value shape Payload stores for polymorphic relationship fields.
 */
export type AuditUserRef = {
  relationTo: string
  value: number | string
}

/**
 * Resolves the label shown for an attributed user — in the "Modified By" column of
 * the versions view and in the audit fields on the document itself. May be async.
 *
 * Receives the user document (fetched at depth 0 with the viewing user's access
 * rights). Return `null`/`undefined`/`''` to fall back to the user's ID.
 *
 * Defaults to `user.email`, falling back to `user.username`, then the ID.
 */
export type ResolveAuditUserLabel = (args: {
  /** Slug of the user collection the document belongs to. */
  relationTo: string
  req: PayloadRequest
  /** The user document the change is attributed to. */
  user: JsonObject
}) => (null | string | undefined) | Promise<null | string | undefined>

/**
 * Custom attribution resolver. Return:
 * - an {@link AuditUserRef} to attribute the change to that user,
 * - `null`/`undefined` to leave the audit fields untouched for this change.
 *
 * When omitted, changes are attributed to `req.user` and writes without a user
 * (seeds, migrations, job runners) leave the audit fields untouched.
 */
export type ResolveAuditUser = (args: {
  collectionSlug?: string
  data: JsonObject
  globalSlug?: string
  operation: 'create' | 'update'
  originalDoc?: JsonObject
  req: PayloadRequest
}) => AuditUserRef | null | Promise<AuditUserRef | null | undefined> | undefined

export type AuditFieldOptions = {
  /**
   * Label for the field. Defaults to `'Created By'` / `'Last Modified By'`.
   */
  label?: AuditFieldLabel
  /**
   * Field name. Defaults to `'createdBy'` / `'lastModifiedBy'`.
   */
  name?: string
  /**
   * Escape hatch to customize the generated relationship field, e.g. to add
   * field-level access control or change admin behaviour.
   */
  override?: (field: RelationshipField) => RelationshipField
}

/**
 * Which collections/globals the plugin applies to.
 * - `true` — every entity in the config (the default).
 * - `string[]` — only these slugs.
 * - `{ exclude }` — every entity except these slugs.
 */
export type AuditEntitySelection<TSlug extends string> = { exclude: TSlug[] } | true | TSlug[]

export type AuditFieldsPluginConfig = {
  /**
   * Which collections receive audit fields.
   *
   * Defaults to `true`: every collection present in the config when the plugin runs —
   * your own collections plus any added by plugins registered before this one.
   * Payload's internal collections (`payload-preferences`, `payload-migrations`,
   * `payload-locked-documents`, `payload-folders`, …) are created after plugins run
   * and are never included.
   *
   * @default true
   */
  collections?: AuditEntitySelection<CollectionSlug>
  /**
   * Enables or disables the plugin (fields, hooks, and versions view).
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Per-field configuration. Set a field to `false` to not manage it at all.
   */
  fields?: {
    createdBy?: AuditFieldOptions | false
    lastModifiedBy?: AuditFieldOptions | false
  }
  /**
   * Which globals receive audit fields. Same semantics as `collections`.
   *
   * @default true
   */
  globals?: AuditEntitySelection<GlobalSlug>
  /**
   * Add a database index to the audit fields, useful when you filter or query
   * documents by author.
   *
   * @default false
   */
  index?: boolean
  /**
   * Custom attribution resolver, e.g. to attribute queue/job or webhook writes to a
   * dedicated bot user. See {@link ResolveAuditUser}.
   */
  resolveUser?: ResolveAuditUser
  /**
   * Custom label for attributed users, shown in the versions view's "Modified By"
   * column and in the audit fields on the document. May be async. See
   * {@link ResolveAuditUserLabel}.
   *
   * Defaults to `user.email`, falling back to `user.username`, then the ID.
   */
  resolveUserLabel?: ResolveAuditUserLabel
  /**
   * Whether to display audit fields in the sidebar instead of at the end of the
   * main field area.
   *
   * @default false
   */
  showInSidebar?: boolean
  /**
   * Auth-enabled collections that changes can be attributed to. Defaults to every
   * auth-enabled collection in the config, falling back to `admin.user`.
   */
  userCollections?: CollectionSlug[]
  /**
   * Replace the versions list view of every audited entity with versions enabled by a
   * view that adds a "Modified By" column. Set to `false` to keep Payload's default
   * view, or pass an object to customize the column.
   *
   * @default true
   */
  versionsView?:
    | {
        /**
         * Heading of the added column. A string or an object mapping locales to
         * localized labels.
         *
         * @default 'Modified By'
         */
        columnLabel?: Record<string, string> | string
      }
    | boolean
}

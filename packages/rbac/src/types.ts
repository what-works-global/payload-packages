import type { CollectionConfig, CollectionSlug, GlobalSlug, RelationshipField } from 'payload'

import type { RbacAction } from './shared.js'

/**
 * A single grant. Either:
 * - `'*'` — full access to every controlled collection and global, present and future.
 * - `'<slug>:<action>'` — one action on one collection (`create`/`read`/`update`/`delete`)
 *   or global (`read`/`update`), e.g. `'posts:update'`.
 */
export type RbacPermission = string

/**
 * A role defined in code. Seeded into the roles collection on init when no role
 * with the same `name` exists yet; existing roles are never overwritten (unless
 * `protected`), so database edits always win.
 */
export type PredefinedRole = {
  /**
   * Who may change the credentials — password, email, and username — of users
   * holding this role:
   * - `'anyone'` — anyone with update access to the user (the default).
   * - `'self'` — only the account owner. Everyone else gets a 403 regardless of
   *   their permissions and should send a password-reset email instead. Email and
   *   username are locked together with password deliberately: an editable email
   *   plus the reset flow would take the account over anyway.
   *
   * The role defined by `adminRole` is always `'self'`. The protection follows
   * the role name, so pair `'self'` with `protected: true` to prevent the role
   * being renamed away from it.
   *
   * @default 'anyone'
   */
  credentialChanges?: 'anyone' | 'self'
  description?: string
  /**
   * Unique role name, used as the seeding key and shown as the document title in
   * the admin panel, so human-friendly names like `'Editor'` are encouraged.
   */
  name: string
  permissions: RbacPermission[]
  /**
   * Locks the role to this code definition. A protected role cannot be renamed,
   * have its permissions changed, or be deleted through the API — the only
   * permissions write the API accepts is restoring this exact list — and drifted
   * permissions are repaired on init. To change a protected role's permissions,
   * change this definition and restart. The role defined by `adminRole` is always
   * protected; use this to additionally lock other roles.
   *
   * @default false
   */
  protected?: boolean
}

/**
 * Which collections/globals the plugin applies to.
 * - `true` — every entity in the config (the default).
 * - `string[]` — only these slugs.
 * - `{ exclude }` — every entity except these slugs.
 */
export type RbacEntitySelection<TSlug extends string> = { exclude: TSlug[] } | true | TSlug[]

export type RbacPluginConfig = {
  /**
   * The built-in administrator role, passed as a role name or `{ name, description }`.
   * When set, the plugin defines a role with this name that always has full access
   * (`permissions: ['*']`) and is always protected — it can never be downgraded,
   * renamed, or deleted through the API, and drifted permissions are repaired on
   * init — so there is always a role that can reach everything. It is auto-assigned
   * to the first user created in the admin user collection (`admin.user`) by an
   * unauthenticated request — the admin "create first user" screen or an init
   * seed — so a fresh project never locks you out. Its holders' credentials are
   * protected too: the role's `credentialChanges` is always `'self'`, so only
   * each holder can change their own password, email, or username — another
   * user with `users:update` cannot take the account over. And only holders can
   * assign the role: full access through another role is not enough, so users
   * below the admin tier can never join it on their own. (While nobody holds
   * the role at all — a fresh rename, or the plugin newly added to an existing
   * project — any user whose permissions cover it may step up; init logs a
   * warning until someone does.) The plugin also guarantees at
   * least one user always holds this role: removing it from — or deleting — the
   * last holder is blocked. And should the system somehow end up with no
   * administrator at all (the roles collection wiped at the database level, or
   * this option renamed so a fresh role was seeded with no holders), any
   * signed-in user may assign this role to themselves — the escalation guard
   * permits exactly that write while no user holds full access, and init logs a
   * warning describing the state. Do not also list it in `roles`; its definition
   * is owned by the plugin.
   *
   * @default false
   */
  adminRole?: { description?: string; name: string } | false | string
  /**
   * Which collections are access-controlled and appear in the permissions matrix.
   *
   * Defaults to `true`: every collection present in the config when the plugin runs —
   * your own collections plus any added by plugins registered before this one, so
   * register this plugin last. Payload's internal collections (`payload-preferences`,
   * `payload-migrations`, `payload-locked-documents`, `payload-folders`, …) are created
   * after plugins run and are never included. The roles collection itself is always
   * controlled.
   *
   * @default true
   */
  collections?: RbacEntitySelection<CollectionSlug>
  /**
   * Enables or disables the plugin.
   *
   * @default true
   */
  enabled?: boolean
  /**
   * Which globals are access-controlled and appear in the permissions matrix
   * (`read`/`update`). Same semantics as `collections`.
   *
   * @default true
   */
  globals?: RbacEntitySelection<GlobalSlug>
  /**
   * Let every user read/update their own user document even without the matching
   * collection permission — the admin account view breaks without self-read. Set to
   * `false` (or narrow to `['read']`) to disable. The roles field stays out of reach
   * regardless: changing it requires the `roles:update` permission, so users cannot
   * remove their own roles by accident.
   *
   * @default ['read', 'update']
   */
  ownAccountAccess?: Exclude<RbacAction, 'create' | 'delete'>[] | false
  /**
   * Blocks users from granting what they do not hold themselves: assigning a role
   * whose permissions their own roles don't cover, and adding permissions to a role
   * (or creating one) beyond their own. Removals mirror additions on the user's own
   * account: a role can only be removed from yourself when the roles you keep cover
   * its permissions — otherwise you could never assign it back, and one save would
   * have locked you out. Users with `'*'` can grant anything. Writes without a user
   * (local API seeds, init scripts, the first-user registration) are not restricted.
   *
   * @default true
   */
  preventPrivilegeEscalation?: boolean
  /**
   * Roles predefined in code, seeded on init when missing. Roles marked `protected`
   * are additionally locked to their code definition. The `adminRole` is defined
   * separately and must not be repeated here. See {@link PredefinedRole}.
   */
  roles?: PredefinedRole[]
  /**
   * The roles collection added by the plugin.
   */
  rolesCollection?: {
    /**
     * Escape hatch to customize the generated roles collection — labels, admin group,
     * extra fields, additional hooks.
     */
    override?: (collection: CollectionConfig) => CollectionConfig
    /**
     * Slug of the roles collection.
     *
     * @default 'roles'
     */
    slug?: string
  }
  /**
   * The roles field added to each user collection. The generated field carries
   * field-level access requiring the `roles:update` permission to change it, so
   * it renders read-only in the admin panel for everyone else and API writes
   * touching it without the permission are silently ignored (Payload's
   * field-access semantics — the stored value is kept, no error is raised).
   */
  rolesField?: {
    /**
     * Field name.
     *
     * @default 'roles'
     */
    name?: string
    /**
     * Escape hatch to customize the generated relationship field — including
     * replacing its `access` to lift or change the `roles:update` requirement.
     */
    override?: (field: RelationshipField) => RelationshipField
  }
  /**
   * Auth-enabled collections that receive the roles field. Defaults to every
   * auth-enabled collection in the config, falling back to `admin.user`.
   */
  userCollections?: CollectionSlug[]
}

# @whatworks/payload-rbac

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-rbac" src="../../assets/whitebanner.svg">
  </picture>
</a>

Role based access control for Payload where the roles live in the database. Editors manage roles in the admin panel through a per-collection **Create / Read / Update / Delete** checkbox matrix; the plugin enforces those permissions across every collection and global.

- Adds a **roles collection** with a checkbox-matrix permissions editor — one row per collection (CRUD) and per global (Read/Update), plus a **Full access** toggle (`'*'`) that covers everything, including collections added later.
- **Predefine roles in code** — they are seeded on init when missing, and never overwritten afterwards, so the database stays the source of truth.
- Adds a `roles` relationship field to your auth collections (multi-role; a user's permissions are the union of their roles).
- **Applies access control automatically** to every collection and global. Access you define explicitly on a collection always wins for that operation — the plugin only fills the gaps.
- **Privilege-escalation protection**: users can only assign roles, and only add permissions to roles, that their own roles already cover.
- **Role assignment requires `roles:update`** — for everyone else the roles field renders read-only in the admin panel. And a role your remaining roles could not re-grant cannot be removed from your own account, so you can never accidentally strip your own access.
- **Built-in admin role** (`adminRole`): a role the plugin locks to full access (`['*']`) — it can never be downgraded, renamed, or deleted through the API, so you can never lose your last full-access role. Only its holders can assign it (even `'*'` through another role is not enough). It is auto-assigned to the first user created, and at least one user always holds it — removing it from (or deleting) the last administrator is blocked, and if the database is damaged so badly that nobody holds it, any signed-in user can claim it for themselves. Other roles can opt into the same code-locking with `protected: true`.
- **Per-role credential protection** (`credentialChanges: 'self'`): the password, email, and username of users holding such a role can only be changed by the account owner — anyone else sends a password-reset email instead. Always on for the admin role, so an administrator account can never be taken over by another user with `users:update`.
- Users can always read/update their own account document (configurable), so the admin account view keeps working for low-privilege users.

## Installation

```sh
pnpm add @whatworks/payload-rbac
```

## Usage

```ts
import { rbacPlugin } from '@whatworks/payload-rbac'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    // Register last so collections added by other plugins are controlled too.
    rbacPlugin({
      adminRole: 'Administrator',
      roles: [
        {
          name: 'Editor',
          permissions: ['posts:create', 'posts:read', 'posts:update', 'posts:delete'],
        },
      ],
    }),
  ],
})
```

Then regenerate the import map so the admin panel can resolve the permissions-matrix component:

```sh
payload generate:importmap
```

That's it — a `roles` collection appears in the admin panel, every auth user gets a `roles` field, and every operation on every collection and global now requires a matching permission.

Role names are plain display strings (the roles collection's title field) that double as the seeding key — permissions never reference them — so human-friendly names like `'Administrator'` and `'Editor'` are encouraged.

## Permissions

A permission is a plain string, stored on the role document:

- `'*'` — full access to every controlled collection and global, present and future.
- `'<slug>:<action>'` — one action on one entity, e.g. `'posts:update'`. Actions are `create`/`read`/`update`/`delete` for collections and `read`/`update` for globals.

A user's permission set is the union of all their roles. Requests without a user are denied wherever the plugin controls access — see [Public access](#public-access-and-custom-rules) below. `readVersions` maps to the entity's `read` permission and `unlock` to `update`.

Payload's internal collections (`payload-preferences`, `payload-migrations`, `payload-locked-documents`, `payload-folders`, …) are created after plugins run; they are never controlled and never appear in the matrix.

## Public access and custom rules

Access you define explicitly on a collection wins for that operation, so public reads keep working the way you wrote them:

```ts
{
  slug: 'posts',
  access: {
    // Explicit — the plugin leaves it alone: anyone can read published posts.
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
    // create/update/delete are not defined — the plugin fills them with role checks.
  },
}
```

To combine your own rule with a role check, compose the exported helpers:

```ts
import { hasPermission, requirePermission } from '@whatworks/payload-rbac'

{
  access: {
    // Access-function factory:
    update: requirePermission('posts:update'),
    // Or inside your own logic:
    delete: async ({ req }) =>
      (await hasPermission(req, 'posts:delete')) && !req.user?.suspended,
  },
}
```

`getUserPermissions(req)` returns the resolved permission set (memoized per request — the roles are fetched at most once per request, no matter how many access functions run).

## Privilege-escalation protection

Enabled by default (`preventPrivilegeEscalation`):

- Assigning a role to a user requires the assigner's own permissions to cover everything that role grants. Assigning a `'*'` role requires holding `'*'`.
- The `adminRole` is stricter still: it can only be assigned by a user who already holds it — full access through another role is not enough (see [lockout prevention](#the-admin-role-and-protected-roles-lockout-prevention) below).
- Removing roles from **your own account** mirrors assignment: the roles you keep must cover the removed role's permissions — otherwise you could never assign it back, and one save would have locked you out. Removing a redundant role (e.g. dropping `Viewer` while you keep a `'*'` role) works; removing the role your access comes from is rejected with a 403. Removing roles from _other_ users is not restricted.
- Adding permissions to a role (or creating a role) is limited to permissions the editor already holds.
- Writes without a user — local API seeds, init scripts, the first-user registration — are never restricted.

Note that managing users also requires the relevant collection permissions themselves (e.g. `users:update` to edit users, `roles:read` to see the roles being assigned).

### The roles field requires `roles:update` — know the semantics

Changing anyone's roles — your own account included — requires the `roles:update` permission. This is enforced as **field-level access** on the generated roles field, which is what makes the admin panel render the field read-only: an editor can see their roles but cannot touch them, so nobody unchecks their own access by accident. Field access comes with Payload's standard semantics, which are worth knowing before you debug:

- **API writes are silently ignored, not rejected.** A create or update that includes the roles field without `roles:update` succeeds — every other field saves, the response is a 200 — but the roles value is dropped and the stored value kept. Nothing errors and nothing is logged. If a role assignment "didn't stick", check that the requesting user holds `roles:update`.
- **Creating or duplicating a user without `roles:update` produces a user with no roles** — roles in the create data are dropped the same way.
- **Assigning roles to another user needs both permissions**: `users:update` to save their document at all, plus `roles:update` for the field.
- **Self-removals fail loudly, not silently**: a user who does hold `roles:update` gets a 403 error (not a silent keep) when removing a role from their own account that their kept roles cannot cover — see the escalation rules above.
- **Break-glass**: while no user in the system holds full access, the field stays writable for signed-in users so the [self-claim recovery](#the-admin-role-and-protected-roles-lockout-prevention) can proceed — the escalation guard still vets that write. Without an `adminRole` configured there is no such relaxation: make sure some role keeps `roles:update`, or roles can only be assigned through the local API.
- **A roles field you defined yourself is left alone**: if your user collection already has a field with the roles field name, the guard hooks apply to it but the `roles:update` field gate does not. Use `rolesField.override` to replace the generated field's `access` when you want different rules.

## The admin role and protected roles (lockout prevention)

Escalation protection alone has a failure mode: removals are always allowed, so if you remove a permission from your **only** full-access role, nobody holds it anymore — and now nobody is allowed to grant it back. You would be permanently locked out of that permission.

The `adminRole` closes that hole: the plugin defines that role itself with `permissions: ['*']`, seeds it, assigns it to the first user, and permanently protects it — you cannot list it in `roles`, so it cannot even be predefined with anything less than full access. Any other predefined role can opt into the same locking with `protected: true`. A protected role is locked to its code definition:

- Its permissions cannot be changed through the API — not even by a `'*'` user. The one write that is accepted is restoring the exact code-defined list; that restore is exempt from the escalation guard, so anyone still holding `roles:update` can repair a drifted protected role without holding the permissions being restored.
- It cannot be renamed or deleted.
- Drifted permissions (e.g. from direct database edits) are restored on init.
- **Only holders can grant the admin role**: assigning it requires holding it yourself — even a `'*'` user cannot join the admin tier on their own. The restriction relaxes only while _nobody_ holds the role at all (a fresh rename, or the plugin newly added to an existing project): then any user whose permissions cover it may step up, and init logs a warning until someone does.
- **At least one user always holds the admin role**: removing it from the last holder, or deleting that user, is rejected (holders are counted across every collection that carries the roles field). Writes without a user (local API, init scripts) are exempt, like the other guards.
- **Break-glass recovery**: the guards cannot see database-level damage — if the roles collection is wiped, re-seeding on restart recreates the admin role under a new ID, so every user's role references dangle and nobody holds it. While **no user in the system holds full access**, any signed-in user may assign the admin role **to themselves**: open your account, add the role, save. The escalation guard permits exactly that write, the roles collection becomes readable to signed-in users so the role can be picked, and the roles field stays writable without `roles:update`. Nothing is granted automatically — an administrator exists again only when someone claims it — and init logs a warning whenever the admin role has no holder. The moment anyone holds full access again, the exemption switches off.
- The admin panel renders its permissions matrix read-only with an explanatory note.

To change a protected role's permissions, change the code definition and restart. Writes without a user (local API, init scripts) are not restricted, matching the other guards.

Renaming `adminRole` seeds a fresh role under the new name with no holders; your existing administrators still hold full access through the old role, and since the new role has no holders yet, the holder-only rule stands aside and lets them assign it in the admin panel (init logs a warning until someone does). The old role stays in the database as an ordinary, no-longer-protected role — delete it when you're done with it.

## Self-only credentials

Permissions alone cannot protect an account from other users: `users:update` is enough to set someone else's password — or to change their email and request a password reset to it — and take the account over. So credential changes get their own rule, per role: the password, email, and username of a user holding a `credentialChanges: 'self'` role can only be changed by that user, no matter what permissions everyone else holds. Helping a locked-out colleague means sending them a password-reset email. Email and username are locked together with password deliberately — an editable email plus the reset flow would take the account over anyway.

The `adminRole` is always `'self'`; opt other roles in per role. The protection follows the role name, so pair `'self'` with `protected: true` to prevent the role being renamed away from it. Writes without a user (local API, seeds) are never restricted, like the other guards.

### Protecting the developer account from client admins

A common handover: the agency keeps a developer account, and the client gets an administrator account of their own. Give the client full access — no need to enumerate permissions per collection — and keep the developer tier to yourself:

```ts
rbacPlugin({
  // The developer/agency tier — only holders can grant it, credentials self-only.
  adminRole: 'Super Admin',
  roles: [
    {
      name: 'Admin',
      description: 'Site administrator.',
      // Full access to everything, including collections added later.
      permissions: ['*'],
      protected: true,
    },
  ],
})
```

The client runs the whole site — content, users, roles, future collections — but the developer account stays out of reach:

- They cannot change the developer's password, email, or username (the admin role is always `credentialChanges: 'self'`), so credential takeover is closed.
- They cannot hold or hand out `'Super Admin'`: even with `'*'`, assigning the admin role requires already holding it.
- They cannot strip the role from — or delete — the last developer account, and the role itself cannot be renamed, downgraded, or deleted.

Note the last-holder guard only protects the _last_ holder: with two or more Super Admin accounts, a user with `users:update`/`users:delete` can still strip or delete all but one of them (their credentials stay protected regardless).

## Options

```ts
rbacPlugin({
  // Which collections are access-controlled and appear in the matrix. Defaults to all
  // collections present when the plugin runs (register the plugin last).
  // - true — every collection (default)
  // - ['posts', 'pages'] — only these
  // - { exclude: ['media'] } — all except these
  collections: true,

  // Which globals are controlled (read/update). Same semantics. Defaults to all.
  globals: true,

  // Auth collections that receive the roles field.
  // Defaults to every auth-enabled collection.
  userCollections: ['users'],

  // The built-in administrator role: always full access (['*']), always protected
  // (no API edits/renames/deletes, drift repaired on init), auto-assigned to the
  // first user created. A name, or { name, description }. Default: false.
  adminRole: 'Administrator',

  // Additional roles seeded on init when no role with the same name exists.
  // `protected: true` locks a role to its code definition the same way the
  // adminRole is locked (default: false — the database wins). `credentialChanges:
  // 'self'` makes holders' password/email/username changeable only by themselves
  // (default: 'anyone'; the adminRole is always 'self').
  roles: [{ name: 'Editor', permissions: ['posts:read', 'posts:update'] }],

  // Users may read/update their own user document without holding the collection
  // permission. Default: ['read', 'update']. Set false to disable.
  ownAccountAccess: ['read', 'update'],

  // Block users from granting roles/permissions beyond their own. Default: true.
  preventPrivilegeEscalation: true,

  // The roles collection added by the plugin.
  rolesCollection: {
    slug: 'roles', // default
    // Escape hatch: adjust labels, admin group, extra fields, hooks, …
    override: (collection) => ({ ...collection, admin: { ...collection.admin, group: 'Admin' } }),
  },

  // The roles field added to user collections. Changing it requires the
  // `roles:update` permission (it renders read-only in the admin panel
  // otherwise); `override` can replace the field's `access` to change that.
  rolesField: {
    name: 'roles', // default
    override: (field) => ({ ...field, saveToJWT: false }),
  },

  // Disable the plugin entirely (useful per-environment). Default: true.
  enabled: true,
})
```

## Behaviour notes

- **Admin panel navigation** hides collections and globals the user cannot read — no extra configuration needed.
- **Admin panel login** (`access.admin`) is not restricted by the plugin; a user with no roles can log in but sees nothing. Add your own `access.admin` to auth collections if you want to gate the panel itself.
- **Roles are resolved from the database** on each request (one indexed query, memoized per request), so permission changes apply immediately — no re-login needed. The role IDs are also stored on the JWT (`saveToJWT`) for consumers reading the token directly.
- If a user collection already defines a field with the roles field name, the field is left entirely yours — the guard hooks still apply to it, but the `roles:update` field gate does not.
- Predefined role permissions are validated at startup against the known collections and globals, so a typo fails fast with a clear error.

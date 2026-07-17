# @whatworks/payload-audit-fields

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="@whatworks/payload-audit-fields" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Payload plugin that records who created and who last modified every document, and upgrades the versions list view with a **Modified By** column so you can see exactly who saved each version.

- Adds read-only `createdBy` / `lastModifiedBy` relationship fields to every collection and global by default (opt-out, not opt-in).
- Displays attributed users by **email** (customizable via `resolveUserLabel`) — on the document, in the collection list view, and in the versions view — linked to the user document.
- Replaces the versions list view with a faithful recreation of Payload's own view, extended with a per-version "Modified By" column.
- Supports multiple auth collections — attribution is stored as a polymorphic reference to whichever collection the acting user belongs to.
- Data-compatible with [`@payload-bites/audit-fields`](https://github.com/rilrom/payload-bites) — same default field names and the same stored value shape (`{ relationTo, value }`), so you can switch plugins without a migration.

## Installation

```sh
pnpm add @whatworks/payload-audit-fields
```

## Usage

```ts
import { auditFieldsPlugin } from '@whatworks/payload-audit-fields'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    // Register last so collections added by other plugins are audited too.
    auditFieldsPlugin(),
  ],
})
```

Then regenerate the import map so the admin panel can resolve the plugin's components:

```sh
payload generate:importmap
```

That's it — every collection and global now tracks `createdBy` and `lastModifiedBy`, and every entity with versions enabled gets the enhanced versions view.

## Options

```ts
auditFieldsPlugin({
  // Which collections to audit. Defaults to all.
  // - true — every collection (default)
  // - ['posts', 'pages'] — only these
  // - { exclude: ['tags'] } — all except these
  collections: { exclude: ['tags'] },

  // Which globals to audit. Same semantics. Defaults to all.
  globals: true,

  // Auth collections users can be attributed to.
  // Defaults to every auth-enabled collection in your config.
  userCollections: ['users'],

  fields: {
    createdBy: {
      name: 'createdBy',
      label: 'Created By', // string | { [locale]: string } | (slug) => label
      // Escape hatch for full control over the generated field, e.g. delete
      // `field.admin.components` to restore the default relationship input:
      override: (field) => ({ ...field, index: true }),
    },
    // Set to false to only track one of the two fields:
    lastModifiedBy: { name: 'lastModifiedBy', label: 'Last Modified By' },
  },

  showInSidebar: false, // default false — fields render at the end of the main field area
  index: false, // default false — add a DB index to the fields

  // Custom attribution, e.g. attribute job/webhook writes to a bot user.
  // Return null/undefined to leave the fields untouched for that change.
  resolveUser: ({ req }) =>
    req.user ? { relationTo: req.user.collection, value: req.user.id } : null,

  // How attributed users are displayed — on the document and in the versions
  // view. May be async. Defaults to email → username → ID.
  resolveUserLabel: ({ user }) =>
    user.firstName ? `${user.firstName} ${user.lastName}` : (user.email as string),

  // The enhanced versions list view. Default: true.
  versionsView: {
    columnLabel: 'Modified By', // string | { [locale]: string }
  },
  // ...or `versionsView: false` to keep Payload's default view.
})
```

## Behaviour

- **Create** sets both `createdBy` and `lastModifiedBy` to the acting user.
- **Update** sets `lastModifiedBy` and strips any incoming `createdBy` value, so API clients cannot rewrite attribution after the fact.
- **Writes without a user** (seeds, migrations, job runners, local API calls without `user`/`req`) leave both fields untouched, so scripts can set them explicitly when needed — or use `resolveUser` to attribute them to a dedicated system user.
- If an entity already defines a field with one of the configured names, the plugin leaves that entity's field **and its values** entirely alone.
- The plugin does not touch Payload's internal collections (`payload-preferences`, `payload-migrations`, `payload-locked-documents`, `payload-folders`, …) — they are created after plugins run, are system-managed, or already carry their own user reference.

## How users are displayed

On the document, audit fields render as a read-only label linking to the user
document instead of the default (greyed-out) relationship input. The collection
list view shows the same label in place of the raw relationship ID, and the
versions view's "Modified By" column shows it too.

All three use `resolveUserLabel` to derive the label from the user document, which
is fetched with the **viewing** user's access rights — if the current user cannot
read the users collection, the raw ID is shown instead. The default resolver
returns `user.email`, falling back to `user.username`, then the ID.

`resolveUserLabel` may be async, so you can derive the label from anywhere:

```ts
resolveUserLabel: async ({ relationTo, req, user }) => {
  const profile = await req.payload.findByID({ collection: 'profiles', id: user.profile })
  return profile?.displayName ?? (user.email as string)
}
```

## Versions view

For every audited entity with versions enabled, the plugin sets
`admin.components.views.edit.versions` to its own server view
(`@whatworks/payload-audit-fields/rsc#AuditVersionsView`) — unless you have already
customized that view, in which case yours wins.

The view is a faithful recreation of Payload's built-in versions list (same layout,
pagination, status pills, autosave badges, and trash support), with one addition: a
**Modified By** column showing who saved each version, linked to the user document.
It reads `lastModifiedBy` from each version snapshot and falls back to `createdBy`
for the initial version.

The vendored view internals come from `payload@3.84.1` and degrade gracefully on
the older Payload versions in the peer range (version-gated props are simply
absent there); if Payload materially changes its versions view, update the
vendored files alongside the peer bump.

## Migrating from @payload-bites/audit-fields

Field names, labels, and the stored value shape are identical by default, so
swapping plugins requires no data migration. Differences to be aware of:

- `lastModifiedBy` is now also set on create (previously only on update).
- `createdBy` can no longer be overwritten through authenticated API updates.
- Audit fields render at the end of the main field area by default; pass
  `showInSidebar: true` for the old placement.
- Fields display the user's email as a link instead of a disabled relationship
  input (customize via `resolveUserLabel`, or restore the input via
  `fields.createdBy.override`).
- `excludedCollections` / `excludedGlobals` become `collections: { exclude: [...] }`
  / `globals: { exclude: [...] }`.
- Attribution uses `req.user.collection`, so users from any auth collection are
  recorded correctly (previously always the admin user collection).

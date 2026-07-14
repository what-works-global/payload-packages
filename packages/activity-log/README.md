# @whatworks/payload-activity-log

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Activity Log" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Payload plugin that records a chronological activity feed for your whole CMS — who did what, when, across every collection and global. Think WordPress's Simple History, for Payload.

- Logs document **creates, updates, trashes, restores, and deletes**, plus user **logins and logouts** (opt-out, not opt-in).
- Shows **document titles and user emails**, not IDs — both captured at event time, so they survive deletion.
- **No full-document snapshots by default.** Each entry links to the version the change produced (when versions are enabled) instead of duplicating document data. Only permanent deletes store a snapshot — the one moment the data would otherwise be lost, since Payload deletes a document's versions with it.
- Records the **changed field names** on updates ("title, content") without storing values.
- Supports multiple auth collections — actors are stored as a polymorphic reference plus a label.
- Composes with [`@whatworks/payload-audit-fields`](../audit-fields): reuses its `resolveUserLabel` automatically so both plugins display users identically, and keeps its attribution fields out of the changed-fields noise.

## Installation

```sh
pnpm add @whatworks/payload-activity-log
```

## Usage

```ts
import { activityLogPlugin } from '@whatworks/payload-activity-log'
import { buildConfig } from 'payload'

export default buildConfig({
  // ...
  plugins: [
    // Register last so collections added by other plugins are logged too.
    activityLogPlugin(),
  ],
})
```

Then regenerate the import map so the admin panel can resolve the plugin's components:

```sh
payload generate:importmap
```

An **Activity Log** collection appears in the admin panel: a reverse-chronological feed with linked users, linked documents, the operation, and a link to the version diff for each change.

## Options

```ts
activityLogPlugin({
  // Which collections to log. Defaults to all (the log collection itself is
  // always excluded).
  // - true — every collection (default)
  // - ['posts', 'pages'] — only these
  // - { exclude: ['redirects'] } — all except these
  collections: { exclude: ['redirects'] },

  // Which globals to log. Same semantics. Defaults to all.
  globals: true,

  // Per-event toggles (all default true except autosave).
  events: {
    create: true,
    update: true,
    trash: true, // moving to the trash (collections with trash: true)
    restore: true, // restoring from the trash
    delete: true, // permanent deletion
    login: true,
    logout: true,
    autosave: false, // default false — autosaves fire every few seconds while editing
  },

  // When to store a full JSON snapshot of the affected document:
  // 'delete' (default) — only on permanent delete, where it's the only surviving
  // record; 'always' — every change (watch your database size); 'never'.
  snapshot: 'delete',

  // Opt-in IP address tracking. When enabled, an `ipAddress` field is added to
  // the log collection and every entry stores the requester's address.
  // `true` reads the standard reverse-proxy headers (`cf-connecting-ip` →
  // `x-real-ip` → first `x-forwarded-for` entry); pass a function to resolve it
  // yourself when your proxy chain makes those untrustworthy. IP addresses are
  // personal data under most privacy regimes — consider pairing with `retention`.
  ipAddress: false,

  // Delete entries older than this. Off by default — nothing is pruned unless
  // you opt in. Pruning runs after log writes, at most once per hour.
  retention: { maxAgeDays: 90 },

  // Slug of the log collection. Default 'activity-log'.
  collectionSlug: 'activity-log',

  // Escape hatch for the generated collection — access control, labels, admin
  // options, extra fields.
  collectionOverride: (collection) => ({
    ...collection,
    access: { ...collection.access, read: ({ req }) => req.user?.role === 'admin' },
  }),

  // Auth collections whose users can appear as actors (and whose logins/logouts
  // are logged). Defaults to every auth-enabled collection in your config.
  userCollections: ['users'],

  // Custom actor resolution, e.g. attribute job/webhook writes to a bot user.
  // Return null/undefined to skip logging that event.
  resolveUser: ({ req }) =>
    req.user ? { relationTo: req.user.collection, value: req.user.id } : null,

  // Label stored for the acting user at event time. May be async.
  // Defaults to email → username → ID, or to audit-fields' resolveUserLabel
  // when that plugin is registered.
  resolveUserLabel: ({ user }) => user.email as string,

  // Title stored for the affected document at event time. May be async.
  // Defaults to the collection's useAsTitle value → title → name → email →
  // username → ID; for globals, the global's label.
  resolveDocumentLabel: ({ doc }) => doc.title as string,
})
```

## Behaviour

- **Actors.** Events are attributed to `req.user`. Writes without a user (seeds, migrations, job runners, local API calls without `user`) are **not logged** — pass `resolveUser` to attribute them to a dedicated system user instead.
- **What each entry stores.** The actor (polymorphic reference + label), the operation, the affected collection/global and document ID, the document's title, the ID of the version the change produced (entities with versions), and the changed field names (updates). Labels and titles are captured at event time, so the feed stays readable after users or documents are deleted — at the cost of not reflecting later renames.
- **Trash.** On collections with `trash: true`, moving to the trash logs `trash` (linked to the document under the trash route), restoring logs `restore`, and emptying the trash logs `delete` with a snapshot. Payload introduced trash in 3.49 — on older versions within the supported peer range these events simply never occur (there is no trash), and everything else works as described.
- **Autosave.** Skipped by default; manual draft saves and publishes are logged. Set `events.autosave: true` to log every autosave.
- **IP addresses.** Nothing is stored unless you opt in with `ipAddress`. When enabled, every entry (all operations, not just logins) records the requesting client's address; resolution failures simply leave it unset. Which proxy headers can be trusted depends on your deployment — pass a resolver function if the defaults pick up spoofable values.
- **The log is append-only.** All mutating access on the log collection is disabled; entries are written exclusively by the plugin's hooks. Reads default to any authenticated user — tighten via `collectionOverride`. Note that stored labels/titles are visible to anyone who can read the log, regardless of their access to the source documents.
- **Log writes never break the operation** that caused them: failures are logged and swallowed. Entries are written on the operation's request, so they commit and roll back with it.
- The plugin does not touch Payload's internal collections (they are created after plugins run).

## Versions link

Payload saves a change's version _before_ `afterChange` hooks run, so each log entry can record the ID of the exact version its change produced. The **Version** column links straight to that version's diff view. For entities without versions the column shows `—`, and the entry's changed-field names still tell you what was touched.

Cells only link to destinations that still resolve: once a document is permanently deleted (its versions are deleted with it) the version cell shows a muted "Document deleted" and the document cell shows the stored title without a link; a version pruned by `versions.maxPerDoc` shows `—`. The actor gets the same treatment — a deleted user's label loses its link (in the list and on the entry view). Documents and users sitting in the trash link under the trash route. The existence checks are batched per render pass — one query per collection for a whole page of rows, not one per cell — and the actor checks share the same batch.

## Using with @whatworks/payload-audit-fields

The two plugins are independent but designed to compose. Register both (order doesn't matter):

```ts
plugins: [auditFieldsPlugin(), activityLogPlugin()]
```

- Audit fields answer "who touched _this document_" on the document itself and per-version; the activity log answers "what happened _across the site_", including deletes and logins that per-document views can't show.
- The activity log reuses audit-fields' `resolveUserLabel` (unless you pass its own), so users display identically everywhere.
- Audit-fields' `createdBy`/`lastModifiedBy` are excluded from `changedFields`.

## Differences from @payload-bites/activity-log

This plugin is a rethink rather than a drop-in replacement (field names and stored shapes differ):

- Logging is **opt-out** (all collections/globals by default) instead of a required opt-in map.
- **No `data` json copy of the whole document on every change** — entries link to the version diff instead; snapshots only on permanent delete (configurable).
- The feed shows **document titles and user emails**, not raw IDs, and they survive deletion.
- Actors can belong to **any auth collection**, not only the admin user collection.
- **Local API writes are logged** whenever a user is attached (or `resolveUser` returns one) — instead of being skipped wholesale.
- Adds **trash/restore classification**, **changed-field names**, **logins/logouts**, and optional **retention pruning**.
- Autosave logging defaults **off** (was on).
- Read logging is not supported.

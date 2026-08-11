---
'@whatworks/payload-rbac': minor
---

feat(rbac): opt-in `compose` for access the config already defines, and an init notice for permissions that may be inert

The plugin only ever filled gaps in access control: an operation with an access function of its own kept it, and the matching RBAC permission never ran. Nothing errored — the permission was simply inert, which is easy to miss when the function came from another plugin or from a collection written before the plugin was added. Two additive changes make that visible and fixable:

- **`compose: { [slug]: RbacAction[] }`** opts individual entities and actions into `yourAccess AND permissionCheck` instead of standing aside. Both functions receive the same args and are awaited; results are ANDed the way Payload combines queries (`false` denies, `true` is the identity, two `Where` constraints become one `{ and: [...] }`), and the permission check is skipped when the existing function already denies. Listed actions with no existing function are plain gap fills, and unlisted entities/actions are untouched. `readVersions` follows `read`, `unlock` follows `update`. Unknown slugs, uncontrolled slugs, the roles collection, and actions an entity does not have throw at startup instead of quietly doing nothing. The AND itself is exported as `composeAccess`/`andAccessResults` for hand-written access.
- **A single informational log on init** names every controlled collection and global that defines access of its own, together with the operations affected, and points at `requirePermission` and `compose` as the fixes. It is informational because the plugin cannot know whether those functions already check permissions; operations opted into `compose` are excluded, nothing is logged when there is nothing to report, and `quiet: true` silences it.

Gap-filling remains the default for every collection, global and action, unchanged: composing by default would break public access — a collection whose `create` is `() => true` for anonymous submissions would start requiring a role that anonymous requests can never hold.

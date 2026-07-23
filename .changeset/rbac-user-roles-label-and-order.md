---
'@whatworks/payload-rbac': minor
---

The roles collection now defaults to the label **"User Roles"** (singular "User Role") and is placed directly after the last user/auth collection in the admin nav instead of at the end of the collection list.

- **Default labels** are `{ singular: 'User Role', plural: 'User Roles' }`. Override them as before via `rolesCollection.override`. The permissions matrix row for the roles collection is labelled "User Roles" to match.
- **Nav order**: the plugin inserts the roles collection immediately after the last collection in `userCollections` (the resolved auth collections, or `admin.user`), so roles sit next to the users they govern. It still appends at the end when no user collection is present.

---
'@whatworks/payload-rbac': minor
---

Administrators can only be managed by administrators. When an `adminRole` is configured, a user who does not hold it can no longer create, update, or delete an account that does — regardless of their `users:create`/`users:update`/`users:delete` permissions, and regardless of full access (`'*'`) held through another role. Holding the admin role is the only key.

This closes two gaps left by the existing guards: a non-administrator could previously edit non-credential fields of an administrator's document (only credentials were locked), and could delete any administrator except the last one (only the final holder was guarded). Both are now blocked outright.

Administrators still manage each other normally, subject to the last-holder guard; writes without a user (local API, seeds, first-user bootstrap) and the break-glass self-claim are unaffected. Exposes `createProtectAdminUsersChangeHook`, `createProtectAdminUsersDeleteHook`, and `findRoleIdByName`.

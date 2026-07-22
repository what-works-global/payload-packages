---
'@whatworks/payload-rbac': minor
---

Credential protection is now on by default for every user with a role. The password, email, and username of a user can be changed only by the account owner — anyone else is directed to a password-reset email — unless the user's roles are all opted out. This closes credential takeover out of the box instead of requiring a per-role opt-in.

- **`credentialChanges` defaults to `'self'`** (was `'anyone'`).
- **Roles created in the admin panel are self-only too**, always — the protection is built in, not a per-role setting, so it needs no field on the roles collection. `'anyone'` exists only as an explicit opt-out on a role you predefine in code.
- A user is exempt only when **every** role they hold is a predefined role marked `credentialChanges: 'anyone'`; holding one self-only role (including any database-defined role) keeps them protected. The `adminRole` is always `'self'`.

**Behavior change:** if you relied on the previous default — any user with `users:update` changing another user's credentials — mark the relevant predefined roles `credentialChanges: 'anyone'`. A user whose only roles are database-defined can no longer have their credentials changed by others at all; give them a predefined `'anyone'` role if that is required.

**API:** `ProtectCredentialsArgs` now takes `anyoneRoleNames` (the opt-out list) instead of `selfOnlyRoleNames`; the guard is installed on every user collection unconditionally.

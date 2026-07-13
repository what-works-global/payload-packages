# @whatworks/payload-rbac

## 0.1.0

### Minor Changes

- fda087e: Initial release: role based access control with database-defined roles, a per-collection CRUD checkbox matrix, code-predefined roles seeded on init, automatic access enforcement across collections and globals, privilege-escalation protection, a built-in `adminRole` locked to full access (it can never be downgraded, renamed, or deleted, can only be assigned by users who already hold it, is auto-assigned to the first user, and always has at least one holder — stripping or deleting the last administrator is blocked, and if the database is damaged so that no administrator exists at all, any signed-in user may claim the role for themselves as a break-glass recovery), opt-in `protected` roles locked to their code definition, and per-role credential protection (`credentialChanges: 'self'`, always on for the admin role) so a protected account's password, email, and username can only be changed by the account owner. Changing a user's roles requires the `roles:update` permission — the roles field renders read-only in the admin panel for everyone else — and a role your remaining roles could not re-grant cannot be removed from your own account, so users can never accidentally strip their own access.

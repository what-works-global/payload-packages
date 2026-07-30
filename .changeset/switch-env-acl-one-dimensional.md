---
'@whatworks/payload-switch-env': patch
---

fix(switch-env): stop Postgres copies failing with `ACL arrays must be one-dimensional`

The schema-privileges capture that runs before a Postgres restore passed `COALESCE(nspacl, ARRAY[]::aclitem[])` to `aclexplode`. An empty array built in SQL has zero dimensions, and `aclexplode` rejects anything that isn't exactly one-dimensional, so any target schema carrying only owner-default privileges (a null `nspacl` — the normal state of a plainly created schema, or of a `public` that was ever dropped and recreated) aborted the whole copy with `22023 ACL arrays must be one-dimensional`. Empty ACLs are now passed as NULL, which `aclexplode` treats as no grants.

# @whatworks/analytics — package notes

## Burned version numbers: 3.3.0 and 4.0.0

Versions **3.3.0** and **4.0.0** were published by accident (July 2026) and then
unpublished from npm, and their git tags were deleted. npm permanently forbids
reusing a version number that has ever been published, even after an unpublish.

- **Never publish 3.3.0 or 4.0.0 again** — the publish will be rejected.
- The next minor release on the 3.x line must be **3.4.0** (or 3.3.1 for a patch).
- The next major release must be **4.1.0** (or 4.0.1) — not 4.0.0.
- If Changesets computes 3.3.0 or 4.0.0 as the next version, bump the version in
  `package.json` past the burned number by hand before releasing.

The codebase was reverted to the 3.2.0 state, so `CHANGELOG.md` has no entries
for the unpublished versions. What they contained lives only in git history:
`ba40152` (3.3.0, cookie banner redesign) and `7db31b3` (4.0.0, headless
`useCookieBanner()`). The latest published version is **3.2.0**.

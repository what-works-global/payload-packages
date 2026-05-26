# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) — small markdown files describing pending version bumps and changelogs for the published packages in this monorepo.

## Adding a changeset

Run:

```
pnpm changeset
```

Pick the affected packages and the semver bump (patch / minor / major), and write a one-line summary. The summary lands in the released package's CHANGELOG.

## Release flow

On merge to `main`, the release workflow either opens / updates a "Version Packages" PR (if pending changesets exist) or publishes packages whose versions have been bumped. `@whatworks/dev-fixture` is private and excluded from release.

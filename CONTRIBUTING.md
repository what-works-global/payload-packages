# Contributing

Thanks for taking a look. Bug reports, reproductions, docs fixes, ideas and code are all useful. You don't need to write code to help.

This guide covers what is specific to this monorepo. The organisation-wide [contributing guide](https://github.com/what-works-global/.github/blob/main/CONTRIBUTING.md) and [code of conduct](https://github.com/what-works-global/.github/blob/main/CODE_OF_CONDUCT.md) apply too.

## Questions and ideas

If you're not sure whether something is a bug, or want to float an idea before building it, start a thread in [Discussions](https://github.com/what-works-global/payload-packages/discussions). For questions about Payload or Next.js themselves, their own docs and communities are usually faster.

## Reporting a bug

Open an issue using the bug report form. The most useful reports include:

- the package and the version you're on
- the versions of Payload, Next.js and Node involved
- the smallest reproduction you can manage: a config snippet, a failing test, or a small repo
- what you expected and what happened instead, including the full error

A good reproduction is often most of the fix.

**Security vulnerabilities are different.** Don't open a public issue. See [SECURITY.md](SECURITY.md).

## Proposing a change

For typos, docs fixes and obvious bugs, just open a pull request.

For anything larger — a new option, a behaviour change, a new package — open an issue or discussion first. A short "here's the problem, here's what I'm thinking" saves you from building something we'd have to push back on.

## Making a pull request

1. Fork the repository and create a branch from `main`.
2. Set up with `pnpm install`. The package manager is pnpm; `AGENTS.md` describes the repository's conventions and applies to humans too.
3. Keep the change focused. One fix or feature per PR, with no drive-by refactors.
4. Add or update tests, and update the package README when behaviour or options change.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` before pushing. CI also runs `pnpm test:peer`, which tests each Payload package against the oldest Payload version it supports and the latest 3.x.
6. **Add a changeset** for any change consumers would notice: `pnpm changeset`, pick the affected package(s) and a semver bump, and describe the change from the consumer's point of view. Releases are cut from accumulated changesets by the Release workflow on `main`.
7. Open the PR and fill in the template.

Draft PRs are welcome if you want early feedback.

## How review works

- A maintainer will review your PR. We aim to respond within a week or so; a polite nudge on the PR is fine after that.
- CI has to pass before merge.
- We may ask for changes, suggest a different approach, or occasionally decline something that doesn't fit a package's scope. When we decline, we'll explain why.
- Don't worry about a tidy commit history. We squash on merge.

## Finding something to work on

We label issues `good first issue` or `help wanted` only when they're genuinely approachable and we know what a good fix looks like. If nothing is labelled, ask in Discussions.

## Licensing

Every package is MIT licensed (see the `LICENSE.md` in each package). By contributing, you agree that your contribution is licensed the same way.

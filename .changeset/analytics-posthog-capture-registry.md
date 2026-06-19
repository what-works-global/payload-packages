---
'@whatworks/analytics': minor
---

Fix `capture()` (and consent toggling) silently no-opping in the Next.js App Router.

The live posthog-js instance was held in a module-level variable in `posthogClient`. Under React Server Components, `<PostHog>` (rendered from a server layout, so reached via a client reference) and the `capture()` an app imports can resolve to **separate copies** of that module — so the instance one copy initialised was invisible to the other and events were dropped. The instance is now anchored on a `Symbol.for`-keyed `globalThis` registry, shared across every module copy in the realm (the same pattern Next recommends for singletons like the Prisma client).

Also in this release:

- **`posthog-js` is now declared as an _optional_ peer dependency** (`peerDependenciesMeta`), replacing the previous implicit "install it yourself" requirement. Consumers who never import `@whatworks/analytics/posthog` still pull in neither the SDK nor its types.
- **New `getPostHog()` export** from `@whatworks/analytics/posthog`, returning the same initialised, fully-typed posthog-js instance. Use it for `identify()`, feature flags, group analytics, etc. instead of importing `posthog-js` directly (which can resolve to a different, uninitialised copy).

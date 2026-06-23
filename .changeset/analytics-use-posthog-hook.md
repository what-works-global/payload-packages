---
'@whatworks/analytics': minor
---

Add `usePostHog()` and `onPostHogReady()` to the `@whatworks/analytics/posthog` entry for reacting to PostHog readiness without polling.

The shared instance is initialised lazily — posthog-js is loaded via a dynamic `import()` only once the consent gate allows scripts — so `getPostHog()` returns `null` until that completes, with no signal for when it flips. Consumers that need the instance to run setup (e.g. `identify()` or a `register()` super property keyed on the signed-in user) previously had to poll `getPostHog()`.

`usePostHog()` is a reactive accessor backed by `useSyncExternalStore`: it returns `null` until init completes, then the live instance, re-rendering the caller when it flips. It composes with other reactive state — key a `useEffect` on `[posthog, user]` and it runs as soon as both are available and again whenever the user changes, with no polling and no missed edges. SSR-safe (returns `null` on the server).

`onPostHogReady(callback)` is the imperative counterpart for non-React callers: it invokes `callback` with the instance synchronously if already ready, otherwise when init completes, and returns an unsubscribe to cancel a still-pending callback.

Both are backed by a subscriber set on the shared cross-realm registry, so every duplicated module copy under Next's RSC model observes the same readiness signal. No new dependencies (`react` is already a peer; posthog-js stays an optional peer).

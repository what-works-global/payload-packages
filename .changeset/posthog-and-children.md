---
'@whatworks/analytics': minor
---

Add a first-class PostHog integration and let custom analytics scripts reuse the shared consent provider.

- `<Analytics>` now accepts `children`, rendered inside its `CookieBannerProvider`. Any `'use client'` script passed as a child can read consent via `useCookieBanner()` — no need to mount a second provider.
- New `<PostHog>` component: consent-gated, lazy-loads `posthog-js` via a runtime dynamic `import()`, defaults to PostHog EU Cloud, disables session replay, and uses `identified_only` profiles with opt-out-by-default. Wire it up via the new `posthogKey` / `posthogApiHost` / `posthogOptions` props on `<Analytics>` (env fallbacks `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`). `posthog-js` is **not** a dependency or peer dependency of this package — its types are kept out of the public API, so consumers that don't use PostHog pull in nothing. Install `posthog-js` yourself to use `<PostHog>`.
- New `capture()`, `getPostHog()`, `initPostHog()`, and `setPostHogConsent()` helpers so app code can send events through the same instance the provider manages.

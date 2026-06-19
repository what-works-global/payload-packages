---
'@whatworks/analytics': major
---

Compositional, tree-shakeable API. **Breaking.**

- `<Analytics>` no longer accepts vendor-ID props (`gtmId`, `gaId`, `clarityId`, `facebookPixelId`, `linkedInPartnerId`, `posthogKey`/`posthogApiHost`/`posthogOptions`). It is now a provider shell — compose the tags you want as children, each imported from its own subpath.
- New per-vendor subpaths: `@whatworks/analytics/google` (`GoogleAnalytics`, `GoogleTagManager`), `/linkedin` (`LinkedInInsightTag`), `/clarity` (`MicrosoftClarity`), `/facebook` (`FacebookPixel`), `/posthog` (`PostHog`, `capture`). The root entry keeps `Analytics`, `CookieBanner`, `CookieBannerProvider`, `CookieBannerPortal`, `useCookieBanner`.
- All exports are now **named** (no default exports).
- Every tag gains an `enabled` prop, defaulting to `process.env.NODE_ENV === 'production'`; `<Analytics enabled>` sets an inherited default for its children. This replaces the old top-level `NODE_ENV` gate and makes each script independently switchable (e.g. `<PostHog enabled />` to exercise it in development).
- Removed all `NEXT_PUBLIC_*` env-var fallbacks; pass IDs/keys explicitly as props.
- `GtagBootstrap` is no longer exported — `GoogleAnalytics`/`GoogleTagManager` render it internally (deduped by `next/script` id), so Consent Mode bootstrap can never be forgotten.
- `/posthog` no longer exports `getPostHog`, `initPostHog`, or `setPostHogConsent` — only `capture` and the `<PostHog>` component. Import `posthog-js` directly for advanced use.

**Migration:** replace `<Analytics gtmId=… clarityId=… posthogKey=… />` with `<Analytics>` wrapping `<GoogleTagManager gtmId=… />` / `<MicrosoftClarity clarityId=… />` / `<PostHog apiKey=… />` (each from its subpath); import `capture` from `@whatworks/analytics/posthog`. Apps served under a Next `basePath` must pass `consentApiPath` with the prefix (a browser `fetch` is not auto-prefixed).

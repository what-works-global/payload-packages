# @whatworks/analytics

## 3.0.0

### Major Changes

- 1af4818: Compositional, tree-shakeable API. **Breaking.**

  - `<Analytics>` no longer accepts vendor-ID props (`gtmId`, `gaId`, `clarityId`, `facebookPixelId`, `linkedInPartnerId`, `posthogKey`/`posthogApiHost`/`posthogOptions`). It is now a provider shell — compose the tags you want as children, each imported from its own subpath.
  - New per-vendor subpaths: `@whatworks/analytics/google` (`GoogleAnalytics`, `GoogleTagManager`), `/linkedin` (`LinkedInInsightTag`), `/clarity` (`MicrosoftClarity`), `/facebook` (`FacebookPixel`), `/posthog` (`PostHog`, `capture`). The root entry keeps `Analytics`, `CookieBanner`, `CookieBannerProvider`, `CookieBannerPortal`, `useCookieBanner`.
  - All exports are now **named** (no default exports).
  - Every tag gains an `enabled` prop, defaulting to `process.env.NODE_ENV === 'production'`; `<Analytics enabled>` sets an inherited default for its children. This replaces the old top-level `NODE_ENV` gate and makes each script independently switchable (e.g. `<PostHog enabled />` to exercise it in development).
  - Removed all `NEXT_PUBLIC_*` env-var fallbacks; pass IDs/keys explicitly as props.
  - `GtagBootstrap` is no longer exported — `GoogleAnalytics`/`GoogleTagManager` render it internally (deduped by `next/script` id), so Consent Mode bootstrap can never be forgotten.
  - `/posthog` no longer exports `getPostHog`, `initPostHog`, or `setPostHogConsent` — only `capture` and the `<PostHog>` component. Import `posthog-js` directly for advanced use.

  **Migration:** replace `<Analytics gtmId=… clarityId=… posthogKey=… />` with `<Analytics>` wrapping `<GoogleTagManager gtmId=… />` / `<MicrosoftClarity clarityId=… />` / `<PostHog apiKey=… />` (each from its subpath); import `capture` from `@whatworks/analytics/posthog`. Apps served under a Next `basePath` must pass `consentApiPath` with the prefix (a browser `fetch` is not auto-prefixed).

## 2.2.1

### Patch Changes

- 34f8902: Fix `<PostHog>` / `capture()` failing at runtime with `TypeError: init is not a function`. posthog-js ships no `exports` map, so a bundler can resolve the dynamic `import('posthog-js')` to its CJS build and wrap the namespace a level too deep, leaving the singleton at `mod.default.default` (or `mod.posthog`) rather than `mod.default`. `initPostHog` now probes those locations and uses whichever candidate actually exposes `init()`.

## 2.2.0

### Minor Changes

- 62277ca: Add a first-class PostHog integration and let custom analytics scripts reuse the shared consent provider.

  - `<Analytics>` now accepts `children`, rendered inside its `CookieBannerProvider`. Any `'use client'` script passed as a child can read consent via `useCookieBanner()` — no need to mount a second provider.
  - New `<PostHog>` component: consent-gated, lazy-loads `posthog-js` via a runtime dynamic `import()`, defaults to PostHog EU Cloud, disables session replay, and uses `identified_only` profiles with opt-out-by-default. Wire it up via the new `posthogKey` / `posthogApiHost` / `posthogOptions` props on `<Analytics>` (env fallbacks `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`). `posthog-js` is **not** a dependency or peer dependency of this package — its types are kept out of the public API, so consumers that don't use PostHog pull in nothing. Install `posthog-js` yourself to use `<PostHog>`.
  - New `capture()`, `getPostHog()`, `initPostHog()`, and `setPostHogConsent()` helpers so app code can send events through the same instance the provider manages.

## 2.1.4

### Patch Changes

- 4abd2d0: Detect the viewer country in the consent API on AWS Amplify Hosting (`cloudfront-viewer-country`) and Cloudflare (`cf-ipcountry`) in addition to Vercel (`x-vercel-ip-country`). Previously, on non-Vercel hosts the country was always unknown, so `requiresConsent` was `true` for every visitor and consent was revoked after the geolocation check regardless of location.

## 2.1.3

### Patch Changes

- dc43fd8: `GoogleTagManager` now loads the container via Google's official IIFE snippet, which pushes `gtm.start` and injects `gtm.js` in one synchronous step. This replaces the split `beforeInteractive` init + `afterInteractive` `src` approach, removing any ordering/caching race and presenting the canonical loader GTM self-checks for (fixes the "tag installed incorrectly" diagnostic). The SSR preload link is kept via an explicit `<link rel="preload">`.

## 2.1.2

### Patch Changes

- 6005107: `GoogleTagManager` now renders the GTM `<noscript>` `ns.html` iframe fallback (gated on granted consent) for clients with JavaScript disabled.

## 2.1.1

### Patch Changes

- eb9f97a: Push the `gtm.start` dataLayer event from a `beforeInteractive` script so it always precedes the `gtm.js` container. Previously both ran at `afterInteractive`, letting the SSR-preloaded container execute before `gtm.start` was set, which made GTM report the tag as "installed incorrectly". The container `src` still emits its SSR preload link.

## 2.1.0

### Minor Changes

- 748cd50: Add `consentApiPath` and `consentStrategy` props to `<Analytics>` so consumers can configure the consent endpoint and strategy (defaults unchanged: `/api/consent` and `load-scripts-then-revoke-consent-after-geolocation-check`). Each strategy is now documented via JSDoc.

  `GoogleTagManager` now loads `gtm.js` through a `next/script` `src` tag (with a small dataLayer init) instead of an inline injector, so it emits an SSR preload link and gains `onLoad`/`onError` handling.

## 2.0.2

### Patch Changes

- 80620b7: fix(analytics): preserve the RSC `'use client'` boundary

  `Analytics` is a server component that composes nine `'use client'` components
  (`GoogleAnalytics`, `GoogleTagManager`, `FacebookPixel`, `MicrosoftClarity`,
  `LinkedInInsightTag`, `GtagBootstrap`, `CookieBanner`, `CookieBannerPortal`,
  `CookieBannerProvider`). Bundling collapsed them into a single directive-less
  module, so the client components were executed on the server and threw. The
  build now emits one file per source module (`unbundle`), keeping each
  `'use client'` directive intact.

## 2.0.1

### Patch Changes

- c67e83b: Compile JSX with the React automatic runtime

## 2.0.0

### Major Changes

- d17dc89: Overhaul build, test, and release pipeline. Packages are now built with [tsdown](https://github.com/rolldown/tsdown) (rolldown-based) instead of swc, and emit a single ESM output with sourcemaps and bundled `.d.ts` files. Module resolution, bundled vs externalized deps, and tree-shaking behaviour may differ from prior releases — verify your build against the new output.

  Additionally, `@whatworks/payload-utilities` raises its peer-dep range for `payload`, `@payloadcms/richtext-lexical`, and `@payloadcms/translations` from `>=3.0.2` to `>=3.29.0`. The new floor reflects what the source actually requires: `@payloadcms/ui/utilities/getSchemaMap` was introduced in 3.2.0 and `@payloadcms/richtext-lexical/plaintext` was introduced in 3.29.0 — the package never worked on versions below the new floor.

# @whatworks/analytics

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

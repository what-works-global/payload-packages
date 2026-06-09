---
"@whatworks/analytics": minor
---

Add `consentApiPath` and `consentStrategy` props to `<Analytics>` so consumers can configure the consent endpoint and strategy (defaults unchanged: `/api/consent` and `load-scripts-then-revoke-consent-after-geolocation-check`). Each strategy is now documented via JSDoc.

`GoogleTagManager` now loads `gtm.js` through a `next/script` `src` tag (with a small dataLayer init) instead of an inline injector, so it emits an SSR preload link and gains `onLoad`/`onError` handling.

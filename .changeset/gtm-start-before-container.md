---
'@whatworks/analytics': patch
---

Push the `gtm.start` dataLayer event from a `beforeInteractive` script so it always precedes the `gtm.js` container. Previously both ran at `afterInteractive`, letting the SSR-preloaded container execute before `gtm.start` was set, which made GTM report the tag as "installed incorrectly". The container `src` still emits its SSR preload link.

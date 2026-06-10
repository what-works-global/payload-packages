---
'@whatworks/analytics': patch
---

`GoogleTagManager` now loads the container via Google's official IIFE snippet, which pushes `gtm.start` and injects `gtm.js` in one synchronous step. This replaces the split `beforeInteractive` init + `afterInteractive` `src` approach, removing any ordering/caching race and presenting the canonical loader GTM self-checks for (fixes the "tag installed incorrectly" diagnostic). The SSR preload link is kept via an explicit `<link rel="preload">`.

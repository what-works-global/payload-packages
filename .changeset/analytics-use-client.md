---
'@whatworks/analytics': patch
---

fix(analytics): preserve the RSC `'use client'` boundary

`Analytics` is a server component that composes nine `'use client'` components
(`GoogleAnalytics`, `GoogleTagManager`, `FacebookPixel`, `MicrosoftClarity`,
`LinkedInInsightTag`, `GtagBootstrap`, `CookieBanner`, `CookieBannerPortal`,
`CookieBannerProvider`). Bundling collapsed them into a single directive-less
module, so the client components were executed on the server and threw. The
build now emits one file per source module (`unbundle`), keeping each
`'use client'` directive intact.

---
'@whatworks/payload-sitemap': patch
---

Resolve the sitemap origin from the incoming request's public host (`x-forwarded-host`/`Host`, then the request URL) before any environment fallback, so zero-config deployments mirror whichever domain each sitemap was requested on. An explicit `siteUrl` option still pins a canonical domain; `SITE_URL`, `NEXT_PUBLIC_SERVER_URL`, and Vercel's project URL now only apply when no request is available. The robots metadata route reads `next/headers` when the origin isn't pinned, and an empty `x-forwarded-host` header no longer shadows `Host`.

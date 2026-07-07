---
'@whatworks/payload-sitemap': minor
---

Rename the `robots.isProduction` option to `robots.allowIndexing`. It names the effect directly: when `false`, robots.txt disallows everything so non-production environments stay out of search indexes. The default is unchanged (`VERCEL_ENV`/`NODE_ENV === 'production'`).

**Breaking:** rename `isProduction` to `allowIndexing` in your `robots` config and in any `createRobots` / `generateRobotsTxt` overrides.

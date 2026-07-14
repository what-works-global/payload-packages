---
'@whatworks/payload-algolia-search': minor
---

Add Algolia Insights support to the `/react` entry. New `useInsights` hook returns `sendClick`/`sendConversion` for click/conversion tracking, built on the official `search-insights` client — added as an **optional peer dependency** and loaded lazily the first time the hook runs, so it stays out of bundles that never track (install it only in apps that call `useInsights`). `useAlgoliaSearch` gains a `clickAnalytics` option that surfaces a `queryID` and stamps `__queryID`/`__position` on every hit, so clicks are reported as `clickedObjectIDsAfterSearch` and attributed to the search that surfaced them. Closes the previous gap that required dropping down to `react-instantsearch` for analytics.

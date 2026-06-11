---
'@whatworks/analytics': patch
---

Detect the viewer country in the consent API on AWS Amplify Hosting (`cloudfront-viewer-country`) and Cloudflare (`cf-ipcountry`) in addition to Vercel (`x-vercel-ip-country`). Previously, on non-Vercel hosts the country was always unknown, so `requiresConsent` was `true` for every visitor and consent was revoked after the geolocation check regardless of location.

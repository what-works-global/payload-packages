---
'@whatworks/payload-switch-env': patch
---

Fix payload version auto-detection still failing in Vercel deployments.

The filesystem walk introduced previously could still miss the installed payload package in traced serverless bundles, leaving deployments with the "Could not auto-detect the installed payload version" warning. Detection now asks payload itself first: it calls `getDependencies` (exported from `payload` since 3.0.0) to resolve payload's own package.json with Node's resolver. Because that helper executes inside the payload package — which Next.js keeps in `serverExternalPackages` and never bundles — it always runs with real runtime paths, so resolution works anywhere payload itself loads. The filesystem walk remains as a fallback, and `detectPayloadVersion` is now async (the plugin callback already was).

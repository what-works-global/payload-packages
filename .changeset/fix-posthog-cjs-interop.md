---
'@whatworks/analytics': patch
---

Fix `<PostHog>` / `capture()` failing at runtime with `TypeError: init is not a function`. posthog-js ships no `exports` map, so a bundler can resolve the dynamic `import('posthog-js')` to its CJS build and wrap the namespace a level too deep, leaving the singleton at `mod.default.default` (or `mod.posthog`) rather than `mod.default`. `initPostHog` now probes those locations and uses whichever candidate actually exposes `init()`.

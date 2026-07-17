---
'@whatworks/analytics': major
---

Remove the pre-styled `CookieBanner` component — the package is now headless and ships no banner UI or CSS. Design your banner in your own codebase and drive it from `useCookieBanner()` (`shouldShowBanner`, `accept()`, `reject()`), optionally rendering it through the still-exported `CookieBannerPortal`. See the README's "Build your own cookie banner" section for a drop-in starting point. The Tailwind toolchain and `dist/styles.css` output are gone along with it.

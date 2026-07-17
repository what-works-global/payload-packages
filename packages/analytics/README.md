# NextJS Analytics

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Analytics" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Analytics components for Next.js (App Router) with built-in cookie consent. Most vendor snippets assume a full page reload on every navigation, so when you drop them straight into `layout.tsx` the initial page view fires but client-side route changes are never tracked — you end up with a single hit per session. This package wraps the tracking scripts most projects need — Google Analytics, Google Tag Manager, Facebook Pixel, Microsoft Clarity, LinkedIn Insight Tag, and PostHog — in components that load via `next/script` and re-fire page views off `usePathname` as the user navigates, all gated through a shared consent provider that can optionally require consent by geolocation (EEA / UK / CH).

Each vendor lives in its own subpath import, so you only ever bundle the tags you actually use.

## Contents

- [Installation](#installation)
- [Usage](#usage)
  - [1. Add the consent API route](#1-add-the-consent-api-route)
  - [2. Compose `<Analytics>` in your root layout](#2-compose-analytics-in-your-root-layout)
  - [3. Build your own cookie banner](#3-build-your-own-cookie-banner)
  - [4. Enabling and disabling tags](#4-enabling-and-disabling-tags)
- [PostHog](#posthog)
- [Custom analytics scripts](#custom-analytics-scripts)
- [Consent strategies](#consent-strategies)
- [Subpaths and components](#subpaths-and-components)
- [Notes](#notes)

## Installation

```bash
pnpm add @whatworks/analytics
```

Peer deps: `next >= 13.4`, `react >= 18.2`.

## Usage

### 1. Add the consent API route

The provider needs an endpoint that returns whether the current request requires consent. A default handler is exported that uses Vercel's `x-vercel-ip-country` header to flag EEA / UK / CH visitors.

```ts
// app/api/consent/route.ts
export { GET } from '@whatworks/analytics/api/consent'
```

If you aren't on Vercel, write your own handler that returns `{ requiresConsent: boolean }`.

> **basePath:** under a Next `basePath`, pass the prefixed path to `<Analytics consentApiPath>` (e.g. `consentApiPath="/my-app/api/consent"`) — a browser `fetch` is not auto-prefixed.

### 2. Compose `<Analytics>` in your root layout

`<Analytics>` is a provider shell: it wires up cookie consent and renders whatever tags you pass as children. Import each tag from its vendor subpath and give it the IDs it needs.

```tsx
// app/layout.tsx
import { Analytics } from '@whatworks/analytics'
import { GoogleAnalytics, GoogleTagManager } from '@whatworks/analytics/google'
import { MicrosoftClarity } from '@whatworks/analytics/clarity'
import { FacebookPixel } from '@whatworks/analytics/facebook'
import { LinkedInInsightTag } from '@whatworks/analytics/linkedin'
import { PostHog } from '@whatworks/analytics/posthog'
import { CookieBanner } from './CookieBanner' // yours — see the next step

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics>
          <GoogleAnalytics gaId="G-XXXX" />
          <GoogleTagManager gtmId="GTM-XXXX" />
          <FacebookPixel pixelId="0000000000" />
          <MicrosoftClarity clarityId="xxxxxxxx" />
          <LinkedInInsightTag partnerId="1234567" />
          <PostHog apiKey="phc_XXXX" />
          <CookieBanner />
        </Analytics>
        {children}
      </body>
    </html>
  )
}
```

Render only the tags you need — each is independent. Pass IDs explicitly as props; there are no environment-variable fallbacks (read your own `process.env.NEXT_PUBLIC_*` at the call site if you want them).

### 3. Build your own cookie banner

The package ships **no banner UI** — you design the banner in your codebase, with your own styling system, and drive it from the consent context via `useCookieBanner()`. The hook exposes everything the banner needs: `shouldShowBanner`, `accept()`, `reject()` (plus `consentStatus` / `shouldLoadScripts` if you want them). Render it **inside** `<Analytics>` so it can read the context:

```tsx
// app/CookieBanner.tsx
'use client'
import { CookieBannerPortal, useCookieBanner } from '@whatworks/analytics'

export function CookieBanner() {
  const { accept, reject, shouldShowBanner } = useCookieBanner()

  if (!shouldShowBanner) {
    return null
  }

  return (
    <CookieBannerPortal>
      <div className="your-banner-styles">
        <h3>We use cookies</h3>
        <p>
          We use cookies to analyse traffic and run ad campaigns. See our{' '}
          <a href="/privacy-policy">Privacy Policy</a>.
        </p>
        <button onClick={accept} type="button">
          Accept all
        </button>
        <button onClick={reject} type="button">
          Accept essential only
        </button>
      </div>
    </CookieBannerPortal>
  )
}
```

`CookieBannerPortal` is an optional helper that portals your banner into a `document.body`-level node (default id `cookie-banner-root`, override via `portalId`), so a fixed-position banner isn't trapped by a parent's stacking context or `transform`. Skip it if your layout doesn't need that.

The provider handles everything behind the hook: `shouldShowBanner` is only `true` when the geolocation check says consent is required **and** the visitor hasn't already decided; `accept()` / `reject()` persist the decision to `localStorage` and flip consent for every tag at once.

### 4. Enabling and disabling tags

Every tag accepts an `enabled` prop. It defaults to `process.env.NODE_ENV === 'production'`, so tags stay inert in `next dev` and run on production and preview builds. Set it explicitly to override:

```tsx
<PostHog apiKey="phc_XXXX" enabled />              {/* force on — e.g. to test in dev */}
<GoogleAnalytics gaId="G-XXXX" enabled={false} />  {/* force off */}
```

`<Analytics enabled>` sets the default for every child tag; a tag's own prop still wins:

```tsx
<Analytics enabled={flags.analytics}>
  <GoogleAnalytics gaId="G-XXXX" /> {/* inherits flags.analytics */}
  <PostHog apiKey="phc_XXXX" enabled /> {/* overrides → always on */}
</Analytics>
```

This replaces the old top-level `NODE_ENV` gate: the provider itself always mounts (so consent context is available), and the production-only default is now resolved per tag.

## PostHog

PostHog ships as a `posthog-js` npm module rather than an inline snippet. It is **not** a dependency (or peer dependency) of this package — it is loaded via a runtime dynamic `import()` and its types are kept out of the public API, so nothing is pulled in unless you import `@whatworks/analytics/posthog`. If you use `<PostHog>`, install posthog-js yourself:

```bash
pnpm add posthog-js
```

Pass `apiKey` and it loads lazily, consent-gated, behind the same provider as every other tag — so the SDK only downloads once consent is granted. Sensible defaults are applied — PostHog EU Cloud host, session replay off, `identified_only` profiles, opt-out until consent is granted — and can be overridden via `apiHost` / `options`:

```tsx
import { PostHog } from '@whatworks/analytics/posthog'
;<PostHog apiKey="phc_XXXX" apiHost="https://eu.i.posthog.com" />
```

Send custom events from anywhere in the app with `capture()`. It routes to the same instance the provider manages and no-ops until PostHog has loaded and consent is granted, so it is always safe to call:

```tsx
import { capture } from '@whatworks/analytics/posthog'

capture('table_company_opened', { companyId, companyName })
```

For anything beyond `capture()` — `identify()`, feature flags, group analytics — import `posthog-js` directly (you already have it installed).

## Custom analytics scripts

To add a script the package doesn't ship, render it as a child of `<Analytics>`. Children mount **inside** the shared `CookieBannerProvider`, so a `'use client'` component can call `useCookieBanner()` for consent without mounting its own provider:

```tsx
'use client'
import { useCookieBanner } from '@whatworks/analytics'

function MyTag() {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  // load your script / apply consent...
  return null
}

// in layout.tsx
;<Analytics>
  <MyTag />
</Analytics>
```

## Consent strategies

`<Analytics>` accepts a `consentStrategy` prop, defaulting to `load-scripts-then-revoke-consent-after-geolocation-check` — good for most marketing sites:

```tsx
<Analytics consentStrategy="require-consent-before-loading-scripts">
  <GoogleAnalytics gaId="G-XXXX" />
</Analytics>
```

`<Analytics>` is a server component. To compose tags from a `'use client'` file, render `CookieBannerProvider` directly instead — it is the same provider `<Analytics>` wraps, minus the inherited `enabled` default (so pass `enabled` to each tag yourself):

```tsx
'use client'
import { CookieBannerProvider } from '@whatworks/analytics'
import { GoogleAnalytics } from '@whatworks/analytics/google'
import { CookieBanner } from './CookieBanner' // yours — see step 3
;<CookieBannerProvider
  consentApiPath="/api/consent"
  consentStrategy="require-consent-before-loading-scripts"
>
  <GoogleAnalytics gaId="G-XXXX" enabled />
  <CookieBanner />
</CookieBannerProvider>
```

| Strategy                                                   | Scripts load       | Default consent         | Banner shown               |
| ---------------------------------------------------------- | ------------------ | ----------------------- | -------------------------- |
| `load-scripts-always-grant-consent`                        | immediately        | granted                 | never                      |
| `load-scripts-revoke-consent-immediately`                  | immediately        | denied                  | if geolocation requires it |
| `load-scripts-then-revoke-consent-after-geolocation-check` | immediately        | granted until geo check | if geolocation requires it |
| `require-consent-before-loading-scripts`                   | only after consent | denied                  | if geolocation requires it |

## Subpaths and components

| Import                             | Exports                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `@whatworks/analytics`             | `Analytics`, `CookieBannerProvider`, `CookieBannerPortal`, `useCookieBanner`, `ConsentStrategy` |
| `@whatworks/analytics/google`      | `GoogleAnalytics`, `GoogleTagManager`                                                           |
| `@whatworks/analytics/linkedin`    | `LinkedInInsightTag`                                                                            |
| `@whatworks/analytics/clarity`     | `MicrosoftClarity`                                                                              |
| `@whatworks/analytics/facebook`    | `FacebookPixel`                                                                                 |
| `@whatworks/analytics/posthog`     | `PostHog`, `capture`                                                                            |
| `@whatworks/analytics/api/consent` | `GET` (consent route handler)                                                                   |

All exports are named, and every tag's `Props` type is exported alongside it (e.g. `GoogleAnalyticsProps`).

- **`<Analytics>`** — provider shell. Sets up consent and the inherited `enabled` default, then renders the tags you pass as children. Props: `enabled?`, `consentStrategy?`, `consentApiPath?`.
- **`<CookieBannerProvider>`** / **`useCookieBanner()`** — consent context. Exposes `consentStatus`, `shouldLoadScripts`, `shouldShowBanner`, `accept()`, `reject()`. Drive your own banner UI from the hook — the package ships none (see [Build your own cookie banner](#3-build-your-own-cookie-banner)).
- **`<CookieBannerPortal>`** — optional helper that portals children into a `document.body`-level node (`portalId?`, default `cookie-banner-root`) so a fixed banner escapes parent stacking contexts.
- **`<GoogleAnalytics gaId>`** (`/google`) — GA4 config script. Renders the shared `gtag` / Consent Mode bootstrap internally.
- **`<GoogleTagManager gtmId>`** (`/google`) — GTM container script plus the `<noscript>` `ns.html` fallback (see note below). Renders the shared bootstrap internally; deduped automatically when GA is also present.
- **`<FacebookPixel pixelId>`** (`/facebook`) — Meta Pixel with SPA route tracking and noscript fallback.
- **`<MicrosoftClarity clarityId>`** (`/clarity`) — Clarity with consent v2 signalling. **You must disable cookies in the Clarity dashboard for GDPR compliance** — see [Clarity's docs](https://learn.microsoft.com/en-us/clarity/setup-and-installation/cookie-consent).
- **`<LinkedInInsightTag partnerId>`** (`/linkedin`) — LinkedIn Insight Tag, consent-gated. Loads only once consent is granted (LinkedIn has no native consent API).
- **`<PostHog apiKey>`** (`/posthog`) — PostHog product analytics, consent-gated. Lazy-loads `posthog-js` (which you install yourself; not a dependency of this package), opts out until consent is granted. Pair with `capture()` for events.

Every tag also accepts an `enabled` prop — see [Enabling and disabling tags](#4-enabling-and-disabling-tags). The shared `gtag` bootstrap is an internal detail of the Google tags and is no longer exported.

## Notes

- If your GTM container includes a GA4 Configuration tag for the same property as `gaId`, `page_view` events will be double-counted. Pick one side.
- All tag components are `'use client'`; `<Analytics>` itself is a server component, so compose it from a server layout. To use the tags from a `'use client'` file, render `CookieBannerProvider` directly (see [Consent strategies](#consent-strategies)).
- **`<noscript>` fallbacks reflect the _server-rendered_ consent posture only.** A client with JS disabled never runs the geolocation check or banner, so the GTM/Facebook/LinkedIn `<noscript>` tags appear only under grant-by-default strategies (`load-scripts-always-grant-consent`, `load-scripts-then-revoke-consent-after-geolocation-check`) and cannot honor a region-based revoke. To gate the no-JS path by region, seed `requiresConsent` from request headers at SSR rather than relying on the client `fetch`.

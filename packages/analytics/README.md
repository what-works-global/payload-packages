# NextJS Analytics

<a href="https://whatworks.com.au/?utm_source=github.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Analytics" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

Analytics components for Next.js (App Router) with built-in cookie consent. Most vendor snippets assume a full page reload on every navigation, so when you drop them straight into `layout.tsx` the initial page view fires but client-side route changes are never tracked — you end up with a single hit per session. This package wraps the tracking scripts most projects need — Google Analytics, Google Tag Manager, Facebook Pixel, Microsoft Clarity, and LinkedIn Insight Tag — in components that load via `next/script` and re-fire page views off `usePathname` as the user navigates, all gated through a shared consent provider that can optionally require consent by geolocation (EEA / UK / CH).

## Contents

- [Installation](#installation)
- [Usage](#usage)
  - [1. Add the consent API route](#1-add-the-consent-api-route)
  - [2. Render `<Analytics>` in your root layout](#2-render-analytics-in-your-root-layout)
  - [3. Configure IDs](#3-configure-ids)
- [Consent strategies](#consent-strategies)
- [Components](#components)
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

### 2. Render `<Analytics>` in your root layout

```tsx
// app/layout.tsx
import { Analytics, CookieBanner } from '@whatworks/analytics'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Analytics />
        {children}
        <CookieBanner />
      </body>
    </html>
  )
}
```

`<Analytics>` is a no-op outside of `NODE_ENV === 'production'`.

### 3. Configure IDs

Each script is only rendered when its ID is present. Pass IDs as props, or set the matching env var:

| Prop                | Env var                              |
| ------------------- | ------------------------------------ |
| `gaId`              | `NEXT_PUBLIC_GOOGLE_ANALYTICS_ID`    |
| `gtmId`             | `NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID`  |
| `facebookPixelId`   | `NEXT_PUBLIC_FACEBOOK_PIXEL_ID`      |
| `clarityId`         | `NEXT_PUBLIC_MS_CLARITY_ID`          |
| `linkedInPartnerId` | `NEXT_PUBLIC_LINKEDIN_PARTNER_ID`    |

```tsx
<Analytics gaId="G-XXXX" linkedInPartnerId="1234567" />
```

## Consent strategies

`CookieBannerProvider` accepts a `consentStrategy` prop. `<Analytics>` defaults to `load-scripts-then-revoke-consent-after-geolocation-check` — good for most marketing sites. If you want finer control, compose the pieces yourself:

```tsx
import {
  CookieBannerProvider,
  CookieBanner,
  GoogleAnalytics,
  GtagBootstrap,
} from '@whatworks/analytics'

<CookieBannerProvider
  consentApiPath="/api/consent"
  consentStrategy="require-consent-before-loading-scripts"
>
  <GtagBootstrap />
  <GoogleAnalytics gaId="G-XXXX" />
  <CookieBanner />
</CookieBannerProvider>
```

| Strategy | Scripts load | Default consent | Banner shown |
| --- | --- | --- | --- |
| `load-scripts-always-grant-consent` | immediately | granted | never |
| `load-scripts-revoke-consent-immediately` | immediately | denied | if geolocation requires it |
| `load-scripts-then-revoke-consent-after-geolocation-check` | immediately | granted until geo check | if geolocation requires it |
| `require-consent-before-loading-scripts` | only after consent | denied | if geolocation requires it |

## Components

- **`<Analytics>`** — top-level composition. Renders the provider and every tag whose ID is present.
- **`<CookieBanner>`** — default banner UI with `title`, `description`, `acceptText`, `rejectText` props. Only visible when the provider decides it should be.
- **`<CookieBannerProvider>`** / **`useCookieBanner()`** — consent context. Exposes `consentStatus`, `shouldLoadScripts`, `shouldShowBanner`, `accept()`, `reject()`.
- **`<GtagBootstrap>`** — shared `dataLayer` + `gtag` stub and Consent Mode state. Render once when using either GA or GTM.
- **`<GoogleAnalytics gaId>`** — GA4 config script.
- **`<GoogleTagManager gtmId>`** — GTM container script.
- **`<FacebookPixel pixelId>`** — Meta Pixel with SPA route tracking and noscript fallback.
- **`<MicrosoftClarity clarityId>`** — Clarity with consent v2 signalling. **You must disable cookies in the Clarity dashboard for GDPR compliance** — see [Clarity's docs](https://learn.microsoft.com/en-us/clarity/setup-and-installation/cookie-consent).
- **`<LinkedInInsightTag partnerId>`** — LinkedIn Insight Tag, consent-gated. Loads only once consent is granted (LinkedIn has no native consent API).

## Notes
- If your GTM container includes a GA4 Configuration tag for the same property as `gaId`, `page_view` events will be double-counted. Pick one side.
- The default `CookieBanner` renders into a portal and links to `/privacy-policy` — pass a custom `description` to override.
- All script components are `'use client'`; `<Analytics>` itself is a server component.

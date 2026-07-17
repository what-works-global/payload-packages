'use client'

import {
  type ConsentStrategy,
  CookieBannerPortal,
  CookieBannerProvider,
  useCookieBanner,
} from '@whatworks/analytics'
import { MicrosoftClarity } from '@whatworks/analytics/clarity'
import { FacebookPixel } from '@whatworks/analytics/facebook'
import { GoogleAnalytics, GoogleTagManager } from '@whatworks/analytics/google'
import { useMemo, useState } from 'react'

// The package ships no banner UI — this is the pattern consumers follow: build
// your own banner in your codebase on top of `useCookieBanner()`, optionally
// rendering it through `CookieBannerPortal` to escape any local stacking context.
function DevCookieBanner() {
  const { accept, reject, shouldShowBanner } = useCookieBanner()

  if (!shouldShowBanner) {
    return null
  }

  return (
    <CookieBannerPortal>
      <div
        style={{
          background: 'white',
          border: '1px solid #ccc',
          borderRadius: '0.5rem',
          bottom: '1rem',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
          display: 'grid',
          gap: '0.75rem',
          maxWidth: '28rem',
          padding: '1.5rem',
          position: 'fixed',
          right: '1rem',
          zIndex: 50,
        }}
      >
        <strong>We use cookies</strong>
        <p style={{ margin: 0 }}>
          Custom banner rendered by the dev app itself — the package only supplies the consent state
          via <code>useCookieBanner()</code>.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={accept} type="button">
            Accept all
          </button>
          <button onClick={reject} type="button">
            Essential only
          </button>
        </div>
      </div>
    </CookieBannerPortal>
  )
}

const STRATEGIES: ConsentStrategy[] = [
  'load-scripts-always-grant-consent',
  'require-consent-before-loading-scripts',
  'load-scripts-revoke-consent-immediately',
  'load-scripts-then-revoke-consent-after-geolocation-check',
]

export default function Page() {
  const [consentStrategy, setConsentStrategy] = useState<ConsentStrategy>(STRATEGIES[3])

  const exampleIds = useMemo(
    () => ({
      clarityId: 'testclarity',
      facebookPixelId: '1234567890',
      gaId: 'G-TEST1234',
      gtmId: 'GTM-TEST123',
    }),
    [],
  )

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Analytics Dev App</h1>
      <div style={{ alignItems: 'center', display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <label htmlFor="consent-strategy">Consent strategy</label>
        <select
          id="consent-strategy"
          onChange={(event) => setConsentStrategy(event.target.value as ConsentStrategy)}
          value={consentStrategy}
        >
          {STRATEGIES.map((strategy) => (
            <option key={strategy} value={strategy}>
              {strategy}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            localStorage.removeItem('cookiesAllowed')
            window.location.reload()
          }}
          type="button"
        >
          Clear decision
        </button>
      </div>
      <p style={{ marginBottom: '2rem', maxWidth: '48rem' }}>
        Use this page to validate consent behavior across strategies. The consent endpoint lives at
        <code style={{ marginLeft: '0.5rem' }}>/api/consent</code>.
      </p>
      <CookieBannerProvider consentApiPath="/api/consent" consentStrategy={consentStrategy}>
        {/*
          `enabled` is passed explicitly so the tags run in `next dev`, where the
          production-only default would otherwise keep them inert. GtagBootstrap is
          no longer rendered here — GoogleAnalytics/GoogleTagManager self-render it.
        */}
        <FacebookPixel enabled pixelId={exampleIds.facebookPixelId} />
        <GoogleAnalytics enabled gaId={exampleIds.gaId} />
        <GoogleTagManager enabled gtmId={exampleIds.gtmId} />
        <MicrosoftClarity clarityId={exampleIds.clarityId} enabled />
        <DevCookieBanner />
      </CookieBannerProvider>

      <section style={{ marginTop: '60vh', maxWidth: '48rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Long-form page content</h2>
        <p style={{ marginBottom: '1rem' }}>
          This block gives the page enough height to scroll while the cookie banner stays fixed at
          the bottom of the viewport.
        </p>
        <div style={{ display: 'grid', gap: '1rem' }}>
          <p>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse
            lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor.
          </p>
          <p>
            Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod
            non, mi. Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum
            diam nisl sit amet erat.
          </p>
          <p>
            Duis arcu massa, scelerisque vitae, consequat in, pretium a, enim. Pellentesque congue.
            Ut in risus volutpat libero pharetra tempor. Cras vestibulum bibendum augue.
          </p>
          <p>
            Ut tincidunt tincidunt erat. Maecenas fermentum consequat mi. Donec fermentum.
            Pellentesque malesuada nulla a mi. Duis sapien sem, aliquet nec, commodo eget, consequat
            quis, neque.
          </p>
        </div>
      </section>
    </main>
  )
}

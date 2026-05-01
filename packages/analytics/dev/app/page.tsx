'use client'

import {
  type ConsentStrategy,
  CookieBanner,
  CookieBannerProvider,
  FacebookPixel,
  GoogleAnalytics,
  GoogleTagManager,
  MicrosoftClarity,
} from '@whatworks/analytics'
import { useMemo, useState } from 'react'

const STRATEGIES: ConsentStrategy[] = [
  'load-scripts-always-grant-consent',
  'require-consent-before-loading-scripts',
  'load-scripts-revoke-consent-immediately',
  'load-scripts-then-revoke-consent-after-geolocation-check',
]

export default function Page() {
  const [consentStrategy, setConsentStrategy] = useState<ConsentStrategy>(STRATEGIES[0])

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
        <FacebookPixel pixelId={exampleIds.facebookPixelId} />
        <GoogleAnalytics gaId={exampleIds.gaId} />
        <GoogleTagManager gtmId={exampleIds.gtmId} />
        <MicrosoftClarity clarityId={exampleIds.clarityId} />
        <CookieBanner />
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

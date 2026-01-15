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
  'require-consent-before-loading-scripts',
  'load-scripts-revoke-consent-immediately',
  'load-scripts-then-revoke-consent-after-geolocation-check',
]

export default function Page() {
  const [consentStrategy, setConsentStrategy] = useState<ConsentStrategy>(STRATEGIES[2])

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
    </main>
  )
}

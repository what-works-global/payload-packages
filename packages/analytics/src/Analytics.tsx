// This is just an example file of how you would use this package in your own project

import { CookieBannerProvider } from './CookieBannerProvider.js'
import FacebookPixel from './FacebookPixel.js'
import GoogleAnalytics from './GoogleAnalytics.js'
import GoogleTagManager from './GoogleTagManager.js'
import MicrosoftClarity from './MicrosoftClarity.js'

export default function Analytics() {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  return (
    <CookieBannerProvider
      consentApiPath="/api/consent"
      consentStrategy="load-scripts-then-revoke-consent-after-geolocation-check"
    >
      {process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID && (
        <FacebookPixel pixelId={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID} />
      )}
      {/* Avoid double-tracking: prefer GTM when both IDs are present */}
      {process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID &&
        !process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID} />
        )}
      {process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID && (
        <GoogleTagManager gtmId={process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID} />
      )}
      {process.env.NEXT_PUBLIC_MS_CLARITY_ID && (
        <MicrosoftClarity clarityId={process.env.NEXT_PUBLIC_MS_CLARITY_ID} />
      )}
    </CookieBannerProvider>
  )
}

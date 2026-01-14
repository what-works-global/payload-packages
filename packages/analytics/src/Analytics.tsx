import { env } from '@env'

import { CookieBannerProvider } from './CookieBannerProvider.js'
import FacebookPixel from './FacebookPixel.js'
import GoogleAnalytics from './GoogleAnalytics.js'
import GoogleTagManager from './GoogleTagManager.js'
import MicrosoftClarity from './MicrosoftClarity.js'

export default function Analytics() {
  if (env.NODE_ENV !== 'production') {
    return null
  }

  return (
    <CookieBannerProvider
      consentApiPath="/api/consent"
      consentStrategy="require-consent-before-loading-scripts"
    >
      {env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID && (
        <FacebookPixel pixelId={env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID} />
      )}
      {/* Avoid double-tracking: prefer GTM when both IDs are present */}
      {env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID && !env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID && (
        <GoogleAnalytics gaId={env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID} />
      )}
      {env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID && (
        <GoogleTagManager gtmId={env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID} />
      )}
      {env.NEXT_PUBLIC_MS_CLARITY_ID && (
        <MicrosoftClarity clarityId={env.NEXT_PUBLIC_MS_CLARITY_ID} />
      )}
    </CookieBannerProvider>
  )
}

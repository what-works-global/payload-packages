// This is just an example file of how you would use this package in your own project

import { type ConsentStrategy, CookieBannerProvider } from './CookieBannerProvider.js'
import FacebookPixel from './FacebookPixel.js'
import GoogleAnalytics from './GoogleAnalytics.js'
import GoogleTagManager from './GoogleTagManager.js'
import GtagBootstrap from './GtagBootstrap.js'
import LinkedInInsightTag from './LinkedInInsightTag.js'
import MicrosoftClarity from './MicrosoftClarity.js'

type AnalyticsProps = {
  /** Falls back to `process.env.NEXT_PUBLIC_MS_CLARITY_ID` */
  clarityId?: string
  /** Path the CookieBannerProvider posts consent state to. Defaults to `/api/consent` */
  consentApiPath?: string
  /**
   * `load-scripts-revoke-consent-immediately`
   * - Render scripts immediately.
   * - Default consent is denied until a user grants.
   * - Banner shown only if geolocation requires consent.
   *
   * `load-scripts-then-revoke-consent-after-geolocation-check`
   * - Render scripts immediately.
   * - Default consent is granted until geolocation requires consent.
   * - If consent is required, revoke and show banner.
   *
   * `require-consent-before-loading-scripts`
   * - Do not render scripts until consent is granted when required.
   * - Banner shown only if geolocation requires consent.
   *
   * `load-scripts-always-grant-consent`
   * - Render scripts immediately.
   * - Consent is always granted, regardless of geolocation.
   * - Banner is never shown.
   *
   * Defaults to `load-scripts-then-revoke-consent-after-geolocation-check`
   */
  consentStrategy?: ConsentStrategy
  /** Falls back to `process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID` */
  facebookPixelId?: string
  /** Falls back to `process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID` */
  gaId?: string
  /** Falls back to `process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID` */
  gtmId?: string
  /** Falls back to `process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID` */
  linkedInPartnerId?: string
}

export default function Analytics(props: AnalyticsProps = {}) {
  if (process.env.NODE_ENV !== 'production') {
    return null
  }

  const gaId = props.gaId ?? process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID
  const gtmId = props.gtmId ?? process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID
  const facebookPixelId = props.facebookPixelId ?? process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID
  const clarityId = props.clarityId ?? process.env.NEXT_PUBLIC_MS_CLARITY_ID
  const linkedInPartnerId = props.linkedInPartnerId ?? process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID

  return (
    <CookieBannerProvider
      consentApiPath={props.consentApiPath ?? '/api/consent'}
      consentStrategy={
        props.consentStrategy ?? 'load-scripts-then-revoke-consent-after-geolocation-check'
      }
    >
      {facebookPixelId && <FacebookPixel pixelId={facebookPixelId} />}
      {/*
        GtagBootstrap owns dataLayer, the gtag stub, and the single `consent default`
        + `consent update` path shared by GA and GTM. Render it whenever either
        Google tag is present so both can coexist without duplicating consent state.
        Caveat: if the GTM container contains a GA4 Configuration tag for the same
        property as `gaId`, page_view events will still be double-counted — remove
        one side to deduplicate.
      */}
      {(gaId || gtmId) && <GtagBootstrap />}
      {gaId && <GoogleAnalytics gaId={gaId} />}
      {gtmId && <GoogleTagManager gtmId={gtmId} />}
      {clarityId && <MicrosoftClarity clarityId={clarityId} />}
      {linkedInPartnerId && <LinkedInInsightTag partnerId={linkedInPartnerId} />}
    </CookieBannerProvider>
  )
}

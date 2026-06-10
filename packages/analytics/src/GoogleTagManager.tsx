'use client'

import Script from 'next/script'

import { useCookieBanner } from './CookieBannerProvider.js'

interface GoogleTagManagerProps {
  gtmId: string
}

export default function GoogleTagManager({ gtmId }: GoogleTagManagerProps) {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()

  if (!gtmId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      {/* Keep the SSR preload the previous `src` Script gave us. */}
      <link
        as="script"
        href={`https://www.googletagmanager.com/gtm.js?id=${gtmId}`}
        rel="preload"
      />
      {/*
        Load GTM via its official IIFE snippet. It pushes `gtm.start` and
        injects the container in one synchronous step, so the container can
        never execute before the timing event — no dependence on
        beforeInteractive/afterInteractive ordering or on whether the
        preloaded container is already cached, and GTM sees the canonical
        loader it self-checks for. `afterInteractive` keeps it behind
        GtagBootstrap's `beforeInteractive` consent default.
      */}
      <Script
        dangerouslySetInnerHTML={{
          __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');`,
        }}
        id="gtm"
        strategy="afterInteractive"
      />
      {/*
        No-JS fallback. A client with JS disabled never hydrates, so this only
        appears when the *server-rendered* consent posture is already granted —
        i.e. the grant-by-default strategies. It cannot reflect the geolocation
        check or a banner decision, since both require JS. Under the
        geolocation-revoke strategy that means a no-JS visitor from a
        consent-required region still gets this iframe; gating it server-side
        would require seeding `requiresConsent` from request headers at SSR.
      */}
      {consentStatus === 'granted' && (
        <noscript>
          <iframe
            height="0"
            sandbox=""
            src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
            style={{ display: 'none', visibility: 'hidden' }}
            title="Google Tag Manager"
            width="0"
          />
        </noscript>
      )}
    </>
  )
}

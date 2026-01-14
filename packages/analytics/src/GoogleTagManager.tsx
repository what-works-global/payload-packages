/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import Script from 'next/script'
import { useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

interface GoogleTagManagerProps {
  gtmId: string
}

const updateConsent = (consentStatus: 'denied' | 'granted') => {
  if (typeof window === 'undefined') {
    return
  }

  window.dataLayer = window.dataLayer || []
  window.gtag =
    window.gtag ||
    function gtag(...args: any[]) {
      window.dataLayer.push(args)
    }

  if (typeof window.gtag === 'function') {
    if (consentStatus === 'granted') {
      window.gtag('consent', 'update', {
        ad_personalization: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        analytics_storage: 'granted',
        functionality_storage: 'granted',
        personalization_storage: 'granted',
      })
    } else {
      window.gtag('consent', 'update', {
        ad_personalization: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        analytics_storage: 'denied',
        functionality_storage: 'denied',
        personalization_storage: 'denied',
        security_storage: 'granted',
      })
    }
  }
}

export default function GoogleTagManager({ gtmId }: GoogleTagManagerProps) {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()

  useEffect(() => {
    updateConsent(consentStatus)
  }, [consentStatus])

  if (!gtmId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      {shouldLoadScripts && (
        <Script
          dangerouslySetInnerHTML={{
            __html: `
                (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                })(window,document,'script','dataLayer','${gtmId}');
              `,
          }}
          id="gtm"
        />
      )}
    </>
  )
}

declare global {
  interface Window {
    dataLayer: any[]
    gtag: (...args: any[]) => void
  }
}

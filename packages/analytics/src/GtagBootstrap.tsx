/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import Script from 'next/script'
import { useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

const getConsentDefaults = (consentStatus: 'denied' | 'granted') => {
  if (consentStatus === 'granted') {
    return {
      ad_personalization: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      analytics_storage: 'granted',
      functionality_storage: 'granted',
      personalization_storage: 'granted',
      security_storage: 'granted',
    }
  }

  return {
    ad_personalization: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    security_storage: 'granted',
  }
}

export default function GtagBootstrap() {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()

  useEffect(() => {
    if (!shouldLoadScripts || typeof window.gtag !== 'function') {
      return
    }

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
  }, [consentStatus, shouldLoadScripts])

  if (!shouldLoadScripts) {
    return null
  }

  return (
    <Script
      dangerouslySetInnerHTML={{
        __html: `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          gtag('consent', 'default', ${JSON.stringify(getConsentDefaults(consentStatus))});
          gtag('js', new Date());
        `,
      }}
      id="gtag-bootstrap"
      strategy="beforeInteractive"
    />
  )
}

declare global {
  interface Window {
    dataLayer: any[]
    gtag: (...args: any[]) => void
  }
}

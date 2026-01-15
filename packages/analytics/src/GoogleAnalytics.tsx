/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

interface GoogleAnalyticsProps {
  gaId: string
}

export default function GoogleAnalytics({ gaId }: GoogleAnalyticsProps) {
  const pathname = usePathname()
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  const hasSentInitialRef = useRef(false)
  const lastTrackedPathnameRef = useRef<null | string>(null)
  const [isGtagLoaded, setIsGtagLoaded] = useState(false)

  const trackPageView = useCallback(() => {
    if (typeof window.gtag === 'function') {
      window.gtag('config', gaId, {
        page_path: pathname,
      })
    }
  }, [gaId, pathname])

  const updateConsent = useCallback((status: 'denied' | 'granted') => {
    if (typeof window.gtag !== 'function') {
      return
    }

    if (status === 'granted') {
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
  }, [])

  const getConsentDefaults = useCallback((status: 'denied' | 'granted') => {
    if (status === 'granted') {
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
  }, [])

  useEffect(() => {
    updateConsent(consentStatus)
  }, [consentStatus, updateConsent])

  useEffect(() => {
    if (isGtagLoaded && consentStatus === 'granted' && gaId && typeof window.gtag === 'function') {
      if (!hasSentInitialRef.current) {
        window.gtag('config', gaId, { page_path: window.location.pathname })
        hasSentInitialRef.current = true
        lastTrackedPathnameRef.current = window.location.pathname
      }
    }
  }, [consentStatus, gaId, isGtagLoaded])

  useEffect(() => {
    if (isGtagLoaded && consentStatus === 'granted' && gaId && typeof window.gtag === 'function') {
      if (hasSentInitialRef.current) {
        if (lastTrackedPathnameRef.current !== pathname) {
          trackPageView()
          lastTrackedPathnameRef.current = pathname
        }
      }
    }
  }, [pathname, consentStatus, gaId, trackPageView, isGtagLoaded])

  if (!gaId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            window.gtag = window.gtag || gtag;
            gtag('consent', 'default', ${JSON.stringify(getConsentDefaults(consentStatus))});
          `,
        }}
        id="ga-consent-default"
        strategy="beforeInteractive"
      />
      <Script
        id="gtag-base"
        onLoad={() => {
          setIsGtagLoaded(true)
        }}
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);} 
            window.gtag = gtag;
            gtag('js', new Date());
          `,
        }}
        id="gtag-init"
        strategy="afterInteractive"
      />
    </>
  )
}

declare global {
  interface Window {
    dataLayer: any[]
    gtag: (...args: any[]) => void
  }
}

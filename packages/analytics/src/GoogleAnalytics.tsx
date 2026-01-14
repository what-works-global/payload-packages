/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useCallback, useEffect, useRef } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

interface GoogleAnalyticsProps {
  gaId: string
}

export default function GoogleAnalytics({ gaId }: GoogleAnalyticsProps) {
  const pathname = usePathname()
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  const hasSentInitialRef = useRef(false)
  const lastTrackedPathnameRef = useRef<null | string>(null)

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

  useEffect(() => {
    updateConsent(consentStatus)
  }, [consentStatus, updateConsent])

  useEffect(() => {
    if (consentStatus === 'granted' && gaId && typeof window.gtag === 'function') {
      if (!hasSentInitialRef.current) {
        window.gtag('config', gaId, { page_path: window.location.pathname })
        hasSentInitialRef.current = true
        lastTrackedPathnameRef.current = window.location.pathname
      }
    }
  }, [consentStatus, gaId])

  useEffect(() => {
    if (consentStatus === 'granted' && gaId && typeof window.gtag === 'function') {
      if (hasSentInitialRef.current) {
        if (lastTrackedPathnameRef.current !== pathname) {
          trackPageView()
          lastTrackedPathnameRef.current = pathname
        }
      }
    }
  }, [pathname, consentStatus, gaId, trackPageView])

  if (!gaId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      <Script
        id="gtag-base"
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
        onLoad={() => {
          if (typeof window.gtag === 'function') {
            updateConsent(consentStatus)
            if (consentStatus === 'granted') {
              window.gtag('config', gaId, { page_path: window.location.pathname })
              hasSentInitialRef.current = true
              lastTrackedPathnameRef.current = window.location.pathname
            }
          }
        }}
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

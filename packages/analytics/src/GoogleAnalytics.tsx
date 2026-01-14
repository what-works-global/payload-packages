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
  const { cookiesAllowed } = useCookieBanner()
  const hasSentInitialRef = useRef(false)
  const lastTrackedPathnameRef = useRef<null | string>(null)

  const trackPageView = useCallback(() => {
    if (typeof window.gtag === 'function') {
      window.gtag('config', gaId, {
        page_path: pathname,
      })
    }
  }, [gaId, pathname])

  // On mount (consent already granted due to Basic mode rendering), set consent granted.
  // On unmount (revocation), send consent denied.
  useEffect(() => {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {
        ad_personalization: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        analytics_storage: 'granted',
        functionality_storage: 'granted',
        personalization_storage: 'granted',
      })
    }
    return () => {
      if (typeof window.gtag === 'function') {
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
  }, [])

  useEffect(() => {
    if (cookiesAllowed && gaId && typeof window.gtag === 'function') {
      if (hasSentInitialRef.current) {
        if (lastTrackedPathnameRef.current !== pathname) {
          trackPageView()
          lastTrackedPathnameRef.current = pathname
        }
      }
    }
  }, [pathname, cookiesAllowed, gaId, trackPageView])

  if (!gaId) {
    return null
  }

  return cookiesAllowed ? (
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
            window.gtag('config', gaId, { page_path: window.location.pathname })
            hasSentInitialRef.current = true
            lastTrackedPathnameRef.current = window.location.pathname
          }
        }}
        strategy="afterInteractive"
      />
    </>
  ) : null
}

declare global {
  interface Window {
    dataLayer: any[]
    gtag: (...args: any[]) => void
  }
}

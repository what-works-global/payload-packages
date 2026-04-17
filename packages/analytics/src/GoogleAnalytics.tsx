'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

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

  useEffect(() => {
    if (!isGtagLoaded || consentStatus !== 'granted' || !gaId) {
      return
    }
    if (typeof window.gtag !== 'function') {
      return
    }

    if (!hasSentInitialRef.current) {
      window.gtag('config', gaId, { page_path: window.location.pathname })
      hasSentInitialRef.current = true
      lastTrackedPathnameRef.current = window.location.pathname
      return
    }

    if (lastTrackedPathnameRef.current !== pathname) {
      window.gtag('config', gaId, { page_path: pathname })
      lastTrackedPathnameRef.current = pathname
    }
  }, [pathname, consentStatus, gaId, isGtagLoaded])

  if (!gaId || !shouldLoadScripts) {
    return null
  }

  return (
    <Script
      id="gtag-base"
      onLoad={() => {
        setIsGtagLoaded(true)
      }}
      src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
      strategy="afterInteractive"
    />
  )
}

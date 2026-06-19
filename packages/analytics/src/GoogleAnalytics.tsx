'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useEffect, useRef, useState } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'
import { useResolvedEnabled } from './enabledContext.js'
import { GtagBootstrap } from './GtagBootstrap.js'

export interface GoogleAnalyticsProps {
  /** Default-on in production; set explicitly to force on or off elsewhere. */
  enabled?: boolean
  gaId: string
}

export function GoogleAnalytics({ enabled, gaId }: GoogleAnalyticsProps) {
  const pathname = usePathname()
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  const isEnabled = useResolvedEnabled(enabled)
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

  if (!gaId || !isEnabled || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      {/*
        GtagBootstrap owns dataLayer, the gtag stub, and the shared Consent Mode
        default/update path. GA and GTM each render it; next/script dedupes by id
        so it runs once even when both Google tags are present.
      */}
      <GtagBootstrap />
      <Script
        id="gtag-base"
        onLoad={() => {
          setIsGtagLoaded(true)
        }}
        src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
        strategy="afterInteractive"
      />
    </>
  )
}

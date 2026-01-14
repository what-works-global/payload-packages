'use client'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useCallback, useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

interface FacebookPixelProps {
  pixelId: string
}

export default function FacebookPixel({ pixelId }: FacebookPixelProps) {
  const pathname = usePathname()
  const { consentStatus, shouldLoadScripts } = useCookieBanner()

  const trackPageView = useCallback(() => {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'PageView')
    }
  }, [])

  const applyConsent = useCallback((status: 'denied' | 'granted') => {
    if (typeof window.fbq !== 'function') {
      return
    }

    if (status === 'granted') {
      window.fbq('consent', 'grant')
    } else {
      window.fbq('consent', 'revoke')
    }
  }, [])

  useEffect(() => {
    applyConsent(consentStatus)
  }, [applyConsent, consentStatus])

  useEffect(() => {
    if (pixelId && consentStatus === 'granted') {
      trackPageView()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, consentStatus])

  if (!pixelId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');
          `,
        }}
        id="fb-pixel"
        onLoad={() => {
          applyConsent(consentStatus)
          if (consentStatus === 'granted') {
            trackPageView()
          }
        }}
        strategy="afterInteractive"
      />
      {consentStatus === 'granted' && (
        <noscript>
          <img
            alt=""
            height="1"
            loading="lazy"
            src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
            style={{ display: 'none' }}
            width="1"
          />
        </noscript>
      )}
    </>
  )
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fbq: (...args: any[]) => void
  }
}

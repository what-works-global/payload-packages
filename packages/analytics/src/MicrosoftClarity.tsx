'use client'

import Script from 'next/script'
import { useCallback, useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

// WARNING: Cookies must be disabled in Clarity dashboard for this to be GDPR compliant
// See https://learn.microsoft.com/en-us/clarity/setup-and-installation/cookie-consent

interface MicrosoftClarityProps {
  clarityId: string
}

export default function MicrosoftClarity({ clarityId }: MicrosoftClarityProps) {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()

  const applyConsent = useCallback((status: 'denied' | 'granted') => {
    if (typeof window.clarity !== 'function') {
      return
    }

    if (status === 'granted') {
      window.clarity('consentv2', {
        ad_Storage: 'granted',
        analytics_Storage: 'granted',
      })
    } else {
      window.clarity('consentv2', {
        ad_Storage: 'denied',
        analytics_Storage: 'denied',
      })
      window.clarity('consent', false)
    }
  }, [])

  useEffect(() => {
    applyConsent(consentStatus)
  }, [applyConsent, consentStatus])

  if (!clarityId || !shouldLoadScripts) {
    return null
  }

  return (
    <Script
      id="ms-clarity"
      onLoad={() => {
        applyConsent(consentStatus)
      }}
    >
      {`
        (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${clarityId}");
      `}
    </Script>
  )
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clarity: (...args: any[]) => void
  }
}

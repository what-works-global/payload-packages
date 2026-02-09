'use client'

import Script from 'next/script'
import { useCallback, useEffect, useLayoutEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

// Global callback for when the Clarity tag script (clarity.ms) has loaded.
// Set by the component so the inline bootstrap can invoke it from the script tag's onload.
const CLARITY_LOADED_CALLBACK = '__onClarityLoaded'

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

  // Register callback so the inline script can invoke it when the clarity.ms tag has loaded.
  // useLayoutEffect ensures this runs before the Script's effect appends and runs the inline script.
  useLayoutEffect(() => {
    ;(window as WindowWithClarityLoaded)[CLARITY_LOADED_CALLBACK] = () => {
      applyConsent(consentStatus)
    }
    return () => {
      delete (window as WindowWithClarityLoaded)[CLARITY_LOADED_CALLBACK]
    }
  }, [applyConsent, consentStatus])

  // Apply consent when status changes (e.g. user accepts); may no-op if Clarity not loaded yet.
  useEffect(() => {
    applyConsent(consentStatus)
  }, [applyConsent, consentStatus])

  if (!clarityId || !shouldLoadScripts) {
    return null
  }

  return (
    <Script id="ms-clarity">
      {`
        (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        t.onload=function(){var fn=c.${CLARITY_LOADED_CALLBACK};if(typeof fn==="function")fn();};
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
        })(window, document, "clarity", "script", "${clarityId}");
      `}
    </Script>
  )
}

interface WindowWithClarityLoaded extends Window {
  __onClarityLoaded?: () => void
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clarity: (...args: any[]) => void
  }
}

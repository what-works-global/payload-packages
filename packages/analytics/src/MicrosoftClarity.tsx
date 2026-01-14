'use client'

import Script from 'next/script'
import { useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

// WARNING: Cookies must be disabled in Clarity dashboard for this to be GDPR compliant
// See https://learn.microsoft.com/en-us/clarity/setup-and-installation/cookie-consent

interface MicrosoftClarityProps {
  clarityId: string
}

export default function MicrosoftClarity({ clarityId }: MicrosoftClarityProps) {
  const { cookiesAllowed } = useCookieBanner()

  useEffect(() => {
    if (cookiesAllowed) {
      if (typeof window.clarity === 'function') {
        window.clarity('consent')
      }
    }
  }, [cookiesAllowed])

  return (
    <Script id="ms-clarity">
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
    clarity: (...args: any[]) => void
  }
}

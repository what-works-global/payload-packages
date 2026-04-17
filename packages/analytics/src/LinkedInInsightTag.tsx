'use client'

import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useEffect, useRef } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'

interface LinkedInInsightTagProps {
  partnerId: string
}

export default function LinkedInInsightTag({ partnerId }: LinkedInInsightTagProps) {
  const pathname = usePathname()
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  const hasSentInitialRef = useRef(false)
  const lastTrackedPathnameRef = useRef<null | string>(null)

  useEffect(() => {
    if (!partnerId || consentStatus !== 'granted') {
      return
    }
    if (typeof window.lintrk !== 'function') {
      return
    }
    if (!hasSentInitialRef.current) {
      window.lintrk('track')
      hasSentInitialRef.current = true
      lastTrackedPathnameRef.current = pathname
      return
    }
    if (lastTrackedPathnameRef.current !== pathname) {
      window.lintrk('track')
      lastTrackedPathnameRef.current = pathname
    }
  }, [pathname, consentStatus, partnerId])

  if (!partnerId || !shouldLoadScripts || consentStatus !== 'granted') {
    return null
  }

  return (
    <>
      <Script
        dangerouslySetInnerHTML={{
          __html: `
            _linkedin_partner_id = "${partnerId}";
            window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
            window._linkedin_data_partner_ids.push(_linkedin_partner_id);
            (function(l) {
              if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
              window.lintrk.q=[]}
              var s = document.getElementsByTagName("script")[0];
              var b = document.createElement("script");
              b.type = "text/javascript";b.async = true;
              b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
              s.parentNode.insertBefore(b, s);
            })(window.lintrk);
          `,
        }}
        id="linkedin-insight"
        strategy="afterInteractive"
      />
      <noscript>
        <img
          alt=""
          height="1"
          loading="lazy"
          src={`https://px.ads.linkedin.com/collect/?pid=${partnerId}&fmt=gif`}
          style={{ display: 'none' }}
          width="1"
        />
      </noscript>
    </>
  )
}

declare global {
  interface Window {
    _linkedin_data_partner_ids?: string[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lintrk: (...args: any[]) => void
  }
}

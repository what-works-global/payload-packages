'use client'

import Script from 'next/script'

import { useCookieBanner } from './CookieBannerProvider.js'

interface GoogleTagManagerProps {
  gtmId: string
}

export default function GoogleTagManager({ gtmId }: GoogleTagManagerProps) {
  const { shouldLoadScripts } = useCookieBanner()

  if (!gtmId || !shouldLoadScripts) {
    return null
  }

  return (
    <>
      <Script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});`,
        }}
        id="gtm-init"
        strategy="afterInteractive"
      />
      <Script
        id="gtm"
        src={`https://www.googletagmanager.com/gtm.js?id=${gtmId}`}
        strategy="afterInteractive"
      />
    </>
  )
}

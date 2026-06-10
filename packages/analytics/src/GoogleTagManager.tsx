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
      {/*
        Push `gtm.start` before the container loads. `beforeInteractive` runs
        ahead of any `afterInteractive` script, so the timing event is always
        in `dataLayer` by the time `gtm.js` executes — without this guarantee
        the preloaded container can run first and GTM reports the snippet as
        "installed incorrectly".
      */}
      <Script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];window.dataLayer.push({'gtm.start':new Date().getTime(),event:'gtm.js'});`,
        }}
        id="gtm-init"
        strategy="beforeInteractive"
      />
      <Script
        id="gtm"
        src={`https://www.googletagmanager.com/gtm.js?id=${gtmId}`}
        strategy="afterInteractive"
      />
    </>
  )
}

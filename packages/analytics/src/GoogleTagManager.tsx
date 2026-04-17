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
    <Script
      dangerouslySetInnerHTML={{
        __html: `
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${gtmId}');
        `,
      }}
      id="gtm"
      strategy="afterInteractive"
    />
  )
}

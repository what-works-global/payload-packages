'use client'
import type { ReactNode } from 'react'

import './styles.css'

import Link from 'next/link'

import { CookieBannerPortal } from './CookieBannerPortal.js'
import { useCookieBanner } from './CookieBannerProvider.js'

export default function CookieBanner({
  acceptText = 'Accept',
  description = (
    <>
      We use essential cookies to ensure the site functions properly, and optional cookies to
      improve your experience. By clicking “Accept”, you consent to the use of non-essential
      cookies. To learn more, please view our{' '}
      <Link className="underline" href="/privacy-policy">
        Privacy Policy
      </Link>
      .
    </>
  ),
  rejectText = 'Reject',
  title = 'Cookies',
}: {
  acceptText?: string
  description?: ReactNode
  rejectText?: string
  title?: string
}) {
  const { accept, reject, shouldShowBanner } = useCookieBanner()

  if (!shouldShowBanner) {
    return null
  }

  return (
    <CookieBannerPortal>
      <div className="ww max-w-xl">
        <div className="fixed bottom-4 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-5xl -translate-x-1/2 border border-gray-200 rounded-lg bg-white px-4 py-3 sm:py-8 shadow">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="space-y-2">
              <h3 className="text-base font-medium">{title}</h3>
              <p className="text-sm text-gray-600">{description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <button
                className="py-3 px-6 bg-black text-white rounded-md hover:bg-stone-800"
                onClick={() => {
                  reject()
                }}
                type="button"
              >
                {rejectText}
              </button>
              <button
                className="py-3 px-6 bg-black text-white rounded-md hover:bg-stone-800"
                onClick={() => {
                  accept()
                }}
                type="button"
              >
                {acceptText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </CookieBannerPortal>
  )
}

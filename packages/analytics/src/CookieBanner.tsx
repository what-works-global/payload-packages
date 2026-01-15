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
      We use cookies to improve your experience. By clicking "Accept", you agree to the use of
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
      <div className="ww">
        <div className="fixed bottom-4 inset-x-4 z-50 border border-gray-200 rounded-lg bg-white py-8 shadow">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
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
      </div>
    </CookieBannerPortal>
  )
}

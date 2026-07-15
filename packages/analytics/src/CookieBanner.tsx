'use client'
import type { ReactNode } from 'react'

import './styles.css'

import Link from 'next/link'

import { CookieBannerPortal } from './CookieBannerPortal.js'
import { useCookieBanner } from './CookieBannerProvider.js'

export interface CookieBannerProps {
  acceptText?: string
  description?: ReactNode
  rejectText?: string
  title?: string
}

export function CookieBanner({
  acceptText = 'Accept all',
  description = (
    <>
      We use cookies and similar technologies to enhance your experience, analyse site traffic, and
      run targeted advertising campaigns. You can choose to accept all cookies or only those that
      are strictly necessary for site functionality. For more details, see our{' '}
      <Link className="underline" href="/privacy-policy">
        Privacy Policy
      </Link>
      .
    </>
  ),
  rejectText = 'Accept essential only',
  title = 'We use cookies',
}: CookieBannerProps) {
  const { accept, reject, shouldShowBanner } = useCookieBanner()

  if (!shouldShowBanner) {
    return null
  }

  return (
    <CookieBannerPortal>
      <div className="ww">
        <div className="fixed inset-x-0 bottom-0 z-50 flex w-full flex-col items-start justify-center gap-4 rounded-t-lg border-[0.5px] border-deep-works-300 bg-white px-6 py-8 shadow sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[calc(100vw-2rem)] sm:max-w-[443px] sm:rounded-lg">
          <div className="flex flex-col gap-3 text-deep-works-900">
            <h3 className="text-2xl font-light leading-7">{title}</h3>
            <p className="text-base leading-6">{description}</p>
          </div>
          <div className="flex w-full flex-col gap-4 sm:flex-row">
            <button
              className="flex h-9 w-full items-center justify-center rounded-full bg-cyan-works px-[17px] py-2 text-base leading-4 text-deep-works-900 shadow-sm hover:brightness-95 sm:flex-1"
              onClick={() => {
                accept()
              }}
              type="button"
            >
              {acceptText}
            </button>
            <button
              className="flex h-9 w-full items-center justify-center rounded-full border-[0.5px] border-deep-works-900 bg-white px-[17px] py-2 text-base leading-4 text-deep-works-700 drop-shadow-sm hover:bg-gray-50 sm:flex-1"
              onClick={() => {
                reject()
              }}
              type="button"
            >
              {rejectText}
            </button>
          </div>
        </div>
      </div>
    </CookieBannerPortal>
  )
}

'use client'
import type { ReactNode } from 'react'

import './styles.css'
import { useCookieBanner } from './CookieBannerProvider.js'

export default function CookieBanner({
  acceptText,
  description,
  rejectText,
  title,
}: {
  acceptText: string
  description: ReactNode
  rejectText: string
  title: string
}) {
  const { accept, reject, shouldShowBanner } = useCookieBanner()

  if (!shouldShowBanner) {
    return null
  }

  return (
    <div className="ww">
      <div className="bg-deep-works-300 fixed bottom-0 left-0 right-0 z-50 p-[1px]">
        <div className="rounded-lg bg-white py-8">
          <div className="container mx-auto sm:px-6 lg:px-8">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="space-y-2">
                <h3 className="text-base font-medium">{title}</h3>
                <p className="text-sm text-gray-600">{description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-4">
                <button
                  className="p-4"
                  onClick={() => {
                    reject()
                  }}
                  type="button"
                >
                  {rejectText}
                </button>
                <button
                  className="p-4"
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
    </div>
  )
}

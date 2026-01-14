'use client'

import type { ReactNode } from 'react'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import CookieBanner from './CookieBanner.js'

interface CookieBannerContextType {
  accept: () => void
  cookiesAllowed: boolean
  getDecisionMade: () => boolean
  reject: () => void
}

const CookieBannerContext = createContext<CookieBannerContextType | undefined>(undefined)

export function useCookieBanner() {
  const context = useContext(CookieBannerContext)
  if (!context) {
    throw new Error('useCookieBanner must be used within a CookieBannerProvider')
  }
  return context
}

interface CookieBannerProviderProps {
  children: ReactNode
  defaultCookiesAllowed: boolean
}

export function CookieBannerProvider({
  children,
  defaultCookiesAllowed,
}: CookieBannerProviderProps) {
  const [cookiesAllowed, setCookiesAllowed] = useState(defaultCookiesAllowed)

  useEffect(() => {
    const cookiesAllowed = localStorage.getItem('cookiesAllowed')
    if (cookiesAllowed === 'true') {
      setCookiesAllowed(true)
    } else if (cookiesAllowed === 'false') {
      setCookiesAllowed(false)
    }
  }, [])

  const getDecisionMade = useCallback(() => {
    return localStorage.getItem('cookiesAllowed') !== null
  }, [])

  const value = useMemo<CookieBannerContextType>(
    () => ({
      accept: () => {
        setCookiesAllowed(true)
        localStorage.setItem('cookiesAllowed', 'true')
      },
      cookiesAllowed,
      getDecisionMade,
      reject: () => {
        setCookiesAllowed(false)
        localStorage.setItem('cookiesAllowed', 'false')
      },
    }),
    [cookiesAllowed, getDecisionMade],
  )

  return (
    <CookieBannerContext.Provider value={value}>
      {children}
      {!defaultCookiesAllowed && (
        <CookieBanner
          acceptText="Accept"
          description="We use cookies to improve your experience. By clicking 'Accept', you agree to the use of cookies."
          rejectText="Reject"
          title="Cookies"
        />
      )}
    </CookieBannerContext.Provider>
  )
}

'use client'

import type { ReactNode } from 'react'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type ConsentStrategy =
  | 'load-scripts-always-grant-consent'
  | 'load-scripts-revoke-consent-immediately'
  | 'load-scripts-then-revoke-consent-after-geolocation-check'
  | 'require-consent-before-loading-scripts'

type ConsentStatus = 'denied' | 'granted'

interface CookieBannerContextType {
  accept: () => void
  consentStatus: ConsentStatus
  reject: () => void
  shouldLoadScripts: boolean
  shouldShowBanner: boolean
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
  consentApiPath: string
  /**
   * `load-scripts-revoke-consent-immediately`
   * - Render scripts immediately.
   * - Default consent is denied until a user grants.
   * - Banner shown only if geolocation requires consent.
   *
   * `load-scripts-then-revoke-consent-after-geolocation-check`
   * - Render scripts immediately.
   * - Default consent is granted until geolocation requires consent.
   * - If consent is required, revoke and show banner.
   *
   * `require-consent-before-loading-scripts`
   * - Do not render scripts until consent is granted when required.
   * - Banner shown only if geolocation requires consent.
   *
   * `load-scripts-always-grant-consent`
   * - Render scripts immediately.
   * - Consent is always granted, regardless of geolocation.
   * - Banner is never shown.
   */
  consentStrategy: ConsentStrategy
}

const CONSENT_STORAGE_KEY = 'cookiesAllowed'

const getStoredDecision = (): ConsentStatus | null => {
  const stored = localStorage.getItem(CONSENT_STORAGE_KEY)
  if (stored === 'true') {
    return 'granted'
  }
  if (stored === 'false') {
    return 'denied'
  }
  return null
}

export function CookieBannerProvider({
  children,
  consentApiPath,
  consentStrategy,
}: CookieBannerProviderProps) {
  const [userDecision, setUserDecision] = useState<ConsentStatus | null>(
    consentStrategy === 'load-scripts-always-grant-consent' ? 'granted' : null,
  )
  const [requiresConsent, setRequiresConsent] = useState<boolean | null>(
    consentStrategy === 'load-scripts-always-grant-consent' ? false : null,
  )

  useEffect(() => {
    if (consentStrategy === 'load-scripts-always-grant-consent') {
      setUserDecision('granted')
      setRequiresConsent(false)
      return
    }

    const storedDecision = getStoredDecision()
    setUserDecision(storedDecision)
    if (storedDecision !== null) {
      return
    }

    let isActive = true
    const fetchRequiresConsent = async () => {
      try {
        const response = await fetch(consentApiPath, { method: 'GET' })
        if (!response.ok) {
          // TODO: Just console error
          throw new Error('Consent API response not ok')
        }
        const data = (await response.json()) as { requiresConsent?: boolean }
        if (isActive) {
          setRequiresConsent(Boolean(data?.requiresConsent))
        }
      } catch {
        if (isActive) {
          setRequiresConsent(true)
        }
      }
    }

    void fetchRequiresConsent()

    return () => {
      isActive = false
    }
  }, [consentApiPath, consentStrategy])

  const value = useMemo<CookieBannerContextType>(() => {
    const accept = () => {
      setUserDecision('granted')
      localStorage.setItem(CONSENT_STORAGE_KEY, 'true')
    }
    const reject = () => {
      setUserDecision('denied')
      localStorage.setItem(CONSENT_STORAGE_KEY, 'false')
    }

    if (consentStrategy === 'load-scripts-always-grant-consent') {
      return {
        accept,
        consentStatus: 'granted',
        reject,
        shouldLoadScripts: true,
        shouldShowBanner: false,
      }
    }

    const hasUserDecision = userDecision !== null
    const shouldShowBanner = !hasUserDecision && requiresConsent === true

    let shouldLoadScripts = false
    let consentStatus: ConsentStatus = 'denied'

    if (hasUserDecision) {
      consentStatus = userDecision
      shouldLoadScripts =
        consentStrategy === 'require-consent-before-loading-scripts'
          ? userDecision === 'granted'
          : true
    } else {
      switch (consentStrategy) {
        case 'load-scripts-revoke-consent-immediately':
          shouldLoadScripts = true
          consentStatus = requiresConsent === false ? 'granted' : 'denied'
          break
        case 'load-scripts-then-revoke-consent-after-geolocation-check':
          shouldLoadScripts = true
          consentStatus = requiresConsent === true ? 'denied' : 'granted'
          break
        case 'require-consent-before-loading-scripts':
          shouldLoadScripts = requiresConsent === false
          consentStatus = requiresConsent === false ? 'granted' : 'denied'
          break
      }
    }

    return {
      accept,
      consentStatus,
      reject,
      shouldLoadScripts,
      shouldShowBanner,
    }
  }, [consentStrategy, requiresConsent, userDecision])

  return <CookieBannerContext.Provider value={value}>{children}</CookieBannerContext.Provider>
}

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

type StrategyConfig = {
  initialDecision: ConsentStatus | null
  initialRequiresConsent: boolean | null
  resolveWithDecision: (decision: ConsentStatus) => {
    consentStatus: ConsentStatus
    shouldLoadScripts: boolean
  }
  resolveWithoutDecision: (requiresConsent: boolean | null) => {
    consentStatus: ConsentStatus
    shouldLoadScripts: boolean
  }
  shouldSkipGeolocation: boolean
}

const STRATEGY_CONFIG: Record<ConsentStrategy, StrategyConfig> = {
  'load-scripts-always-grant-consent': {
    initialDecision: 'granted',
    initialRequiresConsent: false,
    resolveWithDecision: () => ({
      consentStatus: 'granted',
      shouldLoadScripts: true,
    }),
    resolveWithoutDecision: () => ({
      consentStatus: 'granted',
      shouldLoadScripts: true,
    }),
    shouldSkipGeolocation: true,
  },
  'load-scripts-revoke-consent-immediately': {
    initialDecision: null,
    initialRequiresConsent: null,
    resolveWithDecision: (decision) => ({
      consentStatus: decision,
      shouldLoadScripts: true,
    }),
    resolveWithoutDecision: (requiresConsent) => ({
      consentStatus: requiresConsent === false ? 'granted' : 'denied',
      shouldLoadScripts: true,
    }),
    shouldSkipGeolocation: false,
  },
  'load-scripts-then-revoke-consent-after-geolocation-check': {
    initialDecision: null,
    initialRequiresConsent: null,
    resolveWithDecision: (decision) => ({
      consentStatus: decision,
      shouldLoadScripts: true,
    }),
    resolveWithoutDecision: (requiresConsent) => ({
      consentStatus: requiresConsent === true ? 'denied' : 'granted',
      shouldLoadScripts: true,
    }),
    shouldSkipGeolocation: false,
  },
  'require-consent-before-loading-scripts': {
    initialDecision: null,
    initialRequiresConsent: null,
    resolveWithDecision: (decision) => ({
      consentStatus: decision,
      shouldLoadScripts: decision === 'granted',
    }),
    resolveWithoutDecision: (requiresConsent) => ({
      consentStatus: requiresConsent === false ? 'granted' : 'denied',
      shouldLoadScripts: requiresConsent === false,
    }),
    shouldSkipGeolocation: false,
  },
}

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

const computeConsentState = ({
  consentStrategy,
  requiresConsent,
  userDecision,
}: {
  consentStrategy: ConsentStrategy
  requiresConsent: boolean | null
  userDecision: ConsentStatus | null
}): Pick<CookieBannerContextType, 'consentStatus' | 'shouldLoadScripts' | 'shouldShowBanner'> => {
  const strategyConfig = STRATEGY_CONFIG[consentStrategy]
  const hasUserDecision = userDecision !== null
  const shouldShowBanner = !hasUserDecision && requiresConsent === true
  const { consentStatus, shouldLoadScripts } = hasUserDecision
    ? strategyConfig.resolveWithDecision(userDecision)
    : strategyConfig.resolveWithoutDecision(requiresConsent)

  return {
    consentStatus,
    shouldLoadScripts,
    shouldShowBanner,
  }
}

export function CookieBannerProvider({
  children,
  consentApiPath,
  consentStrategy,
}: CookieBannerProviderProps) {
  const strategyConfig = STRATEGY_CONFIG[consentStrategy]
  const [userDecision, setUserDecision] = useState<ConsentStatus | null>(
    strategyConfig.initialDecision,
  )
  const [requiresConsent, setRequiresConsent] = useState<boolean | null>(
    strategyConfig.initialRequiresConsent,
  )

  useEffect(() => {
    if (strategyConfig.shouldSkipGeolocation) {
      setUserDecision(strategyConfig.initialDecision)
      setRequiresConsent(strategyConfig.initialRequiresConsent)
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
          // eslint-disable-next-line no-console
          console.error(
            `Consent API response not ok: ${response.status}, assuming cookie consent is required`,
          )
          throw new Error(`Consent API response not ok: ${response.status}`)
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
  }, [consentApiPath, strategyConfig])

  const value = useMemo<CookieBannerContextType>(() => {
    const accept = () => {
      setUserDecision('granted')
      localStorage.setItem(CONSENT_STORAGE_KEY, 'true')
    }
    const reject = () => {
      setUserDecision('denied')
      localStorage.setItem(CONSENT_STORAGE_KEY, 'false')
    }

    const { consentStatus, shouldLoadScripts, shouldShowBanner } = computeConsentState({
      consentStrategy,
      requiresConsent,
      userDecision,
    })

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

'use client'

import { useEffect } from 'react'

import { useCookieBanner } from './CookieBannerProvider.js'
import { useResolvedEnabled } from './enabledContext.js'
import { initPostHog, setPostHogConsent } from './posthogClient.js'

export interface PostHogProps {
  /** Ingestion host. Defaults to PostHog EU Cloud. */
  apiHost?: string
  /** PostHog project API key. */
  apiKey: string
  /** Default-on in production; set explicitly to force on or off elsewhere. */
  enabled?: boolean
  /** Extra posthog-js init options (`PostHogConfig`), merged over the privacy-safe defaults. */
  options?: Record<string, unknown>
}

const DEFAULT_API_HOST = 'https://eu.i.posthog.com'

// Unlike the other vendors PostHog has no inline <Script> snippet — the browser
// SDK is an npm module loaded on demand (posthog-js is an optional peer
// dependency, so apps that don't use PostHog never pull it into their bundle).
// Consent is honoured through opt_in/opt_out_capturing rather than by
// withholding the script, so `capture()` becomes live the moment consent is
// granted and goes quiet again if it is revoked.
export function PostHog({ apiHost = DEFAULT_API_HOST, apiKey, enabled, options }: PostHogProps) {
  const { consentStatus, shouldLoadScripts } = useCookieBanner()
  const isEnabled = useResolvedEnabled(enabled)

  useEffect(() => {
    if (!apiKey || !isEnabled || !shouldLoadScripts) {
      return
    }

    let cancelled = false
    void initPostHog({ apiHost, apiKey, options }).then(() => {
      if (!cancelled) {
        setPostHogConsent(consentStatus === 'granted')
      }
    })

    return () => {
      cancelled = true
    }
    // `options` is only read during the one-time init; excluding it keeps a
    // fresh object literal on each render from re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, apiHost, consentStatus, isEnabled, shouldLoadScripts])

  return null
}

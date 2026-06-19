import type { ReactNode } from 'react'

import { type ConsentStrategy, CookieBannerProvider } from './CookieBannerProvider.js'
import { AnalyticsEnabledProvider } from './enabledContext.js'

export interface AnalyticsProps {
  /**
   * Analytics tags to render, e.g. `<GoogleTagManager>` from
   * `@whatworks/analytics/google` or `<PostHog>` from `@whatworks/analytics/posthog`.
   * Each is rendered inside the shared `CookieBannerProvider`, so any `'use client'`
   * component here can call `useCookieBanner()` to read consent — no second provider.
   */
  children?: ReactNode
  /** Path the CookieBannerProvider posts consent state to. Defaults to `/api/consent`.
   *  Apps served under a Next `basePath` must pass the prefixed path (a browser
   *  `fetch` is not auto-prefixed), e.g. `/company-tracker/api/consent`. */
  consentApiPath?: string
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
   *
   * Defaults to `load-scripts-then-revoke-consent-after-geolocation-check`
   */
  consentStrategy?: ConsentStrategy
  /**
   * Default `enabled` state inherited by every child tag (each tag's own
   * `enabled` prop overrides it). Defaults to `process.env.NODE_ENV === 'production'`,
   * so tags stay inert in `next dev` and run on production/preview builds — the
   * same posture the previous top-level gate gave, but now overridable per tag.
   */
  enabled?: boolean
}

/**
 * Provides the shared cookie-consent context and an inherited `enabled` default
 * for the analytics tags composed as its children. It renders no vendor scripts
 * itself — import the tags you want from the per-vendor subpaths and pass them
 * as children.
 */
export function Analytics({
  children,
  consentApiPath,
  consentStrategy,
  enabled,
}: AnalyticsProps = {}) {
  const resolvedEnabled = enabled ?? process.env.NODE_ENV === 'production'

  return (
    <CookieBannerProvider
      consentApiPath={consentApiPath ?? '/api/consent'}
      consentStrategy={
        consentStrategy ?? 'load-scripts-then-revoke-consent-after-geolocation-check'
      }
    >
      <AnalyticsEnabledProvider enabled={resolvedEnabled}>{children}</AnalyticsEnabledProvider>
    </CookieBannerProvider>
  )
}

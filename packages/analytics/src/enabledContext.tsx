'use client'

import type { ReactNode } from 'react'

// eslint-disable-next-line @eslint-react/no-use-context
import { createContext, useContext } from 'react'

// Lets `<Analytics enabled>` set a default for every tag rendered beneath it,
// without each consumer threading the flag through. A tag's own `enabled` prop
// still wins; when neither is set we fall back to production-only, which is what
// the old top-level `NODE_ENV` gate on `<Analytics>` used to enforce — except it
// is now resolved per tag and overridable (e.g. `<PostHog enabled />` to
// exercise PostHog in development).
const AnalyticsEnabledContext = createContext<boolean | undefined>(undefined)

export function AnalyticsEnabledProvider({
  children,
  enabled,
}: {
  children: ReactNode
  enabled: boolean
}) {
  return <AnalyticsEnabledContext value={enabled}>{children}</AnalyticsEnabledContext>
}

/**
 * Resolve a tag's effective `enabled` state: an explicit prop wins, otherwise
 * the value inherited from `<Analytics enabled>`, otherwise production-only.
 */
export function useResolvedEnabled(enabled?: boolean): boolean {
  // eslint-disable-next-line @eslint-react/no-use-context
  const inherited = useContext(AnalyticsEnabledContext)
  return enabled ?? inherited ?? process.env.NODE_ENV === 'production'
}

'use client'

import type { ReactNode } from 'react'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const DEFAULT_PORTAL_ID = 'cookie-banner-root'

const getPortalRoot = (portalId: string): HTMLElement => {
  const existing = document.getElementById(portalId)
  if (existing) {
    return existing
  }

  const root = document.createElement('div')
  root.id = portalId
  document.body.appendChild(root)
  return root
}

export function CookieBannerPortal({
  children,
  portalId = DEFAULT_PORTAL_ID,
}: {
  children: ReactNode
  portalId?: string
}) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setPortalRoot(getPortalRoot(portalId))
  }, [portalId])

  if (!portalRoot) {
    return null
  }

  return createPortal(children, portalRoot)
}

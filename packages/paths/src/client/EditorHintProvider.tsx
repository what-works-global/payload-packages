'use client'

/**
 * Admin-side half of the edit button's request gate. Registered on
 * `admin.components.providers` by the plugin, it stamps a `localStorage` hint
 * on every admin visit — the admin and the frontend share an origin in the
 * standard Payload + Next monolith, so the frontend button reads the same
 * storage and knows this browser may belong to an editor. Browsers without
 * the hint never call the edit-button endpoint at all.
 */
import type { ReactNode } from 'react'

import React, { useEffect } from 'react'

import { writeEditorHint } from './storage.js'

export const PathsEditorHintProvider = ({ children }: { children: ReactNode }): ReactNode => {
  useEffect(() => {
    writeEditorHint()
  }, [])
  return <>{children}</>
}

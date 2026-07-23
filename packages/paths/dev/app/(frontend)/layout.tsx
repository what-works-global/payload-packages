import type { ReactNode } from 'react'

import { NextPathsEditButton } from '@whatworks/payload-paths/next'

import './styles.css'

export default function FrontendLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Appears only for logged-in editors (visit /admin once to seed the
            hint); drag it between corners, open the chevron for the menu. */}
        <NextPathsEditButton exitPreviewURL="/exit-preview" />
      </body>
    </html>
  )
}

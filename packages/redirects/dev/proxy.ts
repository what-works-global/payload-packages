import type { NextFetchEvent, NextRequest } from 'next/server'

import { createRedirectsMiddleware } from '@whatworks/payload-redirects/middleware'
import { NextResponse } from 'next/server'

import { redirectsConfig } from './redirects.config.js'

const redirects = createRedirectsMiddleware(redirectsConfig)

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<NextResponse> {
  return (await redirects(request, event)) ?? NextResponse.next()
}

export const config = {
  matcher: [
    {
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
        { type: 'query', key: '_rsc' },
      ],
      source: '/((?!api|admin|_next/static|_next/image|favicon.ico).*)',
    },
  ],
}

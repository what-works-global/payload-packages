import type { SanitizedConfig } from 'payload'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SitemapPluginConfig } from '../src/types.js'

import { resolveSitemapConfig } from '../src/core/resolved.js'
import { createRobots } from '../src/exports/next.js'

const nextHeaders = vi.hoisted(() => ({
  calls: 0,
  current: undefined as Headers | undefined,
}))

vi.mock('next/headers', () => ({
  headers: () => {
    nextHeaders.calls += 1
    if (!nextHeaders.current) {
      throw new Error('headers() called outside a request scope')
    }
    return Promise.resolve(nextHeaders.current)
  },
}))

const ENV_KEYS = ['SITE_URL', 'NEXT_PUBLIC_SERVER_URL', 'VERCEL_PROJECT_PRODUCTION_URL'] as const

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

const payloadConfig = (siteUrl?: string): SanitizedConfig =>
  ({
    custom: { sitemap: resolveSitemapConfig({ collections: {}, siteUrl } as SitemapPluginConfig) },
    routes: { admin: '/admin', api: '/api' },
  }) as unknown as SanitizedConfig

beforeEach(() => {
  nextHeaders.calls = 0
  nextHeaders.current = undefined
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = saved[key]
    }
  }
})

describe('createRobots siteUrl resolution', () => {
  it('derives the sitemap origin from request headers before the Vercel project URL', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'project.vercel.app'
    nextHeaders.current = new Headers({
      'x-forwarded-host': 'www.example.com',
      'x-forwarded-proto': 'https',
    })
    const robots = await createRobots({ allowIndexing: true, config: payloadConfig() })()
    expect(robots.sitemap).toBe('https://www.example.com/sitemap.xml')
  })

  it('falls back to the env chain when no request scope exists', async () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'project.vercel.app'
    const robots = await createRobots({ allowIndexing: true, config: payloadConfig() })()
    expect(robots.sitemap).toBe('https://project.vercel.app/sitemap.xml')
  })

  it('never touches next/headers when the siteUrl option pins the origin', async () => {
    nextHeaders.current = new Headers({ 'x-forwarded-host': 'www.example.com' })
    const robots = await createRobots({
      allowIndexing: true,
      config: payloadConfig('https://canonical.example.com'),
    })()
    expect(robots.sitemap).toBe('https://canonical.example.com/sitemap.xml')
    expect(nextHeaders.calls).toBe(0)
  })
})

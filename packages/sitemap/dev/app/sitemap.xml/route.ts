import config from '@payload-config'
import { createSitemapIndexRoute } from '@whatworks/payload-sitemap/next'

export const dynamic = 'force-dynamic'
export const { GET } = createSitemapIndexRoute({ config })

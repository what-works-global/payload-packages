import config from '@payload-config'
import { createSitemapChunkRoute } from '@whatworks/payload-sitemap/next'

export const dynamic = 'force-dynamic'
export const { GET } = createSitemapChunkRoute({ config })

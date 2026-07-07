import config from '@payload-config'
import { createRobots } from '@whatworks/payload-sitemap/next'

// NODE_ENV !== 'production' → disallow-all and no Sitemap line. Pass
// `allowIndexing: true` here to preview the production output locally.
export default createRobots({ config })

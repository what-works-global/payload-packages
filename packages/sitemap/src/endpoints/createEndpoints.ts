import type { Endpoint, PayloadRequest } from 'payload'

import type {
  ResolvedSitemapConfig,
  ResolvedSitemapEndpoints,
  SitemapEndpointAccess,
} from '../types.js'

import { getChunkEntries, getIndexItems } from '../core/chunks.js'
import { finalizeEntries, getSitemapEntries } from '../core/entries.js'
import { buildSitemapIndexXml, buildUrlsetXml } from '../core/xml.js'

const checkAccess = async (
  req: PayloadRequest,
  access: SitemapEndpointAccess | undefined,
): Promise<boolean> => (access ? await access({ req }) : true)

const forbidden = (): Response => new Response('Forbidden', { status: 403 })

const xmlResponse = (xml: string, cacheControl: string): Response =>
  new Response(xml, {
    headers: {
      'Cache-Control': cacheControl,
      'Content-Type': 'application/xml; charset=utf-8',
    },
  })

/**
 * The origin the index uses to reference its own chunk files. These endpoints live
 * on the CMS origin (which may differ from `siteUrl` in decoupled setups), so it
 * is derived from the request unless explicitly configured.
 */
const endpointOrigin = (req: PayloadRequest, endpoints: ResolvedSitemapEndpoints): string =>
  endpoints.origin ?? new URL(req.url ?? 'http://localhost').origin

export const createSitemapEndpoints = (config: ResolvedSitemapConfig): Endpoint[] => {
  const endpoints = config.endpoints
  if (!endpoints) {
    return []
  }

  const built: Endpoint[] = [
    {
      handler: async (req) => {
        if (!(await checkAccess(req, endpoints.access))) {
          return forbidden()
        }
        const base = `${endpointOrigin(req, endpoints)}${req.payload.config.routes.api}${endpoints.path}`
        const items = await getIndexItems({
          chunkUrl: (file) => `${base}/${file}`,
          config,
          payload: req.payload,
          req,
        })
        return xmlResponse(buildSitemapIndexXml(items), endpoints.cacheControl)
      },
      method: 'get',
      path: `${endpoints.path}/index.xml`,
    },
  ]

  if (endpoints.json) {
    const jsonAccess = endpoints.json.access
    built.push({
      handler: async (req) => {
        if (!(await checkAccess(req, jsonAccess))) {
          return forbidden()
        }
        const entries = await getSitemapEntries(req.payload, { req })
        return Response.json({ entries }, { headers: { 'Cache-Control': endpoints.cacheControl } })
      },
      method: 'get',
      path: `${endpoints.path}/entries.json`,
    })
  }

  // The `:file` catch-all must be registered last — Payload matches endpoints in
  // order, so it would otherwise swallow `entries.json` (and `index.xml`).
  built.push({
    handler: async (req) => {
      if (!(await checkAccess(req, endpoints.access))) {
        return forbidden()
      }
      const file = req.routeParams?.file
      if (typeof file !== 'string') {
        return new Response('Not found', { status: 404 })
      }
      const chunk = await getChunkEntries({ config, file, payload: req.payload, req })
      if (!chunk) {
        return new Response('Not found', { status: 404 })
      }
      const collConfig = config.collections[chunk.group]
      const entries = finalizeEntries(chunk.entries, {
        siteUrl: config.siteUrl({ request: req }),
        trailingSlash: config.trailingSlash,
      })
      const xml = buildUrlsetXml(entries, {
        changeFreq: collConfig?.changeFreq,
        priority: collConfig?.priority,
      })
      return xmlResponse(xml, endpoints.cacheControl)
    },
    method: 'get',
    path: `${endpoints.path}/:file`,
  })

  return built
}

import type { Config, Endpoint, PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import type { DevelopmentFileStorageArgs, Env } from '../src/types.js'

import { switchEnvironments, wrapClientUploadEndpoints } from '../src/lib/collectionConfig.js'

type CloudStorageArgs = Extract<DevelopmentFileStorageArgs, { mode: 'cloud-storage' }>

const serverHandlerPath = '/storage-s3-generate-signed-url'

interface SignedUrlBody {
  collectionSlug?: string
  docPrefix?: string
  filename?: string
}

const makeFixture = ({ env }: { env: Env }) => {
  const developmentFileStorage: CloudStorageArgs = {
    collections: {
      privateMedia: { prefix: 'private' },
    },
    mode: 'cloud-storage',
    prefix: 'staging',
  }
  let receivedBody: null | SignedUrlBody = null
  const endpoint: Endpoint = {
    handler: async (req: PayloadRequest) => {
      receivedBody = (await req.json!()) as SignedUrlBody
      return Response.json({ ok: true })
    },
    method: 'post',
    path: serverHandlerPath,
  }
  const config = {
    admin: {
      components: {
        providers: [
          {
            clientProps: {
              collectionSlug: 'privateMedia',
              enabled: true,
              prefix: 'private',
              serverHandlerPath,
            },
            path: '@payloadcms/storage-s3/client#S3ClientUploadHandler',
          },
        ],
      },
    },
    collections: [],
    endpoints: [endpoint],
  } as unknown as Config
  wrapClientUploadEndpoints(config, () => env, developmentFileStorage)
  const callEndpoint = async (body: SignedUrlBody) => {
    const req = { json: () => Promise.resolve(body), payload: {} } as unknown as PayloadRequest
    await config.endpoints![0].handler(req)
    return receivedBody
  }
  return { callEndpoint, config, developmentFileStorage, endpoint }
}

describe('wrapClientUploadEndpoints', () => {
  it('prepends the development prefix to a non-empty docPrefix in development', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({
      collectionSlug: 'privateMedia',
      docPrefix: 'private',
      filename: 'a.zip',
    })
    expect(body?.docPrefix).toBe('staging/private')
  })

  it('is idempotent when the docPrefix already carries the development prefix', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({
      collectionSlug: 'privateMedia',
      docPrefix: 'staging/private',
    })
    expect(body?.docPrefix).toBe('staging/private')
  })

  it('rewrites function-generated (custom) doc prefixes too', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'some-uuid' })
    expect(body?.docPrefix).toBe('staging/some-uuid')
  })

  it('pins an empty docPrefix to the rewritten collection prefix', async () => {
    const { callEndpoint, developmentFileStorage } = makeFixture({ env: 'development' })
    // simulate the development switch rewriting this plugin's collection options
    switchEnvironments(
      { collections: [] } as unknown as Config,
      'development',
      developmentFileStorage,
      '3.84.1',
    )
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: '' })
    expect(body?.docPrefix).toBe('staging/private')
  })

  it('leaves the body untouched in production', async () => {
    const { callEndpoint } = makeFixture({ env: 'production' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'private' })
    expect(body?.docPrefix).toBe('private')
  })

  it('does not wrap endpoints that do not match a client upload serverHandlerPath', () => {
    const developmentFileStorage: CloudStorageArgs = {
      collections: {},
      mode: 'cloud-storage',
      prefix: 'staging',
    }
    const handler = () => Response.json({ ok: true })
    const config = {
      admin: { components: { providers: [] } },
      endpoints: [{ handler, method: 'post', path: '/unrelated' }],
    } as unknown as Config
    wrapClientUploadEndpoints(config, () => 'development', developmentFileStorage)
    expect(config.endpoints![0].handler).toBe(handler)
  })

  it('does not double-wrap an already wrapped endpoint', () => {
    const { config, developmentFileStorage } = makeFixture({ env: 'development' })
    const wrappedHandler = config.endpoints![0].handler
    wrapClientUploadEndpoints(config, () => 'development', developmentFileStorage)
    expect(config.endpoints![0].handler).toBe(wrappedHandler)
  })

  it('does nothing in file-system mode', () => {
    const handler = () => Response.json({ ok: true })
    const config = {
      admin: {
        components: {
          providers: [{ clientProps: { serverHandlerPath }, path: 'x' }],
        },
      },
      endpoints: [{ handler, method: 'post', path: serverHandlerPath }],
    } as unknown as Config
    wrapClientUploadEndpoints(config, () => 'development', { mode: 'file-system' })
    expect(config.endpoints![0].handler).toBe(handler)
  })
})

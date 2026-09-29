import type { Config, Endpoint, PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import type { DevelopmentFileStorageArgs, Env } from '../src/types.js'

import { switchEnvironments, wrapClientUploadEndpoints } from '../src/lib/collectionConfig.js'
import { applyDevelopmentPrefixesBeforeStoragePlugin } from '../src/lib/developmentPrefix.js'

type CloudStorageArgs = Extract<DevelopmentFileStorageArgs, { mode: 'cloud-storage' }>

const serverHandlerPath = '/storage-s3-generate-signed-url'

interface SignedUrlBody {
  collectionSlug?: string
  docPrefix?: string
  filename?: string
}

const makeFixture = ({
  appliedBeforeStoragePlugin = false,
  env,
}: {
  appliedBeforeStoragePlugin?: boolean
  env: Env
}) => {
  const developmentFileStorage: CloudStorageArgs = {
    collections: {
      privateMedia: { prefix: 'private' },
    },
    mode: 'cloud-storage',
    prefix: 'staging',
  }
  if (appliedBeforeStoragePlugin) {
    // What `copy` mode does when switchEnvPlugin() is called.
    applyDevelopmentPrefixesBeforeStoragePlugin(developmentFileStorage)
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

// `copy` mode gave the storage options the development prefix before the storage
// plugin read them, so the storage plugin's collection prefix is `staging/private`.
describe('wrapClientUploadEndpoints (development prefix applied before the storage plugin)', () => {
  const appliedBeforeStoragePlugin = true

  it('prepends the development prefix to a non-empty docPrefix', async () => {
    const { callEndpoint } = makeFixture({ appliedBeforeStoragePlugin, env: 'development' })
    const body = await callEndpoint({
      collectionSlug: 'privateMedia',
      docPrefix: 'private',
      filename: 'a.zip',
    })
    expect(body?.docPrefix).toBe('staging/private')
  })

  it('is idempotent when the docPrefix already carries the development prefix', async () => {
    const { callEndpoint } = makeFixture({ appliedBeforeStoragePlugin, env: 'development' })
    const body = await callEndpoint({
      collectionSlug: 'privateMedia',
      docPrefix: 'staging/private',
    })
    expect(body?.docPrefix).toBe('staging/private')
  })

  it('rewrites function-generated (custom) doc prefixes too', async () => {
    const { callEndpoint } = makeFixture({ appliedBeforeStoragePlugin, env: 'development' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'some-uuid' })
    expect(body?.docPrefix).toBe('staging/some-uuid')
  })

  it('pins an empty docPrefix to the development collection prefix', async () => {
    const { callEndpoint } = makeFixture({ appliedBeforeStoragePlugin, env: 'development' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: '' })
    expect(body?.docPrefix).toBe('staging/private')
  })
})

// Otherwise payload contains every new upload beneath the collection prefix the
// storage plugin read (`private`), so the development area nests inside it.
describe('wrapClientUploadEndpoints (development prefix applied per request)', () => {
  it('nests the development prefix inside the collection prefix', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'private' })
    expect(body?.docPrefix).toBe('private/staging')
  })

  it('pins an empty docPrefix to the development area', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: '' })
    expect(body?.docPrefix).toBe('private/staging')
  })

  it('is idempotent for a docPrefix already in the development area', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    const body = await callEndpoint({
      collectionSlug: 'privateMedia',
      docPrefix: 'private/staging/sub',
    })
    expect(body?.docPrefix).toBe('private/staging/sub')
  })

  it('nests custom and outer development doc prefixes', async () => {
    const { callEndpoint } = makeFixture({ env: 'development' })
    expect(
      (await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'some-uuid' }))?.docPrefix,
    ).toBe('private/staging/some-uuid')
    expect(
      (await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'staging/private' }))
        ?.docPrefix,
    ).toBe('private/staging')
  })

  it('does not rewrite the shared collection options', () => {
    const { developmentFileStorage } = makeFixture({ env: 'development' })
    switchEnvironments(
      { collections: [] } as unknown as Config,
      'development',
      developmentFileStorage,
    )
    expect(developmentFileStorage.collections.privateMedia).toEqual({ prefix: 'private' })
  })
})

describe('wrapClientUploadEndpoints', () => {
  it('leaves the body untouched in production', async () => {
    for (const appliedBeforeStoragePlugin of [false, true]) {
      const { callEndpoint } = makeFixture({ appliedBeforeStoragePlugin, env: 'production' })
      const body = await callEndpoint({ collectionSlug: 'privateMedia', docPrefix: 'private' })
      expect(body?.docPrefix).toBe('private')
    }
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

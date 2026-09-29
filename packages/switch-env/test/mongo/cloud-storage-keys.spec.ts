import type { S3Client as S3ClientClass } from '@aws-sdk/client-s3'

import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { s3Storage, type S3StorageOptions } from '@payloadcms/storage-s3'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  type BasePayload,
  buildConfig,
  type CollectionConfig,
  getPayload,
  handleEndpoints,
} from 'payload'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminThumbnail, switchEnvPlugin } from '../../src/index.js'
import {
  normalizeCopyConfig,
  resolvePayloadCollectionScopes,
  resolveVersionCollectionModes,
} from '../../src/lib/copyUtils.js'
import { backup, restore } from '../../src/lib/db/mongo.js'
import { sharedConfigDefaults } from '../shared/configDefaults.js'

// Storage keys must agree end to end: the object an upload writes, the key payload
// reads back to validate a client upload, and every URL the document reports
// (`url`, `sizes.*.url`, `thumbnailURL`) have to name the same objects. These tests
// run a real @payloadcms/storage-s3 adapter (clientUploads, the admin's default
// upload path) against an in-memory bucket, through payload's REST pipeline, and
// assert that invariant — plus the exact `staging/public/...` layout switch-env keeps
// for `copy`-mode deployments.
//
// The fixture mirrors payload-base: a `public` collection prefix, direct-to-bucket
// URLs via generateFileURL, switch-env's `adminThumbnail` helper, and a staging
// deployment that runs switch-env in `copy` mode with a `staging` development
// prefix and the storage collections object shared between both plugins.

type StoredObject = { body: Buffer; contentType?: string }
const bucket = new Map<string, StoredObject>()

const toBuffer = async (body: unknown): Promise<Buffer> => {
  if (Buffer.isBuffer(body)) {
    return body
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }
  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

// Patch the S3 client class storage-s3 itself resolves.
const requireFromS3Storage = createRequire(
  createRequire(import.meta.url).resolve('@payloadcms/storage-s3'),
)
const { S3Client } = requireFromS3Storage('@aws-sdk/client-s3') as {
  S3Client: typeof S3ClientClass
}
S3Client.prototype.send = async function send(command: {
  constructor: { name: string }
  input: Record<string, unknown>
}) {
  const key = command.input.Key as string
  switch (command.constructor.name) {
    case 'DeleteObjectCommand':
      bucket.delete(key)
      return {}
    case 'GetObjectCommand': {
      const object = bucket.get(key)
      if (!object) {
        throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' })
      }
      const range =
        typeof command.input.Range === 'string' && command.input.Range.match(/bytes=(\d+)-(\d+)/)
      const body = range
        ? object.body.subarray(Number(range[1]), Number(range[2]) + 1)
        : object.body
      return {
        Body: Readable.from(body),
        ContentLength: body.length,
        ContentType: object.contentType,
      }
    }
    case 'HeadObjectCommand': {
      const object = bucket.get(key)
      if (!object) {
        throw Object.assign(new Error(`NotFound: ${key}`), { name: 'NotFound' })
      }
      return { ContentLength: object.body.length, ContentType: object.contentType, ETag: '"etag"' }
    }
    case 'PutObjectCommand':
      bucket.set(key, {
        body: await toBuffer(command.input.Body),
        contentType: command.input.ContentType as string | undefined,
      })
      return {}
    default:
      throw new Error(`Unexpected S3 command in test: ${command.constructor.name}`)
  }
} as never

const mediaOrigin = 'https://test-bucket.s3.ap-southeast-2.amazonaws.com'

/** The bucket key a media URL points at, or undefined for a non-bucket URL. */
const keyOf = (url: null | string | undefined): string | undefined =>
  typeof url === 'string' && url.startsWith(`${mediaOrigin}/`)
    ? decodeURIComponent(url.slice(mediaOrigin.length + 1).split('?')[0])
    : undefined

const expectResolvableUrl = (label: string, url: null | string | undefined) => {
  const key = keyOf(url)
  expect(key, `${label} (${url}) is not a bucket URL`).toBeDefined()
  expect(
    bucket.has(key!),
    `${label} points at ${key}, which is not in the bucket: [${[...bucket.keys()].join(', ')}]`,
  ).toBe(true)
}

interface MediaDoc {
  _objectKey?: null | string
  createdDuringDevelopment?: boolean
  filename: string
  id: string
  prefix?: null | string
  sizes?: { thumbnail?: { filename?: string; url?: null | string } }
  thumbnailURL?: null | string
  url?: null | string
}

const expectAllUrlsResolve = (doc: MediaDoc) => {
  expectResolvableUrl('url', doc.url)
  expectResolvableUrl('sizes.thumbnail.url', doc.sizes?.thumbnail?.url)
  expectResolvableUrl('thumbnailURL (from adminThumbnail)', doc.thumbnailURL)
}

const makePng = () =>
  sharp({ create: { background: '#c00', channels: 3, height: 400, width: 400 } })
    .png()
    .toBuffer()

/**
 * - `production`: switch-env disabled, as payload-base's production deployment.
 * - `staging`: `copy` mode with development uploads in cloud storage under `staging`,
 *   the storage collections object shared with the storage plugin (as every site does).
 * - `staging-separate-options`: the same, but switch-env gets its own copy of the
 *   storage collections object, so the storage plugin never sees the development prefix.
 * - `local`: `switch` mode with development uploads on the local file system.
 */
type Deployment = 'local' | 'production' | 'staging' | 'staging-separate-options'

const isStaging = (deployment: Deployment) =>
  deployment === 'staging' || deployment === 'staging-separate-options'

const buildDeploymentConfig = ({
  deployment,
  developmentUrl,
  productionUrl,
  staticDir,
}: {
  deployment: Deployment
  developmentUrl: string
  productionUrl: string
  staticDir: string
}) => {
  // Shared by s3Storage and switch-env, exactly as payload-base does.
  const storageCollections: S3StorageOptions['collections'] = {
    media: {
      disablePayloadAccessControl: true,
      generateFileURL: ({ filename, prefix }) => `${mediaOrigin}/${prefix}/${filename}`,
      prefix: 'public',
    },
  }
  const media: CollectionConfig = {
    slug: 'media',
    fields: [{ name: 'alt', type: 'text' }],
    upload: {
      adminThumbnail: adminThumbnail({ basePath: mediaOrigin, imageSize: 'thumbnail' }),
      imageSizes: [{ name: 'thumbnail', height: 300, width: 300 }],
      mimeTypes: ['image/png'],
      staticDir,
    },
  }
  return buildConfig({
    ...sharedConfigDefaults,
    admin: { user: 'users' },
    collections: [{ slug: 'users', auth: true, fields: [] }, media],
    db: mongooseAdapter({ url: productionUrl }),
    plugins: [
      s3Storage({
        bucket: 'test-bucket',
        clientUploads: true,
        collections: storageCollections,
        config: {
          credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
          region: 'ap-southeast-2',
        },
      }),
      switchEnvPlugin({
        buttonMode: isStaging(deployment) ? 'copy' : 'switch',
        db: {
          developmentArgs: { url: developmentUrl },
          function: mongooseAdapter,
          productionArgs: { url: productionUrl },
        },
        developmentFileStorage: isStaging(deployment)
          ? {
              collections:
                deployment === 'staging' ? storageCollections : { media: { prefix: 'public' } },
              mode: 'cloud-storage',
              prefix: 'staging',
            }
          : { mode: 'file-system' },
        developmentSafetyMode: false,
        enable: deployment !== 'production',
      }),
    ],
    secret: 'test-secret-do-not-use-in-prod',
    sharp,
  })
}

interface Deploy {
  cacheKey: string
  payload: BasePayload
  token: string
}

const bootDeployment = async (
  deployment: Deployment,
  { baseUri, workDir }: { baseUri: string; workDir: string },
): Promise<Deploy> => {
  const cacheKey = `switch-env-test-cloud-storage-keys-${deployment}`
  const config = await buildDeploymentConfig({
    deployment,
    developmentUrl: `${baseUri}${deployment}-development`,
    productionUrl: `${baseUri}production`,
    staticDir: join(workDir, deployment),
  })
  const payload = await getPayload({
    config: Promise.resolve(config),
    key: cacheKey,
  } as Parameters<typeof getPayload>[0])
  const credentials = { email: `${deployment}@example.test`, password: 'test-password' }
  await payload.create({ collection: 'users', data: credentials })
  const { token } = await payload.login({ collection: 'users', data: credentials })
  return { cacheKey, payload, token: token! }
}

const rest = (deploy: Deploy, path: string, init: RequestInit) =>
  handleEndpoints({
    config: Promise.resolve(deploy.payload.config),
    payloadInstanceCacheKey: deploy.cacheKey,
    request: new Request(`http://localhost:3000/api${path}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `JWT ${deploy.token}` },
    }),
  })

/**
 * The admin's client-upload flow, as @payloadcms/storage-s3's S3ClientUploadHandler
 * and the admin form perform it: request a signed URL (sending the hidden prefix
 * field's value as docPrefix), PUT the bytes, then submit the form with the
 * client-upload reference in place of the file.
 */
const clientUpload = async (deploy: Deploy, filename: string) => {
  const png = await makePng()
  // The admin form's hidden prefix field holds its baked defaultValue.
  const docPrefix = 'public'
  const signResponse = await rest(deploy, '/storage-s3-generate-signed-url', {
    body: JSON.stringify({
      collectionSlug: 'media',
      docPrefix,
      filename,
      filesize: png.length,
      mimeType: 'image/png',
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  expect(signResponse.status).toBe(200)
  const signed = (await signResponse.json()) as {
    clientUploadContext: { prefix: string; signedReceipt: string }
    filename: string
    url: string
  }
  const putKey = decodeURIComponent(new URL(signed.url).pathname.slice(1))
  bucket.set(putKey, { body: png, contentType: 'image/png' })

  const form = new FormData()
  form.append(
    'file',
    JSON.stringify({
      clientUploadContext: {
        prefix: signed.clientUploadContext.prefix,
        signedReceipt: signed.clientUploadContext.signedReceipt,
      },
      collectionSlug: 'media',
      filename: signed.filename,
      mimeType: 'image/png',
      size: png.length,
    }),
  )
  form.append('_payload', JSON.stringify({ alt: filename, prefix: docPrefix }))
  const createResponse = await rest(deploy, '/media', { body: form, method: 'POST' })
  const body = (await createResponse.json()) as { doc?: MediaDoc; errors?: unknown }
  expect(createResponse.status, JSON.stringify(body.errors)).toBe(201)
  const doc = await deploy.payload.findByID({ id: body.doc!.id, collection: 'media', depth: 0 })
  return { doc: doc as unknown as MediaDoc, putKey }
}

/** A server-side upload (seed scripts, the local API). */
const localUpload = async (deploy: Deploy, filename: string) => {
  const png = await makePng()
  const created = await deploy.payload.create({
    collection: 'media',
    data: { alt: filename },
    file: { name: filename, data: png, mimetype: 'image/png', size: png.length },
  })
  const doc = await deploy.payload.findByID({ id: created.id, collection: 'media', depth: 0 })
  return doc as unknown as MediaDoc
}

/** The admin form posting the file itself, as it does when client uploads are off. */
const formUpload = async (deploy: Deploy, filename: string) => {
  const png = await makePng()
  const form = new FormData()
  form.append('file', new Blob([png], { type: 'image/png' }), filename)
  form.append('_payload', JSON.stringify({ alt: filename, prefix: 'public' }))
  const response = await rest(deploy, '/media', { body: form, method: 'POST' })
  const body = (await response.json()) as { doc?: MediaDoc; errors?: unknown }
  expect(response.status, JSON.stringify(body.errors)).toBe(201)
  const doc = await deploy.payload.findByID({ id: body.doc!.id, collection: 'media', depth: 0 })
  return doc as unknown as MediaDoc
}

/** Copies the production database over `target`'s development database. */
const copyProductionInto = async (production: Deploy, target: Deploy) => {
  const copy = normalizeCopyConfig({ copy: { documents: { default: { mode: 'all' } } } })
  const backupData = await backup(production.payload.db.connection, {
    payloadCollectionScopes: resolvePayloadCollectionScopes({ copy, payload: production.payload }),
    versionCollectionModes: resolveVersionCollectionModes({ copy, payload: production.payload }),
  })
  await restore(target.payload.db.connection, backupData, target.payload.logger)
}

const expectCopiedMediaResolves = async (target: Deploy, productionDoc: MediaDoc) => {
  const copied = (await target.payload.findByID({
    id: productionDoc.id,
    collection: 'media',
    depth: 0,
  })) as unknown as MediaDoc
  expect(copied._objectKey ?? null).toBe(productionDoc._objectKey ?? null)
  expect(copied.url).toBe(productionDoc.url)
  expectResolvableUrl('url', copied.url)
  expectResolvableUrl('sizes.thumbnail.url', copied.sizes?.thumbnail?.url)
  return copied
}

describe('cloud storage keys (storage-s3, clientUploads)', () => {
  let server: MongoMemoryServer
  let workDir: string
  let production: Deploy
  let staging: Deploy
  let stagingSeparateOptions: Deploy
  let local: Deploy

  beforeAll(async () => {
    server = await MongoMemoryServer.create()
    workDir = await mkdtemp(join(tmpdir(), 'switch-env-cloud-storage-keys-'))
    const boot = { baseUri: server.getUri(), workDir }
    production = await bootDeployment('production', boot)
    staging = await bootDeployment('staging', boot)
    stagingSeparateOptions = await bootDeployment('staging-separate-options', boot)
    local = await bootDeployment('local', boot)
  })

  afterAll(async () => {
    for (const deploy of [production, staging, stagingSeparateOptions, local]) {
      await deploy?.payload.db.destroy?.()
    }
    await server?.stop()
    if (workDir) {
      await rm(workDir, { force: true, recursive: true })
    }
  })

  describe('production deployment (switch-env disabled)', () => {
    it('client upload: every URL resolves to a stored object', async () => {
      const { doc, putKey } = await clientUpload(production, 'prod-client.png')
      expect(keyOf(doc.url)).toBe(putKey)
      expectAllUrlsResolve(doc)
    })

    it('local API upload: every URL resolves to a stored object', async () => {
      const doc = await localUpload(production, 'prod-local.png')
      expectAllUrlsResolve(doc)
    })
  })

  // `copy` mode applies the development prefix before the storage plugin reads its
  // options, so the storage plugin itself works under `staging/public`. Client uploads
  // add their `_objectKey` folder.
  describe('staging deployment (development cloud storage under `staging`)', () => {
    it('client upload: accepted, stored under staging/public, URLs resolve', async () => {
      const { doc, putKey } = await clientUpload(staging, 'staging-client.png')
      expect(doc.createdDuringDevelopment).toBe(true)
      expect(doc.prefix).toBe('staging/public')
      expect(putKey).toMatch(/^staging\/public\/[0-9a-f-]{36}\/staging-client\.png$/)
      expect(keyOf(doc.url)).toBe(putKey)
      expectAllUrlsResolve(doc)
    })

    it('local API upload: stored under staging/public, URLs resolve', async () => {
      const doc = await localUpload(staging, 'staging-local.png')
      expect(doc.createdDuringDevelopment).toBe(true)
      expect(doc.prefix).toBe('staging/public')
      expect(keyOf(doc.url)).toBe('staging/public/staging-local.png')
      expectAllUrlsResolve(doc)
    })

    // Runs last: the restore replaces the staging database wholesale.
    it('production media copied into staging still resolves to the production objects', async () => {
      const { doc: productionDoc } = await clientUpload(production, 'copied-to-staging.png')
      await copyProductionInto(production, staging)
      const copied = await expectCopiedMediaResolves(staging, productionDoc)
      expectResolvableUrl('thumbnailURL (from adminThumbnail)', copied.thumbnailURL)
    })
  })

  // The storage plugin recorded `public`, so development uploads are placed per request
  // instead, nested inside the collection prefix.
  describe('staging deployment with a separate storage options object', () => {
    it('client upload: accepted, stored under public/staging, URLs resolve', async () => {
      const { doc, putKey } = await clientUpload(stagingSeparateOptions, 'separate-client.png')
      expect(doc.createdDuringDevelopment).toBe(true)
      expect(doc.prefix).toBe('public/staging')
      expect(putKey).toMatch(/^public\/staging\/[0-9a-f-]{36}\/separate-client\.png$/)
      expect(keyOf(doc.url)).toBe(putKey)
      expectAllUrlsResolve(doc)
    })

    it('local API upload: stored under public/staging, URLs resolve', async () => {
      const doc = await localUpload(stagingSeparateOptions, 'separate-local.png')
      expect(doc.createdDuringDevelopment).toBe(true)
      expect(keyOf(doc.url)).toBe('public/staging/separate-local.png')
      expectAllUrlsResolve(doc)
    })
  })

  describe('local deployment (development uploads on the file system)', () => {
    it('never assigns an _objectKey, and dedupes same-name uploads on disk', async () => {
      const bucketKeys = new Set(bucket.keys())
      const first = await formUpload(local, 'dup.png')
      const second = await formUpload(local, 'dup.png')
      expect([first.filename, second.filename]).toEqual(['dup.png', 'dup-1.png'])
      for (const doc of [first, second]) {
        expect(doc.createdDuringDevelopment).toBe(true)
        expect(doc._objectKey ?? null).toBeNull()
        expect(doc.url).toBe(`/api/media/file/${doc.filename}`)
        await expect(stat(join(workDir, 'local', doc.filename))).resolves.toBeTruthy()
      }
      expect(new Set(bucket.keys())).toEqual(bucketKeys)
    })

    // Runs last: the restore replaces the local development database wholesale.
    it('production media copied into local development still resolves to the bucket', async () => {
      const { doc: productionDoc } = await clientUpload(production, 'copied-to-local.png')
      await copyProductionInto(production, local)
      await expectCopiedMediaResolves(local, productionDoc)
    })
  })
})

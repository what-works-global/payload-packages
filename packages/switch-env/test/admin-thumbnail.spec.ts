import type { GetAdminThumbnail } from 'payload'

import { describe, expect, it } from 'vitest'

import { adminThumbnail } from '../src/index.js'

const basePath = 'https://bucket.example'
const thumbnailOf = (doc: Record<string, unknown>) =>
  adminThumbnail({ basePath, imageSize: 'thumbnail' })({
    doc,
  } as Parameters<GetAdminThumbnail>[0])

describe('adminThumbnail', () => {
  it('builds prefix/filename for uploads without an _objectKey', () => {
    expect(
      thumbnailOf({
        filename: 'photo.png',
        prefix: 'public',
        sizes: { thumbnail: { filename: 'photo-300x300.png' } },
      }),
    ).toBe(`${basePath}/public/photo-300x300.png`)
  })

  // Client uploads on payload >= 3.90.0 live in a per-upload `_objectKey` folder,
  // image sizes included.
  it('includes the _objectKey folder', () => {
    expect(
      thumbnailOf({
        _objectKey: 'a1b2',
        filename: 'photo.png',
        prefix: 'public',
        sizes: { thumbnail: { filename: 'photo-300x300.png' } },
      }),
    ).toBe(`${basePath}/public/a1b2/photo-300x300.png`)
  })

  it('handles an _objectKey without a prefix, and the original file as fallback', () => {
    expect(thumbnailOf({ _objectKey: 'a1b2', filename: 'doc.pdf', prefix: '' })).toBe(
      `${basePath}/a1b2/doc.pdf`,
    )
    expect(thumbnailOf({ _objectKey: null, filename: 'doc.pdf', prefix: null })).toBe(
      `${basePath}/doc.pdf`,
    )
  })
})

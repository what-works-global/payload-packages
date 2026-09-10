// Maintained by hand. `payload generate:importmap` cannot load this config: it
// resolves the workspace's TS sources through .js specifiers, which only the
// bundler's extensionAlias handles, so the CLI dies on dev-fixture/credentials.js.
// Entries are the `path` values Payload reports when a component is missing.
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { S3ClientUploadHandler as S3ClientUploadHandler_f97eee1f7a5b1f4b1b0b8bcb3ff4d0ac } from '@payloadcms/storage-s3/client'
import { VideoConversionPanel as VideoConversionPanel_04ed11a8e4b6a08560502a5f85fd6a34 } from '@whatworks/payload-video-optimizer/client'

/** @type import('payload').ImportMap */
export const importMap = {
  '@payloadcms/next/rsc#CollectionCards': CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  '@payloadcms/storage-s3/client#S3ClientUploadHandler':
    S3ClientUploadHandler_f97eee1f7a5b1f4b1b0b8bcb3ff4d0ac,
  '@whatworks/payload-video-optimizer/client#VideoConversionPanel':
    VideoConversionPanel_04ed11a8e4b6a08560502a5f85fd6a34,
}

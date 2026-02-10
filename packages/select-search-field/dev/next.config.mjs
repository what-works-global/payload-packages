import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    rules: {
      '*.ts': [
        {
          loaders: ['./import-rewrite-loader.mjs'],
        },
      ],
      '*.tsx': [
        {
          loaders: ['./import-rewrite-loader.mjs'],
        },
      ],
    },
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })

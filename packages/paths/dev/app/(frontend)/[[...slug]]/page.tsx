import config from '@payload-config'
import { createGenerateStaticParams, createPathResolver } from '@whatworks/payload-paths/next'
import { getPayload } from 'payload'

import { pathsConfig } from '../../../paths.config.js'

export const dynamicParams = true

const getPayloadInstance = () => getPayload({ config })

const resolvePage = createPathResolver({
  collection: 'pages',
  config: pathsConfig,
  depth: 0,
  getPayload: getPayloadInstance,
})

export const generateStaticParams = createGenerateStaticParams({
  collection: 'pages',
  config: pathsConfig,
  getPayload: getPayloadInstance,
})

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { doc, path, url } = await resolvePage({ params })
  const page = doc as { title?: string }

  return (
    <main>
      <h1>{page.title}</h1>
      <p>
        Stored path: <code>{path}</code>
      </p>
      <p>
        Public URL: <code>{url}</code>
      </p>
      <p className="intro">
        This page was resolved by a single indexed <code>path</code> lookup. Try{' '}
        <a href="/about/contact">/about/contact</a> and <a href="/contact">/contact</a> — same slug,
        different levels, both resolve. Edit any page&apos;s slug in the <a href="/admin">admin</a>{' '}
        and its whole subtree follows.
      </p>
    </main>
  )
}

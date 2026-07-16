import config from '@payload-config'
import { getRedirectsConfig } from '@whatworks/payload-redirects'
import { getPayload } from 'payload'

// Render on every request so hook-driven cache syncs are visible on reload.
export const dynamic = 'force-dynamic'

const describeMatch = (match: string | undefined): string => match ?? 'exact'

export default async function FrontendPage() {
  const payload = await getPayload({ config })
  const redirectsConfig = getRedirectsConfig(payload.config)
  const cached = (await redirectsConfig.cache.get()) ?? []

  return (
    <main>
      <h1>@whatworks/payload-redirects dev</h1>
      <p className="intro">
        Create, reorder, edit or delete redirects in the <a href="/admin">admin</a> — every change
        rewrites the cache below, and <code>dev/proxy.ts</code> answers matching requests from it.
        Renaming the About page&apos;s slug re-syncs the reference redirect automatically.
      </p>

      <h2>Try it</h2>
      <ul>
        <li>
          <a href="/legacy-about">/legacy-about</a> — 301 to the About page with a{' '}
          <code>scrollTo</code> anchor (<code>#team</code>)
        </li>
        <li>
          <a href="/search-engine">/search-engine</a> — 302 to an external custom URL
        </li>
        <li>
          <a href="/posts/about">/posts/about</a> — regex <code>^/posts/(.+)$</code> →{' '}
          <code>/$1</code> (capture-group substitution)
        </li>
        <li>
          <a href="/section/anything">/section/anything</a> — <code>startsWith</code>{' '}
          <code>/section</code> → <code>/new-section</code>
        </li>
        <li>
          <a href="/docs-legacy">/docs-legacy</a> — case-insensitive exact match of{' '}
          <code>/Docs-Legacy</code> → <code>/docs</code>
        </li>
        <li>
          <a href="/promo?utm_source=demo">/promo?utm_source=demo</a> — <code>forwardQuery</code>{' '}
          appends the incoming query to <code>/campaign</code>
        </li>
        <li>
          <a href="/disabled-redirect">/disabled-redirect</a> — disabled, so it is absent from the
          cache and never fires
        </li>
      </ul>

      <h2>Cached redirects ({cached.length})</h2>
      <ul>
        {cached.map((redirect) => (
          <li key={redirect.id}>
            <code>{redirect.from}</code>{' '}
            <span className="intro">
              ({describeMatch(redirect.match)}
              {redirect.caseInsensitive ? ', case-insensitive' : ''}
              {redirect.forwardQuery ? ', forward-query' : ''})
            </span>{' '}
            → <code>{redirect.to}</code> ({redirect.type})
          </li>
        ))}
      </ul>
      <p className="intro">
        The cache is a <code>vercelRuntimeCache</code> delegating to a <code>fileCache</code> in
        development (<code>dev/.dbs/redirects-cache.json</code>). A hit is tracked on each redirect
        — watch the Hits column in the admin. The disabled redirect above is intentionally missing
        from this list.
      </p>
    </main>
  )
}

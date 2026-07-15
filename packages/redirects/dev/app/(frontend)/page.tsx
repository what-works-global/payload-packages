import config from '@payload-config'
import { getRedirectsConfig } from '@whatworks/payload-redirects'
import { getPayload } from 'payload'

// Render on every request so hook-driven cache syncs are visible on reload.
export const dynamic = 'force-dynamic'

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
      </ul>

      <h2>Cached redirects ({cached.length})</h2>
      <ul>
        {cached.map((redirect) => (
          <li key={redirect.id}>
            <code>{redirect.from}</code>
            {redirect.regex ? <span className="intro"> (regex)</span> : null} →{' '}
            <code>{redirect.to}</code> ({redirect.type})
          </li>
        ))}
      </ul>
      <p className="intro">
        The cache is a <code>vercelRuntimeCache</code> delegating to a <code>fileCache</code> in
        development (<code>dev/.dbs/redirects-cache.json</code>). A hit is tracked on each redirect
        — watch the Hits column in the admin.
      </p>
    </main>
  )
}

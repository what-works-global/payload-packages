import config from '@payload-config'
import { getSitemapEntries, sitemapCacheTag } from '@whatworks/payload-sitemap'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

// Render on every request so hook-driven invalidation is visible on reload.
export const dynamic = 'force-dynamic'

export default async function FrontendPage() {
  const payload = await getPayload({ config })
  // No siteUrl is configured in this sandbox, so the origin derives from the
  // incoming request — RSCs have no request object, hence the headers wrapper.
  const entries = await getSitemapEntries(payload, { request: { headers: await headers() } })

  return (
    <main>
      <h1>@whatworks/payload-sitemap dev</h1>
      <p className="intro">
        Publish, unpublish, delete or edit docs in the <a href="/admin">admin</a>, then reload —
        hooks invalidate the changed group after the save request, and the next read regenerates it.
        Draft-only saves and <code>excludeFromSitemap</code> docs never show up.
      </p>

      <h2>Delivery</h2>
      <ul>
        <li>
          <a href="/sitemap.xml">/sitemap.xml</a> — Next route handler (index referencing the chunks
          below)
        </li>
        <li>
          <a href="/robots.txt">/robots.txt</a> — <code>createRobots</code> (disallow-all outside
          production)
        </li>
        <li>
          <a href="/api/sitemap/index.xml">/api/sitemap/index.xml</a> — REST endpoint (disabled by
          default, enabled in this dev config)
        </li>
        <li>
          <a href="/api/sitemap/entries.json">/api/sitemap/entries.json</a> — JSON entries, 403
          unless logged in to the admin
        </li>
      </ul>

      <h2>Current entries</h2>
      {Object.entries(entries).map(([group, groupEntries]) => (
        <section className="group" key={group}>
          <h3>
            <a href={`/sitemaps/${group}-1.xml`}>{`${group}-1.xml`}</a>
            <span className="group__meta">
              {groupEntries.length} {groupEntries.length === 1 ? 'entry' : 'entries'} · cache tag{' '}
              <code>{sitemapCacheTag(group)}</code>
            </span>
          </h3>
          <ul>
            {groupEntries.map((entry) => (
              <li key={entry.loc}>
                <code>{entry.loc}</code>
                {entry.lastmod ? <span className="group__meta"> — {entry.lastmod}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}

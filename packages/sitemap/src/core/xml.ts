import type { ChangeFrequency, SitemapEntry } from '../types.js'

const XML_ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&apos;',
  '<': '&lt;',
  '>': '&gt;',
}

export const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char])

const clampPriority = (priority: number): string => String(Math.min(1, Math.max(0, priority)))

export const buildUrlsetXml = (
  entries: SitemapEntry[],
  defaults?: { changeFreq?: ChangeFrequency; priority?: number },
): string => {
  const body = entries
    .map((entry) => {
      const changefreq = entry.changefreq ?? defaults?.changeFreq
      const priority = entry.priority ?? defaults?.priority
      return [
        '  <url>',
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : null,
        changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
        priority !== undefined ? `    <priority>${clampPriority(priority)}</priority>` : null,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

export const buildSitemapIndexXml = (items: Array<{ lastmod?: string; loc: string }>): string => {
  const body = items
    .map((item) =>
      [
        '  <sitemap>',
        `    <loc>${escapeXml(item.loc)}</loc>`,
        item.lastmod ? `    <lastmod>${escapeXml(item.lastmod)}</lastmod>` : null,
        '  </sitemap>',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`
}

import type { Payload, PayloadRequest } from 'payload'

import type { ResolvedSitemapConfig, SitemapEntry } from '../types.js'

import { getGroupEntries } from './entries.js'

export const chunkFileName = (group: string, index: number): string => `${group}-${index + 1}.xml`

/**
 * Matches a chunk filename against the known groups by prefix, so group slugs
 * containing hyphens or digits parse unambiguously.
 */
export const matchChunkFile = (
  file: string,
  groups: string[],
): { group: string; index: number } | null => {
  for (const group of groups) {
    if (!file.startsWith(`${group}-`)) {
      continue
    }
    const match = /^([1-9]\d*)\.xml$/.exec(file.slice(group.length + 1))
    if (match) {
      return { group, index: Number(match[1]) - 1 }
    }
  }
  return null
}

const chunkSizeFor = (config: ResolvedSitemapConfig, group: string): number =>
  config.collections[group]?.chunkSize ?? config.chunkSize

const maxLastmod = (entries: SitemapEntry[]): string | undefined => {
  let max: string | undefined
  for (const entry of entries) {
    if (entry.lastmod && (!max || entry.lastmod > max)) {
      max = entry.lastmod
    }
  }
  return max
}

type BaseArgs = {
  config: ResolvedSitemapConfig
  payload: Payload
  req?: PayloadRequest
}

/** Items for the `<sitemapindex>`: one per chunk of each non-empty group. */
export const getIndexItems = async (
  args: { chunkUrl: (file: string) => string } & BaseArgs,
): Promise<Array<{ lastmod?: string; loc: string }>> => {
  const { chunkUrl, config } = args
  const items: Array<{ lastmod?: string; loc: string }> = []

  for (const group of config.groups) {
    const entries = await getGroupEntries({ ...args, group })
    if (!entries.length) {
      continue
    }
    const size = chunkSizeFor(config, group)
    for (let index = 0; index * size < entries.length; index++) {
      const chunk = entries.slice(index * size, (index + 1) * size)
      const lastmod = maxLastmod(chunk)
      items.push({ loc: chunkUrl(chunkFileName(group, index)), ...(lastmod ? { lastmod } : {}) })
    }
  }

  return items
}

/**
 * Entries for one chunk file, or `null` when the filename matches no group/range.
 * `loc` values are site-relative — pass through `finalizeEntries` before rendering.
 */
export const getChunkEntries = async (
  args: { file: string } & BaseArgs,
): Promise<{ entries: SitemapEntry[]; group: string } | null> => {
  const { config, file } = args
  const match = matchChunkFile(file, config.groups)
  if (!match) {
    return null
  }

  const entries = await getGroupEntries({ ...args, group: match.group })
  const size = chunkSizeFor(config, match.group)
  const start = match.index * size
  if (match.index > 0 && start >= entries.length) {
    return null
  }

  return { entries: entries.slice(start, start + size), group: match.group }
}

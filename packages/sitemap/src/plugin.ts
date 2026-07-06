import type { CheckboxField, Config, Field, Plugin } from 'payload'

import type { SitemapPluginConfig } from './types.js'

import { createAfterChangeHook, createAfterDeleteHook } from './core/invalidate.js'
import { resolveSitemapConfig } from './core/resolved.js'
import { createSitemapEndpoints } from './endpoints/createEndpoints.js'

/** Sidebar positioning only applies at the collection root; nested fields render inline. */
const excludeFromSitemapField = (nested: boolean): CheckboxField => ({
  name: 'excludeFromSitemap',
  type: 'checkbox',
  ...(nested ? {} : { admin: { position: 'sidebar' } }),
  label: 'Exclude from sitemap',
})

type InjectResult = { fields: Field[]; injected: boolean }

/** Missing path segments become nested group fields, with `injected` innermost. */
const buildGroupChain = (segments: string[], injected: Field[]): Field => {
  const [head, ...rest] = segments
  return {
    name: head,
    type: 'group',
    fields: rest.length ? [buildGroupChain(rest, injected)] : injected,
  }
}

/**
 * Appends `injected` to the container at `segments` — each segment a group
 * field or named tab. Descends into layout-only containers (rows, collapsibles,
 * unnamed groups and tabs) since they don't affect the data path, but only
 * follows named groups/tabs when they match the next segment — a match inside
 * any other named container would live at a different query path than the
 * `<group>.excludeFromSitemap` filter used at generation time. Once a segment
 * matches, missing deeper segments are created inside it as group fields.
 */
const injectAtPath = (
  fields: Field[],
  segments: string[],
  injected: Field[],
  collectionSlug: string,
): InjectResult => {
  const [segment, ...rest] = segments
  let found = false

  /** Children of a matched container: inject directly, descend, or create the missing tail. */
  const withInjected = (children: Field[]): Field[] => {
    if (!rest.length) {
      return [...children, ...injected]
    }
    const result = injectAtPath(children, rest, injected, collectionSlug)
    return result.injected ? result.fields : [...children, buildGroupChain(rest, injected)]
  }

  const mapped = fields.map((field): Field => {
    if (found) {
      return field
    }

    if ('name' in field && field.name === segment) {
      if (field.type !== 'group') {
        throw new Error(
          `[payload-sitemap] adminFields.group segment "${segment}" matches a "${field.type}" field on collection "${collectionSlug}" — each segment must be a group field or a named tab.`,
        )
      }
      found = true
      return { ...field, fields: withInjected(field.fields) }
    }

    if (field.type === 'tabs') {
      const tabs = field.tabs.map((tab) => {
        if (found) {
          return tab
        }
        if ('name' in tab && tab.name === segment) {
          found = true
          return { ...tab, fields: withInjected(tab.fields) }
        }
        if (!('name' in tab)) {
          const result = injectAtPath(tab.fields, segments, injected, collectionSlug)
          if (result.injected) {
            found = true
            return { ...tab, fields: result.fields }
          }
        }
        return tab
      })
      return found ? { ...field, tabs } : field
    }

    if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && !('name' in field))
    ) {
      const result = injectAtPath(field.fields, segments, injected, collectionSlug)
      if (result.injected) {
        found = true
        return { ...field, fields: result.fields }
      }
    }

    return field
  })

  return { fields: mapped, injected: found }
}

export const sitemapPlugin =
  (pluginConfig: SitemapPluginConfig): Plugin =>
  (config: Config): Config => {
    const slugs = Object.keys(pluginConfig.collections)

    /**
     * Fields are injected even when the plugin is disabled so the database schema
     * stays consistent for migrations.
     */
    if (pluginConfig.adminFields?.exclude !== false) {
      const groupPath = pluginConfig.adminFields?.group
      const segments = groupPath ? groupPath.split('.') : []
      if (segments.some((segment) => !segment)) {
        throw new Error(
          `[payload-sitemap] adminFields.group "${groupPath}" is not a valid field path.`,
        )
      }
      const injected: Field[] = [excludeFromSitemapField(segments.length > 0)]

      config.collections = (config.collections ?? []).map((collection) => {
        if (!slugs.includes(collection.slug)) {
          return collection
        }
        if (!segments.length) {
          return { ...collection, fields: [...collection.fields, ...injected] }
        }
        const result = injectAtPath(collection.fields, segments, injected, collection.slug)
        if (result.injected) {
          return { ...collection, fields: result.fields }
        }
        // No matching container on this collection — create the chain, so the exclude
        // flag lives at the same `<group>.excludeFromSitemap` path on every configured
        // collection.
        return {
          ...collection,
          fields: [...collection.fields, buildGroupChain(segments, injected)],
        }
      })
    }

    if (pluginConfig.disabled) {
      return config
    }

    for (const slug of slugs) {
      if (!config.collections?.some((collection) => collection.slug === slug)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[payload-sitemap] Collection "${slug}" is configured for the sitemap but does not exist.`,
        )
      }
    }

    const resolved = resolveSitemapConfig(pluginConfig)
    config.custom = { ...config.custom, sitemap: resolved }

    config.collections = (config.collections ?? []).map((collection) => {
      const collConfig = resolved.collections[collection.slug]
      if (!collConfig) {
        return collection
      }
      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            createAfterChangeHook(collection.slug, collConfig, resolved),
          ],
          afterDelete: [
            ...(collection.hooks?.afterDelete ?? []),
            createAfterDeleteHook(collection.slug, resolved),
          ],
        },
      }
    })

    if (resolved.endpoints) {
      config.endpoints = [...(config.endpoints ?? []), ...createSitemapEndpoints(resolved)]
    }

    return config
  }

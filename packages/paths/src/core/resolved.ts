import type { CollectionConfig, CollectionSlug, Config, Field, FlattenedField } from 'payload'

import { flattenTopLevelFields } from 'payload'

import type { ResolvedPathsPluginConfig } from '../types.js'
import type { PathsCollectionOptions, PathsStrategy, ResolvedPathsCollection } from './shared.js'

import { DEFAULT_HOME_SLUG, normalizePrefix } from './shared.js'

const findFieldByName = (fields: Field[], name: string): FlattenedField | undefined =>
  (flattenTopLevelFields(fields) as FlattenedField[]).find((field) => field.name === name)

const fail = (message: string): never => {
  throw new Error(`[payload-paths] ${message}`)
}

/**
 * Resolve one collection's options against its actual config: fill defaults,
 * detect the strategy from the fields present, and fail fast on impossible
 * setups (missing fields, localized slugs, name clashes) — a clear boot error
 * beats silently wrong paths.
 */
export const resolveCollectionOptions = (
  slug: string,
  options: PathsCollectionOptions | true,
  collection: CollectionConfig,
  config: Config,
  pluginHomeSlug: false | string | undefined,
): ResolvedPathsCollection => {
  const opts: PathsCollectionOptions = options === true ? {} : options

  const slugField = opts.slugField ?? 'slug'
  const parentField = opts.parentField ?? 'parent'
  const breadcrumbsField = opts.breadcrumbsField ?? 'breadcrumbs'
  const scopeField = opts.scopeField ?? null
  const urlField = opts.urlField ?? 'url'
  const homeSlug = opts.homeSlug ?? pluginHomeSlug ?? DEFAULT_HOME_SLUG
  const prefix = normalizePrefix(opts.prefix ?? '')

  const slugFieldConfig = findFieldByName(collection.fields, slugField)
  if (!slugFieldConfig) {
    fail(
      `Collection "${slug}" has no "${slugField}" field. Add one (or point \`slugField\` at the right field) before configuring paths.`,
    )
  }
  if (config.localization && slugFieldConfig && 'localized' in slugFieldConfig) {
    if (slugFieldConfig.localized) {
      fail(
        `Collection "${slug}": localized slug fields are not supported yet — paths would need to be localized too. Unlocalize "${slugField}" or leave this collection out of the paths plugin.`,
      )
    }
  }

  if (findFieldByName(collection.fields, 'path')) {
    fail(
      `Collection "${slug}" already has a "path" field — the paths plugin injects its own. Rename or remove the existing field.`,
    )
  }
  if (urlField !== false && findFieldByName(collection.fields, urlField)) {
    fail(
      `Collection "${slug}" already has a "${urlField}" field, which clashes with the injected virtual URL field. Set \`urlField\` to another name or \`false\`.`,
    )
  }

  if (scopeField && !findFieldByName(collection.fields, scopeField)) {
    fail(`Collection "${slug}" has no "${scopeField}" field to scope paths by.`)
  }

  const hasParent = Boolean(findFieldByName(collection.fields, parentField))
  const hasBreadcrumbs = Boolean(findFieldByName(collection.fields, breadcrumbsField))

  const requested: PathsStrategy = opts.strategy ?? 'auto'
  let strategy: ResolvedPathsCollection['strategy']

  switch (requested) {
    case 'auto': {
      strategy = hasBreadcrumbs && hasParent ? 'nested-docs' : hasParent ? 'parent' : 'flat'
      break
    }
    case 'flat': {
      strategy = 'flat'
      break
    }
    case 'nested-docs': {
      if (!hasParent || !hasBreadcrumbs) {
        fail(
          `Collection "${slug}" is configured with strategy "nested-docs" but is missing the "${parentField}"/"${breadcrumbsField}" fields those imply. Place pathsPlugin AFTER nestedDocsPlugin in the plugins array (plugins run in order), or use the "parent"/"flat" strategy.`,
        )
      }
      strategy = 'nested-docs'
      break
    }
    case 'parent': {
      if (!hasParent) {
        fail(
          `Collection "${slug}" is configured with strategy "parent" but has no "${parentField}" relationship field. Add one (\`createParentField('${slug}')\` builds a suitable field) or set \`parentField\`.`,
        )
      }
      strategy = 'parent'
      break
    }
  }

  return {
    // The assertion only matters in consumer projects, where generated types
    // make CollectionSlug a strict union; in this package it resolves to string.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    slug: slug as CollectionSlug,
    breadcrumbsField,
    cascade:
      strategy! === 'nested-docs' ? 'nested-docs' : strategy === 'parent' ? 'internal' : 'none',
    duplicateSlugSuffix: opts.duplicateSlugSuffix ?? '-copy',
    homeSlug,
    parentField,
    prefix,
    scopeField,
    slugField,
    strategy: strategy!,
    urlField,
  }
}

/**
 * Read the resolved plugin config a `pathsPlugin` run stored on the sanitized
 * Payload config — how `backfillPaths`/`verifyPathIntegrity` find their
 * settings when called standalone.
 */
export const getResolvedPathsConfig = (config: {
  custom?: Record<string, unknown>
}): ResolvedPathsPluginConfig => {
  const resolved = config.custom?.payloadPaths
  if (!resolved) {
    throw new Error(
      '[payload-paths] pathsPlugin is not registered on this Payload config (or is disabled).',
    )
  }
  return resolved as ResolvedPathsPluginConfig
}

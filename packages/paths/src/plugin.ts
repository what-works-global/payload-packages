import type { CollectionConfig, Config, Field, FieldHook, Plugin, TextField } from 'payload'

import type { ResolvedPathsCollection } from './core/shared.js'
import type { PathsPluginConfig, ResolvedPathsPluginConfig } from './types.js'

import { backfillPaths } from './core/backfill.js'
import { createEditButtonEndpoint } from './core/editButtonEndpoint.js'
import {
  createPathsAfterChangeHook,
  createPathsAfterDeleteHook,
  createPathsBeforeChangeHook,
} from './core/hooks.js'
import { reconcileSlugIndexes } from './core/reconcileIndexes.js'
import { resolveCollectionOptions } from './core/resolved.js'
import { composeUrl, PATH_FIELD_NAME } from './core/shared.js'
import { noopPathsCache } from './exports/cache.js'

/**
 * The stored path field. Hidden by default (editors see the virtual `url`
 * field instead); always recomputed in `beforeChange`, so a value sneaked in
 * through the API is overwritten. Cleared on duplicate so the copy computes
 * its own path.
 */
const buildPathField = (resolved: ResolvedPathsCollection): TextField => ({
  name: PATH_FIELD_NAME,
  type: 'text',
  admin: resolved.urlField === false ? { position: 'sidebar', readOnly: true } : { hidden: true },
  hooks: {
    // Cleared on duplicate; the copy recomputes from its (suffixed) slug.
    beforeDuplicate: [() => null],
  },
  index: true,
  label: 'Path',
})

/**
 * Add a `beforeDuplicate` hook to the slug field that appends the duplicate
 * suffix, so a copied document lands on its own path. Payload copies both the
 * slug and the published status verbatim, which would otherwise make the copy
 * collide with the original at publish time. Returns the fields unchanged when
 * the suffix is disabled or the slug field is absent/not a field with a name.
 */
const withDuplicateSuffixHook = (fields: Field[], resolved: ResolvedPathsCollection): Field[] => {
  if (resolved.duplicateSlugSuffix === false) {
    return fields
  }
  const suffix = resolved.duplicateSlugSuffix
  return fields.map((field) => {
    // UI fields have no `name`/`hooks`; only data fields can be the slug.
    if (field.type === 'ui' || !('name' in field) || field.name !== resolved.slugField) {
      return field
    }
    const suffixHook: FieldHook = ({ value }) =>
      typeof value === 'string' && value.length > 0 ? `${value}${suffix}` : value
    const existing = 'hooks' in field ? field.hooks : undefined
    return {
      ...field,
      hooks: {
        ...existing,
        beforeDuplicate: [...(existing?.beforeDuplicate ?? []), suffixHook],
      },
    } as Field
  })
}

/**
 * The virtual public-URL field: `prefix + path`, composed on read and never
 * stored — which is what makes a later prefix change pure config. Selecting it
 * requires selecting `path` too (it is computed from the sibling value).
 */
const buildUrlField = (resolved: ResolvedPathsCollection, name: string): TextField => ({
  name,
  type: 'text',
  admin: {
    position: 'sidebar',
    readOnly: true,
  },
  hooks: {
    afterRead: [
      ({ siblingData }) => {
        const path = siblingData?.[PATH_FIELD_NAME]
        return typeof path === 'string' ? composeUrl(resolved.prefix, path) : null
      },
    ],
  },
  label: 'URL',
  virtual: true,
})

/**
 * A ready-made self-referencing parent field for the `'parent'` strategy
 * (collections nested WITHOUT the nested-docs plugin). Indexed for the
 * cascade's children lookups; `filterOptions` blocks picking the document as
 * its own parent (deeper cycles are rejected at save time).
 */
export const createParentField = (
  collectionSlug: string,
  overrides: { name?: string } & Partial<Omit<Field, 'name' | 'type'>> = {},
): Field => ({
  name: overrides.name ?? 'parent',
  type: 'relationship',
  admin: {
    position: 'sidebar',
    ...('admin' in overrides ? (overrides as { admin?: object }).admin : {}),
  },
  filterOptions: ({ id }) => (id != null ? { id: { not_equals: id } } : true),
  index: true,
  label: 'Parent',
  relationTo: collectionSlug as never,
})

const hasDrafts = (collection: CollectionConfig): boolean =>
  Boolean(typeof collection.versions === 'object' && collection.versions?.drafts)

/**
 * Stored, queryable document paths for Payload page trees.
 *
 * Injects a computed `path` field (plus a virtual `url` field) into the
 * configured collections, recomputes it on every save by walking the parent
 * chain, enforces per-scope uniqueness at publish time with friendly errors,
 * keeps subtrees consistent when parents move (via nested-docs' cascade or
 * its own), invalidates a pluggable cache, and repairs null paths on boot.
 *
 * Framework-agnostic: nothing here imports Next.js. Next apps should use
 * `nextPathsPlugin` from `@whatworks/payload-paths/next`, which defaults the
 * cache and revalidation wiring.
 */
export const pathsPlugin =
  (pluginConfig: PathsPluginConfig): Plugin =>
  (config: Config): Config => {
    const resolvedPlugin: ResolvedPathsPluginConfig = {
      backfill: pluginConfig.backfill ?? 'fix',
      backfillLimit: pluginConfig.backfillLimit ?? 1000,
      cache: pluginConfig.cache ?? noopPathsCache(),
      collections: {},
      dropStaleSlugUniqueIndex: pluginConfig.dropStaleSlugUniqueIndex ?? true,
      maxCascadePreflight: pluginConfig.maxCascadePreflight ?? 500,
      onPathChanged: Array.isArray(pluginConfig.onPathChanged)
        ? pluginConfig.onPathChanged
        : pluginConfig.onPathChanged
          ? [pluginConfig.onPathChanged]
          : [],
    }

    const configuredSlugs = Object.keys(pluginConfig.collections)

    config.collections = (config.collections ?? []).map((collection) => {
      const options = pluginConfig.collections[collection.slug]
      if (options === undefined) {
        return collection
      }

      const resolved = resolveCollectionOptions(
        collection.slug,
        options,
        collection,
        config,
        pluginConfig.homeSlug,
      )
      resolvedPlugin.collections[collection.slug] = resolved

      const fields: Field[] = [
        ...withDuplicateSuffixHook(collection.fields, resolved),
        buildPathField(resolved),
      ]
      if (resolved.urlField !== false) {
        fields.push(buildUrlField(resolved, resolved.urlField))
      }

      const indexes = [...(collection.indexes ?? [])]
      if (hasDrafts(collection)) {
        // Published-vs-draft lookups filter on both — mirror the compound
        // index the slug-based setups used.
        indexes.push({ fields: [PATH_FIELD_NAME, '_status'] })
      }
      if (resolved.scopeField) {
        indexes.push({ fields: [resolved.scopeField, PATH_FIELD_NAME] })
      }

      const withFields: CollectionConfig = { ...collection, fields, indexes }

      if (pluginConfig.disabled) {
        return withFields
      }

      return {
        ...withFields,
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(collection.hooks?.afterChange ?? []),
            createPathsAfterChangeHook(resolved, resolvedPlugin),
          ],
          afterDelete: [
            ...(collection.hooks?.afterDelete ?? []),
            createPathsAfterDeleteHook(resolved, resolvedPlugin),
          ],
          beforeChange: [
            ...(collection.hooks?.beforeChange ?? []),
            createPathsBeforeChangeHook(resolved, resolvedPlugin),
          ],
        },
      }
    })

    const missing = configuredSlugs.filter((slug) => !resolvedPlugin.collections[slug])
    if (missing.length > 0) {
      throw new Error(
        `[payload-paths] Configured collection(s) not found on the Payload config: ${missing.join(', ')}. If a plugin registers them, place pathsPlugin after it in the plugins array.`,
      )
    }

    if (pluginConfig.disabled) {
      return config
    }

    if (pluginConfig.editButton) {
      const editButton = pluginConfig.editButton === true ? {} : pluginConfig.editButton
      config.endpoints = [
        ...(config.endpoints ?? []),
        createEditButtonEndpoint(resolvedPlugin, editButton),
      ]
      if (editButton.adminHint !== false) {
        // The hint provider stamps `localStorage` on every admin visit so the
        // frontend button knows this browser MAY be an editor's — the gate
        // that keeps anonymous visitors from ever calling the endpoint.
        config.admin = {
          ...config.admin,
          components: {
            ...config.admin?.components,
            providers: [
              ...(config.admin?.components?.providers ?? []),
              '@whatworks/payload-paths/client#PathsEditorHintProvider',
            ],
          },
        }
      }
    }

    config.custom = { ...config.custom, payloadPaths: resolvedPlugin }

    const priorOnInit = config.onInit
    config.onInit = async (payload) => {
      if (priorOnInit) {
        await priorOnInit(payload)
      }

      // Misconfiguration tripwires, evaluated against the FINAL sanitized
      // config: catching a wrong plugin order at boot beats silently wrong
      // paths at runtime.
      for (const resolved of Object.values(resolvedPlugin.collections)) {
        const sanitized = payload.collections[resolved.slug]?.config
        if (!sanitized) {
          continue
        }
        const fieldNames = new Set(sanitized.flattenedFields.map((field) => field.name))
        const looksNested =
          fieldNames.has(resolved.breadcrumbsField) && fieldNames.has(resolved.parentField)
        if (resolved.strategy === 'flat' && looksNested) {
          payload.logger.warn(
            `[payload-paths] "${resolved.slug}" resolved to the 'flat' strategy but now has "${resolved.parentField}"/"${resolved.breadcrumbsField}" fields — pathsPlugin probably runs BEFORE nestedDocsPlugin. Move pathsPlugin after it (or set \`strategy\` explicitly); nested documents currently get flat paths.`,
          )
        }
        if (resolved.strategy === 'parent' && fieldNames.has(resolved.breadcrumbsField)) {
          payload.logger.warn(
            `[payload-paths] "${resolved.slug}" uses the 'parent' strategy but also has a "${resolved.breadcrumbsField}" field — if the nested-docs plugin manages this collection, both cascades will re-save children. Use strategy 'nested-docs' instead.`,
          )
        }
      }

      // Reconcile a legacy unique slug index BEFORE backfilling: on Mongo it
      // clears the drift that would otherwise reject the duplicate slugs the
      // plugin allows. A no-op on SQL adapters (they reconcile via
      // push/migrations) and idempotent once the index is gone.
      if (resolvedPlugin.dropStaleSlugUniqueIndex) {
        try {
          await reconcileSlugIndexes(payload, resolvedPlugin)
        } catch (error) {
          payload.logger.error(error, '[payload-paths] Slug index reconciliation failed on init')
        }
      }

      if (resolvedPlugin.backfill !== 'off') {
        try {
          await backfillPaths(payload, { mode: resolvedPlugin.backfill })
        } catch (error) {
          payload.logger.error(error, '[payload-paths] Path backfill failed on init')
        }
      }
    }

    return config
  }

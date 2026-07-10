import type {
  CollectionConfig,
  Config,
  Field,
  GlobalConfig,
  Plugin,
  RelationshipField,
} from 'payload'

import type { AuditFieldsCustomConfig } from './shared.js'
import type { AuditEntitySelection, AuditFieldLabel, AuditFieldsPluginConfig } from './types.js'

import {
  defaultCreatedByField,
  defaultLastModifiedByField,
  defaultResolveUserLabel,
} from './defaults.js'
import { createAuditField } from './fields/createAuditField.js'
import { setCollectionAuditFields, setGlobalAuditFields } from './hooks/setAuditFields.js'
import { pluginKey, versionsViewComponentPath } from './shared.js'

type ResolvedFieldOptions = {
  label: AuditFieldLabel
  name: string
  override?: (field: RelationshipField) => RelationshipField
}

const createSelector = <TSlug extends string>(
  selection: AuditEntitySelection<TSlug> | undefined,
): ((slug: string) => boolean) => {
  if (selection === undefined || selection === true) {
    return () => true
  }
  if (Array.isArray(selection)) {
    const included = new Set<string>(selection)
    return (slug) => included.has(slug)
  }
  const excluded = new Set<string>(selection.exclude)
  return (slug) => !excluded.has(slug)
}

const hasNamedField = (fields: Field[], name: string): boolean => {
  return fields.some((field) => 'name' in field && field.name === name)
}

const resolveUserCollections = (
  config: Config,
  pluginConfig: AuditFieldsPluginConfig,
): string[] => {
  if (pluginConfig.userCollections?.length) {
    return pluginConfig.userCollections
  }
  const authSlugs = (config.collections ?? [])
    .filter((collection) => Boolean(collection.auth))
    .map((collection) => collection.slug)
  if (authSlugs.length) {
    return authSlugs
  }
  return [config.admin?.user ?? 'users']
}

export const auditFieldsPlugin = (pluginConfig: AuditFieldsPluginConfig = {}): Plugin => {
  return (incomingConfig: Config): Config => {
    const config = { ...incomingConfig }

    if (pluginConfig.enabled === false) {
      return config
    }

    const createdBy: null | ResolvedFieldOptions =
      pluginConfig.fields?.createdBy === false
        ? null
        : { ...defaultCreatedByField, ...pluginConfig.fields?.createdBy }
    const lastModifiedBy: null | ResolvedFieldOptions =
      pluginConfig.fields?.lastModifiedBy === false
        ? null
        : { ...defaultLastModifiedByField, ...pluginConfig.fields?.lastModifiedBy }

    if (!createdBy && !lastModifiedBy) {
      return config
    }

    const userCollections = resolveUserCollections(config, pluginConfig)
    const shouldAuditCollection = createSelector(pluginConfig.collections)
    const shouldAuditGlobal = createSelector(pluginConfig.globals)

    const versionsViewEnabled = pluginConfig.versionsView !== false
    const versionsColumnLabel =
      typeof pluginConfig.versionsView === 'object'
        ? (pluginConfig.versionsView.columnLabel ?? null)
        : null

    const index = pluginConfig.index === true
    const showInSidebar = pluginConfig.showInSidebar === true

    const buildAuditFields = (
      entitySlug: string,
      existingFields: Field[],
    ): {
      createdByFieldName: null | string
      fields: Field[]
      lastModifiedByFieldName: null | string
    } => {
      const fields: Field[] = []
      let createdByFieldName: null | string = null
      let lastModifiedByFieldName: null | string = null

      for (const options of [createdBy, lastModifiedBy]) {
        if (!options) {
          continue
        }
        // If the entity already defines a field with this name, leave it alone —
        // both the field config and its values stay entirely user-managed.
        if (hasNamedField(existingFields, options.name)) {
          continue
        }
        fields.push(
          createAuditField({
            name: options.name,
            entitySlug,
            index,
            label: options.label,
            override: options.override,
            showInSidebar,
            userCollections,
          }),
        )
        if (options === createdBy) {
          createdByFieldName = options.name
        } else {
          lastModifiedByFieldName = options.name
        }
      }

      return { createdByFieldName, fields, lastModifiedByFieldName }
    }

    const withVersionsView = <TEntity extends CollectionConfig | GlobalConfig>(
      entity: TEntity,
    ): TEntity => {
      if (!versionsViewEnabled || !entity.versions) {
        return entity
      }

      const views = entity.admin?.components?.views
      const edit = views?.edit

      // Respect existing view customizations: a `root` override replaces every
      // nested document view, and an existing `versions` override wins over ours.
      if (edit && ('root' in edit ? Boolean(edit.root) : Boolean(edit.versions))) {
        return entity
      }

      return {
        ...entity,
        admin: {
          ...entity.admin,
          components: {
            ...entity.admin?.components,
            views: {
              ...views,
              edit: {
                ...edit,
                versions: {
                  Component: versionsViewComponentPath,
                },
              },
            },
          },
        },
      }
    }

    const auditedCollection = (collection: CollectionConfig): CollectionConfig => {
      const { createdByFieldName, fields, lastModifiedByFieldName } = buildAuditFields(
        collection.slug,
        collection.fields,
      )

      if (!createdByFieldName && !lastModifiedByFieldName) {
        return collection
      }

      return withVersionsView({
        ...collection,
        fields: [...collection.fields, ...fields],
        hooks: {
          ...collection.hooks,
          beforeChange: [
            ...(collection.hooks?.beforeChange ?? []),
            setCollectionAuditFields({
              createdByFieldName,
              lastModifiedByFieldName,
              resolveUser: pluginConfig.resolveUser,
            }),
          ],
        },
      })
    }

    const auditedGlobal = (global: GlobalConfig): GlobalConfig => {
      const { createdByFieldName, fields, lastModifiedByFieldName } = buildAuditFields(
        global.slug,
        global.fields,
      )

      if (!createdByFieldName && !lastModifiedByFieldName) {
        return global
      }

      return withVersionsView({
        ...global,
        fields: [...global.fields, ...fields],
        hooks: {
          ...global.hooks,
          beforeChange: [
            ...(global.hooks?.beforeChange ?? []),
            setGlobalAuditFields({
              createdByFieldName,
              lastModifiedByFieldName,
              resolveUser: pluginConfig.resolveUser,
            }),
          ],
        },
      })
    }

    config.collections = (config.collections ?? []).map((collection) =>
      shouldAuditCollection(collection.slug) ? auditedCollection(collection) : collection,
    )

    config.globals = (config.globals ?? []).map((global) =>
      shouldAuditGlobal(global.slug) ? auditedGlobal(global) : global,
    )

    const customConfig: AuditFieldsCustomConfig = {
      createdByFieldName: createdBy?.name ?? null,
      lastModifiedByFieldName: lastModifiedBy?.name ?? null,
      resolveUserLabel: pluginConfig.resolveUserLabel ?? defaultResolveUserLabel,
      userCollections,
      versionsColumnLabel,
    }

    config.custom = {
      ...config.custom,
      [pluginKey]: customConfig,
    }

    return config
  }
}

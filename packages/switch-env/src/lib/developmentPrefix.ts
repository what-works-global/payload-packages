import type { CollectionConfig } from 'payload'

import type { DevelopmentFileStorageArgs } from '../types.js'

type CloudStorageArgs = Extract<DevelopmentFileStorageArgs, { mode: 'cloud-storage' }>
type CollectionOptions = CloudStorageArgs['collections'][keyof CloudStorageArgs['collections']]

/**
 * Where development uploads sit relative to a collection's storage prefix.
 *
 * Payload contains every new upload beneath the collection prefix the storage
 * plugin read when the config was built: the `prefix` normalize hooks rewrite the
 * stored prefix into it, the upload hook builds keys inside it, and a client
 * upload is read back from inside it. A development prefix outside it would be
 * re-nested (`public/staging/public`) — and differently by the signed-URL endpoint,
 * which reads the collection prefix at request time — so client uploads would be
 * written to one key and read back from another.
 *
 * - `outer`: the development prefix wraps the collection prefix —
 *   `staging/public/image.png`. Only possible when the development prefix was
 *   applied before the storage plugin read its options (see
 *   applyDevelopmentPrefixesBeforeStoragePlugin), because the storage plugin's own
 *   collection prefix then already is `staging/public`.
 * - `nested`: otherwise the development area sits inside the collection prefix,
 *   where every step agrees — `public/staging/<_objectKey>/image.png`.
 */
export type DevelopmentPrefixPlacement = 'nested' | 'outer'

/**
 * Storage collection options whose development prefix was applied before the
 * storage plugin read them, mapped to the prefix they were configured with.
 */
const prefixesAppliedBeforeStoragePlugin = new WeakMap<object, string>()

export const isPrefixAppliedBeforeStoragePlugin = (collectionOptions: CollectionOptions): boolean =>
  typeof collectionOptions === 'object' && prefixesAppliedBeforeStoragePlugin.has(collectionOptions)

const getCollectionOptions = (
  developmentFileStorage: CloudStorageArgs,
  collectionSlug: string | undefined,
): CollectionOptions =>
  collectionSlug ? developmentFileStorage.collections[collectionSlug] : undefined

export const getDevelopmentPrefixPlacement = (
  developmentFileStorage: DevelopmentFileStorageArgs,
  collectionSlug: string | undefined,
): DevelopmentPrefixPlacement =>
  developmentFileStorage.mode === 'cloud-storage' &&
  isPrefixAppliedBeforeStoragePlugin(getCollectionOptions(developmentFileStorage, collectionSlug))
    ? 'outer'
    : 'nested'

const joinPrefix = (...parts: string[]): string =>
  parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')

const isWithinPrefix = (value: string, prefix: string): boolean =>
  value === prefix || value.startsWith(`${prefix}/`)

const removeLeadingPrefix = (value: string, prefix: string): string =>
  !prefix || !isWithinPrefix(value, prefix) ? value : value.slice(prefix.length + 1)

/**
 * A collection's prefix in the storage options (`''` when it has none): the
 * development prefix for `outer` placement (rewritten in place by
 * applyDevelopmentPrefixesBeforeStoragePlugin), as configured for `nested`.
 */
export const getCollectionPrefix = (
  developmentFileStorage: CloudStorageArgs,
  collectionSlug: string | undefined,
): string => {
  const collectionOptions = getCollectionOptions(developmentFileStorage, collectionSlug)
  return typeof collectionOptions === 'object' && typeof collectionOptions.prefix === 'string'
    ? collectionOptions.prefix
    : ''
}

/**
 * Moves a storage prefix into the development area of `collectionPrefix` (see
 * getCollectionPrefix). Idempotent.
 *
 * `outer` prepends the development prefix unless it already leads. `nested`
 * places the prefix's path relative to the collection prefix beneath
 * `<collectionPrefix>/<developmentPrefix>`; an `outer` development prefix
 * (`staging/public`, e.g. from a document uploaded that way) maps onto the same
 * location.
 */
export const toDevelopmentPrefix = (
  value: string,
  {
    collectionPrefix,
    developmentPrefix,
    placement,
  }: {
    collectionPrefix: string
    developmentPrefix: string
    placement: DevelopmentPrefixPlacement
  },
): string => {
  if (!developmentPrefix) {
    return value
  }
  if (placement === 'outer') {
    return value && isWithinPrefix(value, developmentPrefix)
      ? value
      : joinPrefix(developmentPrefix, value)
  }
  const developmentArea = joinPrefix(collectionPrefix, developmentPrefix)
  if (value && isWithinPrefix(value, developmentArea)) {
    return value
  }
  const relativePrefix = removeLeadingPrefix(
    removeLeadingPrefix(value, developmentPrefix),
    collectionPrefix,
  )
  return joinPrefix(developmentArea, relativePrefix)
}

/**
 * `copy` mode only. Rewrites the storage collection options to the development
 * prefix (`public` → `staging/public`) when `switchEnvPlugin({...})` is *called* —
 * i.e. while the plugins array is being built, before `buildConfig` applies the
 * storage plugin, which reads its collection options only then. The storage plugin
 * therefore builds its fields, hooks and adapter around `staging/public` itself and
 * contains uploads beneath it instead of beneath `public`, keeping the
 * `staging/public/...` layout.
 *
 * Only `copy` mode can do this: its environment is always development, whereas
 * `switch` mode reads the environment from the database at runtime and would need
 * the recorded prefix to change later. It takes effect only when the storage
 * plugin reads this same options object; applying the plugin confirms that (see
 * confirmDevelopmentPrefixesAppliedBeforeStoragePlugin). Idempotent, so a config
 * re-evaluated in the same process keeps a single development prefix.
 */
export const applyDevelopmentPrefixesBeforeStoragePlugin = (
  developmentFileStorage: CloudStorageArgs,
): void => {
  if (!developmentFileStorage.prefix) {
    return
  }
  for (const collectionOptions of Object.values(developmentFileStorage.collections)) {
    if (typeof collectionOptions !== 'object' || typeof collectionOptions.prefix !== 'string') {
      continue
    }
    if (!prefixesAppliedBeforeStoragePlugin.has(collectionOptions)) {
      prefixesAppliedBeforeStoragePlugin.set(collectionOptions, collectionOptions.prefix)
    }
    collectionOptions.prefix = toDevelopmentPrefix(collectionOptions.prefix, {
      collectionPrefix: '',
      developmentPrefix: developmentFileStorage.prefix,
      placement: 'outer',
    })
  }
}

/**
 * Keeps the prefixes applied by applyDevelopmentPrefixesBeforeStoragePlugin only
 * for collections whose storage plugin recorded them — detected from the default
 * of the `prefix` field it adds, which it derives from the collection prefix it
 * read. Any other collection (a separate options object was passed to the storage
 * plugin, composite prefixes, a custom `prefix` field default) gets its configured
 * prefix back and falls back to request-time handling. Returns those slugs.
 */
export const confirmDevelopmentPrefixesAppliedBeforeStoragePlugin = (
  collections: CollectionConfig[],
  developmentFileStorage: CloudStorageArgs,
): string[] => {
  const fallbackSlugs: string[] = []
  for (const [slug, collectionOptions] of Object.entries(developmentFileStorage.collections)) {
    if (
      typeof collectionOptions !== 'object' ||
      !isPrefixAppliedBeforeStoragePlugin(collectionOptions)
    ) {
      continue
    }
    const prefixField = collections
      .find((collection) => collection.slug === slug)
      ?.fields.find((field) => 'name' in field && field.name === 'prefix')
    const recordedPrefix =
      prefixField && 'defaultValue' in prefixField ? prefixField.defaultValue : undefined
    if (recordedPrefix !== collectionOptions.prefix) {
      collectionOptions.prefix = prefixesAppliedBeforeStoragePlugin.get(collectionOptions)
      prefixesAppliedBeforeStoragePlugin.delete(collectionOptions)
      fallbackSlugs.push(slug)
    }
  }
  return fallbackSlugs
}

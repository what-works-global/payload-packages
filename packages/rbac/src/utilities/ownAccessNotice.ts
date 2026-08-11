import type { Payload } from 'payload'

/**
 * A controlled collection or global that defines access of its own, so the plugin
 * left those operations alone instead of installing its role check.
 */
export type EntityWithOwnAccess = {
  entity: 'collection' | 'global'
  /**
   * The operations the plugin did not touch, e.g. `['read', 'readVersions']`.
   * Operations opted into `compose` are excluded — there the role check applies.
   */
  operations: string[]
  slug: string
}

/**
 * The startup notice text. Deliberately worded as "may not apply": whether the
 * entity's own access already performs a role check (through `requirePermission`
 * or `hasPermission`) is not knowable from the config, so this points at both
 * fixes rather than declaring a fault.
 */
export const formatOwnAccessNotice = (entities: readonly EntityWithOwnAccess[]): string => {
  const list = entities
    .map(({ slug, entity, operations }) => `${slug} (${entity}): ${operations.join(', ')}`)
    .join('; ')

  return (
    `[payload-rbac] These controlled entities define access of their own, so the plugin left those ` +
    `operations alone and their permissions may not apply — ${list}. ` +
    `Nothing is wrong if those access functions already check permissions themselves ` +
    `(requirePermission/hasPermission). Otherwise compose the role check into them, or let the plugin ` +
    `do it: compose: { '<slug>': ['<action>'] } ANDs the permission check with the access already ` +
    `defined. Set quiet: true to silence this notice.`
  )
}

export type LogOwnAccessNoticeArgs = {
  entities: readonly EntityWithOwnAccess[]
  /**
   * Payload's logger when one is reachable (init). Falls back to `console.info`,
   * so the notice is never lost when it is not.
   */
  logger?: Pick<Payload['logger'], 'info'>
}

/** Emits {@link formatOwnAccessNotice}, or nothing at all when there is nothing to report. */
export const logOwnAccessNotice = ({ entities, logger }: LogOwnAccessNoticeArgs): void => {
  if (entities.length === 0) {
    return
  }

  const message = formatOwnAccessNotice(entities)
  if (typeof logger?.info === 'function') {
    logger.info(message)
    return
  }
  // eslint-disable-next-line no-console -- no payload logger is reachable; the notice still has to surface
  console.info(message)
}

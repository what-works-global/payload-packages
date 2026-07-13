import type { PayloadRequest } from 'payload'

import React from 'react'

import type { AlgoliaSearchContext } from '../types.js'

import { pluginKey } from '../shared.js'
import { ReindexAction, type ReindexActionProps } from './ReindexAction.js'

export type ReindexActionServerProps = {
  /** Provided by Payload's admin template alongside the other server props. */
  req?: PayloadRequest
} & ReindexActionProps

/**
 * Server wrapper around the header icon: evaluates `reindex.access` with the
 * live admin request and renders nothing for users who may not reindex. The
 * endpoint enforces the same check — this only keeps the icon honest.
 */
export const ReindexActionServer = async ({
  collections,
  reindexPath,
  req,
}: ReindexActionServerProps): Promise<null | React.JSX.Element> => {
  const context = (req?.payload.config.custom as Record<string, unknown> | undefined)?.[
    pluginKey
  ] as AlgoliaSearchContext | undefined
  if (!context || !req) {
    return null
  }

  let allowed = false
  try {
    allowed = await context.reindex.access({ req })
  } catch (error) {
    req.payload.logger.error({
      err: error,
      msg: '[algolia-search] reindex access check failed — hiding the header action',
    })
  }
  if (!allowed) {
    return null
  }

  return <ReindexAction collections={collections} reindexPath={reindexPath} />
}

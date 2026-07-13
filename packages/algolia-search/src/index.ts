export { createAlgoliaClientFactory } from './algolia.js'
export { buildDefaultRecord, type BuildRecordArgs, buildSearchRecord } from './buildRecord.js'
export {
  defaultContentLimit,
  defaultExcludeFields,
  defaultIndexSettings,
  defaultReindexAccess,
  defaultReindexBatchSize,
  defaultReindexPath,
} from './defaults.js'
export {
  extractDocumentText,
  type ExtractDocumentTextArgs,
  extractRichTextText,
} from './extractText.js'
export { syncAfterChange, syncAfterDelete } from './hooks.js'
export { algoliaSearchPlugin } from './plugin.js'
export {
  createReindexHandler,
  getAlgoliaSearchContext,
  type ReindexResult,
  runAlgoliaReindex,
} from './reindex.js'
export { createRichTextToText, loadLexicalConverter } from './richText.js'
export { getObjectID, pluginKey, reindexActionPath } from './shared.js'
export type * from './types.js'

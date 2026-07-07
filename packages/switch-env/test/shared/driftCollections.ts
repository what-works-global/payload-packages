import type { CollectionConfig } from 'payload'

// Collection sets for the schema-progressed copy scenarios. `production` is
// the schema production was deployed with; the other two are local code states
// that have drifted from it in different ways. Factories for the same reason
// as collections.ts (buildConfig mutates the array).

const statusField: CollectionConfig['fields'][number] = {
  name: 'status',
  type: 'select',
  options: [
    { label: 'Draft', value: 'draft' },
    { label: 'Published', value: 'published' },
  ],
}

export const buildProductionCollections = (): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'legacy', type: 'text' },
      statusField,
    ],
  },
  {
    slug: 'archived-items',
    fields: [{ name: 'name', type: 'text' }],
  },
]

/**
 * Rename-shaped drift: `posts` both removes a column (legacy) and adds columns
 * (subtitle, rating); a collection is deleted (archived-items) while another is
 * added (reviews). Indistinguishable from renames — the reconcile must pause.
 */
export const buildAmbiguousCollections = (): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      statusField,
      { name: 'subtitle', type: 'text' },
      { name: 'rating', type: 'number', defaultValue: 5, required: true },
    ],
  },
  {
    slug: 'reviews',
    fields: [{ name: 'comment', type: 'text' }],
  },
]

/**
 * Unambiguous drift: a column added to `posts` (no column removed from it) and
 * a collection deleted (none added). No created+deleted pair of the same kind
 * exists, so the reconcile must run headlessly — drizzle's push handles the
 * drops (including the deleted collection's FK column in
 * payload_locked_documents_rels) without prompting.
 */
export const buildUnambiguousCollections = (): CollectionConfig[] => [
  {
    slug: 'posts',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'legacy', type: 'text' },
      statusField,
      { name: 'subtitle', type: 'text' },
    ],
  },
]

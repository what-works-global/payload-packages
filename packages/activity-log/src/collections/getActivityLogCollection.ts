import type { CollectionConfig } from 'payload'

import {
  documentCellComponentPath,
  userCellComponentPath,
  userFieldComponentPath,
  versionCellComponentPath,
} from '../shared.js'

export type GetActivityLogCollectionArgs = {
  /** Adds the `ipAddress` field (and list column) when IP tracking is enabled. */
  ipAddress?: boolean
  slug: string
  userCollections: string[]
}

/**
 * The append-only collection log entries are stored in. Entries are created
 * exclusively by the plugin's hooks (through the local API, which overrides
 * access), so all mutating access is locked down; reads default to any
 * authenticated user. Use the plugin's `collectionOverride` to customize.
 */
export const getActivityLogCollection = ({
  slug,
  ipAddress = false,
  userCollections,
}: GetActivityLogCollectionArgs): CollectionConfig => ({
  slug,
  access: {
    create: () => false,
    delete: () => false,
    read: ({ req }) => Boolean(req.user),
    update: () => false,
  },
  admin: {
    defaultColumns: [
      'createdAt',
      'user',
      'operation',
      'documentTitle',
      'versionId',
      ...(ipAddress ? ['ipAddress'] : []),
    ],
    useAsTitle: 'documentTitle',
  },
  defaultSort: '-createdAt',
  disableDuplicate: true,
  fields: [
    {
      name: 'user',
      type: 'relationship',
      admin: {
        components: {
          Cell: userCellComponentPath,
          Field: userFieldComponentPath,
        },
        readOnly: true,
      },
      index: true,
      label: 'User',
      relationTo: userCollections,
    },
    {
      // The acting user's label captured at event time — survives user deletion
      // and renders without extra queries. Displayed through the user field/cell.
      name: 'userLabel',
      type: 'text',
      admin: {
        hidden: true,
      },
      label: 'User Label',
    },
    {
      name: 'operation',
      type: 'select',
      admin: {
        readOnly: true,
      },
      index: true,
      label: 'Operation',
      options: [
        { label: 'Create', value: 'create' },
        { label: 'Update', value: 'update' },
        { label: 'Trash', value: 'trash' },
        { label: 'Restore', value: 'restore' },
        { label: 'Delete', value: 'delete' },
        { label: 'Login', value: 'login' },
        { label: 'Logout', value: 'logout' },
      ],
    },
    ...(ipAddress
      ? ([
          {
            // The requesting client's address, captured for every logged
            // operation when the plugin's opt-in `ipAddress` option is enabled.
            name: 'ipAddress',
            type: 'text',
            admin: {
              condition: (data) => Boolean(data?.ipAddress),
              readOnly: true,
            },
            index: true,
            label: 'IP Address',
          },
        ] satisfies CollectionConfig['fields'])
      : []),
    {
      name: 'collectionSlug',
      type: 'text',
      admin: {
        readOnly: true,
      },
      index: true,
      label: 'Collection',
    },
    {
      name: 'globalSlug',
      type: 'text',
      admin: {
        readOnly: true,
      },
      index: true,
      label: 'Global',
    },
    {
      name: 'documentId',
      type: 'text',
      admin: {
        readOnly: true,
      },
      index: true,
      label: 'Document ID',
    },
    {
      // The affected document's title captured at event time — survives document
      // deletion. The cell links to the document when it still exists.
      name: 'documentTitle',
      type: 'text',
      admin: {
        components: {
          Cell: documentCellComponentPath,
        },
        readOnly: true,
      },
      label: 'Document',
    },
    {
      // ID of the version saved by this change; the cell links to the version
      // diff view. Only set for entities with versions enabled.
      name: 'versionId',
      type: 'text',
      admin: {
        components: {
          Cell: versionCellComponentPath,
        },
        readOnly: true,
      },
      label: 'Version',
    },
    {
      name: 'changedFields',
      type: 'text',
      admin: {
        readOnly: true,
      },
      hasMany: true,
      label: 'Changed Fields',
    },
    {
      name: 'snapshot',
      type: 'json',
      admin: {
        condition: (data) => Boolean(data?.snapshot),
        readOnly: true,
      },
      label: 'Snapshot',
    },
  ],
  labels: {
    plural: 'Activity Log',
    singular: 'Activity',
  },
  timestamps: true,
})

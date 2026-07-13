import type { CollectionConfig, Option } from 'payload'

import type { MatrixRow } from '../shared.js'

import { FULL_ACCESS, permissionFor } from '../permissions.js'
import { permissionsMatrixFieldPath } from '../shared.js'

export type CreateRolesCollectionArgs = {
  access: CollectionConfig['access']
  hooks?: CollectionConfig['hooks']
  matrixRows: MatrixRow[]
  override?: (collection: CollectionConfig) => CollectionConfig
  /** Names of code-locked roles; the matrix renders read-only for them. */
  protectedRoleNames?: string[]
  slug: string
}

/**
 * Builds the roles collection. Permissions are stored as an array of
 * `'<slug>:<action>'` strings (plus `'*'`) in a `select` field, so every value is
 * validated against the known collections and globals; the admin UI renders them
 * through the plugin's checkbox-matrix field component.
 */
export const createRolesCollection = ({
  slug,
  access,
  hooks,
  matrixRows,
  override,
  protectedRoleNames = [],
}: CreateRolesCollectionArgs): CollectionConfig => {
  const options: Option[] = [
    { label: 'Full access', value: FULL_ACCESS },
    ...matrixRows.flatMap((row) =>
      row.actions.map((action) => ({
        label: `${row.label}: ${action}`,
        value: permissionFor(row.slug, action),
      })),
    ),
  ]

  const collection: CollectionConfig = {
    slug,
    access,
    admin: {
      defaultColumns: ['name', 'description'],
      description: 'Roles control what users can access. Assign them on the user document.',
      useAsTitle: 'name',
    },
    fields: [
      {
        name: 'name',
        type: 'text',
        index: true,
        label: 'Name',
        required: true,
        unique: true,
      },
      {
        name: 'description',
        type: 'textarea',
        label: 'Description',
      },
      {
        name: 'permissions',
        type: 'select',
        admin: {
          components: {
            Field: {
              clientProps: { protectedRoleNames, rows: matrixRows },
              path: permissionsMatrixFieldPath,
            },
          },
        },
        hasMany: true,
        label: 'Permissions',
        options,
      },
    ],
    hooks,
  }

  return override ? override(collection) : collection
}

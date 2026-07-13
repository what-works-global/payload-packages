import type { RelationshipField } from 'payload'

export type CreateRolesFieldArgs = {
  access?: RelationshipField['access']
  name: string
  override?: (field: RelationshipField) => RelationshipField
  rolesCollectionSlug: string
}

/**
 * Builds the roles field added to each user collection. `saveToJWT` keeps the role
 * IDs on the token payload for consumers reading the JWT directly; access checks
 * always resolve permissions from the user document.
 */
export const createRolesField = ({
  name,
  access,
  override,
  rolesCollectionSlug,
}: CreateRolesFieldArgs): RelationshipField => {
  const field: RelationshipField = {
    name,
    type: 'relationship',
    ...(access ? { access } : {}),
    admin: {
      description: 'Roles controlling what this user can access.',
      position: 'sidebar',
    },
    hasMany: true,
    index: true,
    label: 'Roles',
    relationTo: rolesCollectionSlug,
    saveToJWT: true,
  }

  return override ? override(field) : field
}

import type { PayloadRequest } from 'payload'

/**
 * Resolves a role's ID from its unique name, scoped to the current request so the
 * lookup stays inside any active transaction. Returns undefined when no role with
 * that name exists — e.g. a renamed admin role whose old name no longer resolves.
 */
export const findRoleIdByName = async (
  req: PayloadRequest,
  rolesCollectionSlug: string,
  name: string,
): Promise<number | string | undefined> => {
  const { docs } = await req.payload.find({
    collection: rolesCollectionSlug,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
    where: { name: { equals: name } },
  })
  const id = (docs[0] as { id?: unknown } | undefined)?.id
  return typeof id === 'number' || typeof id === 'string' ? id : undefined
}

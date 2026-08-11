import type { Access, AccessResult } from 'payload'

/**
 * ANDs two access results, mirroring Payload's own `combineQueries`: a denial
 * wins outright, an unconditional grant is the identity, and two query
 * constraints combine into one `{ and: [...] }` filter (Payload's `Where` uses
 * the lowercase `and` key, so the result stays a valid query).
 */
export const andAccessResults = (first: AccessResult, second: AccessResult): AccessResult => {
  if (first === false || second === false) {
    return false
  }
  if (first === true) {
    return second
  }
  if (second === true) {
    return first
  }
  return { and: [first, second] }
}

/**
 * Combines two access functions into one that grants only what both grant. Both
 * may be async and both receive the exact same args; `second` is never called
 * once `first` has denied. Used by the plugin's `compose` option to AND its role
 * check into access a collection or global defines itself, and exported for
 * composing access functions by hand.
 */
export const composeAccess = (first: Access, second: Access): Access => {
  return async (args) => {
    const firstResult = await first(args)
    if (firstResult === false) {
      return false
    }
    return andAccessResults(firstResult, await second(args))
  }
}

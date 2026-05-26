import { describe, expect, it } from 'vitest'

import { resolveJsonSchemaRelationships } from '../src/index.js'
import {
  flattenDocument,
  relationshipTitleResolver,
  transformDocument,
  traverseDocument,
} from '../src/traverseDocument/index.js'

describe('@whatworks/payload-utilities peer smoke', () => {
  it('public functions are callable', () => {
    expect(typeof resolveJsonSchemaRelationships).toBe('function')
    expect(typeof flattenDocument).toBe('function')
    expect(typeof transformDocument).toBe('function')
    expect(typeof traverseDocument).toBe('function')
    expect(typeof relationshipTitleResolver).toBe('function')
  })
})

# Payload Utilities

<a href="https://whatworks.com.au" target="_blank" rel="noopener noreferrer">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/blackbanner.svg">
    <img alt="Payload Utilities" src="../../assets/whitebanner.svg">
  </picture>
</a>

&nbsp;

A collection of utilities for Payload 3.0.

## Contents

- [Installation](#installation)
- [Exports](#exports)
- [`resolveJsonSchemaRelationships`](#resolvejsonschemarelationships)
- [`traverseDocument`](#traversedocument)
- [`flattenDocument`](#flattendocument)
- [`transformDocument`](#transformdocument)
- [Field resolvers](#field-resolvers)

## Installation

```bash
pnpm add @whatworks/payload-utilities
```

## Exports

| Entry | Path |
| --- | --- |
| Root | `@whatworks/payload-utilities` |
| Document traversal | `@whatworks/payload-utilities/traverseDocument` |

## `resolveJsonSchemaRelationships`

A `JsonSchemaFunction` for `config.typescript.schema` that rewrites generated types under the assumption that documents are always fetched with full depth. Strips the unresolved `string` (ID) variant from relationship unions so `string | Page` becomes `Page` and `(string | Page)[]` becomes `Page[]`. Null is preserved.

```ts
import { buildConfig } from 'payload'
import { resolveJsonSchemaRelationships } from '@whatworks/payload-utilities'

export default buildConfig({
  typescript: {
    schema: [resolveJsonSchemaRelationships],
  },
})
```

## `traverseDocument`

Walks a document against its sanitized collection schema, invoking a callback for each field/value pair. Recurses into `array` and `group` fields. Returning a truthy value from the callback short-circuits traversal. Sync callbacks return `void`; async callbacks return `Promise<void>`.

```ts
import { traverseDocument } from '@whatworks/payload-utilities/traverseDocument'

await traverseDocument({
  collection,
  doc,
  req,
  callback: ({ field, schemaPathSegments, value }) => {
    console.log(schemaPathSegments.map((s) => s.name).join('.'), field.type, value)
  },
})
```

Callback args:

- `field` — the matched `Field` from the schema map.
- `schemaPathSegments` — `{ name, label }[]` describing the path through the schema.
- `indexPathSegments` — same as `schemaPathSegments` but includes array indices.
- `siblingData` — the parent object the value lives on.
- `schemaMap` — the resolved Payload field schema map.
- `value` — the field's current value.

## `flattenDocument`

Returns a flat, schema-ordered array of `{ field, schemaPathSegments, indexPathSegments, value }` for every visited field. Optionally applies `fieldResolvers` to transform the stored `value`. Useful for serializing documents (e.g. exporting, indexing, generating previews).

```ts
import {
  flattenDocument,
  relationshipTitleResolver,
  richTextPlaintextResolver,
} from '@whatworks/payload-utilities/traverseDocument'

const rows = await flattenDocument({
  collection,
  doc,
  req,
  excludedFields: ['internalNotes'],
  fieldResolvers: {
    relationship: relationshipTitleResolver,
    richText: richTextPlaintextResolver(),
  },
})
```

## `transformDocument`

Returns a deep-cloned copy of the document with any `fieldResolvers` applied in place. Resolvers returning `undefined` leave the value untouched; child paths win over parent paths when both resolve.

```ts
import {
  transformDocument,
  uploadMetadataResolver,
} from '@whatworks/payload-utilities/traverseDocument'

const transformed = await transformDocument({
  collection,
  doc,
  req,
  fieldResolvers: {
    upload: uploadMetadataResolver,
  },
})
```

## Field resolvers

A `FieldResolver<T>` receives the field, its value, sibling data, and the current request, and returns a replacement value (or `undefined` to keep the original). Three are bundled:

| Resolver | Field type | Behavior |
| --- | --- | --- |
| `relationshipTitleResolver` | `relationship` | Resolves to the referenced document's `admin.useAsTitle` value. Falls back to the populated value on the doc, then the ID, then the original value. Handles polymorphic and `hasMany` relationships. |
| `richTextPlaintextResolver({ converters? })` | `richText` | Converts a Lexical value to plain text via `@payloadcms/richtext-lexical/plaintext`. Accepts optional custom `PlaintextConverters`. |
| `uploadMetadataResolver` | `upload` | Resolves to `{ id, filename, filesize, mimeType, url }` from the referenced upload document. Uses inline metadata when complete, otherwise fetches it. |

Define your own by typing the field key:

```ts
import type { FieldResolver } from '@whatworks/payload-utilities/traverseDocument'

const numberResolver: FieldResolver<'number'> = ({ value }) =>
  typeof value === 'number' ? value.toFixed(2) : undefined
```

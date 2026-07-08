---
'@whatworks/payload-select-search-field': patch
---

Fix "Field not found" when a `selectSearch` field is used inside a richText (lexical) block. The endpoint resolved the field's `searchFunction` via the entity's `flattenedFields`, which do not include fields nested inside lexical blocks. It now falls back to the full field schema map (keyed by the complete `schemaPath`, including lexical block sub-fields) when the field is not found on `flattenedFields`.

---
'@whatworks/payload-heading-field': patch
---

`RenderHeading`'s `data` prop now accepts a nullable partial shape
(`{ tag?: ... | null; value?: ... | null }`), matching what Payload generates for
optional fields. The component already handled null `tag`/`value` at runtime; this
aligns the type so callers no longer need to coerce `null` → `undefined` to pass
generated types. Adds an exported `NullablePartial<T>` helper.

---
'@whatworks/payload-heading-field': major
---

`headingField()` now takes the field as its first argument and an optional config
as its second — `headingField(field, config?)` — instead of a single
`{ config, field }` object. Adopting it in an existing codebase is now a one-line
change: wrap your existing field object directly, e.g.
`headingField({ name: 'heading', type: 'text' })`, and pass `config` only when
you need to override the defaults.

Migration: change `headingField({ field: <field>, config: <config> })` to
`headingField(<field>, <config>)`. The `config` argument is now optional, so
`headingField({ config: {}, field })` becomes simply `headingField(field)`. The
unused `HeadingFieldArgs` type has been removed from the public exports.

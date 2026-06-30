# @whatworks/payload-heading-field

## 2.1.0

### Minor Changes

- 8e9dabd: `RenderHeading` now forwards a `ref` to the emitted heading element. This lets
  client components that measure or animate the heading (for example a
  fit-to-width font-size hook) attach a ref while still letting the editor's stored
  tag drive the element. The ref is not attached when the component renders nothing
  (no resolvable content). The component remains generic over the value type, so
  the forwarded `ref` composes with `render` without a cast.

  Minimum supported React version is now 19 (ref-as-prop).

## 2.0.0

### Major Changes

- 09b8fa1: `headingField()` now takes the field as its first argument and an optional config
  as its second — `headingField(field, config?)` — instead of a single
  `{ config, field }` object. Adopting it in an existing codebase is now a one-line
  change: wrap your existing field object directly, e.g.
  `headingField({ name: 'heading', type: 'text' })`, and pass `config` only when
  you need to override the defaults.

  Migration: change `headingField({ field: <field>, config: <config> })` to
  `headingField(<field>, <config>)`. The `config` argument is now optional, so
  `headingField({ config: {}, field })` becomes simply `headingField(field)`. The
  unused `HeadingFieldArgs` type has been removed from the public exports.

## 1.0.0

### Major Changes

- c1cfef3: Add `@whatworks/payload-heading-field`: a Payload field that lets content editors
  choose the rendered heading tag (h1–h6) for any text, textarea, or rich text
  heading. `headingField({ config, field })` wraps the given field in a group that
  also stores the selected `tag`, and renders it as a single, normal-looking field
  with a compact inline tag dropdown beside the label (never as a default Payload
  group). Ships a `RenderHeading` render component (via `/rsc`) for outputting the
  stored `{ tag, value }` on the front end.

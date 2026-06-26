# @whatworks/payload-heading-field

## 1.0.0

### Major Changes

- c1cfef3: Add `@whatworks/payload-heading-field`: a Payload field that lets content editors
  choose the rendered heading tag (h1–h6) for any text, textarea, or rich text
  heading. `headingField({ config, field })` wraps the given field in a group that
  also stores the selected `tag`, and renders it as a single, normal-looking field
  with a compact inline tag dropdown beside the label (never as a default Payload
  group). Ships a `RenderHeading` render component (via `/rsc`) for outputting the
  stored `{ tag, value }` on the front end.

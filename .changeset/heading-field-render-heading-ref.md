---
'@whatworks/payload-heading-field': minor
---

`RenderHeading` now forwards a `ref` to the emitted heading element. This lets
client components that measure or animate the heading (for example a
fit-to-width font-size hook) attach a ref while still letting the editor's stored
tag drive the element. The ref is not attached when the component renders nothing
(no resolvable content). The component remains generic over the value type, so
the forwarded `ref` composes with `render` without a cast.

Minimum supported React version is now 19 (ref-as-prop).

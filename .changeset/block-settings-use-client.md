---
'@whatworks/payload-block-settings': patch
---

fix(block-settings): preserve the RSC `'use client'` boundary

The client export's components (`BlockLabelWithActions`, `BlockSettingsLabel`,
`BlockSettingsToggleButton`, `HiddenSettingsGroupField`, `useBlockLabelState`,
`inlineSettingsStore`) declare `'use client'`, but bundling collapsed them into
directive-less chunks, so they were executed on the server and threw. The build
now emits one file per source module (`unbundle`), keeping each `'use client'`
directive intact.

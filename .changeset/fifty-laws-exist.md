---
'@whatworks/payload-switch-env': patch
---

fix(switch-env): preserve the RSC `'use client'` boundary in the build

The client export mixes async server components (`AdminButton`, `DangerBar`,
`SwitchDbConnectionView`) with the `'use client'` components they render.
Bundling collapsed them into a single module and stripped the per-file
directives, so `SwitchEnvButtonClient`/`CopyDbButtonClient` were executed on the
server and threw `Attempted to call useConfig() from the server`. The build now
emits one file per source module (`unbundle`), keeping each `'use client'`
directive intact.

---
'@whatworks/payload-switch-env': patch
---

fix(switch-env): preserve the RSC `'use client'` boundary and honour Next.js `basePath`

Two fixes:

1. The client export mixes async server components (`AdminButton`, `DangerBar`,
   `SwitchDbConnectionView`) with the `'use client'` components they render.
   Bundling collapsed them into a single module and stripped the per-file
   directives, so `SwitchEnvButtonClient`/`CopyDbButtonClient` were executed on
   the server and threw `Attempted to call useConfig() from the server`. The
   build now emits one file per source module (`unbundle`), keeping each
   `'use client'` directive intact.

2. Endpoint and thumbnail URLs were hand-built as `${serverURL}${apiRoute}/…`,
   which drops a Next.js `basePath`. Under a configured `basePath` the switch /
   copy-db POSTs (and admin thumbnails) 404'd. They now use Payload's
   `formatAdminURL`, which prepends `process.env.NEXT_BASE_PATH` exactly like
   Payload's own admin requests. (`formatAdminURL` has shipped in
   `payload/shared` since 3.27.0, well within the `>=3.54.0` peer range.)

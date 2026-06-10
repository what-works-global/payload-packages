---
'@whatworks/payload-switch-env': patch
---

Make payload version auto-detection work in bundled serverless deployments (e.g. Vercel), and stop crashing the app when detection fails.

In a traced lambda bundle the previous detection found nothing: bundlers inline `import.meta.url` to a build-machine path that doesn't exist at runtime, and file tracing resolves pnpm symlinks to their real store paths, so the bundle contains `node_modules/.pnpm/payload@<version>/node_modules/payload` without a top-level `node_modules/payload` symlink for the walk to find. Detection now also derives a start directory from the runtime stack trace (which carries the executing chunk's real path) and scans the pnpm virtual store at every level of the walk.

If detection still finds nothing, the plugin now logs a warning and treats the version as unknown instead of throwing at boot — version gates assume a current payload release in that case, so pass `payloadVersion` explicitly when running payload < 3.83.0 in such an environment.

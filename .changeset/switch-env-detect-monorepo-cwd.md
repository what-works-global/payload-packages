---
'@whatworks/payload-switch-env': patch
---

Fix payload version auto-detection still failing on Vercel in pnpm monorepos.

The primary detection strategy asked payload's own `getDependencies` to resolve
payload from `process.cwd()`. In a pnpm monorepo deployed to Vercel the function's
cwd is the workspace root, which has no top-level `payload` symlink (pnpm only links
payload into the consuming app's own `node_modules`), so `getDependencies` resolved
nothing and the filesystem fallback — defeated by the same relocated trace layout —
also missed, leaving deployments with the "Could not auto-detect the installed payload
version" warning.

Detection now resolves payload from the directory of the module that imported it (and
the executing chunk's path), not just `process.cwd()`. That directory is the exact base
from which the plugin's own `import('payload')` already succeeds, so Node's resolver
mirrors the working resolution wherever payload loads. `process.cwd()` is kept as a last
resort. The shared candidate-directory logic is exported as `getRuntimeDirs`.

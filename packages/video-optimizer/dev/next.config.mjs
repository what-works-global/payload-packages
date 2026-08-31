import { defineDevNextConfig } from '@whatworks/dev-fixture/next-config'

// ffmpeg-static resolves its binary as `path.join(__dirname, 'ffmpeg')`. Bundled
// into the server build, `__dirname` becomes the bundler's virtual root — the
// "/ROOT/node_modules/..." in the spawn ENOENT — so the package has to stay an
// external require to see a real path. Any consumer using ffmpeg-static on Next
// needs the same line.
export default defineDevNextConfig({ serverExternalPackages: ['ffmpeg-static'] })

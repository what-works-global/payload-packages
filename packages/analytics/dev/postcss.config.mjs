import tailwindConfig from '../tailwind.config.js'

export default {
  plugins: {
    // Reuse the published Tailwind config, overriding only `content`. The dev app
    // runs Next from the nested `dev/` root, so the package's components (where the
    // Tailwind classes are authored) live at `../src`, whereas the published
    // config's `./src` is relative to the package root. Two Turbopack notes:
    // - Pass the config object inline (not a `config` path): Tailwind v3's
    //   path-based loader returns undefined under Turbopack and crashes with
    //   "Cannot read properties of undefined (reading 'blocklist')".
    // - Use relative globs (resolved against the Next root, `dev/`): Turbopack
    //   panics on absolute content paths ("leaves the filesystem root").
    tailwindcss: {
      ...tailwindConfig,
      content: ['../src/**/*.{ts,tsx,js,jsx}', './app/**/*.{ts,tsx,js,jsx}'],
    },
    autoprefixer: {},
  },
}

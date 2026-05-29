import { defineConfig, type CopyEntry, type UserConfig } from 'tsdown'

type StringOrRegExp = string | RegExp

export interface PackageBuildOptions {
  entry: string[]
  /** Set `true` when source side-effect-imports .scss/.css. Adds external markers,
   *  copies style files into dist preserving their src layout, and strips the
   *  side-effect imports from emitted .d.ts files. */
  styles?: boolean
  /** Set `true` for packages that ship React Server Component boundaries (files with
   *  `'use client'` / `'use server'` directives). Emits one output file per source
   *  module instead of bundling, so each module keeps its own directive and the
   *  server/client boundary survives the build. */
  unbundle?: boolean
  external?: StringOrRegExp | StringOrRegExp[]
  copy?: CopyEntry | CopyEntry[]
}

const STYLE_EXTERNAL: RegExp[] = [/\.scss$/, /\.css$/]
const STYLE_COPY: CopyEntry[] = [{ from: 'src/**/*.{scss,css}', to: 'dist', flatten: false }]

const stripStyleImportsFromDts: UserConfig['plugins'] = [
  {
    name: 'strip-style-imports-from-dts',
    renderChunk(code, chunk) {
      if (!chunk.fileName.endsWith('.d.ts')) return null
      return code.replace(/^import ['"][^'"]+\.(?:scss|css)['"];?\r?\n/gm, '')
    },
  },
]

export function definePackageBuild({
  entry,
  styles,
  unbundle,
  external,
  copy,
}: PackageBuildOptions) {
  const config: UserConfig = {
    entry,
    format: 'esm',
    dts: true,
    sourcemap: true,
    clean: true,
    fixedExtension: false,
    unbundle,
    inputOptions: {
      transform: { jsx: { runtime: 'automatic' } },
    },
  }

  const externalArr: StringOrRegExp[] = external ? [external].flat() : []
  const mergedExternal: StringOrRegExp[] = styles
    ? [...STYLE_EXTERNAL, ...externalArr]
    : externalArr
  if (mergedExternal.length) config.external = mergedExternal

  const mergedCopy: CopyEntry[] = [...(styles ? STYLE_COPY : []), ...(copy ? [copy].flat() : [])]
  if (mergedCopy.length) config.copy = mergedCopy

  if (styles) config.plugins = stripStyleImportsFromDts

  return defineConfig(config)
}

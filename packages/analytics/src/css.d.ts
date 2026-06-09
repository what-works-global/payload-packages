// Ambient declaration so side-effect CSS imports (e.g. `import './styles.css'`)
// typecheck in this tsdown-built package, which has no Next.js `next-env.d.ts`.
declare module '*.css'

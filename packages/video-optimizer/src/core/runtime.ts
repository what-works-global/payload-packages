/**
 * Which execution limit the host imposes, since the plugin cannot ask for one.
 *
 * `jobs.maxRunMs` is the only thing that makes a run survive a platform kill: it is
 * what sorts the ladder cheapest-first and what stops an encode we know cannot
 * finish. Left unset on a serverless host the run does the opposite — biggest rung
 * first, killed mid-encode, nothing linked, and three retries into the same wall.
 * That is the worst outcome the plugin has, and it is reached by writing no config
 * at all, so it is worth a boot warning rather than a line in the README.
 *
 * Detection is by environment variable, so it is a hint and never a gate: a false
 * positive costs one log line, and a false negative leaves today's behaviour.
 */

export type HostRuntime = 'cloudflare-workers' | 'node' | 'serverless'

export interface RuntimeInfo {
  kind: HostRuntime
  /** Display name for the warning, when we can be specific. */
  name: null | string
}

/**
 * Workers is not a smaller Lambda — it is a V8 isolate with no `child_process`, no
 * `/tmp`, and no way to execute a binary. ffmpeg cannot run there at any budget, so
 * this is the one case where the answer is never "configure it differently".
 */
const isCloudflareWorkers = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'

/** Read-only view of the variables consulted; the repo's ProcessEnv requires keys we never touch. */
type EnvLike = Record<string, string | undefined>

export const detectRuntime = (env: EnvLike = process.env): RuntimeInfo => {
  if (isCloudflareWorkers()) {
    return { name: 'Cloudflare Workers', kind: 'cloudflare-workers' }
  }
  // Netlify Functions run on Lambda and set both, so it is checked first to name the
  // platform the user actually deploys to.
  if (env.NETLIFY) {
    return { name: 'Netlify Functions', kind: 'serverless' }
  }
  if (env.VERCEL) {
    return { name: 'Vercel', kind: 'serverless' }
  }
  if (env.AWS_LAMBDA_FUNCTION_NAME || env.LAMBDA_TASK_ROOT) {
    return { name: 'AWS Lambda', kind: 'serverless' }
  }
  if (env.FUNCTION_TARGET || env.K_SERVICE) {
    return { name: 'Google Cloud Functions', kind: 'serverless' }
  }
  return { name: null, kind: 'node' }
}

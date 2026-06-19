'use client'

// posthog-js is an OPTIONAL peer dependency — only consumers who use `<PostHog>`
// install it (declared via `peerDependenciesMeta`). It is loaded purely through
// a runtime dynamic `import()`, so consumers who never import
// `@whatworks/analytics/posthog` pull in neither the SDK nor its types. This
// type-only import resolves against the peer/dev install and appears only in the
// `/posthog` entry's declarations — which already imply posthog-js is present —
// so it is safe to lean on the real types here.
import type { PostHog } from 'posthog-js'

// The live instance must survive bundler module duplication. Under Next's RSC
// model the `<PostHog>` component (rendered from a server layout, so reached via
// a client-reference) and the `capture()` an app's client component imports can
// resolve to SEPARATE copies of this module — a plain module-level `let` set by
// one copy is then invisible to the other, so `capture()` silently no-ops. We
// therefore park the instance on a process-global keyed by a registry Symbol,
// shared across every module copy in the realm, so all copies see the one
// instance `<PostHog>` initialised. (Next recommends this same globalThis
// pattern for singletons such as the Prisma client.)
interface PostHogRegistry {
  client: null | PostHog
  initStarted: boolean
}

// `Symbol.for` resolves against the global symbol registry, so every duplicated
// copy of this module — and any other realm in the same process — resolves to
// the same key and therefore the same backing object. A namespaced description
// keeps it from colliding with anything else parked on `globalThis`.
const REGISTRY_KEY = Symbol.for('@whatworks/analytics::posthog-client')

function getRegistry(): PostHogRegistry {
  const store = globalThis as unknown as Record<symbol, PostHogRegistry | undefined>
  return (store[REGISTRY_KEY] ??= { client: null, initStarted: false })
}

const DEFAULT_OPTIONS: Record<string, unknown> = {
  // Billing is per-event and per-identified-person; tying profiles to
  // identified users only keeps anonymous browsing from inflating cost.
  person_profiles: 'identified_only',
  // Clarity (or another tool) typically owns session replay; PostHog replay
  // would double the cost and privacy surface for no extra insight.
  disable_session_recording: true,
  // Start opted-out so nothing is captured until consent is granted; the
  // provider flips this via `setPostHogConsent`.
  opt_out_capturing_by_default: true,
}

export interface InitPostHogOptions {
  apiHost: string
  apiKey: string
  /** Merged over the privacy-safe defaults. See posthog-js `PostHogConfig`. */
  options?: Record<string, unknown>
}

/**
 * Lazily loads posthog-js and initialises the shared instance. Safe to call
 * repeatedly — only the first call initialises; later calls resolve with the
 * existing instance. Returns `null` if posthog-js is not installed.
 */
export async function initPostHog({
  apiHost,
  apiKey,
  options,
}: InitPostHogOptions): Promise<null | PostHog> {
  const registry = getRegistry()
  if (registry.initStarted) {
    return registry.client
  }
  registry.initStarted = true

  try {
    // posthog-js ships no "exports" map, so the consuming bundler may pick its
    // ESM (`module`) or CJS (`main`) build, and synthesises the dynamic-import
    // namespace differently for each. The CJS build marks `__esModule` and sets
    // both `exports.default` and `exports.posthog` to the singleton; some
    // bundlers (e.g. Turbopack) then re-wrap it a level too deep, so `.default`
    // is the namespace object rather than the instance — the cause of the
    // `init is not a function` error. Probe the likely locations and use
    // whichever candidate actually carries `init()`.
    const mod = (await import('posthog-js')) as unknown as Record<string, unknown>
    const nestedDefault = (mod.default as Record<string, unknown> | undefined)?.default
    const candidates: unknown[] = [mod.default, nestedDefault, mod.posthog, mod]
    const posthog = candidates.find(
      (candidate): candidate is PostHog =>
        !!candidate && typeof (candidate as { init?: unknown }).init === 'function',
    )

    if (!posthog) {
      throw new Error('posthog-js resolved but no instance exposing init() was found')
    }

    posthog.init(apiKey, {
      ...DEFAULT_OPTIONS,
      api_host: apiHost,
      ...options,
    } as Parameters<typeof posthog.init>[1])
    registry.client = posthog
  } catch (error) {
    // Allow a later mount to retry — the failure is usually a missing install
    // rather than a permanent condition.
    registry.initStarted = false
    // eslint-disable-next-line no-console
    console.error(
      '[@whatworks/analytics] Could not load posthog-js. Install it to use <PostHog>: `pnpm add posthog-js`',
      error,
    )
  }

  return registry.client
}

/** Honour a consent decision by opting the shared instance in or out. */
export function setPostHogConsent(granted: boolean): void {
  const { client } = getRegistry()
  if (!client) {
    return
  }
  if (granted) {
    client.opt_in_capturing()
  } else {
    client.opt_out_capturing()
  }
}

/**
 * Send an event to PostHog. No-ops until the instance is initialised and
 * consent is granted, so it is always safe to call from app code.
 */
export function capture(event: string, properties?: Record<string, unknown>): void {
  getRegistry().client?.capture(event, properties)
}

/** The underlying posthog-js instance once initialised, otherwise `null`. */
export function getPostHog(): null | PostHog {
  return getRegistry().client
}

'use client'

// Type-only — resolves against the devDependency during this package's own
// build and is erased from the published declarations (it is referenced only by
// the non-exported guard below), so it costs consumers nothing.
import type { PostHog } from 'posthog-js'

// PostHog's browser SDK is a single default-exported instance. We hold a
// reference to it here so application code can `capture()` events without
// importing posthog-js directly or knowing whether it has finished loading —
// calls before init simply no-op, mirroring how the script components stay
// inert until consent resolves. The module is shared across the client bundle,
// so the `<PostHog>` component and the app that calls `capture()` see the same
// instance.
//
// posthog-js is loaded purely via a runtime dynamic `import()` and is NOT a
// dependency (or peer dependency) of this package — it is only declared as a
// devDependency so this file type-checks. Consumers that use `<PostHog>` install
// posthog-js themselves; consumers that don't never pull it (or its types) in.
// To keep that promise, the posthog-js type is described locally below rather
// than imported, so it never leaks into this package's published declarations.
interface PostHogClient {
  capture: (event: string, properties?: Record<string, unknown>) => void
  init: (apiKey: string, options?: Record<string, unknown>) => void
  opt_in_capturing: () => void
  opt_out_capturing: () => void
}

// Compile-time guard against posthog-js API drift. If a future posthog-js
// renames or drops a method we call, `keyof PostHogClient` stops being a subset
// of `keyof PostHog`, the constraint below is violated, and this fails to
// compile here — surfacing the break at build time instead of at runtime in a
// consumer. (Method names only — we pass options through loosely on purpose, so
// signature tweaks are intentionally not flagged.) Fully erased from output.
type AssertSubset<Sub extends Super, Super> = Sub
type _PostHogApiGuard = AssertSubset<keyof PostHogClient, keyof PostHog>

let client: null | PostHogClient = null
let initStarted = false

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
}: InitPostHogOptions): Promise<null | PostHogClient> {
  if (initStarted) {
    return client
  }
  initStarted = true

  try {
    const { default: posthog } = (await import('posthog-js')) as unknown as {
      default: PostHogClient
    }
    posthog.init(apiKey, {
      ...DEFAULT_OPTIONS,
      api_host: apiHost,
      ...options,
    })
    client = posthog
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[@whatworks/analytics] Could not load posthog-js. Install it to use <PostHog>: `pnpm add posthog-js`',
      error,
    )
  }

  return client
}

/** Honour a consent decision by opting the shared instance in or out. */
export function setPostHogConsent(granted: boolean): void {
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
  client?.capture(event, properties)
}

/** The underlying posthog-js instance once initialised, otherwise `null`. */
export function getPostHog(): null | PostHogClient {
  return client
}

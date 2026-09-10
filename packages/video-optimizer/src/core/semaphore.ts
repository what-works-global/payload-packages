/**
 * Minimal in-process counting semaphore backing `maxConcurrentEncodes`. FIFO, no
 * dependencies. Releasing twice is a no-op so a `finally`-released permit can't
 * corrupt the count. Scope is this Node.js process only — horizontally scaled
 * deployments run up to `limit` encodes per instance.
 */
export class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`[payload-video-optimizer] semaphore limit must be a positive integer`)
    }
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      // The released permit is handed straight to this waiter — `active` is never
      // decremented in between. Decrementing first would open a window in which an
      // `acquire()` continuation scheduled ahead of the waiter's takes the permit,
      // overshooting the limit and breaking FIFO order.
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    } else {
      this.active++
    }

    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const next = this.waiting.shift()
      if (next) {
        next()
      } else {
        this.active--
      }
    }
  }
}

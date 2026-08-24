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
      throw new Error(`[payload-video-webm] semaphore limit must be a positive integer`)
    }
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.active++

    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.active--
      this.waiting.shift()?.()
    }
  }
}

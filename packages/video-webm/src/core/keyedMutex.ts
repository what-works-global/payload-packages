/**
 * Serializes async work per key inside this process — used to stop two runs of the
 * same conversion job (the immediate run racing the cron safety net, or two retries)
 * from encoding the same document at once and writing over each other.
 *
 * Process-local by design: it removes the common single-instance duplication, while
 * the job's generation check is what keeps *cross-process* runs correct.
 */
export class KeyedMutex {
  private readonly chains = new Map<string, Promise<void>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key)
    // A predecessor's rejection must not reject its successors — each run reports
    // its own outcome to its own caller.
    const gate = previous ? previous.then(noop, noop) : Promise.resolve()
    const current = gate.then(fn)
    const tail = current.then(noop, noop)
    this.chains.set(key, tail)

    try {
      return await current
    } finally {
      // Only the last runner clears the key, so the map can't grow without bound.
      if (this.chains.get(key) === tail) {
        this.chains.delete(key)
      }
    }
  }
}

const noop = (): void => undefined

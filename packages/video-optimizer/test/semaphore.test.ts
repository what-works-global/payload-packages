import { describe, expect, it } from 'vitest'

import { Semaphore } from '../src/core/semaphore.js'

describe('Semaphore', () => {
  it('rejects a non-positive limit', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/)
  })

  it('caps concurrency and wakes waiters in FIFO order', async () => {
    const semaphore = new Semaphore(2)
    let active = 0
    let peak = 0
    const order: number[] = []

    await Promise.all(
      [1, 2, 3, 4, 5].map(async (id) => {
        const release = await semaphore.acquire()
        order.push(id)
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active--
        release()
      }),
    )

    expect(peak).toBe(2)
    expect(order).toEqual([1, 2, 3, 4, 5])
    expect(active).toBe(0)
  })

  it('hands a released permit to the waiter, not to a late arrival', async () => {
    const semaphore = new Semaphore(1)
    const held: string[] = []

    const releaseFirst = await semaphore.acquire()
    const second = semaphore.acquire().then((release) => {
      held.push('second')
      return release
    })

    // The release and the next `acquire()` land in the same tick — the window in
    // which a count that dips before the waiter wakes lets this caller barge in
    // and run a second encode under a limit of one.
    releaseFirst()
    const third = semaphore.acquire().then((release) => {
      held.push('third')
      return release
    })

    const releaseSecond = await second
    expect(held).toEqual(['second'])

    releaseSecond()
    const releaseThird = await third
    expect(held).toEqual(['second', 'third'])
    releaseThird()
  })

  it('treats double-release as a no-op', async () => {
    const semaphore = new Semaphore(1)
    const releaseFirst = await semaphore.acquire()
    releaseFirst()
    releaseFirst()

    // If the double release corrupted the count, this second acquire would let a
    // third one through concurrently; verify it still serializes.
    const releaseSecond = await semaphore.acquire()
    let thirdAcquired = false
    const third = semaphore.acquire().then((release) => {
      thirdAcquired = true
      release()
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(thirdAcquired).toBe(false)
    releaseSecond()
    await third
    expect(thirdAcquired).toBe(true)
  })
})

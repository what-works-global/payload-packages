---
'@whatworks/payload-redirects': patch
---

The miss path no longer turns an origin outage into a stampede.

**The bug.** Every request that missed the cache asked the origin again, and each ask boots a Payload instance. In production, one client's burst of about 6,900 page loads in 40 seconds, on a deployment still running 0.2.0, became 2,860 `refresh-cache` POSTs. Each booted Payload and opened its own database connections, until the database refused new TLS handshakes. 0.3.0's read-through removes the routine misses that caused it, but a failed list fetch still left both halves of the stampede in place: each later request retried the list, and each one also POSTed `refresh-cache`.

- **A failed read-through backs off.** After an error status, a network failure or a malformed body, that instance skips the list route for 1s, doubling per consecutive failure up to 30s, and passes requests through unredirected meanwhile. Any successful read resets it, whether from the cache or the list.
- **No `refresh-cache` POST when a list route exists.** A failed read-through no longer falls back to it. The rebuild runs wherever Payload runs, so it warms a cache the region that missed may not see. `refreshOnMiss` now applies only without a list route (`list: { disabled: true }` with no `path`). There, each instance sends one refresh at a time, and successive ones wait out the same back-off until a cache read succeeds.
- **`refresh-cache` never purges.** It rebuilds with `{ invalidate: false }`. A refresh re-reads unchanged data, so it is not an edit, and with `list.invalidate` wired up, a purge per call would mark every region's copy stale each time. Edits still purge through the collection's hooks.

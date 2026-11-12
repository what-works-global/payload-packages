---
'@whatworks/payload-switch-env': patch
---

Postgres copies restore rows in batches instead of one `INSERT` per row. Each statement is a network round trip, so against a remote target (a hosted Postgres or connection pooler a few milliseconds away) a copy of a few hundred thousand rows spent around ten minutes waiting on the network and could outrun a serverless function's time limit, holding the target's tables locked the whole time. Rows now go in multi-row `INSERT`s of up to 1,000 rows, fewer for wide tables so a statement stays under Postgres's 65,535 bind parameters, and the same copy's inserts take a couple of seconds. The restore also sets a 30-second `lock_timeout`, so a copy that can't lock the target's tables (another connection holding a transaction open) fails with nothing changed instead of hanging.

---
'@whatworks/payload-switch-env': patch
---

Log a skipped production extension (e.g. Supabase's `supabase_vault`, Neon's `neon` — provider extensions with no local binaries) as a single warning line during copy, instead of dumping the full database error and stack trace, which made a routine, expected skip read like a failed copy.

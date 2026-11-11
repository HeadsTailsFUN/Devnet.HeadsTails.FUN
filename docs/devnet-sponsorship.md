# Devnet SOL sponsorship

The HTS Devnet beta has no daily SOL sponsorship quota per player or across the service. This includes verified join/cancel reimbursement, low-balance preparation, matchmaking, settlement and the SOL cost of a welcome grant. The existing one-time 10,000 HTS entitlement is unchanged.

The database opts out only the enabled, pinned `hts-v1` release through `devnet_token_releases.daily_sol_caps_enabled = false`. Daily API cap values are `null`; obsolete daily-cap environment values have no effect. The earlier numeric limits remain stored for an explicit rollback, rather than being replaced with a large artificial limit.

Devnet genesis/program/mint checks, server-derived amounts, individual transfer limits, signed simulation, serialized expense reservations, receipt accounting, identity fencing, pending-outcome holds and duplicate protection remain in place. Preparing an already funded wallet sends nothing. The existing sliding prefund duplicate protection remains. Sponsorship still requires a funded Devnet service wallet.

## Validation

Run the sponsor/room/HTS and settlement-reservation Node tests and TypeScript/lint checks. `supabase/tests/devnet_sponsor_no_daily_caps.sql` is a self-contained PostgreSQL fixture for a **fresh disposable database only**; it reproduces the former limits before checking their removal, preserved idempotency, invalid-amount rejection, privilege boundaries and rollback. It contains synthetic records and performs no blockchain transactions.

## Rollback

First promote the preceding compatible application release, then set `daily_sol_caps_enabled = true` on the exact pinned release to restore the stored numeric player limits and previous service policy. The new application's null cap arguments intentionally fail closed if the database's daily-limit policy is restored first. No expense rows or historical data need to be deleted. The pre-change function definitions are retained in the owner's private release evidence.

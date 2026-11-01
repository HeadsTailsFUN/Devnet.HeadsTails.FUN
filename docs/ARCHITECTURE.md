# Architecture

The program is authoritative for escrow, FIFO ordering, match membership, randomness verification, result, and payout. Neither the browser nor the application database chooses a winner. ORAO VRF requests use an unpredictable nonce and must be newly initialized in the matching transaction.

The historical generation retains its original mint, account layouts, stored randomness seeds, exact cancellation amounts, and settlement behavior. The HTS generation uses separate `hts-config`, `hts-vault`, `hts-vault-authority`, `hts-room`, `hts-queue`, `hts-player`, and `hts-match` PDA namespaces under the existing program. Old intake must be paused for HTS joins and matching. A read-only legacy-position check prevents opening a conflicting new HTS position while an older position remains active.

HTS matching advances the canonical historical global match counter, preserving unique application match IDs. SDK, indexer, and settlement consumers resolve the canonical match generation and its corresponding mint. Historical refunds remain explicitly owner-signed and are not executed automatically by migration.

Supabase stores application/read models, wallet sessions, profiles, chat, history, referral and Points records, settlement jobs, and operational expense evidence. Server operations reserve shared budgets atomically and persist signed transaction evidence before broadcast. Unknown outcomes retain their hold for reconciliation rather than issuing a replacement payment.

Browser-visible configuration is separate from server credentials. Grant/sponsor paths check the actual Devnet genesis and canonical program/mint configuration. Generic inherited Mainnet labels and fail-closed safety branches remain in the Devnet source for compatibility; no private Mainnet implementation or staging configuration is included.

The admin surface requires wallet-session authorization and live owner or permitted Devnet staff checks. The obsolete browser program-upgrade helper is excluded and its API route remains disabled. A deployed site does not itself authorize opening on-chain intake.

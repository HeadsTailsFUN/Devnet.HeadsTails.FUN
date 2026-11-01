# UI and community refinement candidate

This source update requires its additive database migration and a reviewed application deployment. Source publication alone does not change the hosted game.

The Devnet flow connects and verifies wallet ownership in the game panel, chooses a side and room, then uses HTS automatically. Confirm still initiates the real wallet-approved stake. No funding-method selector or mock SOL purchase path is rendered. Quote validation, sponsorship, legacy-position protection, FIFO/ORAO settlement, full-pot payout and Points rules are retained. The program, SDK and authorities are unchanged.

Settled results remain visible until Play Again, with a 4.5-second minimum. Reaction art uses the player's actual side/outcome and chronological settled outcome count from a service-only read RPC. It saturates at the final supplied image; the same result's phrase and verified reaction are cached locally for presentation stability. Images are the original owner-supplied assets. Tail.png includes its original white background.

Chat reads at most 100 rows and recent flips at most 50 settled rows, with deterministic database ordering. These limits do not delete history. Chat masks a curated English/Persian dictionary server-side, serializes accepted sends per authenticated wallet, deduplicates retry UUIDs, and pauses sends for three seconds after the third message in an active burst. Ten seconds idle resets a burst; the existing one-second gap and 20-per-minute guard remain.

Optional community teams are profile preferences, independent of gameplay choices. Choose Later persists dismissal. Name/avatar updates and existing upload validation remain separate. Public Tokenomics and Roadmap pages distinguish proposed allocations and plans from completed on-chain actions. The owner has not supplied a legal operator identity or dedicated privacy contact; the legal pages do not invent either.

## Database rollout

Review and apply `20261101172806_ui_community_refinement.sql` only to the intended Devnet application database. It adds preference columns, retry identity/indexes, private burst state, and two service-only RPCs. All new definer functions have an empty search path and explicitly revoked public execution. Wallet ownership is checked by the server before privileged calls.

Direct INSERT on chat_messages is revoked, including column-level INSERT grants, so older server versions cannot bypass the atomic send gate. Existing SELECT and moderation UPDATE privileges are preserved. Older cached chat clients must reload to supply retry identity. Install the migration immediately before promoting the new application; a brief chat-send interruption is expected during this window. No gameplay transaction or historical row cleanup is part of this migration.

Before installation, record existing row counts and the chat INSERT ACL. Afterward verify unchanged historical counts, private-table ACLs, RPC execution grants, authenticated profile ownership and current release bindings. Stage a production application deployment without moving domains, verify it, then promote. Keep the previous deployment available for rollback. On rollback preserve all additive data; restore the previously recorded INSERT grant only if returning to the old chat backend is explicitly included in the recovery approval. Otherwise hold chat sends closed until corrected. Never reset the database to roll back this change.

## Checks

Run web `test:release`, `test:reliability`, `test:ui`, `test:ui-components`, TypeScript, ESLint and the production build. Local PostgreSQL acceptance covers concurrency, idempotency, cooldown/idle behavior, provider-default grants, moderation and chronological reactions. Browser captures cover the requested five mobile, one tablet and three desktop viewports. Local fixtures are labelled synthetic and are not included in the release. These checks do not substitute for hosted acceptance or personally approved wallet signatures.

# Earn Points production release — 2026-11-16

The owner authorized publication to the main website and removal of the Airdrop menu. The compact Earn Points popup, full 12-row rules table and website-side integration code are now deployed at https://headstails.fun. Profile navigation contains Profile, Referrals and Report Bug; Earn Points remains accessible separately. Existing reward history and shared reward forms are preserved.

## Release identity

- Application code: `9f9b55b96d2f474cb26a513aec14d859041f5904`, fast-forward pushed to the official repository's `main`.
- Vercel project: `headstails-devnet-beta` (`prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B`).
- Production deployment: `dpl_CmCdVKVkvxaJvKvTqZRExFp77U6o`, READY; its releaseCommit metadata matches the application code above.
- Canonical domain alias verified against that exact deployment after promotion.
- Previous deployment, retained as a rollback target: `dpl_EEfyByusNanoPkZ8uJ7pVqCaLJJM` (releaseCommit `8e7fa32524fb6546a3d8687d1c3bb500b327a11e`).

## Verification

Fresh local suites passed: reliability 553, mobile 12, Earn Points 21 and verification 34 (620 tests total), plus ESLint and TypeScript. The remote production build also passed. Changes from the previous live deployment were compared using actual deployed source: 489 pre-existing files matched exactly or after newline normalization; remaining differences were within the Earn Points release scope. Gameplay, SDK, contract, settlement and funding/sponsor code matched the live source.

Nine HTTP checks passed both before promotion and on the canonical production domain afterward: homepage and catalog 200; Points, referrals, quest status and admin APIs 401 anonymously; legacy Earn Points redirect 307; disabled Telegram health 503; existing leaderboard 200. The catalog confirms the four new quests at 20/5/15/20 Points, official Telegram identifiers configured, and all new integration/reward switches false. No error-level runtime logs were returned for this deployment in the 10-minute release inspection window.

The live popup and expanded 12-row rules table were checked in the in-app browser. Evidence is stored locally under ignored `artifacts/earn-points/`, including `production-earn-points.png` and `release-production-checks.json`. The browser session displayed Restoring wallet; no authenticated wallet action, signing, provider linking, live reward award or gameplay test is claimed. Airdrop menu removal is covered by the mobile/Profile component suite and deployed release source.

## Configuration and activation limits

Production Config values now contain the owner's official bot username, distinct Telegram group/channel IDs and Discord guild ID. `EARN_TELEGRAM_ENABLED`, `EARN_TELEGRAM_LINKING_ENABLED`, `EARN_TELEGRAM_JOBS_ENABLED`, `EARN_DISCORD_ENABLED`, `EARN_X_MANUAL_VERIFICATION_ENABLED` and `EARN_NEW_REWARDS_ENABLED` are explicitly false. No secret was added to source or logs. Existing Solana/Supabase configuration was preserved.

The additive production migration was not run. Dedicated service credentials, Discord application settings, bot-side configuration and real provider round-trip tests remain required before any new integration or reward activation. Existing ledger/claim workflows remain in place. The Telegram bot and Bot Manager were not changed by this website release.

This report is a documentation-only follow-up to the application release; its later documentation commit is not the deployment's application-code identity.

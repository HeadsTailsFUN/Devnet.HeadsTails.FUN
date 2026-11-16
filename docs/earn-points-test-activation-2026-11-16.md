# Earn Points test activation — 2026-11-16

The owner requested that the entry appear only after wallet connection, beside the wallet control in mobile Play, and that quests be enabled for testing. They authorized configuring the connections directly. Application commit: `7ea6de66be55e26300c27892b6d456b013873749`.

## Website changes and verification

The header renders Earn Points only when the existing connected-wallet address is present. Disconnect removes it. Mobile CSS shows the header entry in Play and hides it in other mobile tabs/information views. It shares the wallet control row. The Profile entry remains available to the connected owner. Existing deep-link compatibility and popup lifecycle remain intact; this display rule does not replace server-side ownership checks.

Fresh checks passed: mobile navigation/components 13, Earn Points API/components 21, verification API/components 34, isolated PostgreSQL 18, ESLint and TypeScript. The new header test covers disconnected, connected adjacency and disconnect. No extra gameplay scheduler, contract, queue or settlement changes were made.

## Database and active settings

Applied the reviewed additive `20261115124344_earn_points_social_verification.sql` migration to the verified `heads-or-tails-dev` project. All 11 new tables have RLS enabled. Browser roles have no RPC execute permission; service_role does. A live service_role dispatcher smoke check passed inside an explicitly rolled-back transaction, leaving no test identity, audit event or reward. Security advisor results contain informational no-policy notices for intentionally server-only tables, with no warning/error findings. [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

The active season is selected from existing `airdrop_seasons`, never created or reset. Its new reward and manual X gates are true; all four quest flags are registered. The three-day quest can award the approved 20 Points only after three distinct, eligible, settled UTC dates and normal exclusion/season checks. X remains a real manual bio/evidence review flow, never automatic verification. Existing campaign configuration still governs repost/reply availability.

Production environment now sets `EARN_NEW_REWARDS_ENABLED=true` and `EARN_X_MANUAL_VERIFICATION_ENABLED=true`. Discord callback is `https://headstails.fun/api/earn/discord/callback`; its existing invite `https://discord.gg/ytQBSWD75J` was verified using the official Discord API to resolve to guild `1566470653861822514` (HeadsTails).

## External connection prerequisites

Telegram linking/jobs and Discord OAuth remain disabled while their actual external configuration is missing. No fake completion, forged provider evidence, fabricated Client ID or duplicate credential was substituted. The separately managed Telegram bot was not available in this workspace or running as a HeadsTails process. The owner is locating its project/settings and completing the Discord Developer Portal login.

Telegram needs a dedicated `HEADSTAILS_WEBSITE_API_KEY` securely configured with the same value in Vercel production and the actual V5.10 bot process. Bot settings must use Bearer mode, canonical API origin, official distinct group/channel IDs and the contract's five endpoints. Confirm real getChatMember permissions and single poller operation before enabling its website/season/bot gates. A BotFather token is different from this service credential and must never be sent in chat.

Discord needs the official application's `EARN_DISCORD_CLIENT_ID` and server-only `EARN_DISCORD_CLIENT_SECRET`, plus the exact callback registered in that application's OAuth2 settings. Guild ID alone is insufficient. No bot token or automatic guild join is needed for the implemented identify + guilds.members.read authorization. Enable environment/season gates only with valid credentials.

Authenticated browser/provider round trips require the real owner/test account. Offline tests and rolled-back server smoke checks do not constitute live OAuth or membership confirmation. Private endpoints must continue returning 401 without an authenticated wallet session.

## Published release evidence

Production deployment `dpl_2vfxyRN8HjfFi6Cu3QrbKQBVZSry` is READY and promoted to `headstails.fun`; its releaseCommit metadata is the application commit above. Build completed successfully with Next.js, SDK TypeScript and lint/type checks. All nine HTTP checks passed on the staged production build and again on the canonical domain. Public catalog confirms rewards/manual X true, Telegram/Discord false and the verified Discord invitation. The five-minute deployment error-log inspection returned zero error entries.

The live disconnected browser header was reloaded and checked: Wallet and rewards contains Connect Wallet and no Earn Points entry. Connected adjacency/disconnection and mobile Play visibility are covered by the component test and scoped responsive CSS. No signed-in wallet/provider browser round trip is claimed. The documentation commit following the application commit does not change the deployed application-code identity. Previous production deployment `dpl_CmCdVKVkvxaJvKvTqZRExFp77U6o` is retained; a rollback must also account for the new season/environment gates without deleting additive verification history.

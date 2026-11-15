# Earn Points integration readiness

2026-11-15 · branch feat/earn-points · latest inspected main: 4811bcf4d193c3d648493d6f16e1af5a9fae1f25.

Final handoff review: 2026-11-16. Integration code is recorded in cae5cfe; the subsequent UI-only review in 1d936a5 simplified the popup and added the complete rules table. Its 54 targeted tests and final production build passed; [the UI review](docs/earn-points-ui-review-2026-11-16.md) records those results. The original 2026-11-15 integration test counts below are historical evidence, not additional tests to add to that 54. No live integration, deployment, reward activation or production migration has occurred in either phase.

**Website-side implementation is complete for review. Production deployment, production migration, live linking and new reward activation have not been performed.** The active Telegram bot and Bot Manager were not modified.

| Area | Status | Evidence / limit |
|---|---|---|
| Existing popup and PLAY / INVITE / QUESTS | IMPLEMENTED | Existing game remains mounted; wallet handoff, focus and scroll behavior retained |
| Four new quests (+20/+5/+15/+20) | IMPLEMENTED | Existing Points ledger; one wallet/identity claim per eligible season; independent activation gates |
| Telegram linking / jobs / results | TESTED OFFLINE | Real PostgreSQL races, replay, expiry, scope, durable ACK and exact-once credits |
| Telegram V5.10 live configuration | NEEDS BOT CONFIGURATION | Owner supplied official identifiers; shared service credential, matching bot settings, permissions and canonical origin still need verification |
| Telegram live round-trip | NEEDS LIVE END-TO-END TEST | No actual getChatMember request or live link was performed |
| Discord official OAuth and membership | IMPLEMENTED / TESTED OFFLINE | State/denial/scopes/identity/screening/failure tests; no actual Discord account authorized |
| Discord live round-trip | NEEDS LIVE END-TO-END TEST | Owner-configured developer app, guild, callback and designated test account |
| X bio ownership / campaign evidence | IMPLEMENTED / TESTED OFFLINE | Expiring challenge, explicit manual attestations, role checks, reason/history and existing +100/+75/+50 rules |
| Three-day quest | IMPLEMENTED / TESTED OFFLINE | Existing verified gameplay markers plus matching settled Devnet match history; retroactive, distinct nonconsecutive UTC dates |
| Production readiness | BLOCKED | Preview approval, staging migration/configuration and real provider testing remain required |

## What changed

The existing Earn Points dialog now includes connected wallet/Telegram/Discord/X cards, four community/gameplay quests, true owner-scoped progress, connection/retry actions and an inactive state until activation is approved. Existing PLAY/INVITE rules, verified versus pending totals, activity history, mobile navigation and X claims remain.

Telegram tokens/OAuth state are random, short-lived, wallet-bound and digest-only in storage. Linking and result acceptance use atomic transactions; API retries use durable idempotency receipts. New quest credits go to airdrop_points_ledger, not a second financial ledger. Three-day eligibility is evaluated automatically when the authenticated owner opens/refetches quest status and can also be checked explicitly. No settlement hook or game writer was modified.

Discord uses official identify + guilds.members.read OAuth. State is cookie- and database-bound to the authenticated wallet, expires in 600 seconds, and is consumed before code exchange. Real user IDs bind accounts. Membership Screening must explicitly be complete; missing/ambiguous metadata earns zero. Access tokens remain in memory and are revoked/discarded after the callback; refresh tokens are not stored. A retry reopens authorization. There is no automatic server join.

New X ownership verification uses a public temporary bio code with a 24-hour expiry, not a fabricated API identity. Reviewers must have existing OWNER/FULL_ADMIN server authorization, give a reason and attest to ownership/evidence. Existing verified identities, historical Points and ledger rules are retained. Disconnecting X opts out without removing its history/reservation. New manual review is off by default; the legacy X workflow remains in place until activation.

## Files and schema

| Files | Change |
|---|---|
| supabase/migrations/20261115124344_earn_points_social_verification.sql | Additive earn_* tables, RLS/grants, atomic dispatcher, authoritative progress and existing-ledger quest credits; extra metadata columns on existing social claims |
| apps/web/lib/earn/{config,server,telegram,actions,discord,x-guards}.ts | Flags/configuration, authentication, bounded input, idempotency, Telegram handlers, wallet actions/status and official OAuth |
| apps/web/app/api/telegram/{link,unlink,health,verification-jobs,verification-results}/route.ts | Five V5.10-compatible service routes |
| apps/web/app/api/earn/{action,status,catalog}/route.ts | Existing-wallet owner actions/status and public non-secret catalog |
| apps/web/app/api/earn/discord/callback/route.ts | Official OAuth callback, safe return notices and token disposal |
| apps/web/app/api/admin/earn-verifications/route.ts | Existing staff-authenticated history/search/filter and atomic review |
| apps/web/components/earn/{EarnPointsClient,VerificationQuests}.tsx | Existing popup categories plus social connection and quest UI |
| apps/web/components/profile/ProfileModal.tsx | Reuse existing X claim forms; gated bio ownership and campaign evidence |
| apps/web/components/admin/{AdminTabsC,EarnVerificationQueue}.tsx | Add verification queue to existing admin tab |
| apps/web/app/earn-points/earn-points.css | Scoped responsive quest/account styling |
| apps/web/app/api/airdrop/{points,social-claim,social-edit}/route.ts | Additive manual-mode field and gated evidence checks; client x_user_id is never trusted |
| apps/web/lib/airdrop/{social,useRewardResource}.ts | Prevent legacy approval bypass in new manual mode; session-change refresh and social response wallet binding |
| apps/web/lib/earn/verification.test.ts; components/earn/VerificationQuests.test.tsx | New handler/contract/OAuth/UI/admin tests |
| apps/web/lib/earn/local-http-e2e.ts | Offline real-HTTP/PostgREST/PostgreSQL integration runner with external network denylist |
| scripts/{bootstrap-earn-sql,test-earn-sql}.mjs | Isolated schema installation and real transaction/concurrency tests |
| apps/web/components/earn/EarnPointsModal.test.tsx | Supply missing jsdom PopStateEvent so navigation exceptions cannot hide in passing tests |
| .env.example; apps/web/package.json | Empty server configuration template and test:verification command |

The new migration adds earn_account_refs, earn_season_settings, earn_social_links, earn_link_tokens, earn_request_receipts, earn_rate_windows, earn_verification_jobs, earn_quest_claims, earn_x_challenges, earn_social_disconnects and earn_verification_audit. It adds ownership_challenge_id, campaign_url, verification_method and review_state to existing airdrop_social_claims. No existing table, historical row, gameplay RPC or reward amount is replaced/deleted. New review audit rows retain reasons/decisions separately from the latest review note.

## Configuration required

The finalized Telegram endpoints, payloads, error handling, limits and all compatibility decisions are in [TELEGRAM_WEBSITE_API_CONTRACT_FINAL.md](TELEGRAM_WEBSITE_API_CONTRACT_FINAL.md). In particular, website-owner-first unlink followed by a **new bot /unlink command** is an explicit synchronization limitation requiring sign-off.

All environment names are listed with empty values or false switches in .env.example. No credential was requested in chat or committed.

The owner supplied these official identifiers during review: bot HeadsTailsFunBot, Telegram group -1004441691477, announcement channel -1004350361539 and Discord guild 1566470653861822514. They are stored in the ignored local preview environment with all activation flags false. No provider permission or membership was inferred from the identifiers.

Discord still requires EARN_DISCORD_CLIENT_ID, EARN_DISCORD_CLIENT_SECRET, EARN_DISCORD_JOIN_URL and EARN_DISCORD_REDIRECT_URI. Register the exact canonical HTTPS callback /api/earn/discord/callback in the official developer app. Enable EARN_DISCORD_ENABLED and the season's discord_enabled flag only in approved staging first. Membership scope is guilds.members.read plus identify. Missing/unfinished screening is unavailable/pending, not an award.

EARN_X_MANUAL_VERIFICATION_ENABLED and the season's x_manual_enabled gate the new X workflow. AIRDROP_X_CAMPAIGN_URL is the existing official campaign setting. Review current [X authenticity rules](https://help.x.com/en/rules-and-policies/authenticity) for the actual proposed campaign before enabling it. No paid API, scraping or automated engagement was introduced.

EARN_NEW_REWARDS_ENABLED, earn_season_settings.new_rewards_enabled and the corresponding quest_flags entry must all be true before one of the four new rewards can be issued. All are inactive by default. Each new season needs its own deliberate configuration.

Membership verification and Points issuance have independent switches. In approved staging, enable the integration and quest visibility flags while keeping both new-reward switches false to test authoritative membership without issuing new Points.

Official platform references checked during implementation: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Discord current guild member](https://docs.discord.com/developers/resources/user#get-current-user-guild-member), [Telegram getChatMember](https://core.telegram.org/bots/api#getchatmember). External provider behavior remains subject to actual staging verification.

## Verification evidence

The ignored artifacts/earn-points directory contains exact command logs and screenshots; no production credentials or real wallet data are used in fixtures.

| Check | Result |
|---|---|
| Existing test:reliability | 553 passed |
| Existing test:earn plus targeted regressions | 20 passed (6 API/ledger + 14 content/popup) |
| New test:verification | 33 passed (24 handlers/contracts/OAuth + 9 components/admin) |
| Isolated PostgreSQL transaction suite | 18 passed |
| TypeScript / ESLint / production build | Passed; final logs in artifacts/earn-points |
| HTTP → handlers → Supabase client → PostgREST → PostgreSQL | 7 passed; no Telegram/Discord/Solana calls |
| Existing mobile navigation/components | 12 passed |
| Existing Profile/Team components | 5 passed |
| Desktop/mobile browser review | 320×740, 390×844, 768×900, 1024×900 and default 2558×1054; no page/popup horizontal overflow; Escape/focus restoration and wallet handoff retained |

Total: **648 passing automated tests/scenarios**, plus the browser checks above. Final preview HTTP smoke checks confirmed four public quest definitions, configured Telegram identifiers, all integration/reward switches off, and HTTP 401 for unauthenticated private/admin reads. Production build and ESLint completed successfully; the production build also ran TypeScript validation.

The local preview is [available on this computer](http://127.0.0.1:3337/?earn=1). Its Supabase and Solana RPC credentials are not configured, so gameplay/chat behind the popup show configuration/unavailable states. This preview demonstrates the UI without connecting to production data; a signed-in live-provider browser test is not claimed. Screenshots: artifacts/earn-points/verification-desktop.png and verification-mobile.png.

The PostgreSQL fixture is a separately labelled disposable container, with no access to production. Existing Supabase containers are untouched. SQL tests install the real baseline growth migrations and the additive migration into a fresh database; race tests use genuinely concurrent database clients. The HTTP runner temporarily attaches only that test container to a dedicated Docker network, starts a cached official PostgREST image, binds its endpoint to loopback, and removes the temporary API/network afterward. Its fetch allowlist rejects external origins. Synthetic server session records exercise existing session authorization; it does not claim a real wallet-signature/provider end-to-end test.

Reproduction: pnpm --filter @heads-or-tails/web test:verification. For SQL tests, start a disposable postgres:17-alpine container named headstails-earn-v510-qa, labelled headstails.purpose=earn-v510-isolated-tests with --network none and local test trust authentication, then run node scripts/bootstrap-earn-sql.mjs and node scripts/test-earn-sql.mjs from repository root. The scripts refuse other containers/databases. The HTTP runner is pnpm --filter @heads-or-tails/web exec node --import tsx lib/earn/local-http-e2e.ts; it requires the cached official PostgREST image named in the script. These are optional offline tooling, not website runtime dependencies.

## Before production

1. Review the local popup preview and approve its UI.
2. Review/apply the additive migration to an isolated staging Supabase project. Do not reset/restore the production database.
3. Provision credentials securely and verify the canonical origin, official IDs, bot permissions and Discord app callback. Approve the retention/deletion policy documented in the finalized contract.
4. With rewards still off, exercise real wallet authentication, Telegram connect/conflict/replay/unlink, actual group/channel membership and bot offline/restart/ACK recovery.
5. Exercise actual Discord grant/denial/screening/non-member/retry behavior and X manual review with designated accounts.
6. Enable new rewards only in approved staging; confirm each amount once, repeated submissions, exclusions and historical totals.
7. Obtain explicit approval for the exact production build/migration/configuration before deploying or activating anything.

Rollback is flags-first: disable new integrations/rewards in server configuration and season settings; retain additive data, receipts, identity reservations, review history and legitimate Points. The original X routes remain available when the new manual mode is disabled. Never roll back by overwriting a newer live database with an old snapshot.

Core game code, SDK, on-chain program, queue selection, ORAO, fairness, settlement, sponsor/faucet, gameplay +5/+2 with daily cap 200, and referral +50/+25/+2 calculations were not changed by this update. No live database write, wallet transaction, Telegram bot deployment or production website deployment was performed.

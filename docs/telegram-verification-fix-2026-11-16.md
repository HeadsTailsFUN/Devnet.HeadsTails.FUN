# Telegram membership verification — diagnosis and production fix

## Confirmed cause

The seven reported membership requests were successfully leased by the bot, accepted as `VERIFIED`, and durably acknowledged in `earn_request_receipts` with `ok: true`. At the initial investigation, every job's Telegram identity matched its active linked account. Every affected wallet was an administrator and `earn_eligible` correctly returned false. The active season was within its reward period, `new_rewards_enabled` and both Telegram quest flags were true; no verified quest claim or quest Points entry existed for these ineligible attempts.

The write path intentionally excludes administrator wallets from Points. `earn_dispatch('telegram_result')` acknowledges valid membership evidence even when `earn_award_quest` returns `ineligible`. The previous UI only treated a credited claim as Completed, and treated a completed VERIFIED job with no claim as Available. It did not expose the ineligibility reason, so a successful membership check appeared to return silently to Verify.

This release preserves the existing exclusion policy. No administrator privilege was removed, no account was manually approved, and no production Points or membership record was manually inserted or edited.

## Real production evidence

The runtime log sample contained six successful HTTP 200 requests to `/api/telegram/verification-jobs`. Durable job leases and result receipts establish that the earlier result delivery succeeded; this conclusion does not depend on assuming that Health proves the entire flow.

During the investigation, two further real requests from an eligible account completed through the existing authenticated bot integration, before this display fix was promoted:

| Destination | Requested / completed, UTC | Membership | Verified claim count | Verified ledger rows | Points |
| --- | --- | --- | --- | --- | --- |
| Official group | 15:40:45 / 15:41:03 | VERIFIED | 1 | 1 | 20 |
| Official announcement channel | 15:41:00 / 15:41:04 | VERIFIED | 1 | 1 | 5 |

For both, the linked Telegram identity matched and database eligibility was true. Those requests were normal incoming user/bot activity observed through read-only queries, not fabricated requests sent by this agent. They prove the existing real provider-result-to-Points path can issue the correct 25 total. Across the investigation snapshot there were nine accepted VERIFIED jobs/receipts: seven administrator attempts without rewards and two credited eligible attempts. Earlier accounts can subsequently disconnect; matching was checked at the initial investigation and the accepted result path also enforces job identity and active-link scope.

## Changes

- Owner-authenticated `/api/earn/status` now returns a precise `rewardBlockReason` for administrator wallets, reward exclusions or a season outside its reward period. Lookups remain scoped to the authenticated wallet; query parameters cannot select another wallet. A storage error fails closed rather than reporting eligibility.
- The quest UI separates confirmed membership from a credited reward. A VERIFIED administrator job displays Membership verified with the explicit administrator/no-Points explanation and suppresses another unnecessary Verify submission.
- Missing reward records for an otherwise eligible verified job display Reward not recorded and a retry/support message. They are never shown as Completed merely because the bot returned VERIFIED.
- NOT_MEMBER, pending membership approval, provider unavailability, failed validation and request expiration each display their actual outcome category and next step.
- A two-minute automatic-refresh pause now explains the delay and offers Refresh status instead of stopping silently. Account-link polling stops once linking succeeds.
- Every newly observed verified quest claim refreshes the Points overview, including Telegram group/channel; previously this automatic refresh only watched the three-day quest.

No bot API contract, shared credential, database schema, reward amount, duplicate-credit protection, admin permission, Solana transaction or game engine was changed.

## Verification

| Boundary / check | Evidence |
| --- | --- |
| Server tests and UI component tests | 27 + 14 passed |
| Full local HTTP → actual handlers → PostgREST → PostgreSQL | 9 integration flows passed |
| Eligible group/channel award | Exactly 20 + 5, two persisted claims and two ledger rows |
| Duplicate bot result delivery | Repeated ACKs leave the total at 25; changed bodies are rejected |
| Administrator reproduction | Real isolated HTTP result accepted, zero credits, status returns `admin_account` |
| Failure UI | Provider failure, non-membership, expiration, missing reward and administrator messages tested |
| Completion UI | Pending → verified claim becomes Completed and triggers Points refresh |
| Build | Production build, TypeScript and ESLint passed |
| Staged / canonical public flows | Five checks passed on each: app, Welcome, catalog and protected status APIs |
| Production integration configuration | Telegram, Discord, X and reward gates remain enabled; approved quest amounts and join URLs unchanged |
| Authenticated Telegram Health | 200 operational; missing/wrong credentials 401 |
| Live browser | Existing connected wallet restored after reload, Earn Points/Quests renders successfully with approved amounts and join URL |
| Error scan | Zero records in the checked five-minute deployment error-log window |

The local integration uses disposable synthetic identities/sessions and a separately labelled PostgreSQL test container. It makes no external provider requests and does not access the hosted database. Its fixture was brought up to date with the existing admin-report migration; this is a test setup correction, not a new hosted migration. Temporary PostgREST/network resources were removed and the test PostgreSQL container was stopped. The browser session available to this agent was a different wallet without Telegram linked, so the administrator-specific rendered message is supported by component and real local HTTP tests, not claimed as a screenshot from an administrator's production session. The actual successful production awards are independently supported by the read-only records above.

## Deployment

| Field | Result |
| --- | --- |
| URL | https://headstails.fun/ |
| Target / state | Production / READY |
| Project | `headstails-devnet-beta` / `prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B` |
| Team | `team_l2N7NYLjf1k3mpQtNa6ogHUl` |
| Application commit | `1ca21e7d1e673a7305dc8a7410f15fab3707c3ac` |
| Deployment | `dpl_7LpVtZ9YYTxtTbVRubYLkSTL3K3W` |
| Framework / duration | Next.js 15.5.28 / 50.014 seconds |
| Method | Tested staged production build promoted without rebuilding; canonical alias read back |
| Source | Official repository `main` synchronized; this report is a later documentation-only commit |
| Rollback | Previous Welcome release `dpl_AcW8hLzE4kaSxY7BsJNDH9Lb5FmB` |

Log drains and external monitoring were not changed or audited. The five-minute error scan is a bounded observation. Ignored local evidence is in `artifacts/telegram-investigation/`, including tests, integration output, deployment identity, public HTTP checks, runtime sample and `live-quests.png`. No credentials, raw Telegram identifiers, private keys or session cookies are included in this report.

For the user: reload the site to load the new UI. Use a non-admin, non-excluded wallet within the active season when testing actual Points. An administrator can verify membership and manage users, while remaining ineligible for rewards under the current rules.

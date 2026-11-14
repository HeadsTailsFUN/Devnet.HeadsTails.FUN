# Earn Points

Implemented on `feat/earn-points`, based on main commit `4811bcf4d193c3d648493d6f16e1af5a9fae1f25`.

The user flow is Header/Profile → Earn Points popup over the mounted game → existing wallet session → existing Points/Referral APIs → the current ledger, attribution and social-claim records. The popup has no transaction-signing or reward-awarding code.

## Implementation

| Files | Behavior |
| --- | --- |
| `apps/web/app/earn-points/page.tsx`, `earn-points.css` | Legacy route redirects to `/?earn=1`; the game opens a native dialog with a close control, Escape/backdrop dismissal and its own scroll area. |
| `apps/web/components/earn/EarnPointsProvider.tsx`, `EarnPointsModal.tsx`, `EarnPointsContext.tsx`, `EarnPointsClient.tsx` | Verified/pending overview, UTC daily progress, PLAY/INVITE/QUESTS keyboard tabs, recent activity, wallet handoff and airdrop disclosure. |
| `apps/web/components/earn/EarnPointsLink.tsx`, `components/brand/AppHeader.tsx`, `app/globals.css` | Shared green/magenta header entry, slow glow, hover/focus and reduced-motion support. Mobile social destinations remain available through existing navigation/footer; header space is reserved for Earn Points and the wallet control. |
| `apps/web/components/profile/ProfileModal.tsx` | Profile/Airdrop links, shared referral and social forms, claim/edit APIs and honest campaign availability. Existing stored handle is reused for reply/repost submissions. |
| `apps/web/lib/airdrop/earn.ts`, `app/api/airdrop/points/route.ts` | Read-only ledger pagination beyond the default row limit, authoritative gameplay event-day accounting, recurring referral cap, last 12 nonzero reward records. Existing response fields retained. Raw ledger metadata is not returned. |
| `apps/web/lib/airdrop/useRewardResource.ts`, `app/api/referrals/mine/route.ts` | Wallet-bound request and response checks, stale-response protection and private/no-store responses. Signing ownership verification only occurs after an explicit user action. |
| `apps/web/lib/airdrop/earn.test.ts`, `components/earn/EarnPoints.test.tsx`, `package.json` | API/query-boundary and component coverage; `test:earn` command. |

Rules come from the existing Airdrop/Referral modules. Gameplay uses +5/+2 and a 200-Point UTC daily cap. Recurring referral rewards have a separate 500-Point cap; qualification bonuses are displayed separately and are not incorrectly deducted from that cap. Gameplay day uses `metadata.event_day`, with the same legacy `created_at` fallback as the reward processor.

Quest claims stay pending until the existing review process verifies them. Repost submission requires a configured campaign. An already recorded repost status remains visible after the campaign closes. Social read failures disable submissions rather than pretending the task is available. A quest mutation refreshes the main Points overview and activity.

There are no new dependencies, tables, migrations or reward engines. Gameplay, Solana transactions, ORAO, settlement and fee sponsorship are unchanged. No production deployment or remote write was performed.

## Verification

- `pnpm install --frozen-lockfile`
- `pnpm --filter @heads-or-tails/game-sdk build`
- `pnpm --filter @heads-or-tails/web typecheck`
- `pnpm --filter @heads-or-tails/web lint`
- `pnpm build`
- `pnpm --filter @heads-or-tails/web test:earn`: 6 ledger/API tests + 7 content tests + 5 popup lifecycle tests.
- `pnpm --filter @heads-or-tails/web test:reliability`: 553 passing tests.
- Existing Profile/Team components: 5 passing tests.
- `pnpm --filter @heads-or-tails/web test:mobile`: 6 navigation + 6 component tests passing.

Feature tests cover settled event-day progress, qualification versus recurring referral rewards, pagination, session-scoped API requests, anonymous denial, pending/verified separation, true referral links, evidence submission, unavailable campaigns, loading/error/retry/empty states, keyboard tabs, cross-wallet session changes and late responses.

Initial header/page inspection used the local Next app at 320×740, 390×844, 768×900, 1024×900, 1366×900 and desktop size. The replacement popup was then verified at 320×740, 390×844 and desktop size. No horizontal overflow was found. The header control stayed visible beside the wallet control; the main game's four mobile tabs remained intact. The popup opens without changing the URL or unmounting the game. Play Now switches the existing mobile tab in place. Wallet handoff temporarily closes the native top layer and restores the same earning tab afterward. Native dialog focus containment, focus restoration, body scroll locking, Escape/backdrop dismissal and mobile scrolling were exercised without submitting a wallet transaction.

Authenticated component/API verification uses controlled test fixtures through the real handler and Supabase client, not the production database. The local preview has no Supabase credentials, so a signed-in live-data browser test is not claimed. Public instructions and unauthenticated API denial are tested locally. This is the remaining environment-dependent verification before release.

Local-only evidence is in the ignored `artifacts/earn-points/` directory (screenshots and test/build logs). The popup screenshots are `earn-popup-desktop.jpg` and `earn-popup-mobile.jpg`; feature/lifecycle results are in `popup-tests.txt` and `popup-lifecycle-final.txt`.

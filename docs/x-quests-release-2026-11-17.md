# X quests and landing update — 2026-11-17 (Asia/Tehran)

The revised Earn Points popup is live at https://headstails.fun/. The two Read the full Tokenomics / Roadmap calls to action were removed from https://headstails.fun/welcome; both sections, their content, navigation anchors and original information routes remain available.

## User experience

Follow on X replaces the user-facing ownership challenge. The description is Submit your profile URL. Users open the official account, follow it, and submit their profile URL for manual staff review. No new bio code is requested by the form. Staff must explicitly attest that the submitted profile follows @HeadsTailsFun and supply an audit reason before approval.

Reply and Repost each display their configured campaign post as a prominent Open Post button. Reply accepts the user's reply URL. A normal repost does not require a separate repost URL: the authenticated account submits its approved profile and the server captures the official campaign target for manual checking. The existing requirement for an approved X profile before campaign submissions remains, and the UI explains it while approval is pending.

The user-requested retention rule is displayed in the X task area and important rules: users must keep following the official account and keep submitted replies/reposts until distribution. Unfollowing or deleting an activity makes that task ineligible for its reward. Final distribution review remains a staff responsibility; this release does not claim automated X monitoring or an API-based follow check. Staff can reject/revoke an individual task using the existing review flow, which removes its credit from verified Points while retaining the record and audit history.

The three task sections use a single stacked layout, clear headings/statuses, 16 px URL inputs and 48 px full-width buttons. Nested legacy form wrappers and side-by-side input/button rows were removed. The popup's existing game controller and wallet remain mounted behind it.

## Editable campaign posts

In Admin → Settings → X campaign posts, OWNER/FULL_ADMIN can independently edit Reply campaign post URL and Repost campaign post URL without a build or deployment. Empty values pause new submissions for that task. Only official HTTPS X/Twitter HeadsTailsFun status URLs are accepted; spoofed hosts, credentials, profile-only links and other accounts are rejected.

The keys are `earn_x_reply_campaign_url` and `earn_x_repost_campaign_url` in the existing `site_settings` table. Both were initialized to the approved post https://x.com/HeadsTailsFun/status/2120586014045385081. API responses read these settings at request time. Stored settings take precedence over legacy environment configuration, including explicit empty values.

The client includes the post it displayed. A changed target produces a clear conflict rather than silently associating evidence with a different post. The database rechecks the configured target within the submission transaction. Existing saved submissions retain their captured campaign URL; users can open that original post when the current campaign differs. Approved task records remain single-use for the season.

## Database and authorization

Applied migration: `20261116222922_x_follow_manual_and_campaigns.sql`, recorded by Supabase in UTC on November 16, corresponding to November 17 in the user's timezone.

The two new submission functions use SECURITY INVOKER with an empty search path. EXECUTE is revoked from PUBLIC, anon and authenticated and granted to the trusted service role. Website routes derive the wallet from the authenticated session; a supplied wallet address cannot choose the owner. Controlled admin settings and review permissions remain enforced.

Follow creates/reuses the existing pending claim and +100 pending ledger entry. Only an audited staff approval confirms it. Campaign tasks retain +50/+75 and the existing unique claim/ledger constraints. Retrying, resubmitting or approving twice does not create another reward. Legacy pending bio challenges remain reviewable with their original evidence requirement; their history and existing approved rewards were not erased. The security-advisor comparison found no new findings after excluding observation timestamps. Existing service-only RLS/no-policy informational findings remain unchanged.

No hosted user was manually followed, approved or credited during this release. No wallet keys, bot credentials or game/settlement configuration were changed.

## Executed checks

| Check | Result |
| --- | --- |
| Existing reliability tests | 553 passed |
| Verification server / component tests | 28 + 15 passed |
| Earn Points / popup tests | 6 + 15 passed |
| Admin reporting / review tests | 7 + 5 passed |
| Campaign-settings UI and validation | 2 passed |
| Actual local HTTP → handlers → PostgREST → PostgreSQL | 12 flows passed |
| TypeScript, ESLint, local production build and final hosted build | Passed |
| Final staged public checks | 5 passed |
| Canonical public HTTP checks | 8 passed |
| Existing Telegram integration Health | Correct credential 200; missing/wrong credential 401 |
| Existing quest configuration | Telegram, Discord, X manual and reward gates retained; approved Telegram URLs and quest amounts verified |
| Local responsive checks | 320, 390, 768 and 1440 px: no page/dialog horizontal overflow, 16 px input fonts, minimum button height 48 px |
| Actual production browser | Existing wallet restored; X forms, supplied campaign links and retention notice rendered; 390 px dialog had no horizontal overflow and full-width 48 px buttons |
| Post-deploy error scan | Zero records in the checked five-minute window |

The database integration tests exercise profile submission without a bio, refusal to approve without staff attestation, exactly one +100 credit, duplicate approval, revocation before payout, Reply/Repost evidence, a normal repost with no evidence URL, admin-only campaign edits, immediate settings readback, pause, stale-post conflict and retention of a previously submitted post. Legacy Telegram, X bio review and reward exclusion tests also pass. Tests use synthetic identities and disposable local PostgreSQL/PostgREST resources with external networking prohibited; their results are not represented as live X membership checks.

Live browser inspection used the existing owner's session without submitting an X claim or signing any transaction. The local layout fixture was explicitly labelled synthetic and excluded from deployments. Proof and logs are in ignored `artifacts/x-quests-2026-11-17/`, including `live-mobile-follow.png`, `live-mobile-reply.png`, `layout-checks.json`, all test logs and the staged/live checks.

## Deployment

| Field | Verified result |
| --- | --- |
| URL | https://headstails.fun/ |
| Target / status | Production / READY |
| Project | `headstails-devnet-beta` / `prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B` |
| Team | `team_l2N7NYLjf1k3mpQtNa6ogHUl` |
| Application commit | `45e0048d5f1a60564ca02664367b3b0cadb94e19` |
| Deployment | `dpl_6YL4hYaT4QZb9PaRDSEkwzsDmEjf` |
| Framework / build duration | Next.js 15.5.28 / 67.359 seconds |
| Release method | Staged production, tested, promoted without rebuilding; canonical alias read back |
| Source | Official repository main synchronized; this report is a subsequent documentation-only commit |

The earlier staged candidate was superseded by the final build, which also handles a paused submission explicitly. The previous production deployment was `dpl_7LpVtZ9YYTxtTbVRubYLkSTL3K3W`. Do not remove claim data when rolling back: pending follow requests need the current follow-aware staff reviewer. Log drains and external monitoring were not changed or audited; the five-minute log scan is a bounded observation.

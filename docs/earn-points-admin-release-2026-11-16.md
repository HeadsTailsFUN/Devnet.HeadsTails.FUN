# Earn Points administration — 2026-11-16

The owner requested per-user visibility across every earning activity, ranking by activity, manual X review and full website administration for wallet `3KRKZ7Kj9VqgWzZomVe2AgxU7664VkidGpnS3BmcRAVo`. They clarified that “follow X” means the existing X account ownership task; no separate follow task or new reward amount was invented.

## Delivered behavior

The admin section is labelled **Earn Points**. Its activity report reads the entire current season in the database before filtering, ranking and pagination. It supports username/wallet/X handle, individual activity, status and UTC date range; descending/ascending order by total activity, verified activity, pending activity, verified Points or last activity. Profiles with no activity appear in the unfiltered user list. Selected-user history and request queues are independently paginated; they are not limited to the old recent-100 claims or first 500/1000 ledger rows.

All 12 approved earning activities are covered, with additional connection/adjustment records. One settled game combines its gameplay marker and win bonus. Zero-Point capped games remain visible. Social claims and their corresponding ledger credits are counted once. Pending/failed membership checks, unsubmitted ownership challenges and referrals without a credit remain visible with truthful states and zero confirmed Points. This reports stored events, not unrecorded clicks, page views or fabricated activity. Connection records reflect stored connection state, not an invented complete connection history.

The social queue filters all ownership/repost/reply requests before pagination, shows original profile/evidence/campaign links, bio challenge/expiry where recorded, ledger status, previous attempts, reviewer, reason and decision history. Only one request's reason/attestation form is active; selecting another clears both. Approve requires evidence attestation and a reason; reject/revoke/needs-review require a reason. Existing reviews remain available while new submissions are paused. The legacy review endpoint delegates to the same authenticated path instead of bypassing its checks.

`admin_review_earn_claim` serializes reviews and reuses the existing atomic claim/ledger/identity operation. It keeps eligibility, identity uniqueness, bio challenge expiry, idempotency, revocation and historical-record preservation. Review decisions and reasons are stored in both verification and admin audit logs. No actual user's claim was approved or rejected as an agent test.

## Access and current activation

The specified wallet was granted the existing **FULL_ADMIN** role in `admin_members` and read back successfully. The operator grant is recorded in `admin_audit_log` with an explicit-request source. No wallet key/signature was required or accessed. The role is full Devnet website administration: user moderation, review, rewards management and existing off-chain admin surfaces. It does not transfer on-chain owner/upgrade authority or permit staff-role escalation. The user must connect this wallet and verify ownership at `https://headstails.fun/admin`; an address alone never authenticates.

Moderators retain read-only access to these reports and cannot review. Ordinary/anonymous users are denied. FULL_ADMIN is still denied outside the existing Devnet context. Report/review API responses are private/no-store. The new view is `security_invoker`; view and RPC access are service-role-only, with explicit browser-role revocations. Raw token digests, OAuth secrets and Telegram numeric identities are not exposed in activity output.

Quest activation remains **Health-only** as last instructed: Telegram Health enabled, user linking/jobs/new rewards/manual-X submissions/Discord disabled, with active-season gates also off. Existing gameplay/referral and historical Points remain unchanged. Manual staff decisions on already submitted X requests are available; this does not enable new provider connections or automatically approve anything.

## Verification

- 553 reliability tests, 34 verification tests, 11 new admin API/component tests and 14 real isolated PostgreSQL tests passed (612 total), plus ESLint and TypeScript.
- SQL tests include 1050 games and 130 pending claims, global search/pagination, zero credits, bonus deduplication, evidence/expiry enforcement, approval/rejection/replay, audit preservation and denial of browser SQL/RPC access.
- Real production read-only comparison: 161 users; 5621 reported games exactly match 5621 ledger gameplay markers; reported verified Points 14118 exactly match the ledger total. These are a snapshot, not a permanently fixed count.
- Security advisors returned the same 41 informational notices for deliberately server-only RLS tables, with no new warning/error findings. [Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Actual React components were visually inspected using a local synthetic fixture at normal viewport and 320 pixels. Per-user details, request-specific attestation and enabled/disabled review controls were checked; no page overflow occurred. Temporary viewport settings were reset. Screenshots are ignored `artifacts/earn-points/admin-layout.png` and `admin-mobile-review.png`; they show synthetic UI verification, not a signed-in production session.

The additive migration is `20261116005911_admin_earn_activity_report.sql`; its source filename matches the applied migration-history version. Gameplay, SDK, queue, contract, settlement and sponsor implementations were not changed. Application commit: `643873d3226905f4e30f8ad6cb9a4bc23526ca80`. Authenticated live browser testing as the newly granted wallet requires its actual signer; no session was forged to simulate it.

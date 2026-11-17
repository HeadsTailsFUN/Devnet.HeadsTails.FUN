# Remove duplicate Referrals entry from Profile

Published to https://headstails.fun. Profile now exposes only **Profile** and **Report Bug**. Referrals remain available through **Earn Points → INVITE**. The shared referral component export was retained because Earn Points uses it; referral APIs and admin tools were not changed.

## Validation

- All 15 mobile navigation/component tests and 15 Earn Points/modal component tests passed. The existing connected Invite test verified referral-link rendering, Copy Link and qualification progress.
- Final hosted build passed. Deployment metadata independently confirmed READY status and the expected source commit after a transient CLI connection interruption.
- The staged deployment required Vercel Authentication. Using the existing authenticated `vercel curl` access returned game HTTP 200 and application Earn-status HTTP 401; protection settings were not changed.
- Canonical alias readback matched the deployment below.
- Actual connected mobile Profile on the live site displayed exactly `[Profile, Report Bug]`. Opening Earn Points and selecting INVITE succeeded (`aria-selected=true`). No connection, signature, referral submission or profile edit was initiated.
- Live screenshot: `artifacts/profile-referrals-removal-2026-11-17/live-profile-tabs.jpg`. Browser viewport override was reset and the temporary verification tab closed.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-rndt19f49-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: a88b04ab37e69961edf4f2d50e5e1a48bf25c3b1
- **Framework**: Next.js 15.5.28
- **Build Duration**: 69.8 seconds building-to-ready
- **Deployment**: dpl_FecGZmvTQNq4d9wUJiEGbD9NZtbf
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_BD4GU3S685MdbaZWF2wP7mEWZDti

Promoted the tested staged production build without rebuilding. Source is on official `main`; this report is a subsequent documentation-only commit.

### Post-Deploy Observability

- **Error scan**: zero records in a bounded five-minute error scan.
- **Drains**: not audited or changed.
- **Monitoring**: live browser and authenticated HTTP checks completed; ongoing external monitoring was not audited or changed.

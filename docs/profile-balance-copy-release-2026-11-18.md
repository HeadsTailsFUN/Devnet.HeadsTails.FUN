# Mobile Profile balance and copy icon

Published to https://headstails.fun. Mobile Profile now shows the existing HTS balance beside the user name, with the rank below the address. The full wallet address has an accessible icon-only copy button beside it. The existing clipboard success/failure feedback is preserved. Balance fetching and precision are unchanged.

## Validation

- All 15 existing mobile navigation/component tests passed, including clipboard copying and confirmation, a single balance display, Profile back navigation, and the remaining Profile controls.
- Hosted production build completed successfully, including TypeScript and lint checks.
- Authenticated HTTP check of the exact staged deployment returned 200 and the actual game document.
- Promoted that same staged production deployment. Canonical alias readback matched its ID.
- Public game returned HTTP 200. All 17 referenced scripts fetched successfully; the live Profile bundle includes the new balance label and the accessible copy control.
- Visual browser verification could not be completed: the Computer Use tool stopped because it could not determine the current browser URL confidently. No screenshot or rendered layout verification is claimed.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-3hg79h397-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: 703a15cfc258a004d5a10477cb01e09fff3fb1a6
- **Framework**: Next.js 15.5.28
- **Build Duration**: 48.0 seconds building-to-ready
- **Deployment**: dpl_FtXFgkMPCoSqf5b5shxnrsc4pdQB
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_FecGZmvTQNq4d9wUJiEGbD9NZtbf

### Post-Deploy Observability

- **Error scan**: zero records in a bounded five-minute error scan.
- **Drains**: not audited or changed.
- **Monitoring**: public HTTP and live asset checks completed; visual browser verification remains uncompleted as noted above.

Source is on official main. This report is a subsequent documentation-only commit.

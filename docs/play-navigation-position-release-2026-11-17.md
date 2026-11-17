# Desktop social links and mobile back placement

Published to https://headstails.fun on 2026-11-17.

- Social links are explicitly visible in the desktop game header beside Connect Wallet, including at widths below the previous 1024px visibility breakpoint. At intermediate widths the controls wrap as a group to avoid squeezing the brand and wallet.
- Moved the mobile room selector and both back actions into one shared navigation block before the coin/hero. Initial Play links to Welcome; an unsubmitted side selection uses the existing Back to sides handler. Transaction, queue and result guards are unchanged.
- Mobile social links remain borderless and are still hidden on non-Play tabs. Welcome styling is unchanged.

## Verification

- All 14 mobile navigation/component tests passed.
- The real controller regression passed, including an assertion that both back actions share the same parent before the game hero. Simulated wallet/RPC test recorded zero signing requests and zero transaction submissions.
- Local and hosted production builds passed, including lint and type checks. Existing test-harness act/WebSocket diagnostics did not cause test failures.
- Staged browser checks at 390px confirmed identical back rectangles before selection, after HEADS and after TAILS: x=16, y=168.28125, width=44, height=44. No wallet was connected; side changes only previewed the local UI, with no stake, signature or Confirm action.
- At 800px and 1280px, all four desktop social links were visible with no horizontal overflow.
- On the canonical live site at 1280px, socials occupied x=903.953125–1059.953125 and Connect Wallet x=1067.953125–1241, both y=20–64: adjacent and non-overlapping.
- On the canonical live site at 390px, initial and selected back rectangles matched exactly, the arrow was above the coin, and mobile socials had a 0px border. Clicking Back to Welcome navigated to `/welcome`. No horizontal overflow was observed.
- Canonical game and Welcome HTTP checks returned 200; unauthenticated Earn status remained 401. The alias readback matched the deployment below.
- Screenshots: `artifacts/play-navigation-position-2026-11-17/live-desktop-play.jpg` and `live-mobile-play.jpg`.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-b6i2uu59p-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: 5b8b80060e21a8135006a8be192405d253ae50f6
- **Framework**: Next.js 15.5.28
- **Build Duration**: 54 seconds reported by hosted build; 62.344 seconds building-to-ready
- **Deployment**: dpl_Gxc6j5sSFFJEaR3cfcjrXKGcrqyt
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_DA2i3sLy4KngumrTNr5Lk35XkucK

The tested staged production build was promoted without rebuilding; application source is on the official repository's `main`. This report is a subsequent documentation-only commit. No database, environment, game-engine, wallet authorization or Bot Manager changes were made.

### Post-Deploy Observability

- **Error scan**: zero error records in a bounded five-minute scan.
- **Drains**: not audited or changed.
- **Monitoring**: live browser and HTTP checks completed; ongoing external monitoring was not audited or changed.

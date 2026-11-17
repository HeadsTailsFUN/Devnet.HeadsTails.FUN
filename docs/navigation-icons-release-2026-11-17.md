# Play navigation icons — 2026-11-17

Published the requested follow-up to the social-navigation release:

- Removed the mobile Play social group border and background. Welcome styling remains unchanged.
- Removed the labelled Welcome entry from the game header. Desktop now has an icon-only Home link beside the logo, with an accessible name and 44px target.
- Mobile hides that header Home icon and shows the existing-style back arrow in the initial Play view, in the navigation area immediately before game progress. It links to `/welcome` in the current tab.
- Selecting a side still replaces that link with the original Back to sides action. During queue, match and protected transaction states, the existing controller guards remain in force.
- Footer Welcome access and the first-visit redirect policy remain unchanged.

## Verification

- Six mobile navigation tests and eight mobile component tests passed.
- The real controller regression passed with simulated RPC/wallet state: initial Welcome link, side selection, return to sides, queue/result retention and replay. Zero signing requests or submitted transactions in that test.
- Local production build and hosted build passed, including lint and type checks. Existing test-harness act/WebSocket diagnostics were present; no tests failed.
- Before promotion, genuine browser checks on the staged production build verified mobile return and desktop Home navigation, no horizontal overflow, mobile Play social border `0px` and Welcome social border `1px`.
- After promotion, the canonical game and Welcome returned HTTP 200 with the new header and no old header Welcome class. Unauthenticated Earn status remained HTTP 401.
- Live mobile browser checks at 320px and 390px and desktop at 1440px showed no horizontal overflow. Back to Welcome and Home both navigated to the canonical `/welcome`. Mobile Home is hidden, desktop Home contains no text, and touch targets measure 44px high.
- Live screenshots: `artifacts/navigation-icons-2026-11-17/live-mobile-play.png` and `live-desktop-play.png`.
- No gameplay transactions, message signatures, database changes, environment updates or Bot Manager operations were performed for this release. A previously authorized browser wallet restored automatically; no new connection or authorization was submitted.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-hjphf09cw-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: f6fe5ae6e52dc863cf4405d98012ef7fcc5b8ead
- **Framework**: Next.js 15.5.28
- **Build Duration**: 44 seconds reported by hosted build; 53.531 seconds building-to-ready
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Deployment**: dpl_DA2i3sLy4KngumrTNr5Lk35XkucK
- **Rollback deployment**: dpl_CghiCwVSAjopLiS3Ftit9v7TN9mm

The tested staged production build was promoted without rebuilding. Canonical alias readback matched the deployment above. Application source is on the official repository's `main`; this report is a subsequent documentation-only change.

### Post-Deploy Observability

- **Error scan**: zero records in the bounded five-minute error scan.
- **Drains**: not audited or changed in this visual update.
- **Monitoring**: live browser and HTTP checks completed; ongoing external monitoring was not audited or changed.

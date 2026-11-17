# Larger mobile Earn Points and icon-only Profile Back

Published to https://headstails.fun. Mobile Earn Points is now 128px wide with 14px single-line text. At widths up to 360px, the connected header places Earn on a separate aligned row to retain useful account space. Profile's top Back control now contains only an arrow, retaining its accessible name, 44px target and existing callback.

## Verification

- All 15 mobile navigation/component tests passed, including the existing Profile return action checks.
- Local build/lint/type validation passed before the final CSS sizing adjustment; the final hosted build completed successfully for the exact published commit.
- Synthetic connected-header checks at 320, 360, 375 and 390px confirmed a 128px button, single-line label height 16.09375px, text fitting within the button, no account/social overlap and no horizontal page overflow.
- Staged Profile showed an SVG, empty visible button text and a 44 × 44px target; clicking it returned a direct Profile entry to Play.
- Canonical production CSS contained the final 128px sizing and nowrap rule. The live browser subsequently restored its previously authorized wallet, and actual mobile Play at 390px confirmed width 128px, label height 16.09375px, nowrap text and no page overflow.
- Canonical Profile showed an icon-only 44 × 44px Back control; clicking it navigated to `/?tab=play`.
- Verified live screenshots: `artifacts/earn-single-line-2026-11-17/live-earn-header.jpg` and `live-profile-arrow.jpg`.
- No new wallet connections, signatures, gameplay, database or environment changes were initiated. Temporary layout server stopped; browser viewport overrides reset.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-9r5is7tj8-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: d8ca2d29059beae837ffa27d320a241273ba6313
- **Framework**: Next.js 15.5.28
- **Build Duration**: 49.982 seconds building-to-ready
- **Deployment**: dpl_BD4GU3S685MdbaZWF2wP7mEWZDti
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_3eh3VkQ3eiyFxhziD4FzmJCGci4R

A transient CLI connection interruption was resolved by independently reading back READY status and the expected source commit before promotion. The tested staged production build was promoted without rebuilding; canonical alias readback matched it. Source is on official `main`; this report is a subsequent documentation-only commit.

### Post-Deploy Observability

- **Error scan**: zero records in a bounded five-minute error scan.
- **Drains**: not audited or changed.
- **Monitoring**: live browser checks completed; ongoing external monitoring was not audited or changed.

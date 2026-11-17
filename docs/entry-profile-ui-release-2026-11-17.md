# Welcome actions, mobile Earn Points and Profile Back

Published three requested UI changes to https://headstails.fun:

- Launch App uses a forward arrow; How It Works uses an open-book guide icon instead of a video/play icon. Destinations remain unchanged.
- Mobile Play displays the full Earn Points label beside its icon. The narrow layout uses two lines, preserving socials and account controls without horizontal overflow.
- Profile has a top Back button. On mobile it returns to the originating Play, Social or Flips tab; direct Profile entry safely defaults to Play. Guest Profile also has this control. Desktop Profile closes back to the underlying page. Existing bottom Back to Play remains available.

## Verification

- Six navigation logic tests, nine mobile component tests and the real-controller regression passed. New checks cover originating tabs, Profile information pages, direct-entry fallback and independent top/bottom actions. The controller test recorded zero signing requests and zero transaction submissions.
- Local and hosted production builds passed, including lint and type checking. Existing simulated RPC/WebSocket and act diagnostics did not cause test failures.
- Synthetic connected-header fixtures at 320 and 390px showed the full label (`clip-path: none`, static position, 37 × 27.59375px text box) with no page/control overflow.
- Staged browser confirmed guest Profile returns to Flips and Social. The How It Works link still navigated to `#how-it-works`; both replacement SVG paths were verified.
- Canonical live browser automatically restored a previously authorized wallet. From Flips, header Profile opened `?tab=profile`; the new top Back button returned to `?tab=flips`. Its target measured 87.40625 × 44px at y=145.
- Canonical live Play showed the full Earn Points label at 390px with no clipping. Screenshot: `artifacts/entry-profile-ui-2026-11-17/live-mobile-earn-header.jpg`.
- Canonical Welcome had the forward-arrow and guide icon paths. Canonical game/Welcome returned HTTP 200; unauthenticated Earn status returned 401. Alias readback matched the deployment below.
- No new wallet connection, authentication signature, gameplay submission, profile edit, database or environment change was initiated. The temporary fixture server was stopped and browser viewport overrides reset.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-lo48mtzd4-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: 5f13ace5ba7e4b92665b0b94a553b86f71973f7f
- **Framework**: Next.js 15.5.28
- **Build Duration**: 43 seconds reported by hosted build; 51.062 seconds building-to-ready
- **Deployment**: dpl_3eh3VkQ3eiyFxhziD4FzmJCGci4R
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_A9iFpRA6PeETKxWYcEcsSdv812Fa

Promoted the tested staged production build without rebuilding. Application source is on official `main`; this report is a subsequent documentation-only commit.

### Post-Deploy Observability

- **Error scan**: zero records in a bounded five-minute error scan.
- **Drains**: not audited or changed.
- **Monitoring**: live HTTP and browser checks completed; ongoing external monitoring was not audited or changed.

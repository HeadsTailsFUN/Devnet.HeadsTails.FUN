# Desktop header alignment

Fixed the game header to keep the logo, Home, social links and wallet controls on one row at desktop widths. The previous `lg` breakpoint allowed wrapping below 1024px. The header now uses a single row by default, with explicit wrapping only inside the existing mobile media query. Narrow desktop screens use compact account/reward controls; accessible names remain intact.

## Validation

- All 14 existing mobile navigation/component tests passed. Local and hosted builds passed, including lint and type checking.
- Ten isolated header layout checks passed: connected (synthetic long name and balance) and disconnected at widths 768, 800, 1024, 1280 and 1536, height 900. All four header elements had center y=42, with no page or control overflow. These fixtures did not access wallets or submit transactions.
- Mobile fixture checks at 320 and 390 retained the separate brand/control rows without overflow.
- Staged production browser at 800px and canonical production at 800px and 1280px confirmed centers `[42,42,42,42]` and no horizontal overflow.
- Canonical mobile at 390px retained the existing layout, hidden Home and back arrow y=168.28125, without overflow.
- Canonical game and Welcome returned 200; unauthenticated Earn status returned 401. Alias readback matched the deployment below.
- Live screenshot: `artifacts/desktop-header-row-2026-11-17/live-header-800.jpg`. The temporary fixture server was stopped and browser viewport overrides reset.
- No game-engine, database, environment or Bot Manager changes; no wallet connections, signatures or gameplay submissions initiated.

## Deploy Result

- **URL**: https://headstails.fun
- **Deployment URL**: https://headstails-devnet-beta-jp6gp99z9-shralireza42-2875s-projects.vercel.app
- **Target**: production
- **Status**: READY
- **Commit**: 60345b9f4ee96020e5357110d7399d1c32333363
- **Framework**: Next.js 15.5.28
- **Build Duration**: 54 seconds reported by hosted build; 62.756 seconds building-to-ready
- **Deployment**: dpl_A9iFpRA6PeETKxWYcEcsSdv812Fa
- **Project**: headstails-devnet-beta / prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B
- **Rollback**: dpl_Gxc6j5sSFFJEaR3cfcjrXKGcrqyt

Promoted the tested staged production build without rebuilding. Application source is on official `main`; this report is a subsequent documentation-only commit.

### Post-Deploy Observability

- **Error scan**: zero error records in a bounded five-minute scan.
- **Drains**: not audited or changed.
- **Monitoring**: live HTTP and browser checks completed; ongoing external monitoring was not audited or changed.

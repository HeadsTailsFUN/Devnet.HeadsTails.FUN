# Welcome production release — 2026-11-16

The published landing page is https://headstails.fun/welcome. The complete game remains at https://headstails.fun/; Launch App was clicked in the live browser and reached that exact address.

## Published build

| Field | Verified result |
| --- | --- |
| Vercel project | `headstails-devnet-beta` / `prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B` |
| Team | `team_l2N7NYLjf1k3mpQtNa6ogHUl` |
| Environment / state | Production / READY |
| Deployment | `dpl_AcW8hLzE4kaSxY7BsJNDH9Lb5FmB` |
| Application source commit | `74c1b3f262c43615f14a65008f7f44c5aad53df8` |
| Framework / build duration | Next.js 15.5.28 / 53.2 seconds |
| Canonical alias | `headstails.fun`, read back after promotion |

The production build was staged with domain assignment disabled, verified, then promoted without rebuilding. The application source was pushed to the official repository's `main` branch. This report is a later documentation-only commit; it does not change the deployed application build.

## Content and navigation

The current official `/tokenomics` and `/roadmap` pages were fetched before implementation. Welcome and those information pages now share allocation and roadmap data in `apps/web/lib/site/project-content.ts`.

Tokenomics displays 1,000,000,000 HTS issued, six decimals, Solana Devnet and the official mint. Its seven proposed allocations are Founder 15%, Team 5%, Player Rewards 30%, Ecosystem 15%, Treasury 15%, Liquidity 15% and Initial Community 5%. The planning-only status, retained mint/metadata authorities, absence of freeze authority and simulated test-token disclosures are preserved. No completed distribution, locked allocation or financial value is invented.

Roadmap displays the official Devnet Beta, Community & Growth and Expansion stages, their statuses and all twelve items, with the existing no-guarantees disclosure. Both sections link to their full information pages. The previously removed room introduction, Meet the Arena and Earn Points sections remain absent.

The header stays at the top during scrolling: 16 px on desktop and 10 px on phones. New anchor links appear in desktop and mobile navigation. Browser checks found no horizontal overflow or broken images at 320, 390, 1024 and 1440 px locally; live checks repeated desktop and 390 px navigation. Official artwork, coin fog/shine and the single-row mobile hero were retained.

## First visit for each public IP

Normal first root GET requests from a previously unseen public IP receive a private, non-cacheable HTTP 307 to `/welcome`. Later root requests from a recorded IP render the game. Direct `/welcome` remains available.

The production preference cookie is bound to the current IP digest. An old browser cookie or existing wallet-session cookie cannot suppress Welcome when the public IP changes to a previously unseen one. IP digests are also hostname-scoped, so staging tests do not consume canonical-domain first visits. The standard Vercel `x-forwarded-for` header and its `x-vercel-forwarded-for` alias are accepted only in the Vercel environment; untrusted self-hosted forwarding headers are ignored.

Only a keyed HMAC digest and first-seen time are persisted, with no raw IP, wallet identity, user agent or visit history. People sharing a public IP share its first-visit preference. An IP already recorded earlier does not become new merely because a browser changes. The dedicated key must remain stable between deployments.

Referral, Earn, mobile navigation and wallet/provider callback links retain their direct game entry. HEAD, RSC and prefetch requests do not consume an introduction. Ordinary campaign parameters are retained through Welcome and Launch App. A bounded storage outage admits visitors to the game rather than blocking gameplay; safe static diagnostic reasons contain no IP or credentials.

## Production configuration

The additive migration `supabase/migrations/20261116150507_site_welcome_visits.sql` was applied to project `nkxsofnrivmxhuzctpov` after isolated SQL tests passed. Only the new preference table and atomic claim function were added. Readback confirmed RLS enabled, no execution permission for anonymous/authenticated browser roles, and execution granted to the server service role.

Production has `WELCOME_ENABLED=true` and a dedicated server-only `WELCOME_IP_HASH_SECRET`. The secret was generated securely and stored without printing its value; its local backup is DPAPI protected outside the repository. Existing Supabase credentials, authentication providers, wallets, rewards and game configuration were retained.

The new table produces the intentional informational [RLS enabled with no policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): browser access is deliberately closed and only the service role uses it. No public policy was added to silence that advisory.

## Executed verification

| Check | Result |
| --- | --- |
| Production build, TypeScript, ESLint | Passed |
| Existing reliability tests | 553 passed |
| Welcome/middleware tests plus referral components | 17 + 2 passed |
| Isolated real PostgreSQL tests | 5 passed |
| Local production-build HTTP acceptance flows | 6 passed |
| Corrected staged production | First root 307, then all 9 public flow checks passed |
| Canonical live HTTP | All 15 requests passed |
| Live Telegram Health | Correct credential 200; missing/incorrect credential 401 |
| Existing quest catalog | Telegram, Discord, X manual and reward gates remained enabled; approved URLs and 20/5/15/20 amounts verified |
| Live browser | Desktop/mobile sections, sticky header and Launch App to root verified |
| Deployment error log scan | 0 error records in the checked five-minute window |

The canonical first root request returned 307 to `/welcome`; a subsequent request from that same IP returned the original game with 200 without needing a browser cookie. Live checks also covered referral/Earn/mobile query entry, the full Tokenomics/Roadmap pages, admin page, protected APIs returning 401, official artwork and an optimized image endpoint. Unit tests separately cover a new IP carrying an old preference cookie and wallet session, returning known IPs and origin isolation. This does not claim testing from two independently controlled physical networks.

Twelve concurrent database claims for one digest produced exactly one first visit. The disposable SQL test container was removed after testing. No existing hosted game tables or wallet vaults were modified. No signed gameplay, settlement, Telegram membership or Discord user authorization was initiated during this marketing release. Log drains and external monitoring were not changed or audited; the error scan is a bounded observation, not a guarantee of future availability.

An initial staged candidate did not redirect because the deployment supplied Vercel's standard ingress header instead of its alias. That candidate was not promoted. The corrected candidate above passed the first-visit check before release.

Ignored local evidence is in `artifacts/welcome/release/`: `stage-identity.json`, `stage-checks.json`, `live-checks.json`, `live-desktop.png`, `live-mobile.png`, layout/test/build logs and the bounded error-log scan. No secret, raw IP or session cookie is included in this report.

The previous production deployment remains the rollback target: `dpl_CWzkUNdVivmQiWjXhvWdKrWghqu6`. The additive preference storage need not be removed to roll back the frontend.

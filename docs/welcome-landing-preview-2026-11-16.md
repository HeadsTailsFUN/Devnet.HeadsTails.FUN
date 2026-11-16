# HeadsTails welcome landing — preview handoff

## Latest visual revision, 2026-11-16

The owner requested a simpler welcome page. The current headline and SEO/social titles are **PICK A SIDE. OWN THE FLIP.** The room-introduction, Meet the Arena and Earn Points sections are removed, along with the Earn Points navigation links and the removed sections' unused CSS. Points/referral promotional FAQ items were also removed; referral capture and the game's actual Earn Points feature remain intact.

Each hero character now has its own colored light field, shadow, subtle breathing aura and decorative neon SVG arcs. Desktop artwork uses smaller separated frames with a clear center lane for the coin. On phones the characters occupy separate columns, with the coin in a second row in normal document flow. This avoids fixed-position overlap as the viewport narrows.

This UI-only follow-up passed the production build (including TypeScript/ESLint), all six production-build HTTP acceptance flows, and browser geometry/image checks at 320, 390, 768, 1024 and 1440 pixels. No character/coin intersections, broken images or horizontal overflow were found. Measured phone character gaps exceeded 22 px horizontally and the coin was at least 17 px below the characters in the checked frames. The new HTTP assertions also confirm all three removed section IDs are absent and the old headline is gone. Original game entry, legacy referrals/Earn/mobile links, API protection and supporting routes still pass. No production deployment, environment change or hosted database mutation was performed.

Latest screenshots: `artifacts/welcome/revision-desktop-hero.png`, `revision-desktop.png`, `revision-mobile-hero.png`; measured results: `revision-responsive-results.json`. The preview remains at http://127.0.0.1:3340/welcome. The original implementation and 700-check acceptance record below describe the earlier preview phase; its three removed content sections are superseded by this revision, and its test count is not a claim that the full suite was rerun for this styling change.

2026-11-16 · branch `feat/welcome-landing` · base `0c92bfe`.

**Preview:** http://127.0.0.1:3340/welcome on the owner's computer. Not deployed to production. The live alias still points to `dpl_CWzkUNdVivmQiWjXhvWdKrWghqu6`; its homepage returned HTTP 200 with the original game title and no landing markup.

## Final routing and implementation

The owner's subsequent instructions supersede the attachment's `/devnet` proposal: **the complete existing game remains at `/`**. There is no `/devnet` page, subdomain, new Vercel project or global basePath.

A first normal root GET is temporarily redirected (307, private/no-store) to `/welcome`. Launch App returns to `/`; later requests open the game directly. The welcome response sets an HttpOnly, SameSite=Lax, host-only preference cookie, with Secure on HTTPS and a one-year lifetime. On Vercel, the first-visit claim is also persisted by HMAC-SHA256 of the trusted ingress IP. A second browser on the same public IP skips the introduction. Only the fingerprint and its first-seen timestamp are stored: no raw IP, wallet address, user agent or visit counter. People sharing an IP share this preference; the browser cookie also avoids repeating the intro after a network change.

Existing root query links (including referrals, Earn Points, Discord notices, mobile tabs and wallet callback parameters), existing session cookies, RSC navigation and prefetch bypass the marketing redirect. HEAD probes do not consume the first visit. Direct `/welcome` remains available and marks the preference, so its Launch App cannot loop back. Every landing launch, brand and Earn link preserves incoming query values, including repeated referral/query parameters, and remains same-origin. A tiny client component reuses the app's existing validated 30-day pending-referral storage, so visiting the verification guide or another page before Launch App does not lose attribution. Existing Home, Play, Profile, `/earn-points` and Discord callback links already target the correct root app and were retained.

The new server-rendered landing uses all four owner-provided artworks, green/pink lighting, the hero, steps, features, actual 100/1,000 HTS rooms with simulated USD labels, Points, Devnet disclosure, fairness guide, FAQ, community links and final CTA. The app illustration is explicitly labelled as illustration, not live queue/match data. No invented statistics, audits, partners or release dates appear. The existing official social links are reused.

Native disclosure menus/FAQ, labelled controls, focus outlines, a skip link, reduced-motion CSS, responsive layouts, Next image optimization, canonical metadata and Open Graph previews are included. Landing links do not prefetch the wallet/game bundle. The build reports 110 kB first-load JS for `/welcome` versus 409 kB for the original game; landing route-specific JS, including referral capture, is 639 B. The game background preload was moved from the shared root layout to the game page. The wallet/game/Earn provider hierarchy is unchanged. Privacy documentation describes the entry preference.

No gameplay controller, SDK, program, queue, VRF, settlement, sponsor, rewards, referral engine, Telegram/Discord authentication, cron or recovery implementation changed. Existing API origin checks remain intact; marketing middleware matches only `/` and `/welcome` in addition to the pre-existing protected API matchers.

## Verification

| Check | Result |
| --- | --- |
| Existing reliability suite | 553 passed |
| Welcome routing and existing middleware | 12 passed |
| Landing referral capture through later guide/game visits | 2 passed |
| Existing mobile navigation/components | 13 passed |
| Existing Earn Points | 21 passed |
| Existing social verification | 34 passed |
| Existing fairness | 38 passed |
| Existing WalletConnect | 16 passed |
| Isolated PostgreSQL | 5 passed |
| Production-build HTTP flows | 6 passed |
| Production build, TypeScript and ESLint | Passed |

These are 700 executed checks, including five real PostgreSQL checks and six HTTP flows. The SQL fixture was a separately labelled disposable PostgreSQL container; the existing Supabase stack and hosted database were untouched. Twelve simultaneous claims for one digest produced exactly one first visit. Anonymous/authenticated browser roles could neither read preferences nor execute the claim function. RLS, caller privileges and lack of PUBLIC execute grants were checked; raw IP values were rejected by the digest constraint. The dedicated container was stopped and removed after testing.

HTTP acceptance checked the first redirect, direct welcome, returning root game, legacy referrals/Earn/Discord/mobile/wallet parameters, `/earn-points`, supporting pages/admin, anonymous session/owner API behavior, existing cross-origin protection, every provided image and the optimized-image endpoint. A startup readiness check prevents a test from racing the local server's bind.

Browser review covered 320, 390, 768, 1024 and 1440 pixel widths: no horizontal overflow or clipped primary controls, and no broken images were found. The mobile menu and FAQ were operated. Actual browser clicks confirmed Launch App reaches `/`, referral query retention, later bare-root entry stays in the app, the existing wallet dialog opens, Earn Points opens as a popup, and all four mobile tabs remain on the root app with referral parameters retained. Temporary viewport overrides were reset, and the landing preview was left open.

Screenshots and command logs are in the ignored `artifacts/welcome` directory: `desktop.png`, `desktop-hero.png`, `mobile.png`, `mobile-hero.png`, `responsive-results.json`, `browser-results.json`, the build log and individual test logs.

## Limits and production preparation

This is an isolated local UI preview. Its dedicated RPC and Supabase environment are not configured, so the root game correctly displays its existing unavailable/configuration states. Wallet connection prompts render, and wallet/session behavior is covered by regression fixtures; no actual wallet signature, new game, live settlement, Telegram membership or Discord user authorization was performed in this preview. The running Bot Manager and its wallets were not stopped or changed.

The new migration `supabase/migrations/20261116140331_site_welcome_visits.sql` is prepared and locally tested, **not applied to the hosted database**. Before an approved production release, apply that single additive migration, provision a dedicated random 32+ character `WELCOME_IP_HASH_SECRET` as a server-only production Secret, retain the existing Supabase URL/service credentials, and set `WELCOME_ENABLED=true`. Keep the HMAC key stable across deployments. First-visit detection uses `x-vercel-forwarded-for` only when the platform sets `VERCEL=1`; self-hosted/untrusted forwarded headers are ignored. The choice follows the [official Vercel request-header documentation](https://vercel.com/docs/headers/request-headers).

Only a visitor without the preference cookie needs the bounded (1.2-second) atomic IP claim. A missing or failed production IP service admits the visitor to the game and sets the browser preference instead of blocking gameplay. Local development uses the browser preference for its introduction preview. Consequently, real cross-browser per-IP behavior on the hosted service is a post-configuration release check; the routing policy and database concurrency have been independently tested here.

For an approved release, stage and verify the production build before promotion, including first-IP → welcome → root, a second cookie-free browser on the same IP, referrals, signed wallet session restoration and callback flows with actual provider credentials. No existing authentication secrets, domain allowlists, DNS records or historical records need to change. To bypass the introduction, deploy with `WELCOME_ENABLED=false`; instant rollback to the existing production deployment also leaves the additive preference table harmlessly unused.

Repeatable local commands:

```powershell
pnpm --filter @heads-or-tails/web test:welcome
node scripts/test-welcome-sql.mjs
node scripts/test-welcome-http.mjs
pnpm --filter @heads-or-tails/web build
```

The HTTP suite expects the built local preview at port 3340. The SQL suite creates only its explicitly labelled disposable fixture and never targets a hosted database.

# Welcome and social navigation release — 2026-11-17

Published to https://headstails.fun. Welcome now has a prominent social pill and a clearer coin-flip headline. Mobile Play shows social icons to the left of wallet controls. A permanent Welcome link in the game header and footer opens a new tab, allowing returning players to revisit the introduction without navigating their game document away.

## User-facing changes

- Hero headline: **HEADS OR TAILS. ONE FLIP. ONE WINNER.**
- Subtitle: “A coin-flip game. You vs. another player.”
- Top Welcome social links use 44 × 44 touch targets and accessible labels.
- Mobile Play exposes X, Telegram, Discord and GitHub alongside wallet controls.
- A labelled Welcome entry remains available in the game header and footer.
- First-visit automatic Welcome behavior remains unchanged. This release does not change IP/cookie policy, routing middleware, wallet signing, gameplay, Supabase or environment variables.

Official destinations reuse the existing project configuration:

| Service | Destination |
| --- | --- |
| X | https://x.com/HeadsTailsFun |
| Telegram | https://t.me/HeadsTailsFun |
| Discord | https://discord.gg/ytQBSWD75J |
| GitHub | https://github.com/HeadsTailsFUN/Devnet.HeadsTails.FUN |

External links use a new tab with `noopener noreferrer`. The compact mobile Earn Points button retains its accessible name; account and balance remain visible.

## Verification

- 19 Welcome/referral component tests passed.
- 14 mobile navigation/component tests passed.
- Six local production HTTP flow checks passed, including first-entry redirect, returning-game behavior, direct Welcome access and protected APIs.
- Local and hosted builds passed TypeScript and ESLint checks.
- Three staged deployment checks and three canonical production checks passed. `/welcome` and the game returned 200 with expected content; unauthenticated `/api/earn/status` returned 401.
- Isolated header fixtures at widths 320, 390, 768 and 1280 had no horizontal overflow, including a long account name and large balance. At 320 pixels, disconnected social controls occupied x=16–142 and Connect Wallet x=156.14–304, without overlap. These fixtures used synthetic state and did not connect or sign a wallet.
- Genuine production browser verification at 390 pixels confirmed the mobile Play header and Welcome have no horizontal overflow. Welcome at 1440 pixels had no broken artwork and the description stayed between the two characters.
- Clicking Welcome from the live game opened `/welcome` separately while the original game stayed at `/?tab=play`.
- Clicking the top GitHub icon opened the official repository in a separate tab. All four top social destinations were checked against the configured URLs.
- A bounded five-minute production error-log scan returned zero error records. This is a point-in-time check, not an ongoing monitoring guarantee.

Live screenshots are stored in `artifacts/social-navigation-2026-11-17/`: `live-welcome-desktop.png`, `live-welcome-mobile.png` and `live-mobile-play.png`. Test/build output and deployment identity/check results are in the same ignored directory. No signed gameplay or provider task submissions were initiated for this visual/navigation release. The earlier full reliability suite was not rerun; targeted navigation, rendering and HTTP checks were used. External monitoring and log drains were not audited or changed.

## Deployment identity

| Field | Value |
| --- | --- |
| Production | https://headstails.fun |
| Welcome | https://headstails.fun/welcome |
| Project | headstails-devnet-beta |
| Project ID | prj_zPZUIHQYOuvDVFOl72v1gkXMzE3B |
| Deployment | dpl_CghiCwVSAjopLiS3Ftit9v7TN9mm |
| Deployment URL | https://headstails-devnet-beta-lguif4nay-shralireza42-2875s-projects.vercel.app |
| State / target | READY / production |
| Source commit | fe0912fd0f78c65a545c08b4e2d73821662d5a53 |
| Framework | Next.js 15.5.28 |
| Hosted build duration | 67.853 seconds |
| Previous production / rollback | dpl_6YL4hYaT4QZb9PaRDSEkwzsDmEjf |

The staged production build was tested before promotion, then the canonical alias was read back and matched to the deployment above. Application source was fast-forwarded to the official repository's `main`. This release report is a subsequent documentation-only commit and does not require a new deployment.

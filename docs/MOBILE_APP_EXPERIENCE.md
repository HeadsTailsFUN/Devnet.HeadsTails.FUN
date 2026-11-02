# Mobile app experience

The existing Devnet application uses a four-section shell on phone-sized viewports: **Social | Play | Flips | Profile**. Play is the default. Portrait widths through 767px and landscape phone sizes through 1023px × 600px use the shell. Larger tablet and desktop viewports keep the original layout.

The same `LiveGameClient`, wallet provider, on-chain account readers and transaction functions stay mounted while sections change. Tab changes do not join, cancel, sign or disconnect. Pending signatures retain the existing refresh/reconciliation path. The room chooser shares the existing cached RoomState probe, and rechecks active stake/queue/match/settlement guards before changing rooms.

The approved logo, 210px mobile coin, artwork, button components, typography, colors and effects are reused. The mobile reference headline is “Pick your side and wait for a match”; desktop retains “Pick your side to play.” Mobile alone displays **Devnet Test Rate: 100 HTS = $1 simulated USD**. The desktop disclosure and complete information-page disclosures remain present.

Social reuses the original Chat and Leaderboard instances. Flips uses the existing PostgREST query with a server-side limit of 50 completed rows. Details reuse the original round component; missing transaction/ORAO metadata is not invented. Recorded stakes and pot are identified as recorded data; the settlement link provides payout evidence.

The existing Profile supports page and modal presentation. Mobile keeps its Profile, Referrals, Airdrop and Report Bug sections, avatar/name/team controls, disconnect and pending-payout recovery. Wallet address copying and the existing HTS balance are visible in page presentation. The footer follows all profile content. Its information links render the same extracted static page content within the shell and preserve game and profile scroll state. Direct `/terms`, `/privacy`, `/roadmap` and `/tokenomics` URLs still render normally.

Deep links use `?tab=social|play|flips|profile` and an optional `info=terms|privacy|roadmap|tokenomics`. Existing referral parameters are retained. Browser Back updates presentation without unmounting the game controller.

Safe areas and dynamic visual-viewport height bound the shell. Content that cannot fit, including landscape, larger text and long errors, scrolls inside its section. Chat uses 16px composer text. A keyboard resize can temporarily hide the unchanged header/section switch to keep the composer accessible. Browser zoom is not disabled.

## Validation

- `pnpm --filter @heads-or-tails/web test:mobile`
- `pnpm --filter @heads-or-tails/web test:mobile-controller`
- `pnpm --filter @heads-or-tails/web test:ui-components`
- `pnpm --filter @heads-or-tails/web typecheck`
- `pnpm --filter @heads-or-tails/web lint`
- `pnpm --filter @heads-or-tails/web build`

Controller tests use an explicitly synthetic loopback RPC, public fixture identities and signing methods that reject every request. They prove presentation/state persistence, not live transaction acceptance. Manual wallet connections and game signatures remain owner-controlled. No new mint, program upgrade, service identity, hosted migration or reward-policy change is part of this frontend update.

# Earn Points UI review — 2026-11-16

The owner supplied two Persian reference images listing the approved rewards and their conditions. The values agree with the current gameplay/referral constants and social quest configuration. This update changes presentation only; it does not change any API, reward processor, database migration, activation flag, historical claim or gameplay code.

| Activity | Points | Important condition |
|---|---:|---|
| Settled win / loss | +5 / +2 | Eligible completed matches only; 200 gameplay Points per wallet per UTC day, resetting at 00:00 UTC; same rate in every room |
| Referral qualification | +50 inviter / +25 invited player | After 3 eligible settled matches, once |
| Subsequent referred match | +2 inviter | Match 4 onward; existing 25 recurring events per invitee/day and 500 recurring Points per inviter/day caps; qualification bonuses are separate |
| X ownership / repost / reply | +100 / +75 / +50 | Bio ownership challenge and manual evidence review; no reward from opening a link |
| Telegram group / channel | +20 / +5 | Authoritative membership; no gameplay prerequisite |
| Discord server | +15 | Authoritative membership and complete screening; no automatic join |
| Play on 3 dates | +20 | Distinct, not necessarily consecutive UTC dates; past eligible current-season matches count |

The four new quests total 60 Points per eligible season. No quiz/tutorial reward is present. Pending/failed/unavailable verification is not confirmed Points. Existing activation gates remain off in the local preview.

The popup keeps PLAY / INVITE / QUESTS. The disconnected overview is smaller. A concise gameplay rule line stays visible, and one disclosure exposes the complete 12-row table and detailed conditions. Community tasks use compact expandable rows; account management, X forms, daily progress, reward activity and the full airdrop disclosure open on demand. X forms load when first opened. The game's controller and existing wallet handoff remain in place.

Verification logs and screenshots are in the ignored artifacts/earn-points/compact-* files. Production deployment and live-data writes are outside this UI review.

Targeted checks: test:earn passed 21 tests (6 ledger/API and 15 content/popup), test:verification passed 33 tests (24 API/OAuth and 9 UI/admin). The rules test checks all 12 amounts plus UTC, referral thresholds/caps, membership eligibility, nonconsecutive dates, the 60-Point total and removal of the quiz. Production build includes TypeScript and ESLint validation. Browser checks also exercise native disclosure grouping so opening another task closes the previous one.

The final popup and expanded 12-row table were inspected in the in-app browser at its normal desktop viewport and at 390×844 and 320×740. No horizontal overflow occurred in the page or popup, including the expanded table at 320 pixels. Temporary viewport overrides were reset. The final preview tab was left open on QUESTS. Screenshots are compact-desktop.png, compact-mobile.png and compact-rules.png in artifacts/earn-points. The preview remains disconnected from production Supabase/Solana configuration, so no live wallet/provider integration is claimed.

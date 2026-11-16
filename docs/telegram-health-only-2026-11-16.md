# Telegram Health-only configuration — 2026-11-16

After the initial quest activation, the owner relayed the bot operator's controlled Health-only test requirements and supplied the configuration screenshot. This phase supersedes reward activation: no user linking, job processing, new reward issuance, bot XP or competition changes are authorized by this Health test.

## Final intended settings

| Production setting | Value |
| --- | --- |
| HEADSTAILS_WEBSITE_API_KEY | Dedicated random 64-character credential, stored as Vercel Secret; never included here |
| EARN_TELEGRAM_ENABLED | true |
| EARN_TELEGRAM_LINKING_ENABLED | false |
| EARN_TELEGRAM_JOBS_ENABLED | false |
| EARN_NEW_REWARDS_ENABLED | false |
| EARN_X_MANUAL_VERIFICATION_ENABLED | false |
| EARN_DISCORD_ENABLED | false |
| EARN_TELEGRAM_BOT_USERNAME | HeadsTailsFunBot |
| EARN_TELEGRAM_GROUP_ID | -1004441691477 |
| EARN_TELEGRAM_CHANNEL_ID | -1004350361539 |

The active season's linking/jobs/Discord/manual X/new-reward flags are also false and quest flags are empty. The additive tables remain installed with RLS and service-only grants. Existing gameplay/referral rewards and historical Points were not disabled, deleted or reset. Group/channel URLs are not invented; those optional join links await the actual official destinations.

The credential was generated using the operating system cryptographic random generator. A local backup is encrypted with Windows DPAPI, bound to the owner's account, outside the repository and upload scope. The Desktop folder `HeadsTails Telegram Health Setup` contains only a copy helper and instructions; neither the CMD helper nor the reports contain the key. The helper lets the owner copy it without printing it. It must then be transferred through the owner's secure sharing channel to the friend who operates the bot; no message was sent to that person by the agent.

Bot configuration uses canonical API origin `https://headstails.fun`, Bearer authentication and `HEADSTAILS_WEBSITE_API_KEY` in the bot process environment. Health requires a new UUID4 `X-Request-Id` header. The Telegram BotFather token is unrelated and was not requested. Link/job gates remain off until both sides have completed a real controlled round trip. No new Discord credentials or permission were needed for this Health-only phase.

Public catalog `telegramEnabled=false` refers to account linking (`enabled && linking`), so it is expected even when the protected Health endpoint is enabled.

## Verified production result

Redeployed the previously tested application source (`7ea6de66be55e26300c27892b6d456b013873749`) with updated production configuration. Deployment `dpl_AVtVJzdk9eNaj3o9utxd3N62tLSE` is READY in the verified project and aliased to `headstails.fun`. No application/gameplay code changed for this configuration release.

Real HTTPS tests on the canonical domain passed: correct Bearer credential and UUID4 request ID returned HTTP 200 with `{"ok":true,"status":"operational"}`; missing and incorrect credentials each returned HTTP 401. The public catalog confirms account linking/Discord/manual X/new rewards are false. No link/job mutation, membership verification, bot XP change or new reward was executed during these checks. This verifies the website-side Health boundary; the friend's Windows bot must still receive the same key securely and make its own Health call.

The first local credential-file read rejected a trailing newline in the encrypted DPAPI representation. The representation and reader were corrected; all three final live HTTP checks passed afterward. No secret value was logged. Local evidence: ignored `artifacts/earn-points/telegram-health-live-checks.json` and `telegram-health-public-catalog.json`.

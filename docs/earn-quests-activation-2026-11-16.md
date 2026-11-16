# Quest activation — 2026-11-16

The owner explicitly superseded Health-only mode and requested activation of every quest, supplying the clean Telegram settings and the official X campaign URL. No new reward amounts or synthetic verification evidence were introduced.

## Current live state

Telegram linking/jobs, Discord, new reward issuance and manual X submissions are enabled in both Vercel production configuration and the active DEVNET_BETA season. All four seasonal quest flags are enabled. Telegram group/channel membership, Discord membership and the three-day gameplay quest are available for controlled user tests; X ownership/repost/reply use the existing manual verification workflow.

| Production configuration | Value |
| --- | --- |
| EARN_TELEGRAM_ENABLED | true |
| EARN_TELEGRAM_LINKING_ENABLED | true |
| EARN_TELEGRAM_JOBS_ENABLED | true |
| EARN_TELEGRAM_BOT_USERNAME | HeadsTailsFunBot |
| EARN_TELEGRAM_GROUP_ID | -1004441691477 |
| EARN_TELEGRAM_CHANNEL_ID | -1004350361539 |
| EARN_TELEGRAM_GROUP_URL | https://t.me/HeadsTailsChat |
| EARN_TELEGRAM_CHANNEL_URL | https://t.me/HeadsTailsFun |
| EARN_NEW_REWARDS_ENABLED | true |
| EARN_X_MANUAL_VERIFICATION_ENABLED | true |
| AIRDROP_X_CAMPAIGN_URL | https://x.com/HeadsTailsFun/status/2120586014045385081 |
| NEXT_PUBLIC_AIRDROP_X_CAMPAIGN_URL | Same approved campaign URL |
| EARN_DISCORD_CLIENT_ID | 1569807046876856452 |
| EARN_DISCORD_GUILD_ID | 1566470653861822514 |
| EARN_DISCORD_REDIRECT_URI | https://headstails.fun/api/earn/discord/callback |
| EARN_DISCORD_ENABLED | true |
| EARN_DISCORD_CLIENT_SECRET | Configured as a production Secret; value omitted |

The existing dedicated Telegram Bearer credential was preserved; its value is not included here. Telegram URLs returned HTTP 200 with official HeadsTails group/channel titles. Numeric chat IDs are owner-supplied; actual getChatMember permissions must be confirmed by the separately operated bot. The bot's own linking/worker settings and process environment must use this same service key and canonical API origin; website activation does not modify the friend's Windows process, XP or competitions.

## Publication and verification

Production deployment `dpl_CWzkUNdVivmQiWjXhvWdKrWghqu6` is READY and aliased to `headstails.fun`. It was staged with production settings, verified and promoted without rebuilding. Its releaseCommit is `4a51ee8bf5806b50b73c323757ff69b57f102c66`; subsequent documentation-only commits are not that build's code identity. The Vercel build completed successfully, including lint/type validation; deployment metadata reports a 47.4-second build phase. It replaces the earlier Telegram/X-only deployment `dpl_F2B1wA5nJvEvuBYuapW8Yvzz8UEm`. No gameplay, contract, SDK, sponsor, signing or wallet-vault implementation changed.

34 verification API/component tests passed in the activation phase; this credential-only completion did not change application code. The staged and canonical live catalogs confirm Telegram configured/enabled, Discord enabled, X manual/new rewards enabled and the exact approved join URLs. Active-season settings were independently read back with every gate and all four quest flags true. All four approved quest amounts remain 20/5/15/20. An initial local DNS lookup failed transiently; the retry and subsequent DNS check succeeded. Live Health returns 200 operational with the correct Bearer key and 401 for missing/incorrect credentials. Anonymous Earn status and Discord-connect action requests return 401. The five-minute deployment error scan returned zero entries. These checks do not fabricate a wallet session, Telegram link, membership result or Discord authorization; real user/provider round trips remain the user's controlled tests. Log drains and external monitoring were not changed or audited during this configuration task.

## Completed Discord credential setup

The official HeadsTails Discord application was confirmed in the authenticated Developer Portal. The owner performed the credential reset/recovery and confirmed Copy. The canonical redirect was verified after a fresh navigation: it was persisted, no unsaved-change warning remained, and the credential was hidden. The agent did not reset that authentication credential or expose its value in chat, logs, screenshots or source.

The owner-designated credential was moved through a restricted local transfer to Vercel Secret storage. A DPAPI-encrypted local copy is retained outside the repository; removal of the transient plaintext file was verified. The official Discord token endpoint returned HTTP 400 `invalid_grant` for an intentionally invalid authorization code using this client credential, matching the expected negative-code result without creating a user token or obtaining user data. Discord environment/season gates were enabled only after this probe succeeded and the saved redirect was confirmed. Actual user consent, wallet-bound OAuth completion and real guild membership/reward processing still require a genuine user round trip.

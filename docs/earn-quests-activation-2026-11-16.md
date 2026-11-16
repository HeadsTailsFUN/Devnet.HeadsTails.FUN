# Quest activation — 2026-11-16

The owner explicitly superseded Health-only mode and requested activation of every quest, supplying the clean Telegram settings and the official X campaign URL. No new reward amounts or synthetic verification evidence were introduced.

## Current live state

Telegram linking/jobs, new reward issuance and manual X submissions are enabled in both Vercel production configuration and the active DEVNET_BETA season. All four seasonal quest flags are registered; Discord capability remains disabled until its actual Client Secret is securely provisioned and the OAuth redirect is saved by the owner. Telegram group/channel membership and the three-day gameplay quest are available; X ownership/repost/reply use the existing manual verification workflow.

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
| EARN_DISCORD_ENABLED | false — pending actual credential setup |

The existing dedicated Telegram Bearer credential was preserved; its value is not included here. Telegram URLs returned HTTP 200 with official HeadsTails group/channel titles. Numeric chat IDs are owner-supplied; actual getChatMember permissions must be confirmed by the separately operated bot. The bot's own linking/worker settings and process environment must use this same service key and canonical API origin; website activation does not modify the friend's Windows process, XP or competitions.

## Publication and verification

Production deployment `dpl_F2B1wA5nJvEvuBYuapW8Yvzz8UEm` is READY and aliased to `headstails.fun`. It rebuilds the existing application source recorded by releaseCommit `de84137` with updated environment settings; subsequent documentation-only commits are not that build's code identity. No gameplay, contract, SDK, sponsor, signing or wallet-vault implementation changed.

34 verification API/component tests passed. The staged and canonical live catalogs confirm Telegram configured/enabled, X manual/new rewards enabled and the exact approved join URLs. All four approved quest amounts remain 20/5/15/20. Live Health returns 200 operational with the correct Bearer key and 401 for missing/incorrect credentials. The five-minute deployment error scan returned zero entries. These checks do not fabricate a wallet session, Telegram link, membership result or Discord authorization; real user/provider round trips remain the user's controlled tests.

## Remaining Discord owner action

The official HeadsTails Discord application was found in the authenticated Developer Portal. Its public Client ID was configured in Vercel. The exact canonical redirect was entered as a reviewable pending change. The portal hides the previous Client Secret and disables Copy until owner credential reset/recovery. The owner was asked to save the redirect, perform any required Client Secret reset and MFA, copy the credential, leave the secret display and confirm completion. The agent does not reset that authentication credential or expose its value in chat, logs, screenshots or source.

Once the owner confirms Copy, the credential can be moved through a restricted local transfer to Vercel Secret storage, with a DPAPI-encrypted local copy and removal of the transient plaintext file. Credential validity can be checked using an intentionally invalid authorization-code exchange: accepted client authentication must return invalid_grant, without creating a user token or obtaining user data. Discord environment/season gates must remain off until this succeeds and the redirect is confirmed.

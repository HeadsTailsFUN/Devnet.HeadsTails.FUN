# HeadsTails.FUN website ↔ Telegram V5.10

Website implementation contract v1, initially implemented 2026-11-15 and reviewed for final handoff 2026-11-16. **Implemented and tested locally; NOT deployed, NOT live-confirmed, NOT activated.** The separately managed bot was not modified. This replaces the proposed website-side details in the supplied contract; it does not assert that a live V5.10 installation has accepted them.

Review basis: website integration commit cae5cfe and popup/rules review commit 1d936a5 on the local feat/earn-points branch. The 2026-11-16 UI simplification did not change this API protocol, reward amounts or activation gates. The companion [readiness report](EARN_POINTS_INTEGRATION_READINESS.md) lists exact changed files, migration, offline test evidence, Discord configuration and remaining live-test requirements.

## Base URL and transport

After an approved deployment, configure the bot's API base URL as the canonical website HTTPS origin, normally [HeadsTails.FUN](https://headstails.fun), with no trailing API prefix, query, fragment or embedded credentials. Confirm the actual deployment origin before enabling networking. These routes live in the existing Next.js website:

| Method | Path | Purpose |
|---|---|---|
| POST | /api/telegram/link | Consume a website-issued token and bind Telegram identity |
| POST | /api/telegram/unlink | Safely resynchronize bot unlink state |
| GET | /api/telegram/health | Credential and installed-storage probe |
| GET | /api/telegram/verification-jobs?limit=N | Lease official membership jobs |
| POST | /api/telegram/verification-results | Durably record evidence and, if activated/eligible, credit the existing ledger |

Production requires HTTPS. The local HTTP integration runner is test-only. No inbound port on the Windows bot computer is needed.

## Authentication, identifiers and errors

Use **Bearer authentication only**:

```http
Authorization: Bearer <HEADSTAILS_WEBSITE_API_KEY>
Accept: application/json
Content-Type: application/json
User-Agent: HeadsTails-Telegram-Community/5.10
X-Request-Id: <new UUID4 for this HTTP attempt>
Idempotency-Key: <mutation key defined below>
```

The dedicated credential must have at least 32 characters and be provisioned securely on both servers. No HMAC mode is implemented. Headers are case-insensitive. UUID4 identifiers and the proposal's 32-hex example identifiers are accepted, case-insensitively; a link/unlink idempotency key must exactly equal the body's request_id. Result keys are exactly verification:<job_id>. Mutations require these keys; GET requests do not.

Generate a new X-Request-Id for each attempt. Retrying a mutation requires the same Idempotency-Key and identical JSON field values, including timestamps and optional detail. Object property order is immaterial. A changed body with an existing key returns HTTP 409. There is no separate HMAC-style X-Request-Id replay cache in this Bearer mode.

Transport, authentication, feature gates and structural validation run before receipt replay. A malformed request may therefore return its validation error (including status=invalid for a malformed link token) rather than 409, and a disabled integration may return 503 before a receipt is read. Only responses committed to the durable receipt journal are replayable; validation/rate-limit/availability errors are not all journaled. Replay guarantees below assume those preliminary checks still pass.

All responses are JSON objects, private/no-store, with no token plaintext, service credential, wallet address, database diagnostic or stack trace in service responses. Request bodies are limited to 64 KiB. Typical failures:

```json
{"ok":false,"error":"rate_limited","message":"rate limited","retry_after":30}
```

| HTTP | Handling |
|---|---|
| 200 | Inspect ok and the documented status; never infer success from HTTP alone |
| 400 / 413 / 415 | Malformed/oversized request; do not infer linking or reward success |
| 401 / 403 | Wrong/missing credential or denied transport/authorization; fix configuration |
| 404 | Unknown verification job |
| 409 | Changed idempotency body or mismatched job identity/chat scope; investigate |
| 429 | Honor integer Retry-After (1–600 seconds); retry only as allowed by the bot |
| 503 | Disabled/unconfigured feature or unavailable storage; bounded backoff |

Use the V5.10 bounded timeout/retry policy; the website introduces no recursive client retries. A timeout is ambiguous: resend the identical body/key to obtain its committed receipt. Health success means only that authenticated installed storage answered, not that rewards or jobs are enabled.

## Link

An authenticated wallet owner requests a private deep link through POST /api/earn/action with action=telegram_token. The website generates 32 random bytes encoded as 43 URL-safe characters, hashes the token with SHA-256, and stores only its digest. TTL is **600 seconds**. A fresh token invalidates that wallet's previous unused Telegram tokens.

The browser receives https://t.me/<configured bot>?start=<token>; it must open it privately and never share or log it. The bot authenticates the genuine update's user.id and sends:

```json
{
  "token":"<website-issued 43-character nonce>",
  "telegram_user_id":123456789,
  "telegram_username":"optional_username",
  "request_id":"c017e516-cb72-4bc3-a73c-4e2b905c030a"
}
```

Idempotency-Key is c017e516-cb72-4bc3-a73c-4e2b905c030a for that example. Telegram IDs must be positive JSON integers within JavaScript's safe integer range (<= 9007199254740991); Telegram documents IDs with at most 52 significant bits. No typed wallet/username is accepted as ownership proof. A username is informational and not retained.

Successful atomic link:

```json
{"ok":true,"status":"linked","account_ref":"<opaque UUID>"}
```

| Status | ok | HTTP | Meaning |
|---|---|---|---|
| linked | true | 200 | Token consumed and binding committed |
| already_linked | true | 200 | A fresh token confirms the same existing active binding |
| expired | false | 200 | Expired token; generate a new one |
| invalid | false | 200 | Malformed/unknown/wrong-purpose token |
| used | false | 200 | Token consumed; a new request cannot reuse it |
| conflict | false | 200 | Telegram identity reserved by another wallet or wallet already has a different active identity |
| unavailable | false | 200 or 503 | No active season, missing storage/configuration or unavailable operation |

retry is represented by HTTP 429 plus the error envelope; the adapter must retain its proposed 429 handling. Identical committed receipts return the original response, even if the nonce is subsequently consumed/expired. A fresh request ID with that consumed token returns used. Only successful link consumption commits the binding; a conflict does not consume the nonce.

account_ref is a randomly generated opaque UUID, not a wallet or credential. Identity reservations survive unlinking; the same Telegram identity cannot hop to another wallet to claim again. Same-wallet reconnects remain possible and do not reset historical claims.

New link attempts: 5 per Telegram identity per 600 seconds; successful receipt replays do not consume this counter. Website nonce creation: 5 per wallet per 600 seconds.

## Unlink — explicit security deviation

The bot's authenticated service credential alone cannot authorize unlinking a particular wallet merely by submitting a Telegram numeric ID.

1. The authenticated owner first selects **Disconnect Telegram in the website**. The transaction deactivates the link and cancels pending membership jobs without deleting Points/history.
2. The user sends a **new /unlink command to the official bot**. It generates a fresh request_id and POSTs:

```json
{"telegram_user_id":123456789,"request_id":"a45641ce-0a59-4c3c-a8b9-47cac6dc71f4"}
```

Idempotency-Key equals request_id. If the website binding is already inactive, the result is HTTP 200, {"ok":true,"status":"not_linked"}, which clears the bot's local link state under the proposed adapter semantics.

If the binding is still active, HTTP 200 returns {"ok":false,"status":"unavailable","message":"Unlink on the website first, then retry /unlink."}. The bot must preserve its local state. There is no service endpoint that unlinks an arbitrary active wallet.

The existing V5.10 not_linked handling can be reused; add the website-first instruction to its help if needed. Website disconnect does not push into the bot's local database. Until /unlink or a fresh link resynchronizes it, the bot may display a stale local LINKED badge. Do not activate live linking without accepting this limitation. Unlink requests are limited to 3 per identity per 600 seconds. Use a new command/request ID after website disconnect; an earlier unavailable response did not clear the bot's local state.

## Membership jobs and durable results

The wallet owner requests the group or channel quest. Only the configured official, distinct negative group/channel IDs can be used. No gameplay prerequisite is added.

GET /api/telegram/verification-jobs?limit=N accepts **1–50**, default 10. One poll per service per 30 seconds; 429 returns Retry-After. Disabled jobs return an empty jobs array. Expired, completed, inactive-link and currently leased jobs are not returned.

```json
{"ok":true,"jobs":[{
  "job_id":"f55c1316-d023-4f2f-98b6-296e13bca8b5",
  "telegram_user_id":123456789,
  "chat":"group",
  "chat_id":-1001234567890,
  "requested_at":1794740000,
  "expires_at":1794740900
}]}
```

Example IDs and times above are synthetic. UTC timestamps are numeric epoch seconds and may contain a fractional part. Each job expires **900 seconds** after creation and is leased atomically for **120 seconds**. If a worker disappears, it becomes available after lease expiry, before job expiry. The owner can create a fresh job after expiry/non-success; the website does not extend an expired job. Current integration supports one configured V5.10 worker; multi-instance bot behavior is not certified.

The bot calls official Telegram getChatMember for the exact user/chat and submits:

```json
{
  "job_id":"f55c1316-d023-4f2f-98b6-296e13bca8b5",
  "telegram_user_id":123456789,
  "chat":"group",
  "chat_id":-1001234567890,
  "status":"VERIFIED",
  "checked_at":1794740010,
  "source":"telegram-getChatMember",
  "detail":"optional safe text, at most 250 characters"
}
```

Idempotency-Key: verification:f55c1316-d023-4f2f-98b6-296e13bca8b5.

Accepted statuses: VERIFIED, NOT_MEMBER, PENDING, UNAVAILABLE, ERROR. Only VERIFIED can lead to Points. The website validates exact configured chat ID/type, linked user, job identity, an issued lease, expiry, and checked_at between requested_at−5 seconds and min(expires_at, server_now+300 seconds). Future times beyond server_now+300 are malformed. Stale/expired/unlinked/unleased evidence is durably recorded as ERROR, acknowledged, and earns nothing. The optional detail is validated then discarded, not logged.

The ACK is **HTTP 200 {"ok":true} only after the database transaction commits**. It does not promise a reward. The same transaction checks season activity, account exclusions/staff restrictions, both reward gates, quest activation, and unique wallet/external identity history. Group earns +20 and channel +5 in the existing website ledger, at most once per wallet and identity per season. All non-VERIFIED outcomes earn zero. Duplicate identical results ACK without duplicate credit; a conflicting body returns 409.

## Required configuration and activation gates

Website server environment names (no credentials belong in public frontend variables):

| Variable | Requirement |
|---|---|
| HEADSTAILS_WEBSITE_API_KEY | Dedicated Bearer credential, at least 32 characters |
| EARN_TELEGRAM_ENABLED | Master service switch; default false |
| EARN_TELEGRAM_LINKING_ENABLED | Nonce/link switch; default false |
| EARN_TELEGRAM_JOBS_ENABLED | Poll/result switch; default false |
| EARN_TELEGRAM_BOT_USERNAME | Official username, without @ |
| EARN_TELEGRAM_GROUP_ID | Official negative safe-integer group ID |
| EARN_TELEGRAM_CHANNEL_ID | Official negative safe-integer channel ID, different from group |
| EARN_TELEGRAM_GROUP_URL / EARN_TELEGRAM_CHANNEL_URL | Official HTTPS join links |
| EARN_NEW_REWARDS_ENABLED | Four new quests' master credit switch; default false |
| NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY | Existing website server database connection |

The additive migration is supabase/migrations/20261115124344_earn_points_social_verification.sql. It must be reviewed/applied to a designated staging database first. Every new table/RPC denies anon/authenticated roles; authenticated website routes access it through the existing protected server database client.

Environment flags alone are insufficient: the active season's earn_season_settings row must explicitly enable telegram_linking / telegram_jobs / new_rewards_enabled and each quest_flags entry. All rows are seeded false/empty; a new season also defaults unavailable until deliberately configured. Do not run activation SQL against production as part of this handoff.

Bot-side: select Bearer mode; supply the same secret through its protected environment; set the canonical API base origin; retain the five exact endpoint paths; configure matching distinct official chat IDs, limits <=50 and poll interval >=30 seconds; verify actual getChatMember permissions; enable its integration/link/job gates only after controlled tests. The bot remains the source of Telegram evidence, never the source of website Points. No community XP, campaign budget, rarity score or SOL prize enters this API.

Owner-confirmed identifiers: bot username HeadsTailsFunBot; group ID -1004441691477; announcement channel ID -1004350361539; Discord guild ID 1566470653861822514. These identifiers do not establish current bot permissions or live connectivity.

## Retention and change control

Link tokens become invalid at 600 seconds, OAuth state at 600 seconds, and membership jobs at 900 seconds regardless of whether their database rows remain. The current release has **no automatic purge**: token digests, receipts, verification records and audits remain at rest; identity reservations and historical rewards survive unlinking. Plaintext link tokens, OAuth credentials and Telegram usernames are not retained. The owner must approve the operational retention/deletion policy before live enablement; deleting an identity reservation must never silently allow a second reward.

This is protocol revision v1 (2026-11-15), reviewed 2026-11-16, for the existing unversioned five routes. Breaking changes require an agreed adapter/website release and a revised contract or new versioned route; do not silently change request fields or overwrite integration history during rollback.

## Compatibility decisions and remaining sign-off

1. Bearer selected; no HMAC timestamp signature mode.
2. Both UUID4 and the proposal's 32-hex example request IDs accepted.
3. Numeric Telegram IDs are limited to safe integers; real Telegram IDs fit this range.
4. Unlink is website-owner-first, followed by a new bot /unlink command; there is no bot-only active-wallet unlink.
5. Website lease is 120 seconds; poll floor is 30 seconds; the bot must finish/retry within the 900-second job TTL. A duplicate delivery after bot restart must not discard a pending result before its website ACK.
6. Fractional epoch seconds are permitted. The proposal's JSON examples using integers remain valid.
7. 409 represents conflicting mutation bodies/scope. Existing non-200 handling treats it as unavailable; operator diagnostics should distinguish it from a retryable network failure.

Offline contract/schema/concurrency tests are recorded in [the readiness report](EARN_POINTS_INTEGRATION_READINESS.md). **Live V5.10 linking, worker permissions, real membership, unlink resynchronization, timeouts and bot restart recovery still require an owner-approved staging end-to-end test.** Do not describe this as production-integrated until those checks pass.

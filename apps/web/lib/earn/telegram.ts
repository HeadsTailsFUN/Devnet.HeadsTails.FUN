import { earnConfig } from "./config";
import { dbClient, dispatch, serviceIdentity, readBody, telegramId, REQUEST_ID, TOKEN, JOB_ID, canonical, digest, EarnError, failure, json, rate } from "./server";

export async function telegramRoute(req: Request, operation: "link" | "unlink" | "health" | "verification-jobs" | "verification-results") {
  try {
    serviceIdentity(req);
    const config = earnConfig(), db = dbClient();
    if (operation === "health") {
      const check = await db.from("earn_season_settings").select("season_id").limit(1);
      if (check.error) throw new EarnError("verification_not_installed", 503);
      return json({ ok: true, status: "operational" });
    }
    if (operation === "verification-jobs") {
      const raw = new URL(req.url).searchParams.get("limit") ?? "10";
      if (!/^\d+$/.test(raw) || +raw < 1 || +raw > 50) throw new EarnError("invalid_limit");
      if (!config.jobs || !config.groupId || !config.channelId) return json({ ok: true, jobs: [] });
      await rate(db, "telegram:poll", 1, 30);
      return json(await dispatch(db, "telegram_poll", null, { limit: +raw }));
    }
    const body = await readBody(req), external = telegramId(body.telegram_user_id);
    const key = req.headers.get("idempotency-key") ?? "";
    const receipt = { external_id: external, request_key: key, body_digest: digest(canonical(body)) };
    if (operation === "link" || operation === "unlink") {
      if (!REQUEST_ID.test(String(body.request_id ?? "")) || key !== body.request_id) throw new EarnError("invalid_idempotency_key");
      if (operation === "link") {
        if (!config.linking) throw new EarnError("linking_disabled", 503);
        if (typeof body.token !== "string" || !TOKEN.test(body.token)) return json({ ok: false, status: "invalid" });
        if (body.telegram_username !== undefined && (typeof body.telegram_username !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(body.telegram_username))) throw new EarnError("invalid_username");
        // Rate limiting applies to new attempts, not receipt replays. The SQL journal is authoritative.
        const cached = await db.from("earn_request_receipts").select("body_digest,response").eq("scope", "telegram_link").eq("request_key", key).maybeSingle();
        if (cached.error) throw new EarnError("temporarily_unavailable", 503);
        if (cached.data) {
          if (cached.data.body_digest !== receipt.body_digest) throw new EarnError("idempotency_conflict", 409);
          return json(cached.data.response);
        }
        await rate(db, `telegram:link:${external}`, 5, 600);
        return json(await dispatch(db, "telegram_link", null, { ...receipt, token_digest: digest(body.token) }));
      }
      await rate(db, `telegram:unlink:${external}`, 3, 600);
      return json(await dispatch(db, "telegram_unlink", null, receipt));
    }
    if (!config.jobs) throw new EarnError("membership_jobs_disabled", 503);
    const job = String(body.job_id ?? ""), chat = body.chat;
    if (!JOB_ID.test(job) || key !== `verification:${job}`) throw new EarnError("invalid_idempotency_key");
    const chatId = chat === "group" ? config.groupId : chat === "channel" ? config.channelId : null;
    if (!chatId || body.chat_id !== chatId) throw new EarnError("invalid_chat_scope");
    if (!["VERIFIED", "NOT_MEMBER", "PENDING", "UNAVAILABLE", "ERROR"].includes(String(body.status))) throw new EarnError("invalid_membership_status");
    if (typeof body.checked_at !== "number" || !Number.isFinite(body.checked_at) || body.checked_at <= 0 || body.checked_at > Date.now() / 1000 + 300) throw new EarnError("invalid_check_time");
    if (body.source !== "telegram-getChatMember" || (body.detail !== undefined && (typeof body.detail !== "string" || body.detail.length > 250))) throw new EarnError("invalid_evidence_source");
    return json(await dispatch(db, "telegram_result", null, { ...receipt, job_id: job, chat, chat_id: chatId,
      status: body.status, checked_at: body.checked_at, award: config.rewards }));
  } catch (error) { return failure(error); }
}

export const CHAT_MAX_CHARS = 280;
export const CHAT_MIN_INTERVAL_MS = 1000;
export const CHAT_MAX_PER_MINUTE = 20;

export type BodyCheck = { ok: true; body: string } | { ok: false; reason: string };

/** Plain UTF-8 text only: trimmed, non-blank, max 280 chars. No HTML parsing. */
export function validateBody(input: unknown): BodyCheck {
  if (typeof input !== "string") return { ok: false, reason: "message must be text" };
  const body = input.trim().replace(/\s+/g, " ");
  if (body.length === 0) return { ok: false, reason: "message is blank" };
  if (Array.from(body).length > CHAT_MAX_CHARS) {
    return { ok: false, reason: `message is too long (max ${CHAT_MAX_CHARS})` };
  }
  return { ok: true, body };
}

export interface RateState {
  lastSentAtMs: number | null;
  sentInLastMinute: number;
}

/** Pure rate-limit evaluation (server enforces; client mirrors for UX). */
export function rateLimitCheck(
  state: RateState,
  nowMs: number
): { ok: true } | { ok: false; reason: string; retryAfterMs: number } {
  if (state.lastSentAtMs !== null && nowMs - state.lastSentAtMs < CHAT_MIN_INTERVAL_MS) {
    return {
      ok: false,
      reason: "sending too fast",
      retryAfterMs: CHAT_MIN_INTERVAL_MS - (nowMs - state.lastSentAtMs),
    };
  }
  if (state.sentInLastMinute >= CHAT_MAX_PER_MINUTE) {
    return { ok: false, reason: "minute limit reached", retryAfterMs: 60_000 };
  }
  return { ok: true };
}

/** Render as text: React escapes by default; this documents the no-HTML rule. */
export function isSafeText(body: string): boolean {
  return !body.includes("\0");
}

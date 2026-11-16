import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { earnConfig } from "./config";

export class EarnError extends Error {
  constructor(public code: string, public status = 400, public retryAfter?: number) { super(code); }
}
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export const nonce = () => randomBytes(32).toString("base64url");
export const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
export const REQUEST_ID = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;
export const JOB_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
export function equal(a: string, b: string) { return timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex")); }
export function json(data: unknown, status = 200, retryAfter?: number) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization",
    ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}
export function failure(error: unknown) {
  const e = error instanceof EarnError ? error : new EarnError("temporarily_unavailable", 503);
  return json({ ok: false, error: e.code, message: e.code.replaceAll("_", " "), ...(e.retryAfter ? { retry_after: e.retryAfter } : {}) }, e.status, e.retryAfter);
}
export function dbClient() { const db = getSupabaseAdmin(); if (!db) throw new EarnError("temporarily_unavailable", 503); return db; }
export async function dispatch(db: SupabaseClient, action: string, wallet: string | null, data: Record<string, unknown> = {}) {
  const r = await db.rpc("earn_dispatch", { p_action: action, p_wallet: wallet, p_data: data });
  if (r.error || !r.data || typeof r.data !== "object") {
    const message = String(r.error?.message ?? "");
    if (/idempotency-conflict|job-scope-conflict/.test(message)) throw new EarnError("idempotency_conflict", 409);
    if (/ownership-challenge-required|evidence-review-required|reason-required/.test(message)) throw new EarnError("review_evidence_required", 409);
    if (/unknown-job|unknown-claim/.test(message)) throw new EarnError("not_found", 404);
    throw new EarnError("temporarily_unavailable", 503);
  }
  return r.data as Record<string, unknown>;
}
export async function rate(db: SupabaseClient, key: string, limit: number, window: number) {
  const result = await dispatch(db, "rate", null, { bucket: digest(key), limit, window });
  if (result.allowed !== true) throw new EarnError("rate_limited", 429, Math.min(600, Math.max(1, Number(result.retry_after) || 30)));
}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new EarnError("json_required", 415);
  if (Number(req.headers.get("content-length")) > 65536) throw new EarnError("body_too_large", 413);
  const reader = req.body?.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  if (!reader) throw new EarnError("invalid_body");
  try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
    if (size > 65536) { await reader.cancel(); throw new EarnError("body_too_large", 413); } chunks.push(next.value); }
    const b = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!b || Array.isArray(b) || typeof b !== "object") throw new Error(); return b;
  } catch (e) { if (e instanceof EarnError) throw e; throw new EarnError("invalid_body"); }
}
export async function walletIdentity(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new EarnError("origin_denied", 403);
  const wallet = await getSessionWallet(req); if (!wallet) throw new EarnError("authentication_required", 401); return wallet;
}
export function serviceIdentity(req: Request) {
  if (process.env.NODE_ENV === "production" && new URL(req.url).protocol !== "https:") throw new EarnError("https_required", 403);
  const config = earnConfig();
  if (!config.enabled) throw new EarnError("integration_disabled", 503);
  const secret = process.env.HEADSTAILS_WEBSITE_API_KEY ?? "";
  if (secret.length < 32) throw new EarnError("integration_not_configured", 503);
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ") || !equal(header.slice(7), secret)) throw new EarnError("authentication_required", 401);
  if (!REQUEST_ID.test(req.headers.get("x-request-id") ?? "")) throw new EarnError("invalid_request_id");
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function telegramId(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new EarnError("invalid_telegram_user_id"); return String(value);
}
export async function activeSeason(db: SupabaseClient) {
  const r = await db.from("airdrop_seasons").select("id,key,starts_at,ends_at").eq("active", true).limit(1).maybeSingle();
  if (r.error || !r.data) throw new EarnError("no_active_season", 503);
  return r.data as { id: string; key: string; starts_at?: string; ends_at?: string | null };
}
export async function seasonSettings(db: SupabaseClient, season: string) {
  const r = await db.from("earn_season_settings").select("*").eq("season_id", season).maybeSingle();
  if (r.error) throw new EarnError("verification_not_installed", 503);
  return (r.data ?? {}) as Record<string, unknown>;
}
export function xProfile(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 250) throw new EarnError("invalid_x_profile");
  let url: URL; try { url = new URL(raw); } catch { throw new EarnError("invalid_x_profile"); }
  const handle = url.pathname.replace(/^\//, "").replace(/\/$/, "").toLowerCase();
  if (url.protocol !== "https:" || !["x.com", "twitter.com"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash ||
    !/^[a-z0-9_]{1,15}$/.test(handle) || ["home", "search", "explore", "settings", "intent", "i", "share", "messages", "notifications"].includes(handle)) throw new EarnError("invalid_x_profile");
  return { handle, profileUrl: `https://x.com/${handle}` };
}
export function xPost(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  try { const u = new URL(raw); const m = u.pathname.match(/^\/([a-zA-Z0-9_]{1,15})\/status\/(\d{1,25})\/?$/);
    if (u.protocol !== "https:" || !["x.com", "twitter.com"].includes(u.hostname) || u.username || u.password || u.port || !m) return null;
    return { handle: m[1].toLowerCase(), id: m[2], url: `https://x.com/${m[1].toLowerCase()}/status/${m[2]}` };
  } catch { return null; }
}

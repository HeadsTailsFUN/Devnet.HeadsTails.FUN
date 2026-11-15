import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { earnConfig } from "./config";
import { dbClient, digest, dispatch, EarnError, equal, failure, json, nonce, TOKEN, walletIdentity, activeSeason, seasonSettings } from "./server";

const STATE_COOKIE = "ht_earn_discord_state";
const SCOPES = "identify guilds.members.read";
function oauthConfig() {
  const clientId = process.env.EARN_DISCORD_CLIENT_ID ?? "", clientSecret = process.env.EARN_DISCORD_CLIENT_SECRET ?? "";
  let redirect: URL; try { redirect = new URL(process.env.EARN_DISCORD_REDIRECT_URI ?? ""); } catch { throw new EarnError("discord_not_configured", 503); }
  if (!/^\d{16,22}$/.test(clientId) || !clientSecret || redirect.username || redirect.password || redirect.search || redirect.hash ||
    redirect.pathname !== "/api/earn/discord/callback" || (redirect.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(redirect.hostname)))) throw new EarnError("discord_not_configured", 503);
  return { clientId, clientSecret, redirect: redirect.href, origin: redirect.origin };
}
export async function beginDiscord(_req: Request, db: SupabaseClient, wallet: string) {
  const config = oauthConfig(), state = nonce();
  const result = await dispatch(db, "token", wallet, { provider: "discord", digest: digest(state) });
  if (result.status !== "created") throw new EarnError("discord_unavailable", 503);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirect, response_type: "code", scope: SCOPES, state, prompt: "consent" }).toString();
  const response = json({ wallet, authorizeUrl: url.href });
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: new URL(config.redirect).protocol === "https:", sameSite: "lax", path: "/api/earn/discord", maxAge: 600 });
  return response;
}
export function discordMembership(status: number, body: unknown, expectedId: string): "VERIFIED" | "NOT_MEMBER" | "PENDING" | "UNAVAILABLE" {
  if (status === 404) return "NOT_MEMBER";
  if (status === 429) return "PENDING";
  if (status !== 200 || !body || typeof body !== "object") return "UNAVAILABLE";
  const member = body as { user?: { id?: string }; pending?: boolean; joined_at?: unknown };
  if (member.user?.id !== expectedId || typeof member.joined_at !== "string") return "UNAVAILABLE";
  if (member.pending === true) return "PENDING";
  // Optional/missing screening metadata is unknown, never assumed complete.
  return member.pending === false ? "VERIFIED" : "UNAVAILABLE";
}
async function discordFetch(url: string, init: RequestInit) {
  return fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(8000), cache: "no-store" });
}
async function bodyJSON(response: Response) {
  const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  if (!reader) throw new EarnError("discord_invalid_response", 503);
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > 1024 * 1024) { await reader.cancel(); throw new EarnError("discord_invalid_response", 503); }
    chunks.push(next.value);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new EarnError("discord_invalid_response", 503); }
}
export async function discordCallback(req: Request) {
  let origin: string | null = null, access: string | null = null;
  let config: ReturnType<typeof oauthConfig> | null = null;
  const finish = (notice: string) => {
    const response = NextResponse.redirect(`${origin}/?earn=1&earn_notice=${notice}`, 303);
    response.cookies.set(STATE_COOKIE, "", { path: "/api/earn/discord", maxAge: 0, httpOnly: true, secure: origin?.startsWith("https:") ?? true, sameSite: "lax" });
    response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer"); return response;
  };
  try {
    config = oauthConfig(); origin = config.origin;
    if (new URL(req.url).origin !== origin) throw new EarnError("invalid_callback_origin", 403);
    const c = earnConfig(); if (!c.discord || !c.discordGuild) throw new EarnError("discord_unavailable", 503);
    const wallet = await walletIdentity(req), db = dbClient(), season = await activeSeason(db), settings = await seasonSettings(db, season.id);
    if (settings.discord_enabled !== true) throw new EarnError("discord_unavailable", 503);
    const url = new URL(req.url), state = url.searchParams.get("state") ?? "";
    const cookie = req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) ?? "";
    if (!TOKEN.test(state) || !TOKEN.test(cookie) || !equal(state, cookie) || (url.searchParams.has("iss") && url.searchParams.get("iss") !== "https://discord.com")) throw new EarnError("invalid_oauth_state", 403);
    const consumed = await dispatch(db, "discord_consume", wallet, { digest: digest(state) });
    if (consumed.status !== "consumed") throw new EarnError("expired_oauth_state", 403);
    if (url.searchParams.has("error")) return finish("discord_denied");
    const code = url.searchParams.get("code"); if (!code || code.length > 512) throw new EarnError("invalid_oauth_code");
    const exchange = await discordFetch("https://discord.com/api/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: config.redirect }) });
    if (exchange.status === 429) return finish("discord_rate_limited");
    if (!exchange.ok) return finish("discord_unavailable");
    const token = await bodyJSON(exchange);
    // Discard/revoke issued credentials even when the granted scope is insufficient.
    if (typeof token.access_token === "string") access = token.access_token;
    if (typeof token.access_token !== "string" || token.token_type?.toString().toLowerCase() !== "bearer" || !SCOPES.split(" ").every(scope => String(token.scope).split(" ").includes(scope))) throw new EarnError("invalid_discord_token", 503);
    const headers = { Authorization: `Bearer ${access}` };
    const meResponse = await discordFetch("https://discord.com/api/v10/users/@me", { headers });
    if (!meResponse.ok) return finish("discord_unavailable");
    const me = await bodyJSON(meResponse), id = me.id;
    if (typeof id !== "string" || !/^\d{16,22}$/.test(id) || me.bot === true) throw new EarnError("invalid_discord_identity", 503);
    const memberResponse = await discordFetch(`https://discord.com/api/v10/users/@me/guilds/${c.discordGuild}/member`, { headers });
    const member = memberResponse.ok ? await bodyJSON(memberResponse) : null;
    const membership = discordMembership(memberResponse.status, member, id);
    const linked = await dispatch(db, "discord_link", wallet, { external_id: id, membership, award: c.rewards });
    if (!["linked", "conflict"].includes(String(linked.status))) return finish("discord_unavailable");
    return finish(linked.status === "conflict" ? "discord_conflict" : membership === "VERIFIED" ? "discord_verified" : membership === "NOT_MEMBER" ? "discord_not_member" : membership === "PENDING" ? "discord_pending" : "discord_unavailable");
  } catch (error) {
    return origin ? finish(error instanceof EarnError && error.code.includes("state") ? "discord_invalid_state" : "discord_unavailable") : failure(error);
  } finally {
    // No OAuth credential is stored in the database, browser bundle or report.
    if (access && config) {
      try { await discordFetch("https://discord.com/api/oauth2/token/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, token: access, token_type_hint: "access_token" }) }); } catch { /* token discarded; user can revoke app authorization in Discord */ }
    }
  }
}

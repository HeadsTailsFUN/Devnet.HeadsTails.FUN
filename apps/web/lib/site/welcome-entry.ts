import { NextResponse, type NextRequest } from "next/server";

export const WELCOME_COOKIE = "ht_welcome_seen";
const privateCache = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** No raw IP, wallet identity, user agent or geographic data leaves this module. */
export function normalizeWelcomeIp(raw: string | null): string | null {
  if (!raw || raw.length > 80 || raw.includes(",")) return null;
  const value = raw.trim();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    const octets = value.split(".");
    return octets.every(n => Number(n) <= 255 && String(Number(n)) === n) ? octets.join(".") : null;
  }
  if (!/^[a-f\d:]+$/i.test(value) || !value.includes(":")) return null;
  try { return new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase(); } catch { return null; }
}

export async function welcomeIpDigest(ip: string, secret: string, hostname = "headstails.fun"): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = await crypto.subtle.sign("HMAC", key, encoder.encode(`headstails-welcome:v1:${hostname.toLowerCase().replace(/\.$/, "")}:${ip}`));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

/** Atomic first-visit claim; bounded and fail-open so marketing cannot block gameplay. */
export async function requestWelcomeDigest(headers: Headers, hostname = "headstails.fun"): Promise<string | null> {
  // Forwarded headers are trusted only on the actual Vercel deployment, never on a self-hosted origin.
  if (process.env.VERCEL !== "1") return null;
  const ip = normalizeWelcomeIp(headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for"));
  const secret = process.env.WELCOME_IP_HASH_SECRET;
  if (!ip) { console.warn("welcome_entry_unavailable: ingress_ip_missing_or_invalid"); return null; }
  if (!secret || secret.length < 32) { console.warn("welcome_entry_unavailable: preference_key_not_configured"); return null; }
  try { return await welcomeIpDigest(ip, secret, hostname); } catch { return null; }
}

export async function claimWelcomeIp(headers: Headers, fetcher: typeof fetch = fetch, digest?: string): Promise<boolean | null> {
  const currentDigest = digest ?? await requestWelcomeDigest(headers);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!currentDigest) return null;
  if (!base || !service) { console.warn("welcome_entry_unavailable: storage_not_configured"); return null; }
  try {
    const url = new URL("/rest/v1/rpc/claim_site_welcome_visit", base);
    if (url.protocol !== "https:") return null;
    const response = await fetcher(url, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(1200),
      headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_ip_digest: currentDigest }),
    });
    if (!response.ok) { console.warn(`welcome_entry_unavailable: storage_status_${response.status}`); return null; }
    const result: unknown = await response.json();
    return typeof result === "boolean" ? result : null;
  } catch { console.warn("welcome_entry_unavailable: storage_transport_failure"); return null; }
}

function remember(response: NextResponse, req: NextRequest, digest: string | null): NextResponse {
  response.cookies.set(WELCOME_COOKIE, digest ?? "1", { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 });
  return response;
}

export async function welcomeEntry(req: NextRequest): Promise<NextResponse> {
  const next = () => NextResponse.next({ headers: privateCache });
  if (process.env.WELCOME_ENABLED === "false" || !["GET", "HEAD"].includes(req.method)) return next();
  // Prefetch / RSC navigation and old deep links must stay in the app.
  // This preference is never an authentication or authorization check.
  const returnToGame = req.nextUrl.pathname === "/" && (
    ["ref", "earn", "earn_notice", "tab", "info", "data", "nonce", "code", "state", "signature", "session", "phantom_encryption_public_key", "solflare_encryption_public_key", "errorCode", "errorMessage"].some(key => req.nextUrl.searchParams.has(key)) ||
    req.headers.has("rsc") || req.headers.has("next-router-prefetch") || req.headers.get("purpose") === "prefetch"
  );
  if (returnToGame) return next();
  if (req.method === "HEAD") return next(); // Probes must not consume a person's first visit.
  const digest = await requestWelcomeDigest(req.headers, req.nextUrl.hostname);
  const cookie = req.cookies.get(WELCOME_COOKIE)?.value;
  // A browser preference only skips the lookup for THIS IP and origin, not a new network.
  if (digest && cookie === digest) return next();
  if (process.env.VERCEL !== "1" && cookie === "1") return next();

  const firstVisit = await claimWelcomeIp(req.headers, fetch, digest ?? undefined);
  // A direct /welcome visit also counts as the first visit; Launch App never loops back.
  if (req.nextUrl.pathname === "/welcome") return remember(next(), req, digest);
  if (firstVisit === false) return remember(next(), req, digest);
  // Missing service configuration uses a browser preference. A configured service failure
  // always admits the user to the game rather than making gameplay depend on marketing.
  if (firstVisit === null && process.env.VERCEL === "1") return remember(next(), req, digest);
  const target = req.nextUrl.clone(); target.pathname = "/welcome";
  return remember(NextResponse.redirect(target, { status: 307, headers: privateCache }), req, digest);
}

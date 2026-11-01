import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
import { sanitizeText, validateBugInput } from "@/lib/bugs/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hits = new Map<string, { n: number; at: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.at > 60_000) {
    hits.set(key, { n: 1, at: now });
    return false;
  }
  h.n += 1;
  return h.n > 5;
}

/** Authenticated bug submit (user severity; admin severity authoritative). */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "authentication required" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(`bug:${ip}:${wallet}`)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const checked = validateBugInput(body);
  if (!checked.ok) return NextResponse.json({ error: checked.reason }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const b = (body ?? {}) as Record<string, unknown>;
  const pagePath = sanitizeText(b.page_path ?? b.pagePath ?? "", 200).slice(0, 200) || null;
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
  const telegram = checked.input.telegram ? `@${checked.input.telegram}` : null;

  const { data, error } = await db
    .from("bug_reports")
    .insert({
      wallet,
      telegram_handle: telegram,
      description: checked.input.description,
      steps_to_reproduce: checked.input.steps,
      reported_severity: checked.input.severity,
      status: "new",
      page_path: pagePath,
      user_agent_summary: ua,
    })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "could not save report" }, { status: 503 });
  try {
    await db.from("bug_bounties").insert({ report_id: (data as { id: string }).id });
  } catch {
    // bounty row best-effort
  }
  return NextResponse.json({ status: "submitted", id: (data as { id: string }).id });
}

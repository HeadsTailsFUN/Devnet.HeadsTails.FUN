import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionWallet } from "@/lib/auth/session";
import { validateBody } from "@/lib/chat/validate";
import { maskProfanity } from "@/lib/chat/moderation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Wallet ownership precedes service-only atomic admission and insertion. */
export async function POST(req: Request): Promise<NextResponse> {
  const wallet = await getSessionWallet(req);
  if (!wallet)
    return NextResponse.json(
      { error: "connect and verify your wallet to chat" },
      { status: 401 },
    );
  const body = (await req.json().catch(() => null)) as {
      body?: unknown;
      clientId?: unknown;
    } | null,
    checked = validateBody(body?.body);
  if (!checked.ok)
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  if (
    typeof body?.clientId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.clientId,
    )
  )
    return NextResponse.json(
      { error: "invalid message identity" },
      { status: 400 },
    );
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("send_chat_message_atomic", {
    p_wallet: wallet,
    p_body: maskProfanity(checked.body),
    p_client_id: body.clientId,
  });
  if (error || !data)
    return NextResponse.json(
      { error: "could not send; retry safely" },
      { status: 503 },
    );
  if (data.status === "cooldown") {
    const retryAfterMs = Math.max(1, Math.ceil(Number(data.retryAfterMs)));
    return NextResponse.json(
      { error: "Take a short breath, then send again.", retryAfterMs },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      },
    );
  }
  if (data.status !== "sent")
    return NextResponse.json(
      {
        error:
          data.status === "disabled"
            ? "chat is temporarily disabled"
            : "you cannot post right now",
      },
      { status: data.status === "disabled" ? 503 : 403 },
    );
  return NextResponse.json({
    message: data.message,
    cooldownMs: data.cooldownMs ?? 0,
    reused: data.reused ?? false,
  });
}

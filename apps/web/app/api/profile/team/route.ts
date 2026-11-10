import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { IS_DEVNET } from "@/lib/solana/cluster";
import { resolveServerRpcUrl } from "@/lib/solana/rpc";
import { getSessionWallet } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/solana/sponsorServer";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const wallet = await getSessionWallet(req);
  if (!wallet)
    return NextResponse.json(
      { error: "Verify wallet ownership" },
      { status: 401 },
    );
  const requestedWallet = new URL(req.url).searchParams.get("wallet");
  if (requestedWallet && requestedWallet !== wallet)
    return NextResponse.json(
      { error: "Verified wallet changed; verify again" },
      { status: 403 },
    );
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { data, error } = await db
    .from("profiles")
    .select("team_preference,team_prompt_completed")
    .eq("wallet", wallet)
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  return NextResponse.json(
    {
      team: data?.team_preference ?? null,
      completed: data?.team_prompt_completed ?? false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request) {
  const wallet = await getSessionWallet(req);
  if (!wallet)
    return NextResponse.json(
      { error: "Verify wallet ownership" },
      { status: 401 },
    );
  const body = await req.json().catch(() => null);
  if (body?.wallet !== undefined && body.wallet !== wallet)
    return NextResponse.json(
      { error: "Verified wallet changed; verify again" },
      { status: 403 },
    );
  if (
    !body ||
    !Object.hasOwn(body, "team") ||
    ![null, "HEADS", "TAILS"].includes(body.team)
  )
    return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  if (IS_DEVNET) {
    const rpc = resolveServerRpcUrl();
    if (rpc.missing) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
    // The browser cannot choose the cutoff. A later preference only
    // affects matches created after this observed Solana slot.
    const afterSlot = await new Connection(rpc.url).getSlot("processed").catch(() => null);
    if (!afterSlot) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
    const { data, error } = await db.rpc("save_devnet_community_team", {
      p_wallet: wallet,
      p_team: body.team,
      p_after_slot: afterSlot,
    });
    return !error && data === true
      ? NextResponse.json({ team: body.team, completed: true })
      : NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
  // A wallet-keyed upsert updates only preference columns; avatar/name survive.
  const { error } = await db
    .from("profiles")
    .upsert(
      { wallet, team_preference: body.team, team_prompt_completed: true },
      { onConflict: "wallet" },
    );
  return error
    ? NextResponse.json({ error: "Unavailable" }, { status: 503 })
    : NextResponse.json({ team: body.team, completed: true });
}

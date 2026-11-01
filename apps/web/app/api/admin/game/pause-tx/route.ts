import { NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import { gameIdlJson, type HeadsOrTails } from "@heads-or-tails/game-sdk";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";
import { getServerConnection } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build an UNSIGNED set_paused transaction for the on-chain authority to
 * sign client-side via Wallet Standard. The authority private key is never
 * stored server-side. Response: { transactionBase64, admin, config }.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, true);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "malformed request" }, { status: 400 });
  }
  const paused = (body as { paused?: unknown } | null)?.paused;
  if (typeof paused !== "boolean") {
    return NextResponse.json({ error: "paused must be boolean" }, { status: 400 });
  }
  const { connection, reason } = getServerConnection();
  const db = adminDb();
  if (!connection || !db) {
    return NextResponse.json({ error: reason ?? "unavailable" }, { status: 503 });
  }
  try {
    const programId = new PublicKey(
      process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
    );
    const provider = new AnchorProvider(
      connection,
      { publicKey: new PublicKey(staff.wallet as string) } as Wallet,
      { commitment: "confirmed" }
    );
    const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("hts-config")], programId);
    const tx: Transaction = await program.methods
      .setHtsPaused(paused)
      .accountsPartial({ admin: new PublicKey(staff.wallet as string), authority: new PublicKey(staff.wallet as string), config, legacyConfig: PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0] })
      .transaction();
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = new PublicKey(staff.wallet as string);
    tx.recentBlockhash = blockhash;
    await audit(
      db,
      staff.wallet as string,
      paused ? "game.pause_built" : "game.resume_built",
      null,
      sanitizeMetadata({})
    );
    return NextResponse.json({
      status: "ok",
      transactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"),
      admin: staff.wallet,
      config: config.toBase58(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 160) : "unavailable" },
      { status: 503 }
    );
  }
}

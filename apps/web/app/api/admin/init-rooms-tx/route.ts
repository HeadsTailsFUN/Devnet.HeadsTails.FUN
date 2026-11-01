import { NextResponse } from "next/server";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import type { Wallet } from "@coral-xyz/anchor";
import { gameIdlJson, type HeadsOrTails } from "@heads-or-tails/game-sdk";
import { adminDb, audit, checkStaff, sanitizeMetadata } from "@/lib/admin/auth";
import { getServerConnection } from "@/lib/solana/sponsorServer";
import {
  assertInitRoomExact,
  buildInitRoomInstruction,
  roomPdaFor,
  type InitRoomSpec,
} from "@/lib/solana/roomsInit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROGRAM_ID = new PublicKey("AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");

/**
 * Build the UNSIGNED room-init transaction for the game owner to sign once
 * client-side via Wallet Standard. Combines init_room(1) + init_room(10) in
 * ONE transaction when both are missing; builds only genuinely missing
 * operations otherwise. Owner key never stored server-side.
 *
 * Fail-closed: owner-only caller, live config authority match, supported
 * tiers only, skip existing rooms, exact per-instruction shape validation,
 * plus a real Devnet simulation (sigVerify:false) before returning.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, true);
  if (!staff.ok) {
    return NextResponse.json({ error: staff.error ?? "denied" }, { status: staff.status ?? 403 });
  }
  const { connection, reason } = getServerConnection();
  const db = adminDb();
  if (!connection || !db) {
    return NextResponse.json({ error: reason ?? "unavailable" }, { status: 503 });
  }
  try {
    const provider = new AnchorProvider(
      connection,
      { publicKey: new PublicKey(staff.wallet as string) } as Wallet,
      { commitment: "confirmed" }
    );
    const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
    const [config] = PublicKey.findProgramAddressSync([Buffer.from("hts-config")], PROGRAM_ID);
    const cfg = await program.account.gameConfig.fetch(config).catch(() => null);
    if (!cfg) return NextResponse.json({ error: "game config unreadable" }, { status: 503 });
    const authority = (cfg.authority as PublicKey).toBase58();
    if (authority !== staff.wallet) {
      return NextResponse.json(
        { error: `config authority ${authority} != session wallet; STOP` },
        { status: 403 }
      );
    }

    const specs: InitRoomSpec[] = [];
    for (const tierUsd of [1, 10]) {
      const room = roomPdaFor(PROGRAM_ID, tierUsd);
      const existing = await connection.getAccountInfo(room, "confirmed");
      if (existing) continue; // never re-initialize
      specs.push({ tierUsd, active: true });
    }
    if (specs.length === 0) {
      return NextResponse.json({ status: "already-live", rooms: [] });
    }

    const admin = new PublicKey(staff.wallet as string);
    const ixs = specs.map((spec) =>
      buildInitRoomInstruction(PROGRAM_ID, admin, config, spec)
    );
    ixs.forEach((ix, i) => {
      const err = assertInitRoomExact(ix, PROGRAM_ID, admin, config, specs[i]);
      if (err) throw new Error(`built instruction invalid: ${err}`);
    });
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: admin, recentBlockhash: blockhash });
    tx.add(...ixs);

    let simulation: { ok: boolean; unitsConsumed: number | null; logsTail: string[]; error: string | null };
    try {
      const vtx = new VersionedTransaction(tx.compileMessage());
      const sim = await connection.simulateTransaction(vtx, {
        sigVerify: false,
        commitment: "confirmed",
        replaceRecentBlockhash: true,
        innerInstructions: true,
      });
      const errStr = sim.value.err ? JSON.stringify(sim.value.err) : null;
      simulation = {
        ok: sim.value.err === null,
        unitsConsumed: sim.value.unitsConsumed ?? null,
        logsTail: (sim.value.logs ?? []).slice(-8),
        error: errStr,
      };
    } catch (e) {
      simulation = {
        ok: false,
        unitsConsumed: null,
        logsTail: [],
        error: e instanceof Error ? e.message.slice(0, 200) : "simulation unavailable",
      };
    }
    if (!simulation.ok) {
      return NextResponse.json(
        { error: `Room init simulation failed pre-sign: ${simulation.error ?? "unknown"}; STOP.`, simulation },
        { status: 409 }
      );
    }

    await audit(db, staff.wallet as string, "rooms.init_built", null, sanitizeMetadata({}));
    return NextResponse.json({
      status: "ok",
      transactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"),
      rooms: specs.map((s) => ({
        tierUsd: s.tierUsd,
        active: s.active,
        address: roomPdaFor(PROGRAM_ID, s.tierUsd).toBase58(),
      })),
      simulation,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message.slice(0, 160) : "unavailable" },
      { status: 503 }
    );
  }
}

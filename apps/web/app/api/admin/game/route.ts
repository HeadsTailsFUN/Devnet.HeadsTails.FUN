import { NextResponse } from "next/server";
import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { gameIdlJson, type HeadsOrTails } from "@heads-or-tails/game-sdk";
import { checkStaff } from "@/lib/admin/auth";
import { getServerConnection } from "@/lib/solana/sponsorServer";
import type { GameDiagnosticCode } from "@/lib/admin/gameDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(
  status: number,
  error: string,
  diagnostic: GameDiagnosticCode
): NextResponse {
  // Safe payload only: HTTP status + generic error + machine-readable enum.
  // Never RPC credentials, secret env values, stack traces, or private
  // material (callers must not echo raw exception messages: RPC endpoint
  // URLs can carry embedded API keys).
  return NextResponse.json({ error, diagnostic }, { status });
}

/**
 * On-chain game state for the admin Game panel (read-only mirror).
 *
 * HT-FINAL-004: the observed infinite `Loading…` was the UI swallowing a
 * failed request (only rendering on a valid `paused` boolean, no terminal
 * error state). The UI now surfaces failures as `Could not load on-chain
 * game state.` + Retry instead of hanging. No UI-only masking: this route
 * still fails closed with the real status.
 *
 * HT-OBS micro-fix: every failure also carries a safe `diagnostic`
 * (`GAME_*`) so the Admin UI can render `Diagnostic: <code>` beneath the
 * friendly message. Fail-closed behavior is unchanged.
 *
 * BUGFIX (live GAME_PROGRAM_MISMATCH): this route used to hand-roll a raw
 * coder decode of the GameConfig bytes, which throws on the REAL deployed
 * account bytes even though the program ID, discriminator, and struct
 * layout all match (verified against live Devnet bytes). The SDK's
 * canonical gameConfig account fetch — the same path the working game UI
 * uses via `GameClient.fetchConfig` — decodes the identical bytes
 * correctly. This route now reuses that canonical fetcher instead of
 * duplicating decoding logic. Read-only; program, authority, and config
 * are untouched.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const staff = await checkStaff(req, false);
  if (!staff.ok) {
    const status = staff.status ?? 403;
    return fail(
      status,
      staff.error ?? "denied",
      status === 401 ? "GAME_AUTH_REQUIRED" : "GAME_FORBIDDEN"
    );
  }
  const { connection, reason } = getServerConnection();
  if (!connection) {
    return fail(503, reason ?? "unavailable", "GAME_RPC_CONFIG_MISSING");
  }
  let programId: PublicKey;
  try {
    programId = new PublicKey(
      process.env.HEADS_TAILS_PROGRAM_ID ?? "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k"
    );
  } catch {
    return fail(503, "unavailable", "GAME_UNKNOWN_ERROR");
  }
  // Canonical SDK read path (same decoder the live game UI uses).
  const provider = new AnchorProvider(
    connection,
    { publicKey: Keypair.generate().publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  const program = new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("hts-config")], programId);
  let cfg: Awaited<ReturnType<typeof program.account.gameConfig.fetch>>;
  try {
    cfg = await program.account.gameConfig.fetch(config);
  } catch {
    // Classify without leaking internals: missing account vs undecodable
    // bytes vs RPC failure. One extra read, failure path only.
    const probe = await connection.getAccountInfo(config).catch(() => undefined);
    if (probe === null) return fail(503, "config missing", "GAME_CONFIG_UNREADABLE");
    if (probe === undefined) return fail(503, "unavailable", "GAME_RPC_UNAVAILABLE");
    return fail(503, "unavailable", "GAME_PROGRAM_MISMATCH");
  }
  const str = (v: unknown): string => (v as { toString(): string }).toString();
  return NextResponse.json({
    authority: cfg.authority.toBase58(),
    paused: Boolean(cfg.paused),
    tier1Active: Boolean(cfg.tier1Active),
    headsHead: str(cfg.headsHead),
    headsNext: str(cfg.headsNext),
    tailsHead: str(cfg.tailsHead),
    tailsNext: str(cfg.tailsNext),
    totalMatches: str(cfg.totalMatches),
  });
}

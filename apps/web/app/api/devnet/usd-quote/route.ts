import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { referenceQuote } from "@heads-or-tails/game-sdk";
import { assertDevnetConnection, DEVNET_PROGRAM_ID } from "@/lib/solana/devnetSafety";
import { getServerConnection } from "@/lib/solana/sponsorServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** No quote is served until the exact USD-corrected executable has been verified. */
export async function GET(): Promise<NextResponse> {
  const { connection } = getServerConnection();
  const digest = process.env.HEADSTAILS_USD_PROGRAM_SHA256 ?? "";
  const bytes = Number(process.env.HEADSTAILS_USD_PROGRAM_BYTES);
  if (!connection || !/^[a-f0-9]{64}$/.test(digest) || !Number.isSafeInteger(bytes) || bytes < 100_000 || bytes > 2_000_000) {
    return NextResponse.json({ error: "Devnet Test Rate unavailable" }, { status: 503 });
  }
  try {
    await assertDevnetConnection(connection);
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programId = new PublicKey(DEVNET_PROGRAM_ID);
    const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], loader);
    const [program, data] = await connection.getMultipleAccountsInfo([programId, programData], "confirmed");
    if (!program?.executable || !program.owner.equals(loader) || !data?.owner.equals(loader) ||
        data.data.length < 45 + bytes || data.data.readUInt32LE(0) !== 3 ||
        data.data[12] !== 1 || new PublicKey(data.data.subarray(13,45)).toBase58() !== "5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW" ||
        createHash("sha256").update(data.data.subarray(45,45+bytes)).digest("hex") !== digest ||
        data.data.subarray(45+bytes).some(b => b !== 0)) throw new Error("Executable mismatch");
    return NextResponse.json(referenceQuote(process.env.NEXT_PUBLIC_HTS_TOKEN_MINT!, Date.now()),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Devnet Test Rate unavailable" }, { status: 503 });
  }
}

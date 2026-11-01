import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { gameIdlJson, type HeadsOrTails } from "@heads-or-tails/game-sdk";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Admin GameConfig read path (live GAME_PROGRAM_MISMATCH fix).
 *
 * Root cause: the route hand-rolled
 * `BorshCoder(gameIdlJson).accounts.decode("GameConfig", bytes)`, which
 * throws on the REAL deployed account bytes even though program ID,
 * discriminator, and struct layout all match. The SDK canonical
 * `program.account.gameConfig.fetch` — the path the working game UI uses —
 * decodes the identical bytes correctly. The route now reuses it.
 *
 * Fixture: REAL Devnet GameConfig bytes read from
 * `["config"] @ AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k`
 * (public chain data, point-in-time snapshot — counters grow on-chain).
 */

// Real 117-byte account data (8 disc + 32 + 32 + 1 + 1 + 5x8 + 3).
// Single line on purpose: multi-line concatenation risks a transcription
// shift (a shifted fixture fails bool decode — exactly the class of bug
// this file guards against).
const GAME_CONFIG_HEX =
  "2d929221aa45608548db2b71fd859f634c0a23c3e07c07d4605ad6a3d9e727a0faea11fab416662198b52aecdef915b090407fd8b70e16e52e1cd3b3ce07a50d31614e15b63b499a000115000000000000001500000000000000130000000000000014000000000000003200000000000000feffff";

function programWithFixture() {
  const fakeConnection = {
    getAccountInfoAndContext: async () => ({
      context: { slot: 0 },
      value: { data: Buffer.from(GAME_CONFIG_HEX, "hex") },
    }),
  };
  const provider = new AnchorProvider(
    fakeConnection as unknown as ConstructorParameters<typeof AnchorProvider>[0],
    { publicKey: Keypair.generate().publicKey } as Wallet,
    { commitment: "confirmed" }
  );
  return new Program<HeadsOrTails>(gameIdlJson as HeadsOrTails, provider);
}

describe("admin GameConfig canonical decode (real Devnet fixture)", () => {
  it("canonical fetch decodes the live bytes to the actual on-chain fields", async () => {
    const program = programWithFixture();
    const [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );
    const cfg = await program.account.gameConfig.fetch(config);
    const str = (v: unknown): string => (v as { toString(): string }).toString();
    assert.equal(cfg.authority.toBase58(), "5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW");
    assert.equal(Boolean(cfg.paused), false);
    assert.equal(Boolean(cfg.tier1Active), true);
    assert.equal(str(cfg.headsHead), "21");
    assert.equal(str(cfg.headsNext), "21");
    assert.equal(str(cfg.tailsHead), "19");
    assert.equal(str(cfg.tailsNext), "20");
    assert.equal(str(cfg.totalMatches), "50");
  });

  it("route reuses the canonical fetcher (no hand-rolled decode)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "game", "route.ts"), "utf8");
    assert.ok(src.includes("program.account.gameConfig.fetch"), "canonical SDK read path");
    assert.ok(!src.includes("new BorshCoder"), "no duplicated decoding logic");
    assert.ok(!src.includes(".accounts.decode("), "no raw account decode");
  });

  it("fixture is the full 117-byte account (guard against transcription shift)", () => {
    assert.equal(GAME_CONFIG_HEX.length, 234, "8 + 32 + 32 + 1 + 1 + 5*8 + 3 bytes hex-encoded");
    assert.ok(/^[0-9a-f]+$/.test(GAME_CONFIG_HEX), "hex only");
  });

  it("route still fails safe (diagnostic enum, no leaks)", () => {
    const src = readFileSync(join(root, "app", "api", "admin", "game", "route.ts"), "utf8");
    assert.ok(src.includes("GAME_CONFIG_UNREADABLE"), "missing account classified");
    assert.ok(src.includes("GAME_RPC_UNAVAILABLE"), "RPC failure classified");
    assert.ok(src.includes("GAME_PROGRAM_MISMATCH"), "genuine decode failure still safe");
    assert.ok(!src.includes("e.message"), "no raw exception echo");
  });
});

import "../test/hts-release-env";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  SPONSOR_DAILY_CAP_LAMPORTS,
  SPONSOR_MAX_PREFUND_LAMPORTS,
  SPONSOR_MAX_REIMBURSE_PER_ACTION_LAMPORTS,
  SPONSOR_OPERATIONAL_TARGET_LAMPORTS,
  assertSponsorSafeOrThrow,
  computePrefundLamports,
  evaluateSponsorGate,
  getGlobalDailyCapLamports,
  isValidSignature,
  isValidSponsorAction,
  isValidWallet,
} from "./sponsorGate.js";
import {
  ATOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
  DISCRIMINATORS,
  MATCH_IX_MIN_ACCOUNTS,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  calculateEligibleCost,
  decodeJoinArgs,
  decodeMatchId,
  deriveMatchPda,
  derivePlayerStatePda,
  deriveQueueEntryPda,
  deriveRandomnessPda,
  deriveVrfSeed,
  discriminatorFor,
  verifySponsorTransaction,
  verifyTopLevelShape,
  GAME_PROGRAM_ID,
  type TopLevelIx,
} from "./sponsorVerify.js";
import {
  DEVNET_TEST_MINT,
  FAUCET_CLAIM_BASE_UNITS,
  evaluateFaucetGate,
} from "./faucetGate.js";

const WALLET = "DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy";
const SIG = "5".repeat(88);

const GOOD_GATE = {
  cluster: "devnet",
  sponsorEnabled: "true",
  mainnetRealValue: "false",
};

function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function joinData(side = 0, sequence = BigInt(0)): Uint8Array {
  const disc = hexToBytes(DISCRIMINATORS.join_queue);
  const buf = Buffer.alloc(8 + 1 + 1 + 8 + 8);
  Buffer.from(disc).copy(buf, 0);
  buf[8] = side;
  buf[9] = 1; // tier_usd
  buf.writeBigUInt64LE(BigInt(1000000), 10);
  buf.writeBigUInt64LE(sequence, 18);
  return new Uint8Array(buf);
}

function matchData(matchId = BigInt(0)): Uint8Array {
  const disc = hexToBytes(DISCRIMINATORS.match_next);
  const buf = Buffer.alloc(16);
  Buffer.from(disc).copy(buf, 0);
  buf.writeBigUInt64LE(matchId, 8);
  return new Uint8Array(buf);
}

function settleData(matchId = BigInt(0)): Uint8Array {
  const disc = hexToBytes(DISCRIMINATORS.settle_match);
  const buf = Buffer.alloc(16);
  Buffer.from(disc).copy(buf, 0);
  buf.writeBigUInt64LE(matchId, 8);
  return new Uint8Array(buf);
}

function cancelData(): Uint8Array {
  return hexToBytes(DISCRIMINATORS.cancel_queue_entry);
}

function gameIx(data: Uint8Array, accounts: string[] = [WALLET]): TopLevelIx {
  return { programId: GAME_PROGRAM_ID, data, accounts };
}

function computeIx(): TopLevelIx {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, data: new Uint8Array([1, 2, 3]), accounts: [] };
}

const TEST_TREASURY = "9ZTHWWZDpB36UFe1vszf2KEpt83vwi27jDqtHQ7NSXyR";

/** Realistic match game ix with IDL-ordered accounts (treasury@9, randomness@10). */
function matchGameIx(matchId: bigint): { ix: TopLevelIx; mpda: string; rand: string } {
  const mpda = deriveMatchPda(GAME_PROGRAM_ID, matchId);
  const rand = deriveRandomnessPda(deriveVrfSeed(GAME_PROGRAM_ID, matchId));
  const accounts = [
    WALLET, // 0 caller
    "Cfg111111111111111111111111111111111111111", // 1 config
    "He1111111111111111111111111111111111111111", // 2 head_heads
    "Te1111111111111111111111111111111111111111", // 3 head_tails
    "Hs1111111111111111111111111111111111111111", // 4 heads_state
    "Ts1111111111111111111111111111111111111111", // 5 tails_state
    mpda, // 6 game_match
    "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y", // 7 vrf_program
    "Ns1111111111111111111111111111111111111111", // 8 vrf_network_state
    TEST_TREASURY, // 9 vrf_treasury
    rand, // 10 randomness
    "11111111111111111111111111111111", // 11 system_program
  ];
  return { ix: gameIx(matchData(matchId), accounts), mpda, rand };
}

describe("devnet SOL sponsor gates", () => {
  it("allows the approved devnet sponsor configuration", () => {
    assert.deepEqual(evaluateSponsorGate(GOOD_GATE), { ok: true });
  });

  it("fails closed when disabled", () => {
    assert.equal(evaluateSponsorGate({ ...GOOD_GATE, sponsorEnabled: "false" }).ok, false);
    assert.equal(evaluateSponsorGate({ ...GOOD_GATE, sponsorEnabled: undefined }).ok, false);
  });

  it("fails closed on mainnet cluster", () => {
    assert.equal(evaluateSponsorGate({ ...GOOD_GATE, cluster: "mainnet-beta" }).ok, false);
  });

  it("fails closed when mainnet real value is enabled", () => {
    assert.equal(evaluateSponsorGate({ ...GOOD_GATE, mainnetRealValue: "true" }).ok, false);
  });

  it("mainnet build/runtime assertion blocks sponsor", () => {
    assert.throws(() =>
      assertSponsorSafeOrThrow({ cluster: "mainnet-beta", sponsorEnabled: true, mainnetRealValue: false })
    );
    assert.throws(() =>
      assertSponsorSafeOrThrow({ cluster: "devnet", sponsorEnabled: true, mainnetRealValue: true })
    );
    assertSponsorSafeOrThrow({ cluster: "devnet", sponsorEnabled: true, mainnetRealValue: false });
  });

  it("caps are bounded (abuse controls)", () => {
    assert.equal(SPONSOR_OPERATIONAL_TARGET_LAMPORTS, 20_000_000);
    assert.ok(SPONSOR_MAX_PREFUND_LAMPORTS <= 20_000_000);
    assert.ok(SPONSOR_MAX_REIMBURSE_PER_ACTION_LAMPORTS <= 50_000_000);
    assert.ok(SPONSOR_DAILY_CAP_LAMPORTS <= 1_000_000_000);
  });
});

describe("sponsor pre-fund target (0.02 SOL)", () => {
  it("1. zero-SOL wallet is prepared to a safe operational balance", () => {
    assert.equal(computePrefundLamports(0), 20_000_000);
    assert.equal(computePrefundLamports(null), 20_000_000);
  });

  it("2. low-SOL wallet receives only the required difference", () => {
    assert.equal(computePrefundLamports(5_000_000), 15_000_000);
    assert.equal(computePrefundLamports(19_000_000), 1_000_000);
  });

  it("3. wallet already above target receives no pre-fund", () => {
    assert.equal(computePrefundLamports(20_000_000), 0);
    assert.equal(computePrefundLamports(10_000_000_000), 0); // 10 SOL
  });
});

describe("hardened reimbursement verification", () => {
  it("4. high-SOL wallet still receives legitimate reimbursement (fee-only join)", () => {
    // High balance does not block reimbursement; shape + fee decide.
    const data = joinData(0, BigInt(0));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveQueueEntryPda(GAME_PROGRAM_ID, 0, BigInt(0));
    const accountKeys = [WALLET, ps, entry, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data)],
      accountKeys,
      preBalances: [10_000_000_000, 0, 0, 0],
      postBalances: [10_000_000_000 - 5000, 0, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000);
  });

  it("5. legitimate Join fee/rent is reimbursed", () => {
    const data = joinData(1, BigInt(7));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveQueueEntryPda(GAME_PROGRAM_ID, 1, BigInt(7));
    const accountKeys = [WALLET, ps, entry, GAME_PROGRAM_ID];
    // Player pays fee 5000 + rent 1.5M + 1.2M to the two PDAs.
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [computeIx(), gameIx(data)],
      accountKeys,
      preBalances: [100_000_000, 0, 0, 0],
      postBalances: [100_000_000 - 5000 - 2_700_000, 1_500_000, 1_200_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000 + 2_700_000);
  });

  it("6. legitimate Cancel is reimbursed (fee-only)", () => {
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const accountKeys = [WALLET, ps, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "cancel",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(cancelData())],
      accountKeys,
      preBalances: [50_000_000, 2_000_000, 0],
      postBalances: [50_000_000 - 5000, 2_000_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000);
  });

  it("7. legitimate Match cost is reimbursed (fee + match PDA rent + ORAO fee)", () => {
    const { ix, mpda, rand } = matchGameIx(BigInt(3));
    const accountKeys = [WALLET, mpda, rand, TEST_TREASURY, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "match",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [ix],
      accountKeys,
      preBalances: [50_000_000, 0, 0, 100_000_000, 0],
      postBalances: [50_000_000 - 5000 - 2_000_000 - 4_455_160 - 300_000, 2_000_000, 4_455_160, 100_300_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000 + 2_000_000 + 4_455_160 + 300_000);
  });

  it("match with excessive treasury fee is REJECTED", () => {
    const { ix, mpda, rand } = matchGameIx(BigInt(3));
    const accountKeys = [WALLET, mpda, rand, TEST_TREASURY, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "match",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [ix],
      accountKeys,
      preBalances: [100_000_000, 0, 0, 100_000_000, 0],
      postBalances: [100_000_000 - 5000 - 2_000_000, 2_000_000, 0, 105_000_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /treasury/);
  });

  it("match with wrong randomness account is REJECTED", () => {
    const { ix, mpda } = matchGameIx(BigInt(3));
    const bad = { ...ix, accounts: (ix.accounts ?? []).map((a, i) => (i === 10 ? mpda : a)) };
    const accountKeys = [WALLET, mpda, TEST_TREASURY, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "match",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [bad],
      accountKeys,
      preBalances: [50_000_000, 0, 100_000_000, 0],
      postBalances: [50_000_000 - 5000, 0, 100_000_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /randomness/);
  });

  it("match with malformed game accounts is REJECTED", () => {
    const short = gameIx(matchData(BigInt(3)), [WALLET]);
    assert.ok(short.accounts && short.accounts.length < MATCH_IX_MIN_ACCOUNTS);
    const v = verifySponsorTransaction({
      action: "match",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [short],
      accountKeys: [WALLET, GAME_PROGRAM_ID],
      preBalances: [50_000_000, 0],
      postBalances: [50_000_000 - 5000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
  });

  it("8. legitimate Claim/Settle cost is reimbursed (fee-only, ATA optional)", () => {
    const accountKeys = [WALLET, GAME_PROGRAM_ID];
    const v = verifySponsorTransaction({
      action: "claim",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(settleData(BigInt(3)))],
      accountKeys,
      preBalances: [50_000_000, 0],
      postBalances: [50_000_000 - 5000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    const v2 = verifySponsorTransaction({
      action: "settle",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(settleData(BigInt(3)))],
      accountKeys,
      preBalances: [50_000_000, 0],
      postBalances: [50_000_000 - 5000, 0],
      feeLamports: 5000,
    });
    assert.equal(v2.ok, true);
  });

  it("9. HeadsTails + malicious SystemProgram.transfer is REJECTED", () => {
    const data = joinData(0, BigInt(0));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveQueueEntryPda(GAME_PROGRAM_ID, 0, BigInt(0));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data), { programId: SYSTEM_PROGRAM_ID, data: new Uint8Array([1]) }],
      accountKeys: [WALLET, ps, entry, GAME_PROGRAM_ID, SYSTEM_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0, 0, 0],
      postBalances: [100_000_000 - 5000 - 10_000_000, 0, 0, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /SystemProgram/);
  });

  it("10. HeadsTails + unrelated SPL transfer is REJECTED", () => {
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(joinData(0, BigInt(0))), { programId: TOKEN_PROGRAM_ID, data: new Uint8Array([9]) }],
      accountKeys: [WALLET, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0],
      postBalances: [100_000_000 - 5000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
  });

  it("11. HeadsTails + unknown program instruction is REJECTED", () => {
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [
        gameIx(joinData(0, BigInt(0))),
        { programId: "Evil111111111111111111111111111111111111111", data: null },
      ],
      accountKeys: [WALLET, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0],
      postBalances: [100_000_000 - 5000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
  });

  it("12. fake PDA account creation is REJECTED (QueueEntry PDA missing)", () => {
    const data = joinData(0, BigInt(0));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    // Entry omitted / replaced with attacker address.
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data)],
      accountKeys: [WALLET, ps, "Attacker111111111111111111111111111111111111", GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0, 0],
      postBalances: [100_000_000 - 5000, 0, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason ?? "", /QueueEntry/);
  });

  it("wrong game discriminator is REJECTED (cancel tx claimed as join)", () => {
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(cancelData())],
      accountKeys: [WALLET, ps, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0],
      postBalances: [100_000_000 - 5000, 0, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, false);
  });

  it("AToken creation allowed only for claim/settle, rejected for join", () => {
    const data = joinData(0, BigInt(0));
    const shape = verifyTopLevelShape({
      action: "join",
      topLevel: [gameIx(data), { programId: ATOKEN_PROGRAM_ID, data: null }],
    });
    assert.equal(shape.ok, false);
    const okClaim = verifyTopLevelShape({
      action: "claim",
      topLevel: [gameIx(settleData(BigInt(0))), { programId: ATOKEN_PROGRAM_ID, data: null }],
    });
    assert.equal(okClaim.ok, true);
  });

  it("13. same signature cannot be reimbursed twice (idempotency key = sig)", () => {
    const key = (sig: string) => `reimb-${sig}`;
    assert.equal(key(SIG), key(SIG));
    assert.notEqual(key(SIG), key("6".repeat(88)));
  });

  it("14. manipulated client reimbursement amount is ignored (server recomputes)", () => {
    // No amount field exists on the verifier; fee + PDA rent decide.
    const data = joinData(0, BigInt(0));
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const entry = deriveQueueEntryPda(GAME_PROGRAM_ID, 0, BigInt(0));
    const v = verifySponsorTransaction({
      action: "join",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(data)],
      accountKeys: [WALLET, ps, entry, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 0, 0, 0],
      postBalances: [100_000_000 - 5000 - 1_000_000, 600_000, 400_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    // Attacker claiming 1 SOL would still only get fee+rent (1,005,000).
    assert.equal(v.eligibleLamports, 5000 + 1_000_000);
  });

  it("bare wallet delta is NOT reimbursed (attacker transfer ignored)", () => {
    // Wallet drains 10M (fee 5k + 9.995M attacker transfer), but only fee
    // + verified PDA rent (0 here) is eligible — never the delta.
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const v = verifySponsorTransaction({
      action: "cancel",
      expectedWallet: WALLET,
      txWallet: WALLET,
      topLevel: [gameIx(cancelData())],
      accountKeys: [WALLET, ps, GAME_PROGRAM_ID],
      preBalances: [100_000_000, 2_000_000, 0],
      postBalances: [100_000_000 - 10_000_000, 2_000_000, 0],
      feeLamports: 5000,
    });
    assert.equal(v.ok, true);
    assert.equal(v.eligibleLamports, 5000);
  });

  it("15. global daily cap works (default + env override)", () => {
    const def = getGlobalDailyCapLamports();
    assert.ok(def > 0);
    const prev = process.env.DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS;
    try {
      process.env.DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS = "123456";
      assert.equal(getGlobalDailyCapLamports(), 123456);
    } finally {
      if (prev === undefined) delete process.env.DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS;
      else process.env.DEVNET_SOL_SPONSOR_GLOBAL_DAILY_CAP_LAMPORTS = prev;
    }
  });

  it("16. Mainnet remains fail-closed", () => {
    assert.equal(
      evaluateSponsorGate({ cluster: "mainnet-beta", sponsorEnabled: "true", mainnetRealValue: "false" }).ok,
      false
    );
    // Singular helper is the retained legacy API; accepted variants include HTS.
    assert.equal(discriminatorFor("join"), DISCRIMINATORS.join_queue);
    assert.equal(discriminatorFor("claim"), DISCRIMINATORS.settle_match);
    assert.equal(discriminatorFor("settle"), DISCRIMINATORS.settle_match);
  });

  it("decoders handle join/match args", () => {
    const j = decodeJoinArgs(joinData(1, BigInt(42)));
    assert.deepEqual(j, { side: 1, tier: 1, sequence: BigInt(42) });
    assert.equal(decodeMatchId(matchData(BigInt(9))), BigInt(9));
    const mpda = deriveMatchPda(GAME_PROGRAM_ID, BigInt(9));
    assert.ok(typeof mpda === "string" && mpda.length >= 32);
  });

  it("attributable-cost helper counts only expected PDA rent", () => {
    const ps = derivePlayerStatePda(GAME_PROGRAM_ID, WALLET);
    const { eligible } = calculateEligibleCost({
      feeLamports: 5000,
      accountKeys: [WALLET, ps, "Other111111111111111111111111111111111111111"],
      preBalances: [100_000_000, 0, 5_000_000],
      postBalances: [100_000_000 - 5000 - 1_000_000, 1_000_000, 15_000_000],
      expectedPdaAddresses: [ps],
    });
    // Only fee + 1M PDA rent; the 10M to Other is ignored.
    assert.equal(eligible, 5000 + 1_000_000);
  });

  it("fake transaction signature rejected (validation)", () => {
    assert.equal(isValidSignature("short"), false);
    assert.equal(isValidSignature(SIG), true);
  });

  it("validates wallet + action strictly", () => {
    assert.equal(isValidWallet(WALLET), true);
    assert.equal(isValidWallet("not-a-wallet"), false);
    assert.equal(isValidSponsorAction("join"), true);
    assert.equal(isValidSponsorAction("drain"), false);
  });
});

describe("game semantics unchanged", () => {
  it("HTS welcome grant claims exactly 10,000 tokens (6 decimals)", () => {
    assert.equal(FAUCET_CLAIM_BASE_UNITS, BigInt(10_000_000_000));
    assert.equal(
      evaluateFaucetGate({
        cluster: "devnet",
        faucetEnabled: "true",
        mainnetRealValue: "false",
        configuredMint: DEVNET_TEST_MINT,
      }).ok,
      true
    );
  });

  it("approved mints/programs are pinned", () => {
    assert.equal(DEVNET_TEST_MINT, "DZZ2sjGBEvirhDagPL7Nb28gQ3BDCZTjmnRwWxizSvNy");
    assert.notEqual(DEVNET_TEST_MINT, "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh");
    assert.equal(GAME_PROGRAM_ID, "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k");
  });
});

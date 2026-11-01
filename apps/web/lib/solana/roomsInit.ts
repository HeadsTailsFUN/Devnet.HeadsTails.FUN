import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { gameIdlJson } from "@heads-or-tails/game-sdk";

/**
 * Room initialization helpers (post-V2-upgrade step).
 *
 * init_room(tier, active) is admin-gated on GameConfig authority, so the
 * owner signs once for a combined [init_room(1), init_room(10)] transaction.
 * Discriminators and account shapes are read from the shipped IDL, never
 * hardcoded — the builder output is additionally validated field-by-field
 * before anything is signed.
 */

export const SUPPORTED_ROOM_TIERS = [1, 10] as const;

function idlInstruction(name: string): {
  discriminator: number[];
  accounts: Array<{ name: string; writable?: boolean; signer?: boolean }>;
} {
  const idl = gameIdlJson as unknown as {
    instructions: Array<{
      name: string;
      discriminator: number[];
      accounts: Array<{ name: string; writable?: boolean; signer?: boolean }>;
    }>;
  };
  const found = idl.instructions.find((i) => i.name === name);
  if (!found) throw new Error(`IDL missing instruction ${name}`);
  return found;
}

export function roomPdaFor(programId: PublicKey, tierUsd: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("hts-room"), Buffer.from([tierUsd])],
    programId
  );
  return pda;
}

export interface InitRoomSpec {
  tierUsd: number;
  active: boolean;
}

/** Build one init_room instruction from IDL shape (admin/config/room/system). */
export function buildInitRoomInstruction(
  programId: PublicKey,
  admin: PublicKey,
  config: PublicKey,
  spec: InitRoomSpec
): TransactionInstruction {
  if (spec.tierUsd !== 1 && spec.tierUsd !== 10) {
    throw new Error(`unsupported room tier ${spec.tierUsd}`);
  }
  const idl = idlInstruction("init_hts_room");
  const room = roomPdaFor(programId, spec.tierUsd);
  const byName: Record<string, PublicKey> = {
    admin,
    config,
    room,
    system_program: SystemProgram.programId,
  };
  const data = Buffer.alloc(8 + 1 + 1);
  Buffer.from(idl.discriminator).copy(data, 0);
  data[8] = spec.tierUsd;
  data[9] = spec.active ? 1 : 0;
  return new TransactionInstruction({
    programId,
    keys: idl.accounts.map((a) => ({
      pubkey: byName[a.name] ?? (() => { throw new Error(`unknown account ${a.name}`); })(),
      isSigner: a.signer === true,
      isWritable: a.writable === true,
    })),
    data,
  });
}

/**
 * Exact-shape validator for an init_room instruction. Returns null when the
 * instruction matches the IDL shape, expected room PDA, admin and args.
 */
export function assertInitRoomExact(
  ix: TransactionInstruction,
  programId: PublicKey,
  admin: PublicKey,
  config: PublicKey,
  spec: InitRoomSpec
): string | null {
  if (!ix.programId.equals(programId)) return "wrong program id";
  const idl = idlInstruction("init_hts_room");
  const data = Buffer.from(ix.data);
  if (data.length !== 10) return "bad data length";
  if (!data.subarray(0, 8).equals(Buffer.from(idl.discriminator))) {
    return "not an init_room instruction";
  }
  if (data[8] !== spec.tierUsd) return "tier mismatch";
  if (data[9] !== (spec.active ? 1 : 0)) return "active flag mismatch";
  const want: Array<{ key: string; signer: boolean; writable: boolean }> = [
    { key: admin.toBase58(), signer: true, writable: true },
    { key: config.toBase58(), signer: false, writable: true },
    { key: roomPdaFor(programId, spec.tierUsd).toBase58(), signer: false, writable: true },
    { key: SystemProgram.programId.toBase58(), signer: false, writable: false },
  ];
  if (ix.keys.length !== want.length) return `expected 4 accounts, got ${ix.keys.length}`;
  for (let i = 0; i < want.length; i++) {
    const got = ix.keys[i];
    if (got.pubkey.toBase58() !== want[i].key) return `account ${i} pubkey mismatch`;
    if (got.isSigner !== want[i].signer) return `account ${i} signer flag mismatch`;
    if (got.isWritable !== want[i].writable) return `account ${i} writable flag mismatch`;
  }
  return null;
}

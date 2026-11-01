import { Connection, PublicKey } from "@solana/web3.js";

export const QUEUE_ENTRY_LEN = 67;
const STATUS_OFFSET = 8 + 32 + 1 + 8 + 8 + 8; // discriminator|player|side|seq|amount|slot
export const MAX_SCAN_PER_SIDE = 100;

export interface QueueSnapshot {
  headsActive: number;
  tailsActive: number;
  truncated: boolean;
  headsHead: bigint;
  headsNext: bigint;
  tailsHead: bigint;
  tailsNext: bigint;
  fetchedAt: number;
}

export interface ConfigRange {
  headsHead: bigint;
  headsNext: bigint;
  tailsHead: bigint;
  tailsNext: bigint;
}

/** QueueEntry status byte: Active=0 per programs/heads-or-tails/src/state.rs. */
export function isActiveEntryData(data: Uint8Array | null | undefined): boolean {
  if (!data || data.length < QUEUE_ENTRY_LEN) return false;
  return data[STATUS_OFFSET] === 0;
}

export function countActive(datas: Array<Uint8Array | null>): number {
  let n = 0;
  for (const d of datas) if (isActiveEntryData(d ?? undefined)) n += 1;
  return n;
}

function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

/** Tier-scoped V2 queue address derivation (must match rooms.rs). */
export function roomQueuePda(
  programId: PublicKey,
  tierUsd: number,
  side: number,
  sequence: bigint
): PublicKey {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(sequence);
  const [a] = PublicKey.findProgramAddressSync(
    [Buffer.from("hts-queue"), Buffer.from([tierUsd]), Buffer.from([side]), b],
    programId
  );
  return a;
}

function rangeAddrs(
  programId: PublicKey,
  side: number,
  head: bigint,
  next: bigint
): { addrs: PublicKey[]; truncated: boolean } {
  const total = next - head;
  const take = total > BigInt(MAX_SCAN_PER_SIDE) ? BigInt(MAX_SCAN_PER_SIDE) : total;
  const addrs: PublicKey[] = [];
  for (let i = BigInt(0); i < take; i++) {
    const seq = head + i;
    const [a] = PublicKey.findProgramAddressSync(
      [Buffer.from("queue"), Buffer.from([side]), u64le(seq)],
      programId
    );
    addrs.push(a);
  }
  return { addrs, truncated: total > take };
}

/**
 * V2 tier-scoped queue snapshot: counts ONLY the selected room's entries.
 * $1 shows only $1 queues, $10 only $10 — never shared/cached across tiers.
 * Bounded: at most MAX_SCAN_PER_SIDE account reads per side.
 */
export async function fetchRoomQueueSnapshot(
  connection: Connection,
  programId: PublicKey,
  tierUsd: number,
  cfg: ConfigRange
): Promise<QueueSnapshot> {
  const h = rangeAddrsTier(programId, tierUsd, 0, cfg.headsHead, cfg.headsNext);
  const t = rangeAddrsTier(programId, tierUsd, 1, cfg.tailsHead, cfg.tailsNext);
  const all = [...h.addrs, ...t.addrs];
  let datas: Array<Uint8Array | null> = all.map(() => null);
  if (all.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(all).catch(() => null);
    if (infos) {
      datas = infos.map((info) => {
        if (!info?.data) return null;
        const raw = info.data;
        return raw instanceof Uint8Array ? raw : Uint8Array.from(raw as Uint8Array);
      });
    }
  }
  return {
    headsActive: countActive(datas.slice(0, h.addrs.length)),
    tailsActive: countActive(datas.slice(h.addrs.length)),
    truncated: h.truncated || t.truncated,
    headsHead: cfg.headsHead,
    headsNext: cfg.headsNext,
    tailsHead: cfg.tailsHead,
    tailsNext: cfg.tailsNext,
    fetchedAt: Date.now(),
  };
}

function rangeAddrsTier(
  programId: PublicKey,
  tierUsd: number,
  side: number,
  head: bigint,
  next: bigint
): { addrs: PublicKey[]; truncated: boolean } {
  const total = next - head;
  const take = total > BigInt(MAX_SCAN_PER_SIDE) ? BigInt(MAX_SCAN_PER_SIDE) : total;
  const addrs: PublicKey[] = [];
  for (let i = BigInt(0); i < take; i++) {
    addrs.push(roomQueuePda(programId, tierUsd, side, head + i));
  }
  return { addrs, truncated: total > take };
}

/**
 * Public queue snapshot: active entries only (holes excluded).
 * Bounded: at most MAX_SCAN_PER_SIDE account reads per side.
 */
export async function fetchQueueSnapshot(
  connection: Connection,
  programId: PublicKey,
  cfg: ConfigRange
): Promise<QueueSnapshot> {
  const h = rangeAddrs(programId, 0, cfg.headsHead, cfg.headsNext);
  const t = rangeAddrs(programId, 1, cfg.tailsHead, cfg.tailsNext);
  const all = [...h.addrs, ...t.addrs];
  let datas: Array<Uint8Array | null> = all.map(() => null);
  if (all.length > 0) {
    const infos = await connection.getMultipleAccountsInfo(all).catch(() => null);
    if (infos) {
      datas = infos.map((info) => {
        if (!info?.data) return null;
        const raw = info.data;
        return raw instanceof Uint8Array ? raw : Uint8Array.from(raw as Uint8Array);
      });
    }
  }
  return {
    headsActive: countActive(datas.slice(0, h.addrs.length)),
    tailsActive: countActive(datas.slice(h.addrs.length)),
    truncated: h.truncated || t.truncated,
    headsHead: cfg.headsHead,
    headsNext: cfg.headsNext,
    tailsHead: cfg.tailsHead,
    tailsNext: cfg.tailsNext,
    fetchedAt: Date.now(),
  };
}

export type PositionResult = { position: number } | { unknown: true };

/**
 * V2 tier-scoped ACTIVE-player queue position within ONE room.
 * 1 + active entries ahead of the user's exact (tier, side, sequence).
 */
export async function fetchUserRoomQueuePosition(
  connection: Connection,
  programId: PublicKey,
  tierUsd: number,
  side: number,
  userSequence: bigint,
  head: bigint
): Promise<PositionResult> {
  if (userSequence < head) return { unknown: true };
  const span = userSequence - head + BigInt(1);
  if (span > BigInt(MAX_SCAN_PER_SIDE)) return { unknown: true };
  const addrs: PublicKey[] = [];
  for (let s = head; s <= userSequence; s++) {
    addrs.push(roomQueuePda(programId, tierUsd, side, s));
  }
  const infos = await connection.getMultipleAccountsInfo(addrs).catch(() => null);
  if (!infos) return { unknown: true };
  let ahead = 0;
  for (let i = 0; i < infos.length - 1; i++) {
    const d = infos[i]?.data;
    const bytes = !d ? null : d instanceof Uint8Array ? d : Uint8Array.from(d as Uint8Array);
    if (isActiveEntryData(bytes ?? undefined)) ahead += 1;
  }
  for (let i = 0; i < infos.length - 1; i++) {
    if (!infos[i]?.data) return { unknown: true };
  }
  return { position: ahead + 1 };
}

/**
 * User's ACTIVE-player queue position: 1 + active entries ahead of the
 * user's exact sequence on the same side. Returns unknown when the scan
 * fails or is truncated before reaching the user.
 */
export async function fetchUserQueuePosition(
  connection: Connection,
  programId: PublicKey,
  side: number,
  userSequence: bigint,
  head: bigint
): Promise<PositionResult> {
  if (userSequence < head) return { unknown: true };
  const span = userSequence - head + BigInt(1);
  if (span > BigInt(MAX_SCAN_PER_SIDE)) return { unknown: true };
  const addrs: PublicKey[] = [];
  for (let s = head; s <= userSequence; s++) {
    const [a] = PublicKey.findProgramAddressSync(
      [Buffer.from("queue"), Buffer.from([side]), u64le(s)],
      programId
    );
    addrs.push(a);
  }
  const infos = await connection.getMultipleAccountsInfo(addrs).catch(() => null);
  if (!infos) return { unknown: true };
  let ahead = 0;
  for (let i = 0; i < infos.length - 1; i++) {
    const d = infos[i]?.data;
    const bytes = !d ? null : d instanceof Uint8Array ? d : Uint8Array.from(d as Uint8Array);
    if (isActiveEntryData(bytes ?? undefined)) ahead += 1;
  }
  // If any entry ahead is unreadable (missing data), the count is unreliable.
  for (let i = 0; i < infos.length - 1; i++) {
    if (!infos[i]?.data) return { unknown: true };
  }
  return { position: ahead + 1 };
}

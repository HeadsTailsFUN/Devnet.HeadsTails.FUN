/**
 * Room model (V2 rooms live on-chain).
 * $1 and $10 are playable only while their on-chain RoomState exists and is
 * active — until then a tier must NOT display OPEN. $100/$1000 stay disabled
 * with exact copy "Opening Soon". The legacy V1 global pool is drain-only
 * and never used for new joins.
 */
export interface RoomDef {
  tierUsd: number;
  label: string;
  usdCents: number;
  active: boolean;
  disabledLabel: string;
}

export const ROOMS: RoomDef[] = [
  { tierUsd: 1, label: "$1", usdCents: 100, active: true, disabledLabel: "Opening Soon" },
  { tierUsd: 10, label: "$10", usdCents: 1000, active: true, disabledLabel: "Opening Soon" },
  { tierUsd: 100, label: "$100", usdCents: 10000, active: false, disabledLabel: "Opening Soon" },
  { tierUsd: 1000, label: "$1,000", usdCents: 100000, active: false, disabledLabel: "Opening Soon" },
];

export const DEFAULT_TIER_USD = 1;

/** Copy shown while a designed room has no live on-chain RoomState yet. */
export const ROOM_ACTIVATION_COPY = "Activating after upgrade";

/** Copy for $1/$10 cards while wallet is NOT connected. */
export const DISCONNECTED_ROOM_COPY = "Connect Wallet";

export type RoomCardMode = "open" | "activating" | "soon";

/**
 * Resolve how a room card renders. `liveTiers` holds tiers whose RoomState
 * was confirmed live on-chain (exists + active). Designed rooms without a
 * live RoomState render as activating, never OPEN.
 */
export function resolveRoomCard(
  tierUsd: number,
  liveTiers: Set<number> | number[]
): { mode: RoomCardMode; note: string } {
  const live = liveTiers instanceof Set ? liveTiers : new Set(liveTiers);
  const def = roomForTier(tierUsd);
  if (!def || !def.active) return { mode: "soon", note: def?.disabledLabel ?? "Opening Soon" };
  if (!live.has(tierUsd)) return { mode: "activating", note: ROOM_ACTIVATION_COPY };
  return { mode: "open", note: def.disabledLabel };
}

/**
 * Disconnected view: $1/$10 show Connect Wallet, $100/$1000 stay
 * Opening Soon. Connected view delegates to live RoomState logic.
 */
export function resolveRoomCardWithConnection(
  tierUsd: number,
  liveTiers: Set<number> | number[],
  connected: boolean
): { mode: RoomCardMode; note: string } {
  if (!connected) {
    const def = roomForTier(tierUsd);
    if (!def || !def.active) return { mode: "soon", note: def?.disabledLabel ?? "Opening Soon" };
    return { mode: "soon", note: DISCONNECTED_ROOM_COPY };
  }
  return resolveRoomCard(tierUsd, liveTiers);
}

/** Join gate: every designed tier additionally requires a live on-chain room. */
export function isRoomJoinable(tierUsd: number, liveTiers: Set<number> | number[]): boolean {
  if (!isRoomActive(tierUsd)) return false;
  const live = liveTiers instanceof Set ? liveTiers : new Set(liveTiers);
  return live.has(tierUsd);
}

/**
 * Merge one room-probe cycle into cached liveness. Successful probes
 * (live true/false) always commit; failed probes (null) keep the last known
 * value so a flaky response can never flip live rooms — or clear a pending
 * user selection that the room gate would otherwise reset.
 */
export function mergeRoomLiveness(
  prev: Record<number, boolean>,
  results: Array<{ tier: number; live: boolean | null }>
): { next: Record<number, boolean>; changed: boolean } {
  const next: Record<number, boolean> = { ...prev };
  let changed = false;
  for (const r of results) {
    if (r.live === null) continue;
    if (next[r.tier] !== r.live) {
      next[r.tier] = r.live;
      changed = true;
    }
  }
  return { next, changed };
}

export function roomForTier(tierUsd: number): RoomDef | null {
  return ROOMS.find((r) => r.tierUsd === tierUsd) ?? null;
}

export function isRoomActive(tierUsd: number): boolean {
  return roomForTier(tierUsd)?.active ?? false;
}

export function activeRooms(): RoomDef[] {
  return ROOMS.filter((r) => r.active);
}

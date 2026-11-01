export type Side = "HEADS" | "TAILS";

export type GameStateId =
  | "disconnected"
  | "connected"
  | "ready"
  | "heads-selected"
  | "tails-selected"
  | "joining"
  | "queued-heads"
  | "queued-tails"
  | "match-found"
  | "flipping"
  | "win"
  | "loss"
  | "error"
  | "price-unavailable"
  | "insufficient-balance"
  | "paused";

export interface MockFlip {
  id: string;
  result: Side;
  winner: string;
  pot: string;
  time: string;
}

export interface MockQueue {
  headsWaiting: number;
  tailsWaiting: number;
}

/**
 * UI-ONLY fixture. Must never leak into production.
 * Full-stack phase replaces this with indexed on-chain history.
 */
export const mockFlips: MockFlip[] = [
  { id: "M-8F3K2", result: "HEADS", winner: "7xK…9QpL", pot: "1,842 TOK", time: "12s ago" },
  { id: "M-2H7Q9", result: "TAILS", winner: "3mP…V8xZ", pot: "1,790 TOK", time: "38s ago" },
  { id: "M-5T1N4", result: "HEADS", winner: "9Wq…4LmN", pot: "1,905 TOK", time: "1m ago" },
  { id: "M-9P4B7", result: "HEADS", winner: "5Ab…2CdE", pot: "1,811 TOK", time: "2m ago" },
  { id: "M-3K8M1", result: "TAILS", winner: "8Zk…Q1wE", pot: "1,877 TOK", time: "3m ago" },
  { id: "M-6J2V5", result: "TAILS", winner: "2Np…7RtY", pot: "1,764 TOK", time: "4m ago" },
  { id: "M-4D9C6", result: "HEADS", winner: "6Hs…U3iO", pot: "1,933 TOK", time: "5m ago" },
  { id: "M-1F5G8", result: "TAILS", winner: "4Df…G6hJ", pot: "1,802 TOK", time: "6m ago" },
  { id: "M-7L3A9", result: "HEADS", winner: "1Qa…Z5sX", pot: "1,858 TOK", time: "8m ago" },
  { id: "M-0Z6E2", result: "TAILS", winner: "9Ed…C2vB", pot: "1,791 TOK", time: "9m ago" },
];

export const mockQueue: MockQueue = {
  headsWaiting: 12,
  tailsWaiting: 8,
};

export const mockEntryEstimate = "~1,842 TOK ≈ $1.00";

export const GAME_STATE_LABELS: Record<GameStateId, string> = {
  disconnected: "Disconnected",
  connected: "Connected (mock)",
  ready: "Ready",
  "heads-selected": "HEADS selected",
  "tails-selected": "TAILS selected",
  joining: "Joining / submitting",
  "queued-heads": "Queued — HEADS",
  "queued-tails": "Queued — TAILS",
  "match-found": "Match found",
  flipping: "Flipping / waiting for randomness",
  win: "Win",
  loss: "Loss",
  error: "Error",
  "price-unavailable": "Price unavailable",
  "insufficient-balance": "Insufficient token balance",
  paused: "Paused",
};

export const ALL_GAME_STATES: GameStateId[] = [
  "disconnected",
  "connected",
  "ready",
  "heads-selected",
  "tails-selected",
  "joining",
  "queued-heads",
  "queued-tails",
  "match-found",
  "flipping",
  "win",
  "loss",
  "error",
  "price-unavailable",
  "insufficient-balance",
  "paused",
];

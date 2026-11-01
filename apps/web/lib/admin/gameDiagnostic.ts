/**
 * HT-OBS micro-fix: safe machine-readable diagnostic enum for
 * `GET /api/admin/game` failures.
 *
 * The Admin Overview/Game panels showed `Could not load on-chain game
 * state.` with no clue about the backend cause. The enum below lets the UI
 * render `Diagnostic: GAME_*` beneath the friendly message without ever
 * exposing RPC credentials, secret env values, stack traces, or private
 * material. Fail-closed behavior is unchanged (real 401/403/503 statuses).
 */

export type GameDiagnosticCode =
  | "GAME_AUTH_REQUIRED"
  | "GAME_FORBIDDEN"
  | "GAME_RPC_CONFIG_MISSING"
  | "GAME_RPC_UNAVAILABLE"
  | "GAME_CONFIG_UNREADABLE"
  | "GAME_PROGRAM_MISMATCH"
  | "GAME_UNKNOWN_ERROR";

export const GAME_DIAGNOSTIC_CODES: readonly GameDiagnosticCode[] = [
  "GAME_AUTH_REQUIRED",
  "GAME_FORBIDDEN",
  "GAME_RPC_CONFIG_MISSING",
  "GAME_RPC_UNAVAILABLE",
  "GAME_CONFIG_UNREADABLE",
  "GAME_PROGRAM_MISMATCH",
  "GAME_UNKNOWN_ERROR",
] as const;

export function isGameDiagnosticCode(v: unknown): v is GameDiagnosticCode {
  return (
    typeof v === "string" &&
    (GAME_DIAGNOSTIC_CODES as readonly string[]).includes(v)
  );
}

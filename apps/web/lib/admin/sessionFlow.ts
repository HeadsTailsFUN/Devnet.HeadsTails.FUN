/**
 * Admin authentication flow planner (pure, testable).
 *
 * The /admin page must NOT permanently deny a user who merely opened the page
 * before connecting. Staff status requires an authenticated wallet SESSION
 * (challenge/sign/verify), not just a connected Wallet Standard account, so
 * the page has to (re-)verify whenever the connected wallet changes.
 *
 * Rules encoded here:
 * - disconnected            → clear admin state, never "denied"
 * - address changed         → drop stale status/denied, start over
 * - session unknown yet     → wait (no action; avoids signature loops)
 * - no session / mismatch   → run exactly one wallet-ownership verification
 * - session == address      → fetch /api/admin/status
 * - already busy            → no action (single-flight)
 */

export type AdminFlowAction =
  | { kind: "clear" }
  | { kind: "wait" }
  | { kind: "verify-session"; address: string }
  | { kind: "fetch-status"; address: string };

export function planAdminAuth(args: {
  address: string | null;
  /** undefined = not yet loaded; null = no session; string = session wallet. */
  sessionWallet: string | null | undefined;
  inFlight: boolean;
}): AdminFlowAction {
  const { address, sessionWallet, inFlight } = args;
  if (!address) return { kind: "clear" };
  if (inFlight) return { kind: "wait" };
  if (sessionWallet === undefined) return { kind: "wait" };
  if (sessionWallet === address) return { kind: "fetch-status", address };
  return { kind: "verify-session", address };
}

export interface AdminStatusView {
  isOwner: boolean;
  isModerator: boolean;
  isFullAdmin?: boolean;
  wallet: string;
  authority: string | null;
}

export interface AdminFlowViewState {
  status: AdminStatusView | null;
  denied: boolean;
  note: string | null;
}

export function initialAdminFlowState(): AdminFlowViewState {
  return { status: null, denied: false, note: null };
}

/** Viewing rules for the OWNER/full-admin/moderator/denied rendering. */
export function isStaffView(s: AdminFlowViewState): boolean {
  return s.status !== null && (s.status.isOwner || s.status.isModerator || s.status.isFullAdmin === true);
}

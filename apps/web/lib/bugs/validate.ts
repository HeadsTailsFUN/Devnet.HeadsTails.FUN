/** Bug report validation + sanitization (no raw HTML rendering). */

export const BUG_SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUS = [
  "new",
  "triaged",
  "needs_info",
  "accepted",
  "duplicate",
  "rejected",
  "resolved",
  "rewarded",
] as const;

export function isValidSeverity(s: unknown): s is BugSeverity {
  return typeof s === "string" && (BUG_SEVERITIES as readonly string[]).includes(s);
}

/** Strip HTML tags, collapse whitespace, enforce length caps. */
export function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  const noTags = input.replace(/<[^>]*>/g, "");
  const collapsed = noTags.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, maxLen);
}

export function sanitizeTelegram(handle: unknown): string | null {
  if (typeof handle !== "string") return null;
  const t = handle.trim().replace(/^@/, "").slice(0, 32);
  if (!t) return null;
  if (!/^[A-Za-z0-9_]{3,32}$/.test(t)) return null;
  return t;
}

export interface BugInput {
  description: string;
  steps: string | null;
  telegram: string | null;
  severity: BugSeverity;
}

export function validateBugInput(body: unknown): { ok: true; input: BugInput } | { ok: false; reason: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const description = sanitizeText(b.description ?? b.what ?? b.body, 2000);
  if (description.length < 10) return { ok: false, reason: "description too short" };
  if (!isValidSeverity(b.severity)) return { ok: false, reason: "invalid severity" };
  const stepsRaw = sanitizeText(b.steps ?? b.steps_to_reproduce ?? "", 2000);
  const telegram = sanitizeTelegram(b.telegram ?? b.telegram_handle ?? "");
  return {
    ok: true,
    input: {
      description,
      steps: stepsRaw ? stepsRaw : null,
      telegram,
      severity: b.severity as BugSeverity,
    },
  };
}

/** Bounty guidance (admin only, not a promise). */
export function bountyGuidance(severity: BugSeverity): string {
  if (severity === "Low") return "recognition / up to ~$10 equivalent";
  if (severity === "Medium") return "~$10–$50 equivalent";
  if (severity === "High") return "~$50–$200 equivalent";
  return "~$200–$500+ equivalent";
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 18;
export const USERNAME_COOLDOWN_ENABLED = true;
export const USERNAME_RE = /^[A-Za-z0-9_]+$/;

const RESERVED = new Set([
  "admin",
  "administrator",
  "moderator",
  "mod",
  "headstails",
  "heads",
  "tails",
  "support",
  "system",
  "official",
]);

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export type UsernameCheck = { ok: true; normalized: string } | { ok: false; reason: string };

export function validateUsername(name: unknown): UsernameCheck {
  if (typeof name !== "string") return { ok: false, reason: "username must be text" };
  const trimmed = name.trim();
  if (trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX) {
    return { ok: false, reason: `username must be ${USERNAME_MIN}–${USERNAME_MAX} characters` };
  }
  if (!USERNAME_RE.test(trimmed)) {
    return { ok: false, reason: "letters, numbers and underscore only" };
  }
  const normalized = normalizeUsername(trimmed);
  if (RESERVED.has(normalized)) {
    return { ok: false, reason: "that name is reserved" };
  }
  return { ok: true, normalized };
}

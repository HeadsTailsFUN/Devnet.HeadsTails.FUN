export const TEXT_KEYS = [
  "announcement_text",
  "hero_subtitle",
] as const;

export const IMAGE_KEYS = ["coin_heads_url", "coin_tails_url", "coin_default_url"] as const;

export const BOOL_KEYS = ["chat_enabled", "leaderboard_enabled"] as const;

export type SettingKey =
  | (typeof TEXT_KEYS)[number]
  | (typeof IMAGE_KEYS)[number]
  | (typeof BOOL_KEYS)[number];

const ALL = new Set<string>([...TEXT_KEYS, ...IMAGE_KEYS, ...BOOL_KEYS]);

function hasHtml(s: string): boolean {
  return s.includes("<") || s.includes(">");
}

/** Site-assets or bundled asset paths only. No arbitrary hosts/JS. */
function isSafeImageUrl(s: string): boolean {
  if (s.startsWith("/assets/")) return true;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return false;
    if (!u.hostname.endsWith("supabase.co")) return false;
    return u.pathname.includes("/storage/v1/object/public/site-assets/");
  } catch {
    return false;
  }
}

export type SettingCheck =
  | { ok: true; kind: "text" | "image" | "bool"; value: string | boolean }
  | { ok: false; reason: string };

/** Controlled settings validation. Unknown keys and HTML/JS are rejected. */
export function validateSetting(key: unknown, value: unknown): SettingCheck {
  if (typeof key !== "string" || !ALL.has(key)) {
    return { ok: false, reason: "unknown setting" };
  }
  if ((TEXT_KEYS as readonly string[]).includes(key)) {
    if (typeof value !== "string") return { ok: false, reason: "text value required" };
    const t = value.trim();
    if (t.length === 0 || t.length > 200) return { ok: false, reason: "text must be 1–200 chars" };
    if (hasHtml(t)) return { ok: false, reason: "HTML is not allowed" };
    return { ok: true, kind: "text", value: t };
  }
  if ((IMAGE_KEYS as readonly string[]).includes(key)) {
    if (typeof value !== "string" || !isSafeImageUrl(value.trim())) {
      return { ok: false, reason: "only bundled or site-assets images" };
    }
    return { ok: true, kind: "image", value: value.trim() };
  }
  if (typeof value !== "boolean") return { ok: false, reason: "boolean required" };
  return { ok: true, kind: "bool", value };
}

/** Public keys exposed to browsers (no secrets; settings hold none). */
export const PUBLIC_SETTING_KEYS = [
  "announcement_text",
  "hero_subtitle",
  "coin_heads_url",
  "coin_tails_url",
  "coin_default_url",
  "chat_enabled",
  "leaderboard_enabled",
];

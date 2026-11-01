export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const AVATAR_ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Validate avatar bytes: MIME allowlist + size + magic bytes must agree.
 * SVG/HTML can never pass (no allowed signature for them).
 */
export function validateAvatar(
  bytes: Uint8Array,
  mime: string,
  maxBytes: number = AVATAR_MAX_BYTES
): { ok: true; ext: string } | { ok: false; reason: string } {
  if (!bytes || bytes.length === 0 || bytes.length > maxBytes) {
    return { ok: false, reason: `file must be 1 byte – ${Math.round(maxBytes / 1024 / 1024)} MB` };
  }
  const kind = sniffKind(bytes, mime);
  if (!kind || AVATAR_ALLOWED[mime] !== kind) {
    if (!AVATAR_ALLOWED[mime]) return { ok: false, reason: "only JPEG, PNG or WEBP" };
    return { ok: false, reason: "file content does not match its type" };
  }
  return { ok: true, ext: kind };
}

export function sniffKind(bytes: Uint8Array, mime: string): string | null {
  if (!bytes || bytes.length < 12) return null;
  if (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (
    mime === "image/png" &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    mime === "image/webp" &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

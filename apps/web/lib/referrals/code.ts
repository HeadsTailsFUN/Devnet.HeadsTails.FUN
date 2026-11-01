/** Stable 8-char uppercase referral code (browser-safe, ES2017). */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable 8-char code derived from wallet (collision-safe via DB unique retry). */
export function referralCodeForWallet(wallet: string): string {
  let a = fnv1a(`referral:${wallet}:a`, 0x811c9dc5);
  let b = fnv1a(`referral:${wallet}:b`, 0x01000193);
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    // Mix both hashes each round for diffusion without BigInt.
    a = (Math.imul(a ^ b, 16777619) + i) >>> 0;
    b = (Math.imul(b ^ (a >>> 3), 31) + 0x9e3779b9) >>> 0;
    out += ALPHABET[(a + b + i * 7) % ALPHABET.length];
  }
  return out;
}

export function isValidReferralCode(code: unknown): boolean {
  return typeof code === "string" && /^[A-Z0-9]{6,12}$/i.test(code.trim());
}

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

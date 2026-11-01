/** Exact Unicode words only: ordinary substrings (class, Scunthorpe) survive. */
export const PROFANITY_WORDS = new Set([
  "fuck",
  "fucking",
  "fucker",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "cunt",
  "asshole",
  "کیر",
  "کونی",
  "جاکش",
  "کسکش",
  "کصکش",
  "کص",
  "کوس",
  "گاییدم",
  "گاییدن",
]);
const normalizeWord = (word: string) =>
  word
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670\u0640\u200c\u200d\u200e\u200f]/g, "");
export function maskProfanity(
  text: string,
  words: ReadonlySet<string> = PROFANITY_WORDS,
): string {
  let result = text.replace(/[\p{L}\p{M}\u0640\u200c-\u200f]+/gu, (word) =>
    words.has(normalizeWord(word)) ? "***" : word,
  );
  for (const word of words) {
    // Letter-separated obfuscations, bounded outside whole Unicode words.
    if (!/^(?:[a-z]{4,}|[\u0621-\u06ff]{3,})$/.test(word)) continue;
    const letters = [...normalizeWord(word)].map((letter) =>
      letter === "ی" ? "[یيى]" : letter === "ک" ? "[کك]" : letter,
    );
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${letters.join("[\\s._*\\-\\u200c\\u200d]{0,2}")}(?![\\p{L}\\p{N}])`,
      "giu",
    );
    result = result.replace(pattern, "***");
  }
  return result;
}
export function recentMessages<T extends { id: string; createdAt: string }>(
  rows: T[],
): T[] {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    )
    .slice(-100);
}

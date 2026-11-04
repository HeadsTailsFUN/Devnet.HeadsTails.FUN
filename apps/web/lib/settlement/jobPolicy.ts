export const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
export function settlementScanHighWater(configs:ReadonlyArray<{totalMatches:{toString():string}}|null>):bigint {
  return configs.reduce((max,cfg)=>{const count=cfg?BigInt(cfg.totalMatches.toString()):BigInt(0);return count>max?count:max;},BigInt(0));
}

export function parseMatchId(raw: unknown): bigint | null {
  if (typeof raw === "number" && (!Number.isSafeInteger(raw) || raw < 0)) return null;
  if (typeof raw !== "number" && typeof raw !== "bigint" && typeof raw !== "string") return null;
  const text = String(raw).trim();
  if (!/^\d{1,20}$/.test(text)) return null;
  const id = BigInt(text);
  return id <= U64_MAX ? id : null;
}

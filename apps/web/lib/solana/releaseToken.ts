import { PublicKey } from "@solana/web3.js";

export const LEGACY_TOKEN_MINT = "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh";
// Set only from the approved release manifest at cutover. An empty binding
// disables spending; it never falls back to the historical token.
export const HTS_TOKEN_MINT = process.env.NEXT_PUBLIC_HTS_TOKEN_MINT ?? "";
export const HTS_SERVICE_SIGNER = process.env.NEXT_PUBLIC_DEVNET_SERVICE_SIGNER ?? "";
export const DEPLOYMENT_PAYER = "H9zwyo5FsrkrnVwUvDVksqfjmTevJQpA7oG9opLkpriL";
export const OWNER_AUTHORITY = "5uQBxvv9FMGxDsWwnbQjM9kWf8phdwR8LKzEm6855AZW";
// Private operational exclusions are configured server-side; their values
// are not published with the application or copied into NEXT_PUBLIC_*.
const reservedSigners = (process.env.HEADSTAILS_RESERVED_SIGNER_PUBKEYS ?? "")
  .split(",").map(value => value.trim()).filter(Boolean);

export function validHtsMint(address: string | undefined): boolean {
  if (!address || address === LEGACY_TOKEN_MINT) return false;
  try { return !new PublicKey(address).equals(PublicKey.default); } catch { return false; }
}
export function validServiceSigner(address: string): boolean {
  return validHtsMint(address) && ![HTS_TOKEN_MINT, DEPLOYMENT_PAYER, OWNER_AUTHORITY,
    ...reservedSigners,
    "FwP4JekrFhJ2PksQXdi4DhiPTfVvYTkgpnjJTwaW2nY8"].includes(address);
}

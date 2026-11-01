import type { IdlAccounts, Program } from "@coral-xyz/anchor";
import type { HeadsOrTails } from "./idl-types.js";
import { configPda, matchPda, type GameGeneration } from "./pdas.js";

/** Resolve both canonical generations, never infer a historical mint from
 * the active site's token environment. Global IDs must be unambiguous. */
export async function resolveGameMatch(program: Program<HeadsOrTails>, id: bigint) {
  const generations: GameGeneration[] = ["legacy", "hts"];
  const addresses = generations.map(g => matchPda(program.programId, id, g)[0]);
  const infos = await program.provider.connection.getMultipleAccountsInfo(addresses, "confirmed");
  const candidates: Array<{index: number; match: IdlAccounts<HeadsOrTails>["match"]}> = [];
  for (const [index, info] of infos.entries()) {
    // Existence alone does not establish a program account. Validate the
    // owner and decode this same snapshot before choosing a generation.
    if (!info || !info.owner.equals(program.programId)) continue;
    const match = program.coder.accounts.decode<IdlAccounts<HeadsOrTails>["match"]>("match", info.data);
    if (match.id.toString() !== id.toString()) throw new Error("Match ID mismatch");
    candidates.push({index, match});
  }
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) throw new Error("Ambiguous match ID across game generations");
  const {index, match} = candidates[0];
  const generation = generations[index];
  const address = addresses[index];
  const configAddress = configPda(program.programId, generation)[0];
  const config = await program.account.gameConfig.fetch(configAddress);
  return { generation, address, match, configAddress, config };
}

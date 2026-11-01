import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { validHtsMint } from "./releaseToken";
import { gameIdlJson } from "@heads-or-tails/game-sdk";

export const DEVNET_PROGRAM_ID = "AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k";
export const DEVNET_MINT = "BH7CMEsAEe74yXSyNNM6L5LXJhsRhVDs1hgEMveJmGYh";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export function devnetEnvironmentAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.NEXT_PUBLIC_SOLANA_CLUSTER === "devnet"
    && [env.MAINNET_REAL_VALUE_ENABLED, env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED]
      .every((flag) => flag === undefined || flag === "false")
    && [env.HEADS_TAILS_PROGRAM_ID, env.NEXT_PUBLIC_HEADS_TAILS_PROGRAM_ID]
      .every((id) => id === undefined || id === DEVNET_PROGRAM_ID)
    && validHtsMint(env.NEXT_PUBLIC_HTS_TOKEN_MINT)
    && env.NEXT_PUBLIC_PROJECT_TOKEN_MINT === env.NEXT_PUBLIC_HTS_TOKEN_MINT;
}

/** Spending checks actual chain identity as well as every declared network signal. */
export async function assertDevnetConnection(connection: Pick<Connection, "getGenesisHash" | "getAccountInfo">, env: Readonly<Record<string,string | undefined>> = process.env): Promise<void> {
  if (!devnetEnvironmentAllowed(env)) throw new Error("Devnet operation unavailable");
  if (await connection.getGenesisHash() !== DEVNET_GENESIS) throw new Error("Devnet RPC identity mismatch");
  const program = new PublicKey(DEVNET_PROGRAM_ID);
  const configAddress = PublicKey.findProgramAddressSync([Buffer.from("hts-config")], program)[0];
  const config = await connection.getAccountInfo(configAddress, "confirmed");
  // GameConfig discriminator and immutable mint offset, shared with the SDK.
  const discriminator = Buffer.from(gameIdlJson.accounts.find(a => a.name === "GameConfig")!.discriminator);
  if (!config || !config.owner.equals(program) || config.data.length !== 117
    || !config.data.subarray(0,8).equals(discriminator)
    || !new PublicKey(config.data.subarray(40,72)).equals(new PublicKey(env.NEXT_PUBLIC_HTS_TOKEN_MINT!))) {
    throw new Error("HTS config mint binding mismatch");
  }
}

/** Explicit property reads let Next embed only these public bindings. */
export function assertClientDevnetConnection(connection: Pick<Connection,"getGenesisHash" | "getAccountInfo">): Promise<void> {
  return assertDevnetConnection(connection,{
    NEXT_PUBLIC_SOLANA_CLUSTER:process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
    NEXT_PUBLIC_HTS_TOKEN_MINT:process.env.NEXT_PUBLIC_HTS_TOKEN_MINT,
    NEXT_PUBLIC_PROJECT_TOKEN_MINT:process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT,
    NEXT_PUBLIC_HEADS_TAILS_PROGRAM_ID:process.env.NEXT_PUBLIC_HEADS_TAILS_PROGRAM_ID,
    NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED:process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED,
  });
}

import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { GameClient } from "@heads-or-tails/game-sdk";
import {
  backfill,
  getParsedTx,
  loadConfigFromEnv,
  makeSupabase,
  processTransaction,
} from "./indexer.js";

async function main(): Promise<void> {
  const cfg = loadConfigFromEnv();
  const connection = new Connection(cfg.rpcUrl, "confirmed");
  const provider = new AnchorProvider(
    connection,
    new Wallet(Keypair.generate()),
    { commitment: "confirmed" }
  );
  const client = await GameClient.load(provider);
  if (!client.program.programId.equals(cfg.programId)) {
    console.warn(
      `[indexer] SDK program ${client.program.programId.toBase58()} != configured ${cfg.programId.toBase58()}`
    );
  }
  const db = makeSupabase(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);

  const backfilled = await backfill(
    connection,
    client,
    db,
    cfg.cluster,
    cfg.programId,
    cfg.backfillSignatures
  );
  console.log(`[indexer] backfilled ${backfilled} settled matches`);
  if (process.env.INDEXER_ONESHOT === "1") {
    console.log("[indexer] oneshot complete, exiting");
    process.exit(0);
  }

  connection.onLogs(
    cfg.programId,
    async (logs) => {
      try {
        const tx = await getParsedTx(connection, logs.signature);        if (!tx || tx.meta?.err) return;
        const handled = await processTransaction(
          client,
          db,
          cfg.cluster,
          tx,
          logs.signature
        );
        if (handled > 0) {
          console.log(
            `[indexer] indexed ${handled} settled match(es) in ${logs.signature}`
          );
        }
      } catch (e) {
        console.error(`[indexer] tx processing failed: ${String(e).slice(0, 200)}`);
      }
    },
    "confirmed"
  );
  console.log(`[indexer] subscribed to ${cfg.programId.toBase58()} on ${cfg.cluster}`);
  await new Promise(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

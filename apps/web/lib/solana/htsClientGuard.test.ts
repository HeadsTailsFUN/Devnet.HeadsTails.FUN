import '../test/hts-release-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, Transaction } from '@solana/web3.js';
import { signAndSend } from './send';
import { DEVNET_GENESIS } from './devnetSafety';
import { HTS_TOKEN_MINT } from './releaseToken';

test('wrong RPC network or absent HTS binding fails before wallet signing or submission', async () => {
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER = 'devnet';
  process.env.NEXT_PUBLIC_PROJECT_TOKEN_MINT = HTS_TOKEN_MINT;
  process.env.NEXT_PUBLIC_MAINNET_REAL_VALUE_ENABLED = 'false';
  for (const genesis of ['wrong-network', DEVNET_GENESIS]) {
    let walletRequests = 0;
    let blockhashRequests = 0;
    let submissions = 0;
    const rpc = {
      getGenesisHash: async () => genesis,
      getAccountInfo: async () => null,
      getLatestBlockhash: async () => { blockhashRequests++; throw Error('unexpected blockhash'); },
      sendRawTransaction: async () => { submissions++; throw Error('unexpected send'); },
    };
    const wallet = { publicKey: Keypair.generate().publicKey, signTransaction: async () => { walletRequests++; throw Error('unexpected signature'); } };
    await assert.rejects(signAndSend(rpc as never, wallet as never, new Transaction()), /identity|binding/);
    assert.deepEqual({ walletRequests, blockhashRequests, submissions }, { walletRequests: 0, blockhashRequests: 0, submissions: 0 });
  }
});

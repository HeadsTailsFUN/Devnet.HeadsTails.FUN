# HeadsTails — Solana Devnet Beta

Play the hosted application at [headstails-devnet-beta.vercel.app](https://headstails-devnet-beta.vercel.app/). The current deployment uses signed-wallet admission for owner-designated restricted QA; public source availability does not open gameplay to every wallet.

HeadsTails is a wallet-connected 1v1 coin-flip game: choose HEADS or TAILS, join a room, escrow equal HTS stakes on Solana Devnet, receive genuine ORAO VRF randomness, and settle the full pot to the winner with a 0% protocol fee. Profiles, chat, leaderboard, history, Points and referrals are included.

## Verified release

| Setting | Value |
|---|---|
| Network | Solana Devnet only |
| Program | `AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k` |
| HTS mint | `HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4` |
| Token | HeadsTails / HTS, six decimals |
| Issued supply | 1,000,000,000 HTS; mint authority retained, no freeze authority |
| $1 room | 100 HTS per player; 200 HTS pot |
| $10 room | 1,000 HTS per player; 2,000 HTS pot |
| $100 / $1,000 rooms | Coming Soon |
| Conversion | Simulated Devnet Test Rate: 100 HTS = $1 |
| Eligible welcome grant | 200 existing HTS, one versioned successful claim |

**The USD reference is simulated. HTS has no asserted market price, redeemability or guaranteed financial value.** Points are off-chain records, not a promise of future tokens or compensation.

The owner personally signed real two-wallet matches in both live rooms. On-chain stakes, genuine ORAO fulfillment, exact full-pot payouts, history and Points were independently verified. Fee assistance supplied real Devnet SOL and reimbursed eligible action costs. The owner subsequently reported further successful testing; independent browser-closure recovery acceptance was not recorded. See [release verification](docs/RELEASE_VERIFICATION.md).

The website runs on Vercel. Bounded authenticated serverless recovery uses Supabase scheduling, HMAC authentication, replay protection and journaled operations; it does not require an owner PC worker. Scheduling transport was observed; this is not a guarantee of eventual settlement under every provider outage. Historical original-mint liabilities remain in their separate namespace with legacy intake paused.

## Source layout

- `programs/heads-or-tails`: Anchor program and historical compatibility.
- `packages/game-sdk`: instruction builders, PDA derivation, IDL and quote arithmetic.
- `apps/web`: Next.js application, wallet onboarding and serverless APIs.
- `supabase/migrations`: application schemas and recovery primitives; no hosted records.
- `packages/keeper`, `packages/indexer`: optional consumers, not required PC services for the hosted game.
- `vendor/anchor-syn`: pinned IDL-build compatibility patch and upstream license.

## Build and checks

Use Node.js 22 or newer compatible Node and pnpm 11.1.3.

```sh
pnpm install --frozen-lockfile
pnpm --filter @heads-or-tails/game-sdk build
pnpm --filter @heads-or-tails/game-sdk test:unit
pnpm --filter @heads-or-tails/web test:release
pnpm build
pnpm typecheck
pnpm lint
```

Copy the blank `.env.example` to ignored `apps/web/.env.local` and configure your own isolated development services. Supply a dedicated Devnet RPC and matching public/server program and mint bindings. Server signing and Supabase service credentials must remain server-only. Never upload an authority wallet or deployment-payer key to the web application. Keep sponsorship/grants disabled until their reviewed schema, custody and budgets are configured. The repository does not include private operating tools, backups, filled environment files or original private Git history.

See [development](docs/DEVELOPMENT.md), [architecture](docs/ARCHITECTURE.md), [database setup](docs/DATABASE.md), [HTS model](docs/HTS.md), [USD reference](docs/USD_REFERENCE.md) and [third-party notices](THIRD_PARTY_NOTICES.md). Building source does not authorize deployments, migrations, signing or account changes.

## License

No project-wide open-source license has been selected or granted. Public source publication does not grant additional reuse rights to project code or artwork. Dependencies retain their respective licenses; wallet marks remain third-party trademarks. See THIRD_PARTY_NOTICES.md.

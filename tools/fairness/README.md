# Independent Devnet verifier

No wallet, authentication, signing key, HeadsTails backend, database or environment file is required. The static app requests only public Solana RPC reads. Enter an HTS Match ID or PDA. The default is the official Devnet RPC; supply a different public HTTPS endpoint if it is rate-limited or blocks browser CORS. An optional second endpoint flags inconsistent evidence.

From the repository root, with Node 24 and the pinned pnpm 11.1.3:

```powershell
pnpm install --frozen-lockfile
node tools/fairness/build.cjs
# Serve artifacts/fairness using any ordinary static HTTP server.
# CLI read-only verification:
cd apps/web
node --import tsx ../../tools/fairness/verify.ts 74
# Optional public RPC URL as the final argument.
```

The output is `artifacts/fairness`. It contains static HTML, JS, CSS, existing public fonts/logo, `.nojekyll`. It can be served independently of Vercel or published using GitHub Pages from the dedicated `gh-pages` branch. Publication is a separate reviewed step; the normal website source branch does not automatically replace the static verifier. A build input manifest is written alongside the output as `artifacts/fairness-build-inputs.json` for local review, outside the published directory. `capture.ts` records public read-only Round #74 RPC responses for focused regression tests; it fails if independent verification does not succeed. Test fixture data are explicitly historical, never a fallback for the running verifier.

See [the verification core](../../apps/web/lib/fairness/verifier.ts), [account schema provenance and limitations](../../docs/FAIRNESS.md), and [the actual winner algorithm](../../programs/heads-or-tails/src/vrf.rs).

Run the focused offline regressions from `apps/web` with `pnpm run test:fairness`. The normal `test:reliability`, `test:ui-components`, `test:mobile` and `test:walletconnect` suites remain applicable. Live reads are deliberately separate: use `verify.ts` or the static app and a public Devnet RPC endpoint. These operations never submit a transaction.

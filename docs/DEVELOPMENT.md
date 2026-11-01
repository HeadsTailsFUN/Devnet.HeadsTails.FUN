# Local development

Install pinned workspace dependencies, build the SDK, configure ignored local environment values, then run `pnpm dev`. The app may render while service features remain disabled. Empty environment examples intentionally do not provide a functioning release configuration.

The web app expects a dedicated Devnet RPC, matching public/server program IDs, matching new HTS mint bindings, the service signer public identity, and Supabase URL/publishable key. Service-role and service signing secrets belong only to an isolated server environment. The token treasury, program authority, deployment payer, and service custody are separate roles. Do not use authority or payer material as a web service signer.

The server's `HEADSTAILS_RESERVED_SIGNER_PUBKEYS` setting accepts private operational exclusions; no real exclusion list is published here. Configure this setting before enabling service signing. Do not start a standalone keeper with the shared journaled service signer; that path is deliberately rejected. A separately configured keeper signer still requires its own isolated operational review.

Use `pnpm --filter @heads-or-tails/keeper typecheck` and `pnpm --filter @heads-or-tails/indexer typecheck` to check optional consumers without starting them. Their run commands may connect to networks and submit transactions or write a read model, so they are not part of a build-only check.

The retained SDK unit, HTS, and generation-compatibility tests and targeted web regressions use synthetic accounts. The source contains historical functional tests as well; this draft does not claim all historical test scripts are current release acceptance. Private local-validator ledgers, receipts, operational tools, and real account snapshots are excluded. Obtain appropriate local runtime coverage before operating a changed program.

No command in this document authorizes a public deployment, hosted migration, token issuance, or wallet signature. Never reset a hosted database to prepare a local development copy.

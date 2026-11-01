# Devnet USD reference model

The deployed restricted-QA game uses simulated USD room denominations. Both $1 and $10 real owner-wallet matches passed independent receipt verification.

| Room | HTS per player | Full pot | Availability |
|---|---:|---:|---|
| $1 |100|200|Live for authorized restricted QA|
| $10 |1,000|2,000|Live for authorized restricted QA|
| $100 |10,000|20,000|Coming Soon|
| $1,000 |100,000|200,000|Coming Soon|

Devnet Test Rate:100HTS=$1simulated USD, six decimals, zero protocol fee. No real price, market liquidity, listing, redeemability or guaranteed USD value is asserted. The reference uses deterministic integer arithmetic. The quote has a source, policy version, timestamp,30-second issuance lifetime and ceiling-to-base-unit rule. The server checks the reviewed executable binding and actual Devnet context before serving a quote. The contract independently requires the exact immutable amount for both players; browser data cannot set it. HTTP expiry is checked during client preparation and is not a dynamic on-chain oracle. A later rate change requires reviewed pause/drain and upgrade handling to avoid incompatible queued amounts.

The account layouts, PDA namespaces, instruction ABI and IDL are preserved. Historical cancellation and stored-amount settlement remain compatible. Higher room IDs remain disabled; the current u8tier encoding does not encode1,000.

New eligible wallet+mint welcome claims transfer200existing HTS after signed ownership verification. Historical claims keep their identity and are not automatically reset or topped up. Retried receipts do not report an old transfer as a new200HTS grant. Supported SOL assistance performs a real bounded wallet prefund and validated reimbursement. Service keys stay server-only; the large treasury reserve is not an automatic faucet.

A replaceable real-provider interface validates source, mint, observation age, executable liquidity and deviation against reviewed limits. No real provider is enabled here. Future live pricing also needs appropriate on-chain price authentication and release review; this Devnet source is not Mainnet readiness.

Local evidence includes native program tests, quote/admission tests, component/build checks and focused isolated Agave acceptance of exact payouts, refunds, same-ID upgrade, rollback and re-upgrade. Real hosted wallet connections, grants, fee assistance, both game rooms, history and Points were verified. No referral attribution existed for the QA players. Independent browser-closure recovery acceptance remains unrecorded. No mocked or local result is presented as live acceptance.

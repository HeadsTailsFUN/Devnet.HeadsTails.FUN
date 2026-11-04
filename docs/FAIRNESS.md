# Independent Devnet fairness and payout verification

The verifier reads Solana RPC directly. It does not query the HeadsTails backend or database, connect a wallet, request a signature or send a transaction. A transaction memo is never used in any calculation or acceptance check. Historical captured test fixtures are never used by the running tool.

The supported network is Solana Devnet, checked by its complete genesis hash. The program is `AFVnPWFoYMG1tdmRFUttmf8kf6gpi24LVkYzNmUSni7k`; the six-decimal HTS mint is `HiteMiqxQG1GjLGDmvV1JmVyR9ayWm46ZjhjHzJrN9R4`. This version supports the HTS account namespace and $1/$10 rooms. Original-mint legacy matches are deliberately not interpreted as HTS matches. Historical HTS matches created before the USD correction at slot 517449562 retain the original 1/10 HTS stakes; later HTS matches use 100/1,000 HTS. The verifier checks the appropriate denomination using the authenticated creation slot without rewriting history.

Upgradeable-loader account ownership, executable state and ProgramData headers are checked. The reviewed Devnet upgrade slots are pinned: HeadsTails 517449562 and ORAO 517655076. A later upgrade returns UNAVAILABLE until the executable and decoder are reviewed; a familiar account layout alone is insufficient to approve a new program release. This release binding does not claim an independent reproducible compiler build.

## Account/schema provenance

Game account discriminators and field order come from the checked-in Anchor IDL at `packages/game-sdk/src/idl.json`, corresponding to `programs/heads-or-tails/src/state.rs`. The decoder checks exact allocated account sizes calculated from that schema, owners, discriminators, enum/option tags, IDs, PDAs, room denomination, equal stakes and full pot. The HTS configuration and initialized classic SPL Token mint must bind to the expected mint and six decimals.

ORAO account schema comes from the official published **orao-solana-vrf 0.7.0** crate, the version in the game manifest. Crate archive: https://crates.io/api/v1/crates/orao-solana-vrf/0.7.0/download ; archive SHA256: `3a2da2b4cadd3d921e9a339cf1786ea17ef62fa6d837fe8e14183bd8e47b109e`.

`src/state/randomness_v2.rs` declares `RandomnessV2 { request: RequestAccount }`. Borsh enum variant 0 is `Pending { client: Pubkey, seed: [u8;32], responses: Vec<RandomnessResponse> }`; variant 1 is `Fulfilled { client: Pubkey, seed: [u8;32], randomness: [u8;64] }`. `RandomnessResponse` is a public key plus 64 bytes; the pinned maximum authority count is 10 and majority is 7. The discriminator is the first eight bytes of SHA256(`account:RandomnessV2`): `8befb8d7e356bfe2`.

The decoder follows that declared field sequence using a bounds-checked reader. It checks the exact ORAO PDA and owner (`VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`), discriminator, variant, seed and 64-byte fulfilled output. It does not extract a result from an unexplained byte offset. Unsupported fulfilled layouts fail unavailable. Pending output cannot certify a settled match.

The original finalized match-creation transaction must be available. Its bound `match_next_hts_room` instruction supplies the original nonce, Match ID and room. The verifier reproduces the SHA256 seed domain from `vrf.rs` and checks the original caller against the ORAO request client. This verifies the original request association rather than assuming that today's service wallet was always its caller.

## Result and payout

The algorithm in `programs/heads-or-tails/src/vrf.rs` is `randomness[0] & 1`: zero is HEADS; one is TAILS. The tool computes this before inspecting a stored winner or payout recipient.

For settled matches it checks the recorded result, winning player and settlement slot. It locates the actual successful finalized settlement transaction using Match PDA history, validates the exact `settle_hts_match` instruction and Match ID, all required account bindings, the SPL `transferChecked` instruction, correct mint/decimals/destination/vault authority, and exact winner/vault token balance deltas. The full pot must reach the calculated winner; absent metadata or an unexplained HTS movement cannot verify. Only a full successful check produces VERIFIED.

PENDING means fulfillment or settlement is genuinely incomplete. NOT VERIFIED means a check contradicts expected data. UNAVAILABLE means data cannot be fetched or a required schema/version/receipt cannot be decoded. Public RPC can rate-limit or reject browser requests; users can choose another HTTPS Devnet endpoint. Failure never falls back to a project result or hardcoded outcome. Optional second-endpoint checks report missing data or contradictory evidence instead of silently choosing an answer.

## Reference Round #74

The actual public RPC capture in `tools/fairness/fixtures/round74.json` independently passed the full verifier:

- Match PDA: `Gt8mjdLuMEpW6RJL8Q6wDfHVyKfNoFYe8R3NAz96Ljxc`.
- ORAO: `5heYX3c7zQQiNkp18NVWPeogodSsoSKchWi6qPK4LgDK`, verified program owner above.
- Seed: `418bf40707e79dbd44f01e77c927cd55e5245e4bb5cffa65876fad54cdf217fe`.
- Randomness: `1b21f673be8aa5001229628fbd0dcb66e86e6a0a3bba5e66404970084fa79b9ca33552f485ca72ca902a0a5d37e0666f9472519ca82eea3d061afb60c08ebe00`.
- First byte 27 / hex `1b` / binary `00011011`; bit 1, independently calculated TAILS.
- Recorded and independently calculated winning wallet: `EWMAhKQsGZ7ynGBRNjPHiw36xkur6hoQ3EfhY8xvU1qt`.
- Payout: 200,000,000 base units = **200 HTS**, full pot, six decimals.
- Settlement: `35qMajS7uK8Yj5uV8hqcsdZay4pnsQPKdcxSU4t7Fh6cdYF3RmJiw6ExYjxtC3hfQaFLTf1as6AjPv4rRZLcfUYw`, slot 518044000.

## Separate assurance claims

1. Reproduced randomness calculation: supported by the verified account bytes and algorithm.
2. Match outcome consistency: checked independently from the owned Match PDA and request transaction.
3. Payout: checked independently from successful original instruction and token balance metadata.
4. Source-to-binary correspondence: **separate evidence**. Read-only executable inspection matched the retained approved 682,968-byte USD-release artifact SHA256 `7bb5509ab81f9d7aae8842c8029e5a4257cff50a081ae227b42354b89c0df770`, with zero trailing capacity, upgrade slot 517449562 and the unchanged recorded authority. The 13 retained program-source/manifest files matched the current public source byte-for-byte. A fresh independent reproducible Rust build was not repeated in this task; it is not implied by VERIFIED.

This is consistency verification of ORAO program-owned data. It is **not** an independent audit of the VRF cryptographic proof, Solana consensus or RPC honesty. Choose an independent RPC provider, repeat against another endpoint, inspect the public source and reproduce the static build. Explorer links expose data; explorers do not automatically certify the winner.

## Navigation and release

The existing desktop footer and mobile Profile footer link to `/how-to`. Within the game, navigation opens the guide in the existing stateful shell (desktop overlay/mobile information view), preserving the mounted game and wallet controller. Direct loading of `/how-to` also works without connecting a wallet. No extra mobile tab is added. The static standalone build and Pages publishing instructions are in `tools/fairness/README.md`.

The settlement repair uses fee plus measured missing-ATA rent instead of a blanket 0.05 SOL reservation. Signed simulation, budget admission, journal fencing, persisted-transaction retries and on-chain idempotency remain enforced. Reconciliation reads both config counters and drains durable jobs even if a namespace is missing. A rejected automatic request can retry rather than permanently marking its client-side request as sent. Result-known/payout-pending copy is distinct from randomness still flipping. No contract, mint, payout formula, authority, historical data or points-policy change is part of this release.

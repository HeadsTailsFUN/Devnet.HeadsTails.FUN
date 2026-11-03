# WalletConnect in the Devnet beta

The mobile wallet chooser offers WalletConnect for wallets that approve Solana Devnet transaction and message signing. The existing wallet-browser links remain available. A desktop user without an injected extension gets an optional QR fallback; detected desktop extensions keep their existing selector.

WalletConnect keeps the game in the normal browser. Users still approve the connection, ownership challenge and each gameplay transaction in their own compatible wallet. Wallet support for Devnet varies. A wallet supporting WalletConnect on another network is not automatically suitable for this game.

The owner-supplied Reown project ID is a public client identifier. The canonical site's origin must be allowed in that project. Preview/localhost origins can be rejected unless independently allowed; this is not a reason to weaken origin restrictions.

The implementation pins AppKit core 1.8.19 and Universal Provider 2.23.7 and loads them on demand. Its modal exposes only the Solana Devnet network. Email/social login, purchases, swaps, send UI, analytics and protocol telemetry are disabled. Project, contract, mint, payout, sponsorship, grant eligibility and backend authentication rules are unchanged.

The transport is adapted to the existing Wallet Standard context, rather than adding a second wallet/game provider. It requests only `solana_signTransaction` and `solana_signMessage` on `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Mainnet, expired, multi-account and incomplete signing sessions fail closed. It never exposes a send-transaction feature: the existing game submission/reconciliation flow remains responsible for broadcasting.

The bridge verifies the ownership signature and the wallet's transaction signature, rejects changed transaction messages and erased co-signer approvals, and rechecks session/account identity after signing. Session changes update the same account context used by authentication. A late silent restore cannot override an explicit user choice. Session restoration never requests a new approval. Pairing cancellation and timeout abort the pending attempt; a late approval from a cancelled attempt is disconnected.

Wallet/private recovery keys are never requested or exported. WalletConnect stores its protocol session locally through the SDK under a Devnet-specific prefix; these are not wallet private keys. Pairing URIs and protocol keys must not be put in source, reports, logs or screenshots. The application does not log them.

## Acceptance

Run `lib/solana/walletConnectBridge.test.ts` for synthetic, offline message/legacy/v0 signing, session and alteration checks; run `components/wallet/WalletConnectProvider.test.tsx` with the existing jsdom setup for actual-context account changes/revocation. Existing mobile, controller and ownership tests remain applicable.

Physical acceptance requires the owner: open the canonical HTTPS URL in Safari/Chrome, choose WalletConnect, approve a Devnet-capable wallet connection, return to the browser, verify the expected address, review the ownership challenge, refresh/reconnect, and test one normal match through the existing explicit stake signature. Never auto-confirm wallet prompts. A rendered modal/QR or a synthetic test is not proof of a successful live wallet connection or payout.

References: [Reown Universal Provider](https://docs.reown.com/advanced/providers/universal), [Reown AppKit](https://docs.reown.com/appkit/react/core/installation), [official Solana adapter protocol reference](https://github.com/WalletConnect/walletconnect-solana-adapter).

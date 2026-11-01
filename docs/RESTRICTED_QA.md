# Hosted restricted QA

The actual game is deployed at https://headstails-devnet-beta.vercel.app/. HTS intake is open under the USD-corrected executable; legacy intake remains paused. The website requires signed ownership sessions for the two owner-designated QA wallets. Bare public addresses are not authentication. The underlying program is permissionless; website admission is not an on-chain allowlist.

Real owner-wallet $1 and $10 games passed independent on-chain receipt verification: exact 100/1,000 HTS stakes, genuine ORAO request and fulfillment, 200/2,000 HTS full-pot payout, hosted history and +5/+2 winner/loser Points. Extra queue cancellation returned its full stored stake. The owner reported broader successful tests afterward. Independent pending-match settlement after browser closure was not captured and is not claimed.

Hosted recovery uses bounded serverless execution, short-lived origin/method/path/mint-bound HMACs and service-only atomic nonce claims. Secrets remain server-only. Scheduler requests reached the current deployment successfully. A successful transport response alone does not prove every pending match can be recovered.

No public opening, Mainnet deployment or authority change is implied by source publication.

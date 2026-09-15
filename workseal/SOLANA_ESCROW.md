# WorkSeal Solana escrow successor

This directory extends the merged WorkSeal evidence-gated settlement MVP with an **offline-verifiable Solana SPL-token escrow authority model** and a source-level Anchor program.

## What materially changed

The original WorkSeal adapter intentionally stopped at a client-side transfer plan. This successor moves the authority boundary to an escrow state machine:

1. Normalize the WorkSeal task. The task currency is `SPL:<mint_pubkey>`, so the exact token mint is part of the task digest.
2. Derive the escrow PDA from `workseal-v1 || task_digest` and derive canonical buyer, worker, and vault associated-token accounts.
3. **Buyer and worker co-sign escrow initialization**, binding the task digest, mint, integer amount, verifier fingerprint, and task-deadline refund clock before funding. This prevents the payer from silently shortening the refund window or changing economics.
4. Buyer funds the exact amount into the escrow vault. The offline state only advances from `UNFUNDED` to `FUNDED` when the observed signer/account/mint/amount/PDA tuple exactly matches the plan.
5. Work is committed and accepted through the existing WorkSeal signed-acceptance protocol.
6. The same Ed25519 verifier authority whose SPKI fingerprint was pinned by WorkSeal must sign the exact settlement authorization / Solana settle transaction. The signed fields include result digest, signed-acceptance digest, event head, and generation.
7. Settlement transfers the full escrow amount exactly once to the worker ATA. Refund instead requires the buyer signer **and cannot execute before the task deadline**; it is mutually exclusive with settlement.

This removes a dangerous seam where merely presenting an acceptance digest could be mistaken for authority to move funds. A settlement needs the pinned verifier key again, and its signature covers the exact generation being paid.

## Offline authority model

`src/escrow.mjs` has no third-party runtime dependency. It implements strict base58 public-key handling, Solana-compatible PDA search, canonical ATA derivation, exact SPL-mint binding, u64 amount bounds, binding/state tamper checks, Ed25519 authority bridging, detached settlement/refund signatures, and terminal replay protection.

The simulator deliberately returns `writePerformed:false` and `deploymentObserved:false`. It does **not** perform RPC calls, sign a Solana transaction, transfer tokens, or claim that the Rust program has been deployed.

## Source-level Anchor program

`solana-program/src/lib.rs` mirrors the authority model:

- PDA: `[b"workseal-v1", task_digest]`
- canonical SPL associated-token accounts for buyer / worker / vault
- initialization requires both buyer and worker signers for the frozen economic/refund terms
- `UNFUNDED -> FUNDED` only with buyer signer + exact transfer
- `FUNDED -> SETTLED` only with the pinned WorkSeal verifier signer
- `FUNDED -> REFUNDED` only with buyer signer after the task-bound `refund_after_unix` deadline
- terminal phases cannot transition again
- `transfer_checked` uses the mint's decimals and escrow PDA signer seeds

`solana-program/idl/workseal_escrow.source.json` is intentionally labeled **source contract, not generated IDL**. The checked-in `declare_id!` is a source-local synthetic identity with no retained deployment keypair; a real deployment must generate/sync a program keypair and update the JS/source-contract/Rust program ID together before any build/deploy claim. Until an Anchor/Solana toolchain compiles the program and a deployment transaction is independently observed, those states remain unclaimed.

## Local proof

From `workseal/`:

```bash
node --test test/escrow.test.mjs
node src/escrow_demo.mjs
```

The deterministic proof remains CLI-only here (`node src/escrow_demo.mjs`). Main already gained the separate WorkSeal browser/WebCrypto + retained GitHub-evidence lane in PR #74 after this successor was claimed; this change deliberately does not duplicate or edit that owner’s `workseal/web/**` surface.

## Explicit non-claims

This source does not register for Colosseum, accept competition terms, connect a wallet, publish a private key, write to an RPC endpoint, move SOL/SPL tokens, deploy a program, submit an entry, receive funding, win a prize, or recognize revenue. All demo keys/mints and balances are synthetic.

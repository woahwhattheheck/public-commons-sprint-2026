# WorkSeal on-chain PDA escrow successor

This directory moves WorkSeal from a client-authority SOL transfer plan to a chain-enforced escrow design while preserving the merged MVP's exact-task / exact-result / signed-acceptance model.

## Executable semantic model

`reference.mjs` is the deterministic executable state model. It enforces task/buyer/program-bound escrow identity, exact role keys, canonical u64 atomic amounts, monotonic result generations, pinned-verifier acceptance, exact payee/amount, SPL mint + token-program + token-owner binding, deadline-gated pre-accept cancellation, and terminal SETTLED/CANCELLED states. Once the pinned verifier acceptance exists, settlement is permissionless: the buyer cannot re-acquire a veto, while the program still cannot redirect the payee or amount.

`solana_plan.mjs` gives a browser/client the complete write-free lifecycle plan: INITIALIZE, exact SOL or SPL funding, COMMIT_RESULT, an Ed25519-precompile predecessor plus ACCEPT_RESULT, exact settlement, and deadline cancellation/refund. Classic SPL Token and Token-2022 IDs are explicitly admitted. Every plan contains `writePerformed:false`; this module never touches a wallet or RPC endpoint.

## Rust program source

`program/src/lib.rs` implements the corresponding Solana program path:

- program-owned PDA state at `[b"workseal", task_digest, buyer]`;
- PDA creation funded by buyer rent;
- exact SOL funding through System Program transfer;
- SPL/Token-2022 `TransferChecked` CPI with mint, program, source-owner and vault-owner checks;
- worker-signed monotonic result commits;
- acceptance only when the immediately preceding Ed25519 program instruction verifies a 32-byte `WORKSEAL_ACCEPT_V1` message under the pinned verifier key;
- permissionless post-accept settlement, but only exact amount to the pinned worker / worker-owned mint-bound token account;
- cancellation only by buyer after chain clock passes deadline and only before acceptance, refunding only to buyer;
- checked generation/lamport arithmetic and one-way terminality.

This runtime has Node but **does not have Cargo/Solana tooling**, so no local Rust/SBF compilation or deployment is claimed. CI installs rustfmt and runs source-shape guards; a future SBF/local-validator receipt is still required before calling the Rust program deployable. That is a tooling verification gap, not a hidden client-authority fallback.

## Validation

From `workseal/`:

```bash
node --test
node src/cli.mjs demo
```

The added hostile suite covers PDA identity aliasing, wrong signers, generation replay, stale result acceptance, verifier substitution, deadline boundaries, cancel redirection, double settlement, exact payee/amount, u64 overflow, SPL mint/program/owner substitution, Token-2022 planning, and write-free lifecycle planning. A separate test guards the Rust source for the critical custody invariants and rejects deliberate `Custom(10x)` stubs.

## Authority boundary

No private key is read, no RPC call is made, no SOL/token moves, no program is deployed, and no Colosseum registration/terms/submission/prize/funding/revenue event is claimed. Those are separate explicit-authority and provider events.

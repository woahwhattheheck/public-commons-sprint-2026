# WorkSeal executable Solana proof

WorkSeal's JavaScript escrow model and source-level Anchor program are intentionally not deployment claims. This successor adds a stronger offline proof: the actual `workseal_escrow` Anchor entrypoint is executed inside `solana-program-test` together with native SPL Token and associated-token processors.

## What the hosted test proves

`solana-program/tests/program_test.rs` creates only synthetic in-process state. It creates an SPL mint, buyer and worker associated token accounts, derives the real WorkSeal escrow PDA/vault ATA, then executes the same Anchor instructions that a client would submit:

- `initialize -> fund -> settle`: exact escrow amount leaves the buyer ATA, lands in the PDA-owned vault, and then moves exactly once to the worker ATA when the pinned verifier key signs the settlement instruction.
- Wrong-verifier settlement fails without moving vault tokens.
- Replaying settlement after the terminal transition fails and cannot double-pay.
- `initialize -> fund -> refund`: a buyer refund fails before the frozen deadline, succeeds after the deterministic test clock advances, returns the exact escrow amount, and then becomes terminal.
- Account state is deserialized through Anchor after execution so phase, generation, result digest, acceptance digest, and event head are checked from the bank rather than inferred from the client request.

The existing Node protocol/escrow hostile suite still runs in the same workflow, so the off-chain receipt semantics and the executable on-chain authority path are checked together.

## Reproduce

From repository root:

```bash
cargo test --manifest-path workseal/solana-program/Cargo.toml --test program_test -- --nocapture
```

The workflow also runs:

```bash
cargo check --manifest-path workseal/solana-program/Cargo.toml
```

## Truth boundary

This test does not connect to a Solana RPC endpoint, wallet, faucet, devnet, testnet, or mainnet. It does not deploy a program or move real tokens. All keypairs, lamports, token balances, mint addresses, clock values, PDAs, and transaction effects exist only in the ephemeral `solana-program-test` bank. A real deployment still requires a deployment keypair/program-ID synchronization, wallet/RPC authority, and independent observation of the deployment transaction.

It also does not register for, accept terms for, or submit to the Colosseum Crypto World's Fair, and it makes no prize, funding, payment, or revenue claim.

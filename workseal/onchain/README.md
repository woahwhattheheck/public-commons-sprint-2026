# WorkSeal onchain escrow

This directory is the source-level Solana enforcement layer for WorkSeal. It moves settlement authority out of the buyer's client and into a program-derived escrow account that owns a token vault.

## Authority model

The PDA is derived from:

```text
["workseal", buyer, worker, taskDigest, mint]
```

The token vault is a second PDA:

```text
["vault", escrowPda]
```

The vault is an SPL token account whose token authority is the WorkSeal escrow PDA. Funding, release, and refund use `transfer_checked`, so the mint and its onchain decimals participate in the transfer.

The program pins:

- buyer, worker, verifier Solana authorities;
- exact SPL mint, token program, buyer funding token account, and worker destination token account;
- task and acceptance-policy SHA-256 commitments;
- Ed25519 receipt-authority fingerprint from the offchain WorkSeal protocol;
- exact base-unit amount and deadline;
- monotonic result generation plus result digest;
- exact signed-acceptance envelope digest before release.

## State machine

```text
CREATED --buyer SPL funding--> FUNDED --worker commit--> COMMITTED
                                  |                       |
                                  |                       +-- verifier accept --> ACCEPTED -- PDA release --> RELEASED
                                  |                       |
                                  +-- expiry refund ------+-------------------------------> REFUNDED
                                  |
                                  +-- buyer/worker dispute -------------------------------> DISPUTED
```

`RELEASED`, `REFUNDED`, and `DISPUTED` are terminal in this v1 source. A dispute intentionally freezes the vault rather than guessing an arbitration outcome.

Release is permissionless once the pinned verifier has accepted the exact current generation: no buyer signature is required. The program signs the SPL transfer with the escrow PDA seeds and transfers exactly the pinned amount to a token account owned by the pinned worker. This removes the parent MVP's "buyer validates then signs a direct transfer" trust gap.

## Acceptance boundary

The existing WorkSeal protocol creates and Ed25519-signs the acceptance receipt. This onchain program pins that receipt authority fingerprint and requires the pinned **Solana verifier signer** to record the exact `acceptance_digest` for the current `task_digest`, `result_digest`, and generation.

That means chain state enforces who can attest acceptance and what exact commitment is released, but this v1 program does **not** introspect a Solana Ed25519 precompile instruction to independently re-verify the offchain receipt signature. Adding instruction-sysvar Ed25519 verification is a separate hardening seam, not something this carrier pretends to have done.

## SPL / USDC profile

The program uses Anchor's token-interface accounts and pins the mint in both the escrow PDA seed and account state. The USDC profile uses the canonical USDC mint for the chosen cluster and amount in the mint's base units. `transfer_checked` uses the mint account's actual decimals; the program does not trust a client-supplied decimal count.

The browser/reference demo uses the public mainnet USDC mint address only as a deterministic identity example. It does not connect to mainnet, query balances, create accounts, or transfer tokens.

## Toolchain and verification truth

Source is pinned to Anchor `1.1.1` (`anchor-lang` and `anchor-spl`). The authoring seat had Node v22.16.0 but did **not** have Rust, Anchor, or Solana CLIs installed, so no Anchor build, deployment, program-test, validator, or transaction claim is made here.

When the matching toolchain is available, the intended build commands are:

```bash
cd workseal/onchain
anchor build
anchor test
```

The repository's ordinary `npm test` suite executes a dependency-free reference state machine plus source-contract tests that assert the critical PDA seeds, token constraints, signer separation, acceptance bindings, `transfer_checked` use, and terminal rules. Those tests are useful invariant evidence; they are not a substitute for compiling and testing the Rust program with Anchor.

Program source ID: `BvfrbqcMAERN2VTA9LT84Y4j228UULhsz2iwtKo3aqeA`. It is an undeployed source identity in this carrier, not evidence of a deployed program.

## External authority boundary

Nothing in this directory performs or authorizes:

- wallet creation/import/signing;
- RPC writes or token transfers;
- devnet/mainnet deployment;
- Colosseum registration, terms acceptance, or submission;
- prize, funding, revenue, or payment claims.

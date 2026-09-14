# WorkSeal

**Evidence-gated settlement for agent and contract work.**

WorkSeal makes settlement depend on the exact work that was requested, the exact result generation delivered, and an independently authorized acceptance. The first carrier proved deterministic signed receipts and a plan-only Solana transfer. The onchain successor adds a PDA-owned SPL escrow so an accepted result can release funds without asking the buyer to make a second discretionary payment decision.

This directory is an event-time source carrier for Colosseum Crypto World’s Fair 2026. It is **not** a claim that the project has been registered, submitted, judged, funded, deployed, or paid. External Colosseum account actions and any wallet/RPC writes remain separate explicit-authority steps.

## Settlement architecture

```text
Task + policy --------------------------------------------------------+
  |                                                                  |
  +--> taskDigest + policyDigest                                     |
                                                                      v
Buyer SPL token account -- transfer_checked --> PDA vault        FUNDED
                                                   |                  |
Worker result gen N --> resultDigest -------------+--> COMMITTED     |
                                                   |                  |
Pinned verifier + signed acceptance commitment ---+--> ACCEPTED      |
                                                                      |
Any caller may invoke release; escrow PDA signs exact SPL transfer ---+
                                                                      v
                                                                  RELEASED
```

Alternative terminal paths are buyer refund **after deadline and before acceptance**, or buyer/worker dispute freeze. The pinned SPL mint participates in the escrow PDA identity and every vault transfer.

## Layers

### 1. Offchain evidence protocol

`src/protocol.mjs` binds:

- exact buyer, worker, amount, deadline, and acceptance policy;
- exact task digest and monotonic result generation;
- result artifact/evidence digests;
- verifier id/version;
- Ed25519 receipt-authority fingerprint and signature;
- signed acceptance envelope digest;
- settlement intent and event-chain head.

The existing `src/solana.mjs` plan-only adapter remains useful for compatibility and comparison, but its direct System Program transfer is **client-authority** and is not the hardened escrow path.

### 2. Executable escrow reference model

`src/escrow.mjs` is dependency-free and models the onchain authority/state rules. It produces deterministic PDA seed commitments and non-writing instruction plans (`writePerformed: false`). Tests exercise wrong buyer/source/mint, amount mismatch/overflow, stale generation, wrong verifier and receipt authority, cross-task/cross-vault transplant, replay, over-release, premature refund, and dispute bypass.

The model is an executable invariant oracle, not a substitute for Solana's actual PDA derivation or program execution.

### 3. Anchor / SPL program source

`onchain/programs/workseal_escrow/src/lib.rs` implements the source-level enforcement layer:

- escrow PDA seeds: `['workseal', buyer, worker, taskDigest, mint]`;
- token-vault PDA seeds: `['vault', escrowPda]`;
- exact mint + token-program pinning;
- exact buyer funding + worker destination token-account pinning;
- `transfer_checked` for buyer funding, PDA release, and expiry refund;
- worker-only monotonic result commits;
- verifier-only acceptance of exact task/result/generation plus pinned receipt-authority fingerprint;
- permissionless release after ACCEPTED, signed by the escrow PDA;
- buyer-only expiry refund before acceptance;
- buyer/worker dispute freeze;
- terminal replay resistance through phase state.

See `onchain/README.md` for the precise trust and toolchain boundary.

### 4. Browser + retained-evidence proof

The current mainline browser/evidence carrier (`web/index.html`, `web/demo.mjs`, `web/core.mjs`, and the GitHub retained-evidence adapter) remains the judge-facing proof surface. This successor does not overwrite it. It adds the escrow model/program underneath that surface, preserving the browser carrier's explicit no-wallet/no-RPC boundary while giving the next integration step a chain-enforced settlement target.

## Fail-closed invariants

- Amounts are positive integer base units and the model rejects values above Solana `u64`.
- Unknown offchain protocol fields are rejected instead of ignored.
- Every result binds the exact task, worker, and next generation.
- ACCEPT binds the exact current result/generation and the pinned receipt-authority fingerprint.
- The onchain verifier is a pinned Solana signer distinct from buyer and worker; a different signer cannot authorize release.
- Escrow identity binds buyer + worker + task digest + SPL mint.
- Vault identity binds the escrow PDA and the vault's token authority is the escrow PDA.
- Exact buyer funding and worker destination token accounts are pinned at initialization; funding/release/refund cannot swap in another same-owner token account.
- SPL transfers use the pinned mint and token program; no generic System Program value transfer is used by the escrow program.
- Release/refund move exactly the pinned amount once. Extra vault tokens cannot increase the settlement amount.
- ACCEPTED cannot be refunded; DISPUTED cannot release or refund in v1.
- The Node instruction planner hard-codes `writePerformed: false`.

## Run the verified local surfaces

Requires Node 20+ and no third-party npm packages.

```bash
cd workseal
npm test
npm run demo
```

To view the offline browser surface, serve `workseal/` with any static HTTP server and open `web/`. Serving the files does not connect the demo to Solana.

The original CLI demo still exercises the Ed25519 receipt and plan-only SOL adapter. Mainline also carries the browser/GitHub retained-evidence proof from #74. This successor adds the SPL escrow reference model and Anchor source-contract assertions without replacing those surfaces.

## Anchor build boundary

The program source is pinned to Anchor `1.1.1`. The authoring environment for this successor had Node v22.16.0 but no Rust/Anchor/Solana CLI, so **no Anchor compilation, validator execution, deployment, or onchain transaction is claimed**. With the matching toolchain installed, the intended source build entrypoint is:

```bash
cd workseal/onchain
anchor build
anchor test
```

The undeployed source program ID is `BvfrbqcMAERN2VTA9LT84Y4j228UULhsz2iwtKo3aqeA`.

## Product / competition path

The product wedge is dispute-reducing proof of exactly what an agent or contractor was paid for, now with a path from signed acceptance to chain-enforced SPL escrow. Suitable work classes include bug bounties, AI-agent freelancing, procurement micro-contracts, research deliverables, and API/data jobs.

Remaining substantive seams after this source carrier:

- compile/program-test the Anchor program under the pinned toolchain and repair any toolchain-specific issues;
- add Ed25519 instruction-sysvar verification if the verifier transaction signer should not be trusted to attest the offchain receipt signature;
- add cluster-aware USDC mint profiles and associated-token-account creation UX;
- connect a wallet/RPC only under explicit owner authority, then deploy to devnet and replace model PDA commitments with actual addresses/explorer receipts;
- register/submit to Colosseum only after owner/account authority and current competition requirements are rechecked.

## Competition facts used for the parent carrier

The parent carrier checked Colosseum's event/accelerator facts on 2026-09-14. Those external facts are intentionally not treated as durable protocol input and must be revalidated before any external submission action.

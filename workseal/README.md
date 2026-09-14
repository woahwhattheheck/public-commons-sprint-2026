# WorkSeal

**Evidence-gated settlement for agent and contract work.**

WorkSeal makes a payment instruction depend on the exact work that was requested, the exact result generation that was delivered, and an independently signed acceptance receipt. It is designed for agent-to-business work where “the model says it succeeded” is not enough authority to release money.

This directory is an event-time source carrier for Colosseum Crypto World’s Fair 2026. It is **not** a claim that the project has been registered, submitted, judged, funded, deployed on mainnet, or paid. External Colosseum account actions and any wallet writes remain separate explicit-authority steps.

## Problem

Autonomous agents can discover work, produce artifacts, and even prepare payments, but a commercial settlement rail needs stronger answers to four questions:

1. What exact task and acceptance policy did the buyer authorize?
2. What exact result generation is being paid for?
3. Which verifier is allowed to say the work passed?
4. Can an old “PASS” receipt be replayed after the worker uploads a newer result?

WorkSeal binds all four into deterministic content-addressed receipts.

## Protocol

```text
buyer + worker + amount + deadline + acceptance policy
                         |
                         v
                  taskDigest (sha256)
                         |
                funding reference
                         |
                         v
worker result gen N -> resultDigest ----+
                                        |
verifier checks exact policy            |
      + exact result generation          |
      + Ed25519 signature                |
                                        v
                               acceptanceDigest
                                        |
                                        v
                             settlement intent
                         task/result/receipt/head
                                        |
                                        v
                    chain-specific transaction plan
```

### Fail-closed invariants

- Currency amounts are positive decimal integer strings, never floating point.
- Authority timestamps require explicit RFC3339 timezones.
- Unknown protocol fields are rejected instead of ignored.
- Every result binds the exact `taskDigest`, worker id, and monotonic generation.
- An ACCEPT receipt covers every requirement exactly once; any false requirement prevents receipt creation.
- Receipt verifier id/version are pinned by the task.
- The receipt authority public key fingerprint is pinned before funding.
- Settlement binds the signed acceptance envelope (receipt digest + authority fingerprint + Ed25519 signature), not merely the unsigned receipt.
- Old acceptance receipts cannot authorize a newer result generation.
- Settlement intent binds task, result, acceptance receipt, funding reference, amount, parties, and the current event-chain head.
- The Solana adapter is a **transaction plan only**: it hard-codes `writePerformed: false`; no wallet or RPC mutation is hidden behind the demo.

## Why it is different from the existing Agent Revenue Rail

`ethonline_agent_revenue_rail/graph_purchase_policy` is a **pre-purchase buyer policy**: should an agent BUY/SKIP/HOLD a metered report based on live reputation and budget evidence?

WorkSeal is a **post-delivery settlement protocol**: after a task has been funded and a result delivered, is there an exact signed acceptance receipt for *this* result generation that can authorize a settlement instruction? The two can compose: a revenue rail can decide whether to buy; WorkSeal can bind what actually gets paid after delivery.

## Run

Requires Node 20+ and no third-party packages.

```bash
npm test
npm run demo
```

The demo generates an ephemeral Ed25519 verifier key, creates and funds a task state, commits a result, signs an ACCEPT receipt, derives the settlement intent, and prints a deterministic Solana devnet transaction plan. It does **not** submit the transaction.

## Solana MVP adapter

`src/solana.mjs` currently supports `SOL_LAMPORTS` and emits a deterministic two-instruction plan:

1. a Memo instruction containing `WORKSEAL:v1:<settlementIntentSha256>`;
2. a System Program transfer from the task buyer settlement address to the worker address.

This is deliberately a **client-authority MVP**, not an escrow smart contract. The client MUST validate the pinned signed WorkSeal acceptance before signing the transfer. A production Colosseum submission should add an onchain escrow/PDA program or payment-channel integration so settlement authority is enforced by chain state rather than only by the signing client.

## Product path

WorkSeal targets bug bounties, AI-agent freelancing, procurement micro-contracts, research tasks, and API/data jobs where the buyer wants machine-verifiable acceptance before settlement. The commercial wedge is not “payments for agents” in the abstract; it is **dispute-reducing proof of exactly what a payment was for**.

Near-term build order:

- deploy a Solana devnet escrow program that pins `taskDigest`, worker, verifier authority, generation, amount, and deadline;
- add USDC/SPL-token settlement;
- add verifier adapters for GitHub Actions, signed artifact manifests, and reproducible CLI checks;
- build a browser demo showing task → delivery → acceptance → settlement with Explorer links;
- register/submit to Colosseum only after owner/account authority and current competition requirements are rechecked.

## Competition facts used for this carrier

As checked on 2026-09-14, Colosseum lists Crypto World’s Fair as an online hackathon running Sep 14–Oct 12 and describes its hackathons as four-week startup/product competitions. Colosseum says winners receive non-dilutive prizes and selected winners may be considered for its accelerator; the accelerator page currently says accepted startups receive a $250,000 investment and require some Solana integration. Those external facts should be revalidated at submission time.

Current external references used for the competition boundary:

- https://colosseum.com/hackathon
- https://blog.colosseum.com/expanding-the-arena/
- https://colosseum.com/accelerator

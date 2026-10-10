# SF-38 | x402 v2 Stellar cross-network conformance reader

**MIT · Node.js 22+ · read-only tooling, not a facilitator or a wallet.** Separate canonical wire conformance and actual chain inclusion from cryptographic signature and SEP-41 token transfer proof. No RPC writes, signer secrets, `POST /settle`, `POST /verify`, mainnet payments, Actions, deployments, SCF application or external outreach.

## Exact source custody — October 10, 2026

* x402 Foundation [v2 spec](https://github.com/x402-foundation/x402/blob/f8f83309706b14cc696962f0a002eeeb66c3dc26/specs/x402-specification-v2.md), blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198` — `/supported` (`kinds`, `extensions`, `signers`), identical `/verify` and `/settle` envelope shapes, `invalidReason`/`errorReason`, `SettlementResponse.transaction`, pending settlement behavior.
* Foundation [generic `upto`](https://github.com/x402-foundation/x402/blob/f8f83309706b14cc696962f0a002eeeb66c3dc26/specs/schemes/upto/scheme_upto.md), blob `202dae031d453db9cf46cd52de92c1800aee33f5` — verify max M, settle actual m (0 <= m <= M), cryptographic recipient+nonce+deadline requirements to be independently proven by canonical Stellar SDK/chain.
* [Stellar upstream](https://github.com/stellar/x402-stellar/tree/45d735ab3f30a50286d11286b7d7e584fa69bc77) exact SHA `45d735ab3f30a50286d11286b7d7e584fa69bc77`.
* Existing fleet [SF37 v2 Stellar `upto` profile](../sf37-upto-interoperability/upto-profile.mjs) blob `e5a0fd3b273aa33c16d2cf1184f6940a7ebf90d5`, and [SF43 genuine-testnet acceptance](../sf43-agent-commerce/verify.mjs) blob `16ff274599b9b3e6586b9e2f2a8072d248f7e69a`. **Reuse** their structural and event-derived transfer verification rather than treating this recorder as a replacement. Open Foundation Stellar `upto` proposals #3134/#3098 are not an approved SDK or live mainnet guarantee.

## Actual command surface

```sh
node cli.mjs pins
node cli.mjs audit ./observations.json
node cli.mjs supported https://YOUR-AUTHORIZED-FACILITATOR.EXAMPLE    # GET only
node cli.mjs horizon stellar:testnet 012345...64hex              # GET root + transaction only
node --test test/conformance.test.mjs                         # focused local test
```

`audit` expects `{ "schema":"sf38.v1", "observations":[...] }`. Each observation has a unique `id`, `phase` (`supported`, `verify`, or `settle`), `network` (one of `stellar:testnet` or `stellar:pubnet`), `scheme` (`exact`, `upto`), a **recorded** `response`, and for verify/settle the exact `request` body containing `x402Version:2`, `paymentPayload:{x402Version:2,accepted,payload}` and `paymentRequirements`. Use source-authenticated captured API wire bytes and timestamps in your own custody, redact secrets before sharing. This tool does not create or transmit payment authorization. Do not invent signed payloads as evidence.

`audit` always labels provider recordings `RECORDING_NOT_CHAIN_PROOF`; even an apparently successful settlement response is not a cryptographic proof. The optional `horizon` command reads ONLY the official `horizon-testnet.stellar.org` or `horizon.stellar.org` GET root (must match the canonical network passphrase) and transaction by hash. A successful matching read proves **transaction inclusion only**, not transfer asset/recipient/amount, not auth signature, and not attribution of the transfer to a particular HTTP resource. Combine actual SF43 canonical SDK event decoder with original tx event logs for transfer evidence.

## SCF conformance evidence matrix (no unearned live claims)

| Mechanism | `stellar:testnet` | `stellar:pubnet` | Required promotion evidence |
| --- | --- | --- | --- |
| `exact` | Not measured by this package | Not measured by this package | Stock `@x402/stellar` client+original 402, `/supported` true, real `/verify`, `/settle`, actual ledger tx and decoded SEP-41 event |
| `upto` | Proposed binding; not demonstrated by this package | Proposed binding; not demonstrated by this package | Accepted network spec + canonical SDK, signed max and metered actual, nonce single-use, tx+events, Soroban auth/ledger expiry, trusted settlement contract |

For **both** networks verify positive and negative `/supported` kinds, `extra.areFeesSponsored` as a boolean when present, `verify` read-only without network transaction, v2 shape, exact/upto phase amount drift, transaction/network mismatch, `settlement_pending` nonempty transaction, rejection reason, replay, invalid signer, wrong recipient/asset, time/ledger expiry, 0/M/over-M. Event-derived charges and actual positive/negative RPC receipts are separate acceptance layers. Production evidence also needs provider URL, recorded-at UTC, hash of original raw response, current source and contract/WASM SHA, RPC network passphrase, decoded SEP-41 recipient+amount, elapsed time, scorer denominator and provenance. Do not copy purported hashes from another project's ledger as this project's paid calls.

This is a **real executable wire auditor** and read-only proof tool. It is not an SDK compatibility claim or a passed end-to-end payment certification; future authorized stock-client testnet and mainnet runs fill matrix cells. No broad repository tests or GitHub-hosted CI have been invoked.

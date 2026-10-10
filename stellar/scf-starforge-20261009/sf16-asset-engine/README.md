# SF-16 | Exact Stellar SEP-41 asset amounts (MIT / Node 22+)

This is the original standalone asset admission and amount normalization module for the SCF STARFORGE product effort. It **does not transfer, authorize, sign, query the ledger, select a facilitator, or verify a real trustline**. The aim is to make it impossible for an x402 v2 admission caller to silently convert money through IEEE-754 floating-point arithmetic, accept an unknown asset or network, or accept an unverified recipient state. There are no npm dependencies, GitHub workflows, provider charges, grant submissions, or external messages.

## Primary pinned sources

* Official Stellar/x402-stellar source, HEAD `45d735ab3f30a50286d11286b7d7e584fa69bc77`, `packages/paywall/src/browser/useStellarPayment.test.ts` blob `3c43c3d2c869d47a364695bfa56e71bee55995dd`, explicitly uses `stellar:testnet`, `USDC_TESTNET_ADDRESS`, atomic `amount: "15000000"` for **1.50 USDC with 7 decimals**. Canonical token addresses also appear in upstream `packages/paywall/src/stellar-handler.ts` on that HEAD. [Original source](https://github.com/stellar/x402-stellar/blob/45d735ab3f30a50286d11286b7d7e584fa69bc77/packages/paywall/src/browser/useStellarPayment.test.ts).
* x402 v2 protocol at Foundation `specs/x402-specification-v2.md` blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198`: `PaymentRequirements.amount` is a **string of atomic token units**; token address is `asset`, recipient is `payTo`, network is CAIP-2. [Canonical specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
* Stellar first-party [SEP-41 token interface](https://developers.stellar.org/docs/tokens/stellar-asset-contract) uses `i128` for transfer amount and `decimals() -> u32`, and [first-party destination trustline guidance](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/send-tokens) requires a real on-network recipient eligibility check for classic-issued assets. SEP-41 contract-specific transfer prerequisites are contract-dependent; never invent universal trustline success.

## Source API

* `parseAtomic('1.5', 7) -> '15000000'` and `formatAtomic('15000000', 7) -> '1.5'`. Both use `BigInt`, no rounding or implicit JS `Number` conversion; reject floats, exponents, too-fine precision, unsafe signed-i128 overflow, noncanonical integer strings.
* `AssetRegistry` explicitly admits only *operator-vetted* contract/network/decimals/source rows, enforces future metadata expiry and per-network canonical USDC address, and never auto-falls back to a default asset. The `source` field is provenance bookkeeping, **not a digital signature**. A real integration needs to resolve and verify actual on-chain SEP-41 `decimals()`, contract identity and network passphrase before allowing a new token.
* `validatePaymentTerms(paymentRequirements, registry, {verifyRecipient,now})` enforces `scheme:'exact'`, signed-i128 atomic bounds, original `asset`, `network`, `payTo`, and refuses a missing, stale or inconsistent async trusted recipient verifier. The verifier **must** be implemented by the caller against a trusted Stellar RPC/network and the *actual* contract-account balance/trustline and contract restriction state. Never pass a client-provided `ready:true` or infer readiness from a superficial address regex. Address format validation is syntactic, NOT checksum or actual account existence validation; the trusted verifier must perform full Stellar address decoding, network and state validation.
* `assets.d.ts` is the typed contract; it returns a read-only admission record. No real payment or recipient claim is made by these checks.

## Focused validation

From this directory in an approved local/cloud checkout:

```bash
node --test assets.test.mjs
```

This executes **5 focused offline tests** (actual pinned upstream 1.50 USDC canonical example, 7-decimal precision, i128 boundaries, stale/mismatched token policies, unverified/wrong-network/missing recipient behavior). It is intentionally not a broad repository suite and creates no hosted GitHub Actions charge.

## Integration and remaining production work

Keep the module separate from the owner's SF-17 fee sponsorship, SF-18 payment replay, SF-19 custody, SF-34 `upto`, SF-46 ingestion and SF-31 buyer SDK. Before live acceptance, connect and authenticate actual network metadata and appropriate recipient proof through the owner-controlled RPC boundary; account for contract-specific authorization and trustline behavior. The module only supports **exact** payment scheme, since `upto` settlement paths require independent end-to-end finality/authorization semantics. Do not treat source checks or illustrative proof callbacks as successful mainnet/testnet settlement. Follow the SCF grant-application hold and no-GitHub-Actions cost guard.

## Immutable accepted-terms snapshot across async recipient verification

SF16 copies the five supplied payment terms (`scheme`, `network`, `asset`, `amount`, `payTo`) into a frozen local snapshot **before** policy checks and before awaiting `verifyRecipient`. The validator uses those exact same captured strings for allowlist/amount/recipient checks and for its returned frozen admission record. No property from the mutable caller request is consulted after the snapshot. This prevents a caller from changing a validated atomic amount, chain, asset or recipient during an asynchronous recipient-state check, or from supplying a stateful amount getter that yields different values on successive reads. This remains a read-only local validator; callers must still pass a genuinely trusted live recipient resolver and perform independent signing/settlement checks.

Focused original-source regression command: `node --test stellar/scf-starforge-20261009/sf16-asset-engine/assets.test.mjs` from repository root (or `node --test assets.test.mjs` from this directory). New scenarios mutate amount/network/payee during the async callback and exercise a getter that changes its returned amount on repeated reads.

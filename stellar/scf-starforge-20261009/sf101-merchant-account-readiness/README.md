# SF101 · Stellar merchant account receiving and reserve preflight

For a private browser workspace with saved seller configurations, native receiving reviews, exact account actions, capture replay, comparison and complete export/import, open the [Merchant receiving desk](RECEIVING_DESK.md): `starforge merchant-readiness workspace --directory /private/merchant/receiving-desk --port 8408`.

For the complete original SF30 seller configuration and deployed StellarAssetContract receiving workflow, use [Merchant receiving setup](MERCHANT_READINESS.md). It connects this original account evaluator to exact contract derivation, native contract-instance reads, all configured payment choices and the original SF16 validator. The classic-only command below remains available.

**Node 22+ · MIT · read-only official Horizon · no secrets, dependencies, wallet use, hosted Actions, or automated transactions.**

This fills the **classic merchant account readiness** gap next to the existing SCF Starforge seller, merchant-support, exact asset normalization and independent chain-reconciliation modules. A merchant choosing a Stellar G-address to receive a classic issued asset needs to know whether that exact account exists, its **actual** XLM reserve and native selling liabilities, whether the **specific real issuer/code** trustline exists and is authorized, and whether that trustline's remaining inbound capacity meets the intended sale. Stellar's classic reserve minimum is not simply “1 XLM” when offers, trustlines, sponsorship and additional signers exist.

This module retrieves two official **Horizon GETs**, not another payment service:

- `https://horizon-testnet.stellar.org/accounts/G...` (or `https://horizon.stellar.org/accounts/G...` for public)
- Same origin `/ledgers?order=desc&limit=1`, used for the current reported **base reserve** and **base fee**. Never hard-code 0.5 XLM reserve or a fee.

The account's classic minimum is `(2 + subentry_count + num_sponsoring - num_sponsored) * latest.base_reserve_in_stroops`. Spendable native XLM is `max(0, XLM balance - minimum - native selling liabilities)`. The displayed prospective fee floor is `latest.base_fee_in_stroops * --ops`; it is **not a congestion-adjusted transaction inclusion quote**. Trustline inbound capacity is `max(0, limit - balance - buying_liabilities)` for exactly the provided issued asset and issuer. All currency arithmetic is **BigInt**, seven decimal places, with no `Number` monetary conversion.

## Operator use: account is public, issuer must be independently vetted

Run from the public sprint repository root, replacing the public addresses with the **actual merchant payTo G-address** and verified classic asset code/issuer. `--amount` is the expected inbound **asset units**, not atomic stroops. Outputs are private create-only `0600`; choose a **new** output directory each run:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/cli.mjs \
  --network testnet \
  --account G_ACTUAL_MERCHANT_ADDRESS_FROM_OPERATOR \
  --asset-code USDC \
  --asset-issuer G_ACTUAL_VERIFIED_USDC_ISSUER \
  --amount 25.0000000 \
  --ops 30 \
  --out /private/merchant-sf101-review-unique
```

For XLM receiving (no trustline):

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/cli.mjs \
  --network testnet --account G_ACTUAL_MERCHANT_ADDRESS_FROM_OPERATOR \
  --asset native --amount 2.5000000 --ops 10 \
  --out /private/merchant-native-review-unique
```

There is no custom destination URL, untrusted redirected endpoint, signed POST, Friendbot funding, secret-key parser or automatic setup of a trustline. The HTTPS origin is fixed to official Horizon per selected network. Every input G-address undergoes Stellar base32 **version + CRC16-XModem checksum** validation. Only bounded GET JSON responses (256 KiB, 1–30 sec) are handled, and the original raw responses are **hashed** for provenance without copying them into the emitted report. No payment secrets or customer bodies are accepted.

Optional offline review of separately collected Horizon response JSONs, requiring **both** original account and original latest-ledger envelope:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/cli.mjs \
  --network testnet --account G_REAL_SAVED_ACCOUNT_ID \
  --asset-code USDC --asset-issuer G_VERIFIED_ISSUER --amount 0.5000000 \
  --account-file /private/original-horizon-account.json \
  --ledger-file /private/original-horizon-ledger-list.json \
  --out /private/offline-review-unique
```

Offline output is explicitly `SAVED_UNVERIFIED_HORIZON_SNAPSHOTS`, never a live-network check. It retains local input paths and original SHA256 digests in `manifest.json`, plus the report's observed time and actual embedded ledger close. It is useful for source-native review on Muse/local VMs without claiming snapshots are recent or verified. Do not mistake illustrative test fixtures for actual Horizon evidence.

## Four output files

| File | Purpose |
| --- | --- |
| `readiness.json` | Typed status, actual classic recipient state, seven-place XLM/balance math, reason and caution codes |
| `review.html` | Clean industrial, printable owner handoff, with known/unknown and receiving blockers |
| `review.csv` | Exact small reviewer key-value extract, suitable for sales/pilot readiness workshare |
| `manifest.json` | SHA256/byte lengths of all emitted content, provenance mode, official URLs and SHA256 of each original Horizon response or private saved snapshot |

`ACTION_REQUIRED` has a machine-readable reason (exit 2), `REVIEW` indicates saved/aged records or non-verdict (exit 1), and `CLASSIC_ACCOUNT_PREFLIGHT_OK` (exit 0) means the observable classic checks passed against current official Horizon without an aged head. A pre-existing manifest or output file cannot be overwritten. Errors exit 3 and do not create a spurious “ready” artifact.

**What this does not decide:** For x402's SEP-41 **contract** token transfers, wallet/provider authorization, `C...` contract recipients, SAC-specific transfer restrictions, funds committed by smart contract, signature rights, recipient ownership, active merchant contract, or a completed on-chain payment, this classic Horizon preflight is **not** an authoritative validator. It also cannot guarantee the account stays ready after the observed ledger, that a fee is sufficient under future load, or that the stated merchant owns the public G-address. Compose with existing SF16 operator-vetted SEP-41 contract registry, SF30 actual seller SDK, SF82/86 official transfer verification, and SF49 merchant owner review. When using a classic issued asset, issuer identity should be independently verified: two different `USDC` issuers are **not equivalent**.

## Source and focused local check

The implementation is `readiness.mjs` (checksum, official bounded fetch, pure BigInt evaluation and reports) + `cli.mjs` (input provenance and private create-only output). No other SF modules were changed. The existing docs underpin the math:

- [Stellar account data/Horizon fields](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/accounts/object)
- [Official ledger reserve + fee fields](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/ledgers/object)
- [Stellar sponsored reserves](https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves)
- [Stellar classic asset trustlines and liabilities](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts)

A focused local Node22 check can import `evaluateSnapshots` with original-shaped saved account and ledger JSON, then compare exact sponsorship-adjusted reserve, selling liabilities, untrusted offline provenance and blocked authorization/capacity behavior. No full suites or GitHub Actions. For **live** readiness, use a real public merchant G-address on the chosen Stellar network and record original provider response SHA/provenance in the private manifest before pitching this as customer-ready. This tool never provisions that account.

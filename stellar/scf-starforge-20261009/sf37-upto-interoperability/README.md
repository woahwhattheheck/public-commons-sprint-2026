# SF-37 | Stellar `upto` profile compatibility and safe buyer/facilitator handoff

**Source status:** Original MIT Node.js 22+ standalone source and focused checks. This is **NOT** a new settlement contract or a replacement for the upstream x402-Stellar SDK. It is an actionable interoperability boundary for two **open** Foundation proposals. It does not sign, decrypt, parse XDR, simulate with Soroban, submit transaction, query RPC, register a facilitator or spend funds.

## Official source pins (read directly 2026-10-10)

- x402 Foundation `upto` generic spec `specs/schemes/upto/scheme_upto.md` Git blob `202dae031d453db9cf46cd52de92c1800aee33f5`: single-use authorization, both start/end bounds, recipient binding, bounded actual 0..max, verify-phase maximum vs settle-phase actual.
- Foundation v2 `specs/x402-specification-v2.md` blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198`: `PaymentRequired`/`PaymentPayload`/`SettlementResponse`, phase-aware `amount`, `authorization` flow.
- [x402 Foundation PR #3134](https://github.com/x402-foundation/x402/pull/3134), open, head `aa268ec942575be8caa69a2b5afb774a6ec4c09e`; added `specs/schemes/upto/scheme_upto_stellar.md` blob `b0e709d5ad1808cd4f97b4c3af4f6e20decd3d10` (**851** added lines). Stateless UptoSettlement with optional revoke; signed root args and required expirationLedger.
- [x402 Foundation PR #3098](https://github.com/x402-foundation/x402/pull/3098), open, head `6a528a5acb72a90d95ce3c027da6733844c7c763`; same-path proposed file blob `1d1a148bfbfae658771568e31b7fd72b8277b27a` (**1,163** added lines). Includes compatible `stateless` plus a **separate** facilitator-bound `contract` profile with different authorization/XDR wire shape.
- [Stellar x402 #71](https://github.com/stellar/x402-stellar/issues/71) and [#72](https://github.com/stellar/x402-stellar/issues/72), still open as checked. #72 includes author-disclosed onchain testnet transactions; links are prior contributor evidence, NOT transactions executed by this workstream.
- [SF-34 fleet conformance work](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C7SJXE81M) reported 37/37 original offline policy cases; we consume its source contract, not duplicate its policy oracle.

## Wire-profile incompatibility resolved at our boundary

The stateless profile in both PRs uses `PaymentRequirements.extra.settlementContract`, `PaymentPayload.payload.{from,payTo,asset,maxAmount,validAfter,deadline,expirationLedger,salt,autoRevoke,authEntries}`, and requires an enforcing-mode Soroban simulation of the signed auth-entry tree. PR #3134 has **no** `extra.uptoProfile` field. PR #3098 adds **explicit** `extra.uptoProfile:"stateless"` and separately `"contract"` with payload `{transaction,authorization}`; the latter uses **ledger-sequence time windows**, a facilitator-bound authorization and a different contract deployment. Neither payload can be decoded by naively treating the other as the same wire format.

This module treats `extra.uptoProfile` as mandatory whenever more than one profile is supported; the #3134 legacy *omission* is acceptable only through explicit opt-in when the runtime supports **only** stateless. Unknown profile, missing trusted address or swapped phase fields hard-fails; no automatic stateful downgrade or arbitrary recipient change. The module accepts one **trusted in-memory network/profile contract registry** as operator source of truth and never trusts a seller's self-advertised contract ID as a registry bootstrap. A proper facilitator still must compare XDR auth-entry details to the pinned contract and enforce wallet credentials in actual Soroban simulation.

**Critical verification boundary:** A structural match, a base64-looking string, an advisory `authorization`, or `feeSponsored:true` is **not** an authenticated payment. Return explicitly `signatureVerified:false`, `authorizationEntryParsed:false`, `sorobanSimulationRan:false`, `paymentSettled:false`, `transactionHash:null`. These flags are intentional API outputs to prevent the next operator from mistaking preflight for an actual transfer or a verified smart-wallet.

## Run from the public repository root

```sh
node --test stellar/scf-starforge-20261009/sf37-upto-interoperability/test/upto-profile.test.mjs
```

No npm dependencies, no GitHub Actions. The 8 focused Node v22.16.0 checks run actual original JavaScript functions against exact **documented upstream wire shapes**, including both separate proposed profiles, amount limits (with BigInt canonical signed i128), source offer/verify/settle drift, trusted settlement contract binding, zero-charge, over-cap, profile downgrades, and malformed expiry. No simulated cryptographic signature truth or fabricated RPC calls. Source files `upto-profile.mjs`, `test/upto-profile.test.mjs`, `UPSTREAM_REVIEW.md`.

## Integrating after upstream convergence

1. Operator pins actual deployed Stellar `upto` contract IDs for each network+profile and signed-requirements source; use `extra.uptoProfile` only after the upstream proposals converge and SDK package version contracts are fixed. Do not hardcode demo `C_PINNED...` values from the offline test fixture in production.
2. Buyer picks an explicitly advertised profile and budget ceiling, signs the appropriate **real** Soroban root with the correct wallet implementation. Separately confirm delegated signer `__check_auth` support in enforcing-mode simulation (open upstream issue described in UPSTREAM_REVIEW.md).
3. Resource server calls `/verify` with the unchanged signed ceiling M, meters actual usage m, calls `/settle` with m, and facilitator re-checks original **M** and original contract/recipient/network before invoking the appropriate profile settlement contract. Both must use the actual authored upstream SDK—not this offline preflight as an authorization oracle.
4. Independently observe final transaction/hash and ledger event; reconcile PENDING by original transaction and nonce. Treat zero usage as a consumed one-time authorization after successful settlement.
5. Request maintainer alignment of #3134 and #3098 from the **owner-approved outreach lane only**. Do not open a competing upstream PR or imply the code has been accepted. A real SCF interest/application remains owner-held.

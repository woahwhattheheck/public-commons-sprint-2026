# SF-37 | Proposed upstream x402 Stellar `upto` convergence review

*Read date: 2026-10-10. Source-exact first-party proposed documents, not current accepted `upto` support in the shipped Stellar SDK. Owners/maintainers decide any actual upstream change, and outbound submission is not authorized by this document.*

## Source and version matrix

| Binding / decision | PR #3134 (open) | PR #3098 (open) | Convergence action |
| --- | --- | --- | --- |
| Foundation path | `specs/schemes/upto/scheme_upto_stellar.md` blob `b0e709d5` | same path, blob `1d1a148b` | Do not merge both independent same-path definitions without deliberate spec review |
| x402 wire version | v2 only | v2 only | Shared |
| Networks | `stellar:testnet`, `stellar:pubnet` | Same | CAIP-2 exact identity |
| Stateless Soroban settle | `UptoSettlement.settle(...)` + `from.require_auth_for_args` excluding **actual amount** | Same stateless profile | Converge signed argument order, deployment source, and XDR tree sample |
| Stateless profile discriminator | Omitted `extra.uptoProfile` | Explicit `extra.uptoProfile:stateless` | Define whether omission is a supported **single-profile legacy** alias; never infer stateful |
| Additional stateful contract | Not specified | `extra.uptoProfile:contract`, `UptoSettlement` pull/refund, facilitator-bound signed `Authorization` | Make optional profile genuinely opt-in, separate contract address, no silent fallback |
| Wire payload / time | `authEntries` + `validAfter/deadline` Unix seconds + `expirationLedger` sequence | Stateless identical; stateful has `transaction` XDR + advisory authorization, `validAfterLedger/deadlineLedger` | Add explicit discriminated-union schemas; don't cast one profile's time unit as the other's |
| Recipient binding | Original Soroban signed `payTo` | Stateless same; stateful signed `to` | Check actual auth tree bytes, not advisory JSON |
| Replay | Soroban auth nonce consumed once; `salt` operational | Stateless same; stateful nonce stored with TTL bounds | Define recovery/replay semantics per profile and test zero-amount nonce consumption |
| Account types | G/C supported by native Soroban auth, no universal C-signer format | Caveat delegated C-account signing gap under OpenZeppelin | Require enforcing-mode C-account integration acceptance, not generic claims |
| Residual allowance | `autoRevoke` recommended true | Stateless same; stateful pull/refund | Default true in any our agent SDK; show leftover risk on opt-out |
| Fee sponsor | true, cap via sim, original known facilitator | Same, differing resource implications | Confirm actual fee cap and PENDING reconciliation with real provider |

**Critical delta:** `contract` is not simply `stateless` with another `settlementContract` address. Its signed `Authorization` struct includes facilitator identity, ledger-sequence validity, app-maintained nonce and different XDR transaction format. Sending `stateless` authEntries to that contract or filling in omitted `uptoProfile` by guess will produce incorrect verification and/or payment authorization. The `UPTO_PROFILE_NOT_SUPPORTED` and `EXPLICIT_KNOWN_UPTO_PROFILE_REQUIRED` errors in the included executable module intentionally prevent this error.

## Open upstream questions to settle BEFORE declaring wire interoperability

1. **Profile registry:** Should `extra.uptoProfile` be adopted with explicit "stateless" default for the existing #3134 profile? If absent, may *only* a single-profile stateless deployment assume compatibility? Do clients need a protocol-wide profile enumeration or mechanism versioning instead?
2. **Two candidate contracts:** Is the stateful, named-facilitator contract in #3098 considered part of a single conformant Stellar specification, or a separate extension requiring a distinct network ATM? This affects SDK dispatch, `SettlementResponse`, audit, and cross-facilitator behavior. The underlying generic `upto` scheme itself does not name profiles.
3. **Time units:** Stateless validates Unix timestamps `validAfter` / `deadline` and a signed ledger-sequence `expirationLedger`; stateful uses `validAfterLedger` / `deadlineLedger` and TTL. What explicitly normalized contract should shared SDK display for offer expiry? Refuse local time guesses.
4. **Smart-account delegated signer:** #3098 documents direct C-account success but an independently unresolved delegated/session signing path in OpenZeppelin `stellar-accounts` `__check_auth` with `UnreachableCodeReached` and issue [OpenZeppelin/stellar-contracts #839](https://github.com/OpenZeppelin/stellar-contracts/issues/839). Do NOT advertise all smart-wallet agents as supported until a genuine enforcing-mode auth-entry test succeeds. No signature checking by guessing credential layout.
5. **Price display:** x402 Bazaar catalog advertises `PaymentRequirements.amount=M` at offer/verify, while final m is usage-based. Buyers must see **ceiling M vs expected metered price**, not mistake the former for actual charged amount; still require signed quote freshness at execution.
6. **Trust anchors:** `extra.settlementContract` must be checked against a trusted static provider/SDK registry per CAIP-2 network and profile, never accepted as authoritative from an untrusted 402 resource. If user switches profile, regenerate and reauthorize the signature tree.
7. **Zero-charge one-shot:** The signed authorization is consumed on successful settlement even when m=0. Test against real Soroban auth nonce, not merely application-level hashmap; no streaming reuse.
8. **Settlement PENDING:** Follow original transaction/nonce and preserve ledger hash before retry. Avoid double-charge or presenting `HTTP 200` as proof of ledger SUCCESS.

## High-value independent acceptance plan, once an authorized chain runner is available

Use existing real upstream branch source, correct scheme/version, real Stellar testnet and original wallet types; capture pre/post raw XDR, transaction/hash, ledger sequence, contract address, protocol version and exact rejection reason. Cover G-account partial/max/zero, over-cap, expiry start/end, recipient and asset tampering, same authorization replay, stateful facilitator redirection attempt, stateless alternate verifier risk, direct C-account signer and delegated C-account signer (issue #839), fee cap exceed, ambiguous PENDING and actual cost-vs-ceiling UI. Broad *competition/scheme* simulations can run in the existing authorized Muse/native local harness; no broad repository regression suites or new private GitHub Actions.

Do not conflate contributor-supplied tx links with executions by our workers. PR #3134 describes seven reference checks and testnet links; PR #3098 includes real onchain references, with a fresh documented C-account delegation gap. We have read the source and run our own **offline wire/term preflight** only. No owner-funded transaction was created.

## Owner action map

- SF-34: policy oracle provenance and existing 37 focused acceptance cases.
- SF-35: one implementation in the **actual** upstream contract/SDK, not a third contract.
- SF-36/SF-31: non-custodial spend/budget and buyer UX, with no implicit profile downgrade.
- SF-38 / Muse: full original-chain conformance once authorized; use actual source pin and profiler/tx evidence.
- SF-37 (this output): exact proposed wire shape and divergent contract profile, downloadable executable preflight + convergence questions, send back to fleet; no external upstream PR/contact.
- Commercial SCF owner: package funded grant evidence only when round/eligibility and owner approvals are verified; source merged != grant secured, revenue received, or deployed settlement.

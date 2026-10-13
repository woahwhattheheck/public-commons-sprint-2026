# Current Principal accounting edition 2

This continuation targets principal-Protocol-org/principal at f35b914cbf4896255a3711d81795b810b0a47f1c. It preserves the real SEP-41 PT/YT contracts, original SY custody, Permissioning and live Stellar Asset Contract issuer authority. It is distinct from the predecessor five-contract reference package.

The source is authored for new contract initialization. Accounting edition 1 has no complete remaining backing-credit or paid-yield record from which to infer edition 2 safely. Do not upgrade an existing funded instance or copy balances into this edition. A deployment/migration requires the owner's complete liability and payout reconciliation, explicit policy approval and the normal independent contract/security review.

## Economic records and units

PT and YT balances are seven-decimal USDC accounting notionals. SY shares and the underlying token use seven decimal atoms. Oracle values are USDC per underlying unit scaled by 10,000,000. Backing credit, pending claims, actual payments and recovery amounts are underlying atoms. No binary floating point is used.

For each YT holder, remaining funded backing credit C is separate from the notional balance N and earned pending claim P. At accepted rate R, settlement protects ceil(N × SCALE / R) underlying atoms. Only max(C − protected, 0) becomes earned yield, and that amount is removed from C before it is added to P. Claiming P therefore cannot recreate yield from the same notional at the next rate update. YieldIndex and LastClaimedIndex remain observable display fields; neither is a payout denominator.

Mint first measures the actual SY transfer into PrincipalManager. The shares are valued using the original wrapper's exchange_rate. The new notional is floor(represented underlying × R / SCALE); its initial credit is ceil(notional × SCALE / R), which cannot exceed the represented deposit. Two entrants at different rates have separate credits even when their balances later move. Conservative integer rounding may leave unallocated backing dust; this edition does not expose a treasury withdrawal that could consume liabilities.

All products use checked U256 intermediates; totals use checked i128 arithmetic. Overflow rejects the whole operation. No quote, amount or account is coerced through a JavaScript number.

## Transfers, burns and payments

Before each mint, transfer, transfer_from, burn or seizure, YT refreshes the rate and settles every affected holder. An ordinary transfer moves proportional remaining credit with the balance, after settling both parties. A partial transfer uses floor(C × quantity / balance); a full transfer moves every remaining credit atom. Earned pending stays with the sender. A former holder with zero YT can still claim previously earned pending.

A burn retires the proportional remaining credit and preserves earned pending. PrincipalManager uses settle_yield followed by consume_yield for payment. Only the amount actually received by the underlying recipient is deducted from pending; an unrepresentable fractional share conversion remains pending. The original minter-only YT claim_yield method is retained for ABI continuity, but this Manager does not use its all-at-once accounting debit.

At maturity, PT's underlying entitlement is floor(PT amount × SCALE / frozen rate). That underlying-atom rounding is explicit. Converting this fixed entitlement to SY shares must produce exactly that many underlying atoms: if the actual wrapper payment differs, PrincipalNotRepresentable rejects the entire redemption, including the PT burn and transfer. This prevents an unpaid wrapper-conversion remainder from disappearing. The selected original wrapper is 1:1 in ordinary operation; another wrapper rate may require a larger exactly representable redemption amount.

Before and after payments, Manager checks its actual SY balance against recorded LockedShares and the wrapper's actual token balance against its recorded total underlying. It reserves ceil(total outstanding PT × SCALE / accepted rate) plus all YT pending claims. The actual recipient token delta and manager share delta must match the return value. A shortfall blocks payment atomically. There is no hidden cross-holder loss allocation, negative-yield guarantee or socialization of a custody loss.

## One recorded maturity sample

OracleAdapter now retains every authenticated accepted sample with sequence, value, source timestamp and observed ledger timestamp. The source timestamp must not be in the future or more than 3,600 seconds older than observation. Values remain positive and nondecreasing under the selected current asset model.

Before maturity, each economic operation requires the original fresh oracle. At or after maturity, YT selects the earliest retained sample whose source timestamp is at or after maturity. That sample must lie within 3,600 seconds of maturity and have been observed within 3,600 seconds of its source timestamp. It freezes once. PT redemption, future YT settlement and recovery use that same rate regardless of later oracle updates.

This is the first timely authenticated post-boundary observation, not a claim that an exact-at-maturity market price was observed. Missing, future, stale or late samples leave settlement unresolved and cause the original operation to fail without consuming claims. The complete source and observation timestamps remain in maturity_sample. The new adapter is still the owner's authenticated feed adapter; this change does not implement the separately awarded RedStone primary/fallback adapter.

## Explicit issuer recovery policy

The original live SAC administrator and target deauthorization checks remain authoritative. Permissioning alone does not authorize seizure.

This edition explicitly extends recovery to earned yield. seize_position moves proportional remaining backing credit and earned pending into the configured RecoveryEscrow. A full seizure takes both exact remainders. It rejects self-seizure so an unchanged balance cannot produce a misleading movement receipt. Normal token transfer semantics remain unchanged.

RecoveryEscrow records immutable YieldRecovery records with sequence, source account, actual issuer, YT amount, pending underlying and ledger time. recover_yield can move an exact earned pending amount from an already deauthorized former holder with zero YT. finalize_yield claims the escrow's earned amount into escrow custody without requiring a positive remaining YT balance. Existing finalize_pt and finalize_yt keep their original purpose. The underlying remains in escrow for the native issuer clawback; no off-chain recipient or automatic external transfer is invented.

Recovery receipts prove per-account movement into escrow. Finalization payments are aggregate escrow payments; this edition does not infer a per-person downstream clawback allocation. The operator must retain original recovery receipts and the issuer's actual clawback evidence.

## Current capability boundaries

The current eight contracts remain the implementation baseline. MarketPool/Router, LP recovery, the upgraded rolling per-asset RiskControl, production RedStone feed, actual network deployment and customer KYC decisions are separate owned work. This patch does not claim to implement those awarded deliverables.

The predecessor reference issue budgets and internal paired claim tokens are not mixed into the current SEP-41/accruing-YT ABI. The current source edition and selected Wasm identities must be bound in the operator before observation or invocation. Existing deployments keep their original ABI and history.

## Complete native build and lifecycle

Use the complete selected current source roster and original Cargo.lock. SDK 26.0.1 requires the compatible installed Rust 1.91 toolchain. The actual native receiver retains absolute Cargo/Rustc paths, executable hashes and version output. No hosted Actions, deployment or funded invocation is required.

From the selected current repository root:

```sh
cargo +1.91.0 build --locked --release --target wasm32v1-none --workspace --exclude principal_integration_tests
cargo +1.91.0 test --locked --workspace --lib
PRINCIPAL_CURRENT_WASM=/ABS/current/target/wasm32v1-none/release \
PRINCIPAL_COURSE_ARTIFACTS=/ABS/original-programme/current-accounting-artifacts \
cargo +1.91.0 test --locked -p principal_integration_tests --test accounting_lifecycle -- --nocapture --test-threads=1
cargo +1.91.0 test --locked -p principal_integration_tests --test full_lifecycle --test compliance_recovery --test admin_and_risk_control -- --nocapture --test-threads=1
```

The dedicated accounting course registers all eight actual built Wasm files in the pinned Soroban host. It exercises repeated 1→1.1→1.2 yield claims, a later entrant, partial YT transfer, first-eligible maturity selection, actual PT/YT redemption, later quotes, cold snapshot reopening, ordinary-transfer pending preservation, issuer rejection, zero-balance pending recovery, full seizure/finalization and missing/future maturity sample rejection.

Five complete snapshots are retained: current-01-live-repeated-claims, current-02-frozen-final, current-03-explicit-pending-recovery, current-04-recovered-final and current-05-complete-maturity-proof. Each native run must retain the exact compiler command, stdout/stderr, actual process closure, all eight Wasm identities and each whole snapshot. Test-host authorization mocks simplify signing; SAC authority and role checks remain exercised. The course uses an unlimited test-host budget to test economic semantics, so it does not establish production resource-cost limits.

Existing meaningful unit and integration tests are retained. Expected yield formulas and source-time setup now follow credit accounting and the explicit maturity sample. The new source has been reviewed and source-checked; execution is established only by the real compiler and native lifecycle receipts. An authored course is not a native PASS.

## Operator receiving and readiness

The current operator must display the accounting edition, accepted/frozen sample with both timestamps, remaining credit, pending and paid totals, original LockedShares and actual backing, and each full recovery record. All amounts stay exact integer text with their units. Preserve complete original source and output files in the existing journal/export/receive flow.

Before a client demonstration, open and use the exact outgoing product at wide and narrow widths, inspect the selected current network/contracts and every downloaded attachment, and reopen the full working copy. Source review and a test-host run do not establish deployment, funded settlement, external audit or demo readiness.

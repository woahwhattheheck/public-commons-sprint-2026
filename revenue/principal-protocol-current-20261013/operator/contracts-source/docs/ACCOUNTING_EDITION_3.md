# Principal current accounting — edition 3

This source extends the eight-contract current repository selected at `principal-Protocol-org/principal@f35b914cbf4896255a3711d81795b810b0a47f1c`. It replaces the edition-2 per-account rounded-credit calculation with a constant-time inverse-index ledger. The original code, historical snapshots and edition-2 guide remain retained in the complete source selection and prior immutable delivery. This is a new-initialization economic edition. It does not migrate an existing funded edition-1 or edition-2 market, and it does not infer its earlier paid yield.

The source is authored and independently reviewed. Native compilation, the eight-Wasm lifecycle and rendered operator acceptance require their actual original process receipts. No deployment, signing, funded transaction, testnet maturity or customer financial result is implied by source review.

## Why this changes

Edition 2 calculated earned yield as a holder's remaining integer backing credit minus the ceiling reserve for that holder's current YT balance. A small transfer rounded the moved credit down; a subsequent settlement recomputed the smaller holder's reserve. This could manufacture a whole pending atom even though the rate never changed. The concrete source witnesses are:

* Deposit three underlying atoms at rate 1, move to rate 2.5, claim one atom, then transfer one YT atom twice.
* Deposit 100 underlying units at rate 1, move to rate 1.3, claim 230,769,230 atoms, then transfer one YT atom twice.

Both preserve the same total notional and actual backing. Neither transfer may create yield. A final global payout cap would leave unjustified claims or make outcomes depend on claim order. Edition 3 removes the source of the extra claim.

## Exact representation and supported rates

All stored monetary amounts remain integers. PT and YT balances are USDC accounting atoms with seven decimals. SY shares and underlying balances retain their original seven-decimal conventions. Oracle `value` remains USDC per underlying scaled by 10,000,000.

Define `S=10,000,000` and `Q=10^30`. The economic market accepts original oracle rates `1 <= r <= 10^18` and computes:

```text
I(r) = ceil(S * Q / r)
```

`I` is a conservative underlying-liability numerator per notional atom, over denominator Q. Its relative ceiling error is strictly below 10^-19 over the supported interval. This bound describes the index, not an assurance that the integer issuance difference is always zero. Even at an ordinary rate such as 1.1, the final integer notional may be one atom smaller than the direct original-rate floor.

The original OracleAdapter can retain a valid positive i128 source observation outside this economic range. YT initialization and index update reject that observation for this market. Manager validates the YT index before issuance arithmetic or custody transfer. `preview_mint` independently validates the same range. The adapter is still the original authenticated source and is not silently altered to fit the economic selection.

The display-only genesis factor remains `floor(genesis_rate*S/r)`. It is not a payout denominator. Public `inverse_index`, `reward_scale`, `max_accounting_rate`, `last_inverse_index(account)`, `reward_remainder(account)` and the full `yield_position` expose the actual arithmetic.

## Funded issuance and preview

For the actual selected SY shares, Manager converts their current wrapper valuation to underlying atoms U, then issues:

```text
n = floor(U * Q / I)
```

It transfers and verifies the original actual SY balance delta before minting equal PT and YT. Thus `n*I <= U*Q`. A new position cannot assume backing supplied by another holder.

`preview_mint(sy_shares)` returns the selected shares, underlying valuation, original oracle rate, inverse index, Q, direct original-rate notional `floor(U*r/S)`, actual conservative issued notional and their exact difference. It does not transfer custody or dispatch a financial operation. A zero resulting notional is rejected by mint.

The actual wrapper balance, its underlying token custody, caller eligibility, manager eligibility, original permissioning and topology checks remain in the same atomic mint. Whole arithmetic uses checked i128 additions and U256 products. Inputs outside the representable economic range fail before acceptance.

## Accrual and original holder rights

Each account has only its original balance, last settled inverse index, whole pending reward and a fractional numerator `0 <= remainder < Q`. For a current index I and previous account index J:

```text
numerator = balance * (J - I) + remainder
new whole pending = floor(numerator / Q)
new remainder = numerator mod Q
last settled index = I
```

The numerator uses U256. The fractional remainder is retained exactly. Repeated claims or repeated settlements at the same index cannot recreate an already-paid amount. The account state and computational cost are O(1); transfer touches two accounts and never scans issuance lots, holder history or all market users.

Ordinary transfer and transfer_from settle both participants before changing balances. Existing earned whole and fractional rewards stay with the original holder. A full transfer or later burn does not erase a zero-YT former holder's earned fraction. New recipients start earning only on later index movement. Self-transfers do not change balances or reward rights; spender-authorized self-transfers retain the original allowance semantics.

The legacy `backing_credit` and `total_backing_credit` view names remain callable for compatibility. In edition 3 they report ceiling inverse-index reserve views for the selected account's or total outstanding YT notional. They are not individually transferable cash credits and are not summed to derive global principal liabilities. The reserved edition-2 storage keys are unused.

## Conservation

Before maturity, outstanding PT and YT notional N are equal. For original funded underlying U, paid yield Y and all settled or latent earned reward numerators E, the invariant is:

```text
U * Q >= N * I + E + Y * Q
```

A mint adds funded U and n satisfying `UQ >= nI`. A rate increase lowers I; exactly `N * (old I - new I)` moves from protected liability into earned numerators. Transfer preserves N and all earned numerators. Claim removes only actual underlying paid. Integer and fractional recovery preserves the full earned numerator across both accounts.

Manager separately checks actual retained SY custody and underlying backing. It reserves `ceil(outstanding PT * I / Q)` plus the sum of crystallized whole pending claims. Latent fractions and unsettled earned rewards remain in the complete conservation bound even though `total_pending` intentionally counts only whole atoms. Genuine custody loss remains an atomic unresolved insolvency; this source does not assign one holder's loss to another.

## Maturity and principal redemption

The first authenticated, timely original sample at or after maturity is frozen using the retained OracleAdapter sample history. Its source timestamp and observation timestamp are preserved. A sample must be within the selected 3,600-second boundary and observation windows, and within the economic rate range. A later price never creates additional claims after that index freezes.

This is the first eligible sample policy, not a claim that the feed observed an exact boundary price. A missing or unsupported first eligible sample remains unresolved.

PT redemption retains the original accounting formula:

```text
desired underlying = floor(burned notional * S / frozen original rate)
```

This cannot exceed the conservative inverse-index liability. Manager requires the wrapper's actual payment to represent the desired underlying exactly, or reverts the PT burn and transfer together. YT redemption settles first, burns the selected balance and pays only the actual pending amount. All fractional reward survives the burn and remains readable or explicitly recoverable.

Rounding residue and unredeemable sub-atom fragments remain retained backing. There is no inferred treasury distribution or automatic sweep.

## Explicit compliance recovery

The current underlying SAC administrator and the original account's deauthorization remain the authority. Ordinary transfer semantics do not become recovery semantics.

`seize_position` settles both accounts and moves the selected YT amount plus its exact proportional share of the complete earned numerator `pending*Q+remainder`. The move is:

```text
floor(complete earned numerator * selected amount / original balance)
```

To avoid a three-factor U256 overflow, the implementation divides the numerator by balance first, then combines quotient*amount with floor(remainder*amount/balance). A full-position recovery moves the complete numerator exactly. Subtraction can borrow a whole atom; addition can crystallize a fractional carry. `TotalPending` is adjusted by the exact change in the two accounts' whole pending sum, not merely by the transferred integer field.

RecoveryMovement and the immutable per-account YieldRecovery receipt retain the moved whole atoms and sub-atom numerator separately. The receipt's moved whole field may differ from the recipient's change in whole pending because a retained recipient fraction can combine into an additional whole atom.

`recover_yield` retains the original explicit whole-amount route. New `recover_fraction` moves the original account's complete remaining fraction, including a former holder with zero YT. `finalize_yield` can pay escrow's whole pending without a positive YT balance. The recovered fractions can combine into a whole atom; that payment remains covered by the same original backing. Self-seizure is rejected. No subsequent issuer clawback allocation is inferred from these records.

## Current API and source selection

`CURRENT_ACCOUNTING_API.json` is the exact edition-3 additions/types document. The complete operator action catalogue must be generated from all eight selected Rust contracts and retain its original source edition/hash. Workspaces opened under another action catalogue must preserve that original edition rather than silently changing accepted requests.

The complete current source contains all original 225 files, the accounting overlays, the original edition-2 guide and this edition-3 guide. `CURRENT_ACCOUNTING_SOURCE.json` binds every other member exactly and excludes itself. Historical test_snapshots are original retained files; the new lifecycle does not substitute them for outputs from the selected current eight Wasm.

## Native original course

Use the same source-bound `operator/native/principal-build.py` and original `watershed_process.py` owner. `CURRENT_BUILD.md` describes the exact source packet, absolute Rust 1.91 Cargo/Rustc executables, selected Cargo home/PATH, operation ID and directory. The complete source and compiler identities are frozen before the first compiler action.

The locked build selects all eight real contracts for wasm32v1-none and excludes only the host-only `principal_integration_tests` package from the Wasm build. It then runs the original `accounting_lifecycle` host test against those freshly built Wasm, serially under the same lease. No generic command executor or new process controller is added.

The lifecycle retains repeated claims, late entry, ordinary transfers, fixed maturity, actual custody, issuer recovery, cold reopening and original permission failures. It also executes both tiny-transfer witnesses, merge, self-transfer, allowance transfer, later genuine appreciation, full burn, zero-YT fractional recovery and unsupported-rate rejection.

Seven complete snapshots are required: current-01 through current-05 from the original selected lifecycle, current-06-three-atom-conservation.json and current-07-full-unit-conservation.json. Full stdout, stderr, process identities, all eight Wasm and all seven snapshots are retained. A completed original attempt is verified/adopted before any rerun; the same final basis applies on first completion and completed reopening. A source-level model or source review does not establish that this native course ran.

## Operator acceptance

Select this exact current API/source edition. Read the programme configuration and source pins; inspect mint preview including issuance adjustment, account inverse index and fraction, original maturity sample, global reserve/custody/pending and per-account recovery receipts. Use the original simulation and explicit invocation controls with the selected wallet/network; no source publication authorizes a funded action.

Before client/demo readiness, the producing owner must render the exact outgoing application, use the controls at narrow and screenshare widths, inspect the actual downloaded JSON/CSV/HTML/source/archive attachments and reopen the preserved working copy. Keep compiler, browser, simulation, transaction and source-review outcomes separately attributed to their actual receipts.

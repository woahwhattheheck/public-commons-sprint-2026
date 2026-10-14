# Principal paired exit — recombination edition 1

This source adds a complete pre-maturity exit for a holder of equal actual PT and YT balances. It composes with the original accounting edition 3, market edition 1, oracle, permissioning, SY wrapper and recovery contracts. Router edition 2 exposes both SY and underlying routes. The original current-market source packet and all historical accounting/source packets remain complete.

This is a source implementation with an authored native continuation. It has not established a live deployment or a completed new native/browser run. Use a newly selected source workspace and actual compiled contract identities. Preserve the existing accepted accounting workspace, requests and build outputs.

## The holder workflow

1. Open Account positions in the maintained operator and select the exact public account. Read its native SY, PT, YT and yield positions.
2. Under **Exit a PT and YT pair before maturity**, enter the same positive raw amount to burn from each token. Read the native quote.
3. Review returned SY, current principal allowance and returned underlying value, the original oracle and wrapper rates, rounding retained in backing, and earned whole/fractional yield retained by the holder.
4. Prepare either the SY route or the atomic underlying route. Retain an explicit minimum output and an expiry for the Router. The original preparation, simulation, explicit invocation and retained-request workflow is unchanged.
5. Read the actual execution and account observations. Claim earned yield separately if desired. A full pair burn does not erase that claim, even with zero remaining YT.
6. Export the complete workspace/review using the existing operator, reopen the exact source workspace, and inspect the same original request and asset observations. No browser quantity is substituted for a native result.

A quote is a saved observation, not a reserved price or completed transfer. The new methods recalculate their exact current input and enforce the caller's limit.

## Economics and the original specification

The original technical specification §5.3 is retained unchanged. It sketches returning a user's original deposit pro rata. Current accounting3 instead has transferable SEP-41 PT/YT, continuous claimed yield, and earned pending/fractional credits that stay with the previous holder on an ordinary transfer. It has no complete per-holder original-deposit ledger from which the sketch could be implemented honestly.

Returning that original whole deposit after yield has already been claimed would pay the same backing twice. Recombination edition 1 therefore returns **current principal backing** and retains the holder's already earned yield separately. This is an explicit new settlement choice, not an assertion that the historical sketch was implemented literally.

A user who transfers both tokens after earning yield keeps that earlier earned credit. The recipient may recombine the pair's current principal and earns only yield attributable to its own holding period. The new exit makes no claim about purchase cost, a user's original mint deposit, investment return, or a guaranteed recovered purchase price.

## Integer quantities and one operation

S = 10,000,000. Q = 1,000,000,000,000,000,000,000,000,000,000 is the existing inverse-index reward denominator. n is the equal positive PT/YT token amount. o is the original fresh OracleAdapter reference value. w is the SY wrapper's actual underlying-per-share exchange rate, scaled by S.

At a ledger time strictly before the original maturity:

- I = ceil(S × Q / o), the existing conservative inverse index.
- A = floor(n × S / o), current principal allowance in underlying atoms.
- x = floor(A × S / w), SY share atoms returned.
- V = floor(x × w / S), the current underlying value of those shares.
- D = A − V, the integer value rounding retained in managed backing.

All arithmetic uses the existing checked U256 helpers and i128 narrowing. No floating point, caller-supplied oracle price or browser-estimated value enters settlement. The existing rate ceiling is enforced by inverse(). A zero-share result is rejected before any burn.

The preview is read-only. It projects the selected holder's earned reward with the existing reward() function, original last inverse index and retained fractional numerator. It does not write the YT index, consume yield or burn tokens. The actual exit first updates and settles the original YT ledger, verifies the exact quoted rate/index/pending/fraction, then burns n PT and n YT and checks both balances and supplies.

The returned SY is measured by the exact manager debit, recipient credit and transfer return value. LockedShares decreases by that same amount. Rates are checked again before completion. Cumulative recombined shares/value have their own new counters; existing underlying principal/yield payout counters keep their original meanings.

## Conservation and queued claims

Let T be outstanding PT before the paired burn. The principal reserve release is:

ceil(T × I / Q) − ceil((T − n) × I / Q)
  ≥ floor(n × I / Q)
  ≥ floor(n × S / o)
  = A.

For any managed share balance L, transferring x shares decreases aggregate floor-valued backing by at most ceil(x × w / S), which is at most A. Whole pending yield is reserved before and after. The selected holder's fractional reward numerator remains exactly in the original YT ledger. The unchanged original settlement machinery retains other holders' earned credits.

The Manager checks actual SY custody and actual wrapper underlying custody, current principal reserve and settled queued claims before the burn and after payment. A custody loss or insufficient backing fails the entire transaction. This edition does not implement a haircut, socialized shortfall, insolvency queue or discretionary recovery payout.

Integer rounding can leave residual backing; it is not an administrator fee or a new per-user receivable. Prior pending yield remains separately claimable and can retain the original sub-share payment remainder under the existing claim path. Previously paid yield is not recreated.

## Rates, permissions and boundaries

The new early-exit methods require original account permission, underlying SAC authorization, and both original PT and YT per-asset grants. They reject a paused Manager, expired maturity, insufficient equal-pair holdings, stale oracle or an oracle rate below the original YT's last accounted rate. The SY transfer separately applies its existing global permission and SAC rules. The Manager's own custody eligibility remains checked.

These stricter paired-exit asset checks apply only to the new operation. Existing mint, maturity redeem, claim, recovery, PT/YT transfer and OracleAdapter behavior are unchanged. Existing maturity redemption still uses the original authenticated frozen maturity sample.

The original current SY implementation has no public rate-setting/accrual operation. Native lifecycle checks therefore use its real accessible rate behavior. The integer formula also covers generalized positive wrapper rates. At a rate below one, a nonzero returned SY amount can have V=0 underlying atoms: an SY exit may be valid while the original wrapper rejects an immediate zero-value unwrap. The quote and account screen show this distinction and omit the unavailable underlying shortcut.

The Router holds no customer intermediate balance. It authenticates the original holder, checks its explicit expiry and delegates the paired exit to the configured original Manager. The underlying route then withdraws exactly the returned shares from that holder and checks exact underlying value and recipient delta. Any minimum-output or original wrapper failure reverts the complete nested operation, including the burn.

The curve, all swap fee economics and issuer/protocol fee claims from Market edition 1 are unchanged. This source does not add YT sales, flash minting, live deployment, signing authority, cross-market matching or issuer governance.

## ABI and source selection

Manager:
- preview_recombine(from, amount) → RecombineQuote
- recombine(from, amount, min_sy) → RecombineQuote
- recombination_edition() → 1
- total_recombined_shares()
- total_recombined_underlying()

Router edition 2:
- preview_recombine(from, amount)
- recombine(from, amount, min_sy, expires)
- recombine_underlying(from, amount, min_underlying, expires) → {exit, underlying}

RecombineQuote retains amount, sy_shares, underlying_allowance, underlying_value, retained_rounding, oracle_rate, sy_rate, inverse_index, pending_yield, reward_remainder, sampled_at and maturity. Every amount is the original exact integer.

The installed ABI is principal-paired-exit-1-market-1-accounting-3 and contains 204 methods. CURRENT_PAIRED_EXIT_API.json and CURRENT_PAIRED_EXIT_SOURCE.json bind complete current native source. Earlier API/manifests are retained historical editions alongside the unchanged complete original source packets. Existing workspaces remain pinned to their exact API; use a new selected workspace for this compiled edition. No automatic contract upgrade or old receipt relabeling occurs.

## Maintained native continuation

Use the same native/principal-build.py and unchanged watershed_process.py process owner with the new principal.paired-exit-build-input.v1 schema. The complete input selects actual Rust/Cargo1.91.0 executable paths, exact hashes/version strings, original cache/search path, the new exact source packet and a new edition output directory. The carrier's native build guide gives exact packet and canonical selected-source identities.

The maintained course retains six phases: Cargo version; Rust version; locked ten-contract Wasm build; unchanged accounting lifecycle; unchanged market lifecycle; additive paired-exit lifecycle. Each phase retains original argv, actual process lifetime, stdout/stderr, selected Wasm and snapshots. Reopening revalidates the same complete immutable source and accepted original phases.

paired_exit_lifecycle.rs uses actual built Wasm and original Soroban host fixture. Its cases cover:
- claim before exit, transferred equal-pair ownership and a later minter;
- full burn with retained yield still payable at zero YT balance;
- partial exit, exact fractional remainder and cold snapshot continuation;
- rejected insufficient holdings, limits, expiry, pause, global and per-asset eligibility, stale/decreasing rates;
- actual SAC custody loss with no burn, followed by original maturity settlement.

A mocked authorization fixture is host validation, not a signer/deployment claim. Do not run a broad suite or a second controller. The first actual native failure goes back to the same source owner with exact process/streams/source identity.

## Producing-owner inspection

Before presenting a client-facing result as ready, the producing peer must run and LOOK at the exact final populated operator at desktop and 390px, including empty/loading/error states, quote/account selection changes, minimum/expiry preparation, original result review, every downloaded HTML/JSON/ZIP and cold reopening. Capture and actually view screenshots. Source review, compilation, DOM counts or another peer's approval do not replace actual product inspection.

Preserve existing browser ownership and tabs. No additional native controller, forced worker restart, Actions, RPC/deployment, signer or funds are introduced by this source handoff. Keep the existing accepted accounting and market operations as independent history.

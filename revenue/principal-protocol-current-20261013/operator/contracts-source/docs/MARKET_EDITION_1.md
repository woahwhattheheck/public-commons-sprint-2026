# Principal MarketPool and Router — market edition 1

This source adds two executable contracts and the existing operator's complete corresponding ABI. It composes the original accounting edition 3. It does not migrate a deployed market, a prior operator workspace, or the completed accounting edition 2 receiving course.

## What an operator can do

The market holds actual PT and SY, issues transferable liquidity shares with four decimals, reads complete pricing frames and quotes, performs both swap directions, and returns proportionate actual reserves. The Router composes underlying deposits, original PT/YT tokenization, PT purchases and sales, explicit liquidity splits, yield claims and maturity redemption. Every route operates on the authenticated user's balances; the Router holds no intermediate customer balance. Nested original calls remain in the user's authorization tree.

The original manager has no pre-maturity recombination operation. This edition therefore provides neither recombination nor YT selling. Existing manager tokenization and yield payment formulas are unchanged; no new tokenization or yield fee is introduced. LP positions are this pool's recorded shares, with direct transfer and balance methods; they are not advertised as a complete SEP-41 allowance interface.

## Why the curve is a separate edition

The retained technical specification §7 describes a logit rate and proposes preserving that same rate after positive SY input and positive PT output. Its PT proportion strictly decreases in that situation. Since logit is injective, the equality cannot yield the stated positive output. The complete original specification remains in the source.

This edition instead defines a time-dependent virtual constant-product curve. It is an explicit implementation choice, not a claim to implement the contradictory Newton solve or Pendle's complete pricing algorithm. There is no promise of loss-free liquidity provision. Time and authoritative index changes can change quotes and expose liquidity holders to arbitrage and inventory loss.

## Exact quantities and equations

All inputs and outputs are integer atoms. S=10,000,000. Y=31,536,000 seconds. The maturity and initial timestamp are fixed at initialization, including after all liquidity is withdrawn and another deposit initializes the real reserves.

Let P and R be actual PT and SY reserves, excluding every fee claim. Let L be outstanding LP atoms, o the original OracleAdapter reference value, w the wrapper's underlying-per-SY exchange rate, t the sampled ledger timestamp, T the configured maturity and D=T-start. The simple annualized yield anchor A uses S units; 450,000 represents 4.5%. Strength is an integer from 1 through 100.

The contract samples t, o and w once for an operation's pricing frame. OracleAdapter.is_fresh(3600) must pass. Prices cannot be supplied by a caller. The original PT is rate-notional: manager issuance is approximately underlying*o/S, and maturity settlement is PT*S/final_oracle. Consequently this curve's target SY-per-PT price is:

    u = floor(S*S/o)
    z = floor(u*S/w)
    d = S + ceil(A*(T-t)/Y)
    target = floor(z*S/d)

This preserves the reciprocal original oracle denomination and divides by the actual SY underlying value. It does not treat PT as one fixed underlying unit.

Integer coefficients and virtual quantities are:

    a = floor(1000*strength*D/(T-t))
    b = floor(a*target/S)
    virtual_PT = L*a
    virtual_SY = L*b

Rounding the coefficients before multiplication makes virtual reserves exactly homogeneous in LP supply. The quoted virtual price b/a differs from target/S by less than 1/a. Both coefficients must be positive. Virtual balances are pricing quantities and cannot be withdrawn, seized as assets, or counted as custody.

With X=real input reserve+virtual input and Z=real output reserve+virtual output, a net input n gives:

    gross_output = floor(n*Z/(X+n))

Gross output must be strictly below the actual output reserve. Outputs cannot spend virtual assets or empty an actual reserve. Asset and LP quantities are capped at 10^27; virtual quantities at 10^36; coefficients and observed rates at 10^18. The initial term must be positive and at most ten 365-day years; A is between zero and S. U256 products and checked narrowing handle intermediate arithmetic; invalid ranges reject before transfers.

## Fees and claims

The authored immutable fee tier is annualized basis points (maximum 1,000). Its time factor is remaining seconds divided by Y. The fee is rounded once, up to an SY atom:

    fee = ceil(SY_fee_base * tier_bps * remaining / (10,000*Y))

For SY input, the fee base is the gross SY input; the curve receives input minus fee. For PT input, the full PT amount enters the curve; the fee base is gross SY output, and the user receives that output minus fee. A trade that rounds to no positive input or output is rejected.

Both fee claims are held in SY outside LP reserves. The configured protocol share uses floor(fee*protocol_share_bps/10,000), and the creator receives the exact remainder. The original intended split can be authored as 2,000 protocol basis points (20%). The protocol destination separately authorizes initialization and is immutable. Creator claims authenticate and pay the SAC's **current** administrator at claim time, including after administrator rotation.

This first market edition has no fee-update method. It therefore has no implemented delayed fee-governance course; it does not bypass a delay by making an immediate update available. Share/tier/recipient choices are explicit at initialization.

## Liquidity and rounding

The first liquidity provider supplies both actual asset amounts. Initial LP atoms are floor(PT_atoms/1000), so one LP atom initially represents 1,000 PT atoms. The supplied SY/PT ratio is explicit; the contract does not silently rewrite it to a supposed fair ratio.

Subsequent LP issuance is:

    minted = min(floor(max_PT*L/P), floor(max_SY*L/R))
    consumed_PT = ceil(minted*P/L)
    consumed_SY = ceil(minted*R/L)

Unconsumed maxima remain with the user. Withdrawal floors each pro-rata real asset amount. Removing the entire outstanding L returns all real reserves while leaving all separate fee claims intact. Expiry or a local/risk pause stops deposits and trades; normal withdrawal stays available subject to the original asset compliance and wrapper/token pause behavior.

Original RiskControl.check_deposit is called by the registered pool for added liquidity. Its amount is the conservatively rounded sum of SY's underlying value and PT's original-rate underlying value in the same sampled frame. This does not claim to add a new global limiter to the unchanged original manager or wrapper.

Transfers sent directly to the pool outside its methods are not silently turned into tracked reserves or LP entitlement. Custody must cover every tracked reserve and fee. The contract has no administrative sweep of unsolicited balances.

## Wiring and compliance

1. Use a newly initialized original accounting edition 3 topology, including current Manager address getters and the RecoveryEscrow LP extension. The original accounting formulas are unchanged.
2. Wire PT/YT minters and the original one-time recovery addresses through the original deployment procedure.
3. Grant the pool SAC authorization, original Permissioning account eligibility, and PT asset eligibility. Register it as a RiskControl consumer.
4. Each liquidity holder requires SAC authorization, account eligibility and an explicit Permissioning asset grant for the **pool address**. Actual PT transfers also enforce original PT eligibility.
5. Initialize MarketPool with the exact Manager/SY/PT/YT/Oracle/Permissioning/underlying/Risk/Escrow addresses, expiry, anchor, strength, fee tier, protocol share and protocol receiver. The live SAC administrator and selected protocol receiver authorize this.
6. Initialize Router with that pool; it verifies the same original issuer. The configuration is fixed.

The pool verifies the complete Manager topology, original underlying, expiry, oracle, token minters, accounting edition and recovery links. Inputs and payouts verify measured custody changes. Reentrant mutations are rejected.

LP seizure remains under the original RecoveryEscrow's single live-issuer/deauthorized-target check. RecoveryEscrow.seize_lp verifies the pool's original underlying, manager and recovery address, then asks that pool to burn the restricted LP share. Actual PT moves to RecoveryEscrow for its original maturity finalization. Actual SY is unwrapped directly to the same escrow; the pool checks the exact SY burn, sampled-rate payout and received underlying balance change. Recovery does not manufacture a value for a virtual reserve.

## Operator, original data and downloads

Use a fresh operator directory for edition principal-market-1-accounting-3. Existing workspaces bind their immutable API edition and must reopen through their own complete retained application. The complete preceding accounting-3 packet and ABI, original upstream source, accounting-2 API and all historical snapshots remain retained.

The existing Configuration screen now includes MarketPool and Router addresses/Wasm hashes. The Market screen reads actual reserves, fee claims and configuration, retains quote inputs as working fields, shows the full native quote and lets the user prepare that direction with an explicit minimum and expiry. Every supported method also appears in the original operation catalogue. Initialization accepts the complete typed MarketConfig object; integer fields remain exact strings.

The operator computes no substitute trade price in JavaScript. All displayed quotes come from the selected native contract, and retain its network, address, Wasm SHA, API SHA and original observation. Read-only simulation and explicit invocation retain the original request recovery behavior. A saved quote is historical and does not reserve liquidity. Preparing a transaction neither signs nor executes it.

Original source files, complete review JSON/HTML, native workspace export, browser working copy, independent restore and returned-file history use the existing routes. The new API is an explicit new source edition; prior accepted work is not rewritten.

## Maintained native build and receiving

Use the existing native/principal-build.py process owner with schema principal.market-build-input.v1 and source/current-market-packet.json. The authored market input retains actual cargo/rustc executable paths, SHA256/version, original cargoHome/searchPath, bounded timeout and a new source-edition directory. No live network, signer, deployment or funded invocation is involved.

The maintained phases build all ten locked Wasm artifacts, run the unchanged seven-snapshot accounting lifecycle, and run market_lifecycle on those actual artifacts. Its five snapshots exercise original tokenization, stateless routes, fee-asset conservation, failed slippage/expiry, risk pause, actual creator rotation, original-escrow LP recovery, mature withdrawal and cold snapshot reopening. Source remains unchanged throughout every phase. Only actual native process receipts establish execution.

The market-source packet, selected source SHA and native input recipe are provided in native/MARKET_BUILD.md. The original reference and accounting-3 profiles continue accepting their exact historical packets unchanged. Do not substitute this source into their accepted operation directories.

Before outward readiness, the producing peer must open and operate the actual populated operator at desktop and 390px, inspect empty/loading/error and request-recovery states, open every outgoing report/JSON/ZIP/working copy, independently restore the editable workspace, and inspect the reopened quote and complete source. Source review and V8 parsing are not native compilation or visual acceptance. Retain the first actual compiler, contract or interface exception in the original Principal thread for repair.

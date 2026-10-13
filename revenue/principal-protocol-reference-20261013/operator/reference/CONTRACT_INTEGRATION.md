# Principal reference contract integration

This source implements an independent reference for the backed issuance and maturity flow described by the retained predecessor Principal repository. It is a reference implementation for review and commissioning. It has not been deployed to a network, has not moved funded assets, and does not establish an issuer-approved investment product.

The selected original is Mars12-dev/principal-protocol at fe159e80561061fea9f7358b8ae15137eeacb0e4. The full original21 is retained in the original programme source carrier F0C8FTC9Q0P. This application supplies independently authored contract bodies and records the exact original identities separately. The original repository's retained proposal is not represented as the issued SCF45 milestone agreement.

The awarded SCF45 submission subsequently identified principal-Protocol-org/principal at f35b914cbf4896255a3711d81795b810b0a47f1c. That current implementation has separate SEP41 PT/YT tokens, an accruing yield index and RecoveryEscrow. This issuance-isolated reference has a different economic and callable ABI; it is not an upgrade for those deployed or current contracts, and it is not evidence that the current repository lacks custody or claim accounting. Keep the reference and current source selections separate in every operator workspace.

## What is implemented

The five contracts work together through their actual Soroban interfaces:

- Permissioning maintains explicit account and asset eligibility expiry timestamps. A ledger TTL controls storage availability; it does not define eligibility expiry.
- OracleAdapter retains immutable administrator-authenticated reference samples. Each sample records a strictly increasing timestamp, its actual submission time, an opaque source hash and a sequence number. This is a single-administrator reference feed, not a quorum or independently verified issuer feed.
- RiskControl restricts deposit-volume updates to explicitly authorized contracts. It rejects nonpositive amounts. It exposes a pause and an explicitly configured fixed window; it does not claim to implement a continuously rolling total.
- SYWrapper holds the actual underlying token, transfers actual shares, prices deposits and withdrawals using its current backing, and verifies exact token balance changes.
- PrincipalManager takes custody of actual SY shares, creates issuance-specific principal and yield claims, transfers those claims, recombines matched claims, freezes a maturity sample, withdraws actual backing and pays the two claim classes.

The authoritative callable catalogue is PRINCIPAL_API.json. All integers remain exact decimal strings in an operator or native transport until converted to their declared Soroban integer type.

## Runtime and build

The original Cargo.lock pins Soroban SDK26.0.1 and environment26.1.3. This source preserves its registry versions and checksums and adds the missing local manager, wrapper and risk package records plus their integration dependencies. There is no floating SDK dependency.

The exact upstream SDK26.0.1 Cargo workspace requires Rust1.91.0. Its build script rejects wasm32-unknown-unknown with Rust1.82 or later. rust-toolchain.toml therefore selects Rust1.91.0 and wasm32v1-none.

Install that toolchain with the existing authorized Rust distribution mechanism, then build:

```sh
rustup toolchain install 1.91.0 --profile minimal --component rustfmt --component clippy --target wasm32v1-none
cargo +1.91.0 build --locked --release --target wasm32v1-none --workspace
cargo +1.91.0 test --locked -p principal_manager --test lifecycle -- --nocapture --test-threads=1
```

Build before compiling the lifecycle test. It embeds the five exact release Wasm bodies and registers those Wasm bytes in the pinned native Soroban host. It does not replace their functions with a JavaScript model or with stub clients.

The integration course exercises actual share/token movements, different entry rates, claim transfers, partial redemption, exact final payouts, paired recombination, authorization failure, permissions, pauses, the deposit limit, actual token clawback, extreme prices, and a full captured-ledger reopen before further redemption. Tests use authored accounts, a native test asset and explicit test authorization. The settlement step disables mocked human authorization to exercise the real Manager-to-Wrapper-to-token invoker path. Native host budgets are unlimited for semantic commissioning; these results do not claim network resource-budget or production throughput acceptance.

Set PRINCIPAL_COURSE_ARTIFACTS to the original receiver's selected output directory to retain all complete host snapshots. The existing application receiver is the sole native process owner: it records the exact source selection, Rust/Cargo identities, original build/test output and all five Wasm hashes around the two commands above. These commands have been authored and source-reviewed; no successful native compilation or contract execution is claimed by this source packet.

## Constructor and administrative setup

Every module uses an atomic Soroban constructor. There is no publicly callable post-deployment initialization window. The constructor requires the selected administrator's authorization. Deployment itself is an explicit future native operation; source compilation does not deploy anything.

Deploy in dependency order: Permissioning, RiskControl and OracleAdapter, then SYWrapper, then PrincipalManager. A Manager is bound to one maturity timestamp and the exact Wrapper, Oracle, Permissioning and RiskControl addresses. The Wrapper and Manager must reference the same Permissioning and RiskControl. The underlying token must report seven decimal places.

Before deposits, explicitly grant both account and underlying-asset eligibility to the intended holder, receiving holder, Wrapper contract and Manager contract. Set a real valid_until timestamp. Explicitly authorize the Wrapper as a RiskControl caller. Do not grant arbitrary wallet addresses deposit-volume authority.

Administration rotates in two steps: the current administrator proposes a successor and that successor authorizes acceptance. Contract addresses, economics, maturity and the core asset bindings cannot be rewritten by an administrator. Risk limits and eligibility can be changed by their declared administrator. Pausers can stop activity, while only the administrator can unpause it.

## Exact denominations

SCALE is10000000. Underlying amounts, SY shares, reference prices and USDC accounting claims use seven decimal places.

A reference price is USDC per one underlying token. Claims are denominated in USDC accounting atoms. A claim is not a USDC token or a promise that the system holds USDC.

| Field | Exact unit |
| --- | --- |
| initial_shares, locked_shares, returned_shares | SY share atoms |
| entry_underlying, backing_underlying | Underlying token atoms |
| initial_claims, settlement_claims, pt_supply, yt_supply | USDC accounting claim atoms |
| principal_shortfall | USDC accounting atoms |
| pt_budget, yt_budget, pt_paid, yt_paid | Underlying token atoms |
| entry_sample.value, settlement_sample.value | USDC per underlying token, scaled by10000000 |
| rounding_numerator | Integer division remainder; not spendable backing |

The original prototype's1:1 underlying redemption is deliberately not carried forward. Specification section14 defines principal accounting divided by the final underlying reference price.

## Deposits, backing and donations

At nonzero share supply, share pricing uses the Wrapper's actual underlying balance less its recorded unowned reserve. It does not use an internal total that can drift from the actual token contract.

A deposit measures the actual token increase and requires it to equal the selected amount. It rejects zero minted shares and enforces min_shares. The configured deposit circuit breaker counts the actual accepted deposit once, at the Wrapper. Splitting those shares in the Manager checks the pause but does not count the same deposit a second time.

A withdrawal computes its exact proportional underlying output, enforces min_underlying, burns actual shares and verifies the Wrapper debit and recipient credit. A fee-on-transfer or otherwise inconsistent token is rejected by these balance checks.

Underlying sent to a Wrapper while its share supply is zero is unowned. On the next deposit, it becomes a recorded excluded reserve. A first depositor cannot capture it, and a small unsolicited transfer cannot permanently prevent new deposits. There is no reserve withdrawal or treasury authority in this reference version.

Loss treatment for this reserve is explicit: effective reserve=min(actual token balance,recorded reserve), and share backing=max(actual token balance-recorded reserve,0). The recorded reserve can therefore exceed its effective value after clawback. A zero-backed share withdrawal is allowed when the caller selects a minimum of zero; this lets an issuance record actual complete principal loss. New deposits into a nonzero share supply with zero backing are rejected.

Donations while shares are outstanding affect those shares' backing. A USDY price increase alone does not create extra USDY token units. The reference oracle records that price increase separately.

## Issuance identity and custody

Each mint requires a fresh reference sample, eligibility, an active risk gate, positive shares and an explicit minimum claim quantity. It transfers actual shares into Manager custody before recording claims.

For shares s, underlying equivalent u at entry and entry reference price r:

```text
n = floor(u * r / SCALE)
```

The issuance receives n principal claims and n yield claims. Each issue records its owner, unique owner nonce, actual entry shares and underlying equivalent, complete entry sample, entry time and maturity.

Claims from different issue IDs are not fungible, including claims with the same maturity. This prevents a later entrant with a different entry price from inheriting another issuance's yield. transfer_pt and transfer_yt always select the issue ID and enforce the same account/asset eligibility. These are issuance-scoped internal ledgers, not SEP41 tokens, a market pool or a router.

The Manager records aggregate locked SY shares and verifies its actual share balance against that aggregate before issue-level movements. Once underlying has been withdrawn for settled issues, it records a separate aggregate underlying liability.

Owner nonces prevent a second mint from creating another issuance under the same identity. find_issue provides original recovery. Recombination nonces retain complete original amount, minimum, returned shares and time. Original native request recovery must inspect these records; it must not automatically submit another economic transaction.

## Recombination before maturity

A holder with q principal claims and q yield claims from the same issue can recombine them. There is no cross-issue pairing.

For original shares s, initial claims n and cumulative recombined claims c:

```text
cumulative returned SY = floor(s * c / n)
this return = cumulative returned SY - previously returned SY
```

The method burns q of both claim classes, verifies the explicit minimum and transfers the resulting shares from Manager custody to the holder. A zero-share result is rejected. When all initial claims are recombined, all initial escrowed shares are returned exactly. Small intermediate returns can differ by a share atom according to the displayed cumulative rounding rule.

## Maturity sample

The Manager never accepts an arbitrary caller-selected final price. It selects the earliest retained oracle sample at or after its maturity timestamp, requires that sample to lie within the configured settlement window, and verifies the sample was submitted within the configured freshness interval. Oracle sample timestamps cannot move backward or into the future.

The chosen sample is frozen once for the Manager and retained in each settled issue. Later price updates cannot change an earlier payout budget. A timely historic maturity sample remains usable when a holder settles later; it does not become unusable simply because the holder did not transact immediately.

This reference trusts its Oracle administrator to publish valid source values. It does not implement a signed external feed, quorum, issuer NAV verification or a fallback market price. The source hash is retained provenance, not proof that an external source was authenticated.

## Fixed budgets and explicit shortfall

Settlement withdraws all of an issue's remaining locked shares and measures the exact increase in Manager underlying balance. It never estimates received backing from an API preview.

Let N be initial claims minus paired recombination, U the actual underlying received, and R the frozen final reference price:

```text
PT budget = min(U, floor(N * SCALE / R))
YT budget = U - PT budget
principal shortfall = N - min(N, floor(U * R / SCALE))
rounding numerator = (N * SCALE) mod R
```

A price fall or actual backing loss can consume all backing for principal and leave no yield. The displayed shortfall is an economic loss in USDC accounting atoms. No outside reserve or principal guarantee is invented.

All intermediate products use the SDK U256 integer type. Capped results are capped before conversion to i128, so an extreme positive final price cannot strand an otherwise valid issue merely because an uncapped theoretical quote is too large.

The rounding numerator is a record of exact arithmetic. It is not a second asset balance and cannot be spent. The actual remaining backing belongs to the fixed YT budget. This is an explicit reference interpretation of the original document's unspecified reserve-governance rule. There are zero protocol fees in this version; no treasury, fee policy, market or liquidity product is implied.

## Partial redemption and reserve conservation

Each side of an issue pays against its own fixed budget. For budget B, settlement claim count N and cumulative redeemed claims c:

```text
cumulative paid = floor(B * c / N)
this payout = cumulative paid - previously paid
```

This prevents total payouts from exceeding the budget and pays the exact full budget when all claims on that side have been burned. The single-atom carry depends on cumulative redemption order and is visible in the retained counters.

Redemption verifies the source holder, destination holder and Manager are eligible, applies the pause, burns the selected positive claim amounts and transfers actual underlying to the selected external recipient. Negative quantities and a Manager-self recipient are rejected. A zero-yield claim can be burned with minimum output zero.

Before an issue spends, actual Manager tokens must cover the aggregate liability of all settled issues. A deficit caused by a later Manager-level clawback blocks redemption instead of spending another issue's budget or inventing a cross-issue loss allocation. Such a deficit requires a separately agreed recovery policy. There is no administrator drain.

## Lifecycle outputs and receiving

Keep PRINCIPAL_API.json, the contract source manifest, source provenance, Cargo.lock, the full five Wasm files and complete lifecycle outputs together. The host snapshots include the actual Wasm code and original ledger entries. The course reopens the captured settlement snapshot in a fresh host and completes partial and final redemptions there.

The application journal distinguishes read/simulation evidence from explicit invocation. Its selected contract addresses, network passphrase, signer identity, original parameters, expected source hashes and original request identity must survive export and receiving. A received application must not silently deploy, sign, fund or resume economic operations.

Before a client or demonstration readiness claim, use the exact outgoing application at both a narrow and screen-sharing viewport, exercise the real controls, and open the downloaded API/source/course artifacts. A source review or a successful native host course alone is not a rendered-product acceptance.

## Known scope limits

This reference intentionally preserves visible limits: a single-administrator oracle, an issuance-aware internal claim ledger, fixed-window deposit control, seven-decimal assets, explicit capped-principal loss treatment, no fees or treasury, no market/router, and no external issuer eligibility service. No mainnet address, audited deployment, production liquidity or issuer approval has been inferred.

The useful completed flow is real custody through issuance, transfer, recombination, fixed maturity settlement, actual payout and full source/ledger receiving. Further funded scope should be reconciled to the original issuer's current interface and milestone agreement.

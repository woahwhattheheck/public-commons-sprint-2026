# Exact quantity, credit and fee pricing

The original records-storage engine accepts two explicit request schemas. V1 retains its integer quantity/rate contract. V2 adds decimal quantity/rate input and contract-declared credit, tier, minimum and percentage calculations in the same normalizer and compiler.

Use `OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V2` for the extended request and `OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_PACKET_V2` for its result. Existing roots, current/historical compile, semantic verification and output publication entrypoints remain the same. The request and packet identify their chosen schema.

## Input representation

V2 quantity and rate fields accept unsigned decimal text with at most 18 fractional places. Quantities must be greater than zero. Integer input is also accepted and normalized to decimal text. JSON binary floating-point numbers are refused for these fields. Normalization removes insignificant leading/trailing zeroes; retain original file bytes and lexemes at the importer when those source details matter.

`amount_minor` remains an integer number of currency minor units. Charges are nonnegative; credits are nonpositive. Individual normalized values and checked sums are bounded by 9007199254740991. No numeric sign or invoice amount is discarded to make a record admissible.

V2 policy requires:

```json
{"minor_unit_digits": 2, "rounding_mode": "HALF_UP"}
```

These are explicit caller-supplied terms. The engine does not infer a currency exponent, rounding policy, price, unit conversion, tax jurisdiction or contract from a currency code.

## Declared rate formula

Every V2 rate retains the existing charge code, unit, scope, effective dates and event requirement. Its `pricing` object chooses the formula.

| pricing.kind | Calculation | Additional input |
| --- | --- | --- |
| unit | Quantity × rate_minor | None |
| fixed | One rate_minor amount for the supplied charge row | None |
| graduated | Each part of the quantity uses its applicable tier rate | Ordered tiers |
| volume | The whole quantity uses the single tier containing that quantity | Ordered tiers |
| percentage | Included original invoice amounts × percent / 100 | Percent, exact charge-code set and basis scope |

Optional `minimum_minor` and `maximum_minor` are integer minor-unit bounds applied to the calculated charge. A minimum greater than the maximum is rejected. The engine does not infer multiple periods, automatic prorating, a carrier markup basis or a second minimum from quantity.

For graduated or volume pricing, `tiers` is a nonempty ordered list of `{"upto":"100","rate_minor":"10"}` entries. Bounds strictly increase. Only the final tier may use `upto:null`; that explicitly supplies unbounded coverage. A quantity beyond a finite final tier remains a coverage finding rather than extending the final price.

For example, under explicitly supplied graduated tiers of 100 units at 10 minor units and subsequent units at 8, a quantity of 150 costs 1400 minor units. Under volume pricing with the same thresholds/rates it costs 1200. These figures illustrate the two algorithms and are not a supplier quote.

## Rounding

The calculation uses exact rational arithmetic. It retains the unrounded amount, signed/bounded amount, selected mode, expected integer amount and whether rounding changed the value.

| Mode | Fractional minor-unit result |
| --- | --- |
| EXACT | Expected amount remains null and the row requires review |
| HALF_UP | Nearest integer; a half rounds away from zero |
| HALF_EVEN | Nearest integer; a half chooses an even integer |
| DOWN | Truncate toward zero |
| UP | Round away from zero |

For an explicitly declared unit price of 25 minor units and quantity 1.25, the original unrounded amount is 31.25. HALF_UP produces 31; EXACT retains a fractional-minor-unit finding. An invoice claiming an unrelated supplied amount is not replaced with that expected result.

## Credit notes and retained originals

Additional V2 invoice fields are `line_kind`, `row_role`, `credit_of`, `basis_row_ids`, `billed_at` and `billed_percent`. Omitted line_kind and row_role mean CHARGE and BILLED. Omitted billed_at uses the original service_at.

A CREDIT row must have a nonpositive amount, positive credited quantity and a distinct included original CHARGE in `credit_of`. The original business fields, unit, charge code, carton/site scope and service date remain bound. Credits do not require or consume a new service event.

The applicable original policy declares its credit method:

- `CONTRACT_QUANTITY` applies the declared contract formula to the credited quantity.
- `ORIGINAL_PROPORTION` reverses the actual original amount in proportion to its original quantity. It does not reapply the original minimum/maximum.
- Omitted `credit_method` means UNSPECIFIED. The expected credit remains unavailable until the original rule is supplied.

Use `row_role:REFERENCE` for an included prior-period charge that supports a present credit. Its original pricing is checked, but it does not enter selected billed totals or current fee bases. `billed_at` binds the selected accounting period; `service_at` retains the original service/rate/custody date. This preserves a prior-period original rather than moving its service date to the current period.

The engine checks cumulative credited quantity and absolute amount against the original charge. Missing originals, altered scope, excess reversal, an unadmitted reference rate or unresolved original pricing remain explicit findings. A credit review never asserts that the supplier accepted a credit or cash was received.

## Percentage bases

A percentage policy declares:

```json
{
  "kind": "percentage",
  "percent": "3",
  "basis_scope": "PERIOD",
  "basis_charge_codes": ["STORAGE", "RETRIEVAL"]
}
```

The invoice row names every included `basis_row_ids` and may retain its supplied `billed_percent`. INVOICE restricts the basis to the same original invoice; PERIOD permits the selected closed billing period. Eligible amounts retain their signs, so declared credits reduce a net basis.

Missing, repeated, self-referential, nested, reference-only, wrong-code and out-of-scope bases remain visible. Negative aggregate bases and a supplied percentage that differs from the contract are review items. A basis invoice with unresolved pricing propagates review into its dependent fee. The engine never infers a tax exclusion or an otherwise unlisted fee-on-fee agreement.

`calculate_percentage_fee(rows, percent, rounding_mode)` exposes the same exact calculation for a caller's prepared monthly report. Each row supplies only its original `row_id` and signed `amount_minor`. The result retains the complete basis, summed amount, exact unrounded fee, rounded amount and completeness. Selection of actual account/month/agency, tax exclusions, credit treatment and remittance records remains an explicit caller workflow.

## Result and compatibility

V2 summaries distinguish signed billed total, debits, credits, signed matched/review amounts and gross review magnitude. The full amount of a flagged row is a review amount; it is not confirmed overcharge, recovered money, payable approval or savings.

Reference originals are excluded from selected billed totals. Service events outside the selected period do not become current unbilled findings merely because they were retained to explain an older charge.

The original deterministic economic-duplicate, evidence, rate, custody, service and scope checks still apply. The unchanged V1 request continues to select its original integer normalization and V1 packet. Do not relabel an old packet V2: normalize and compile a genuinely selected V2 request through the original entrypoints.

## Signed bases and proportional fee credits

A percentage basis sums the complete signed rows exactly before checking the final supported money range. Reordering an identical debit/credit basis does not change admission or the amount.

An `ORIGINAL_PROPORTION` credit uses the included original charge's billed amount and quantity directly, including when that charge was a percentage fee. The credit's calculation exposes `proportional_basis` with that original row ID, amount and quantity. It does not require a new percentage basis on the credit or apply another minimum/maximum. The original charge's own pricing and source binding still need to reconcile, and cumulative credited quantity/amount remain bounded by that original charge. `CONTRACT_QUANTITY` retains the declared contract-pricing route.

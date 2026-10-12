# Exact billing and original invoice reconciliation

This contribution supplies two pure Python functions for the existing IANZ receiving application. It uses the full selected fee profiles and original charge records already held by that application.

- `calculate_bill(lines, profiles, policy)` retains the original inputs and returns an independent calculation, canonical charge fields, grouped amounts and controls.
- `reconcile_billing(expected, returned, profiles, policy)` compares the complete original line sets before grouping their amounts. It accepts raw records or the result of `calculate_bill`.

The cumulative application's explicit **Save calculated charge lines** action decides which calculated records become a new native edition. Billing results and their exact input selection remain in its original operation event and financial annotations.

## Source and native contract

This module consumes the canonical `fee_profile` and `charge_line` entities from [contracts/data-contract.json](contracts/data-contract.json), the selected original rows in [data/fee-rates.csv](data/fee-rates.csv), and [data/fee-controls.json](data/fee-controls.json). The initial source set is Public Commons commit `c777801b20d039b59fa2b6ae2953e5dde21c2568`, under `opportunities/ianz_ara_hono_2026/`. The [source register](source-register.json) retains published editions and observations.

The selected July 2026 source profiles are `AS19-2026-07` and `AS14-2026-07`. Their original currency is NZD and their tax classification is the exact text `exclusive of GST`. Complete rule rows, including source IDs and page locators, travel in each profile.

| Charge or control | Original selected value |
| --- | --- |
| Information package | NZD 0 per package |
| Advisory and assessment work | NZD 282 per hour |
| Travel | NZD 141 per hour |
| Initial application | NZD 1,197 per organisation, with the original other-programme exception separately reviewed |
| Annual administration | NZD 1,380 per assessment unit |
| International recognition | NZD 276 per accreditation |
| Recognition cap | NZD 1,380 per laboratory for AS19 or inspection body for AS14 |
| AS14 main / branch / satellite | NZD 2,760 / 690 / 69 per site, corresponding to factors 2 / 0.5 / 0.05 |
| Expenses and technical experts | Original actual cost, with its own amount, currency and source document |

Original source pages: [AS19](https://www.ianz.govt.nz/media/bkjfhlun/as19-fee-schedule-drinking-water-laboratory.pdf) and [AS14](https://www.ianz.govt.nz/media/gcompp0b/as14-fee-schedule-inspection-bodies.pdf). Tax and rounding are selected finance inputs; the engine does not derive them from those labels.

A profile is the actual canonical row, including:

```json
{
  "fee_profile_id": "AS19-2026-07",
  "source_edition_id": "THE_SELECTED_ORIGINAL_EDITION",
  "programme_key": "THE_ORIGINAL_PROGRAMME_KEY",
  "currency": "NZD",
  "tax_basis": "exclusive of GST",
  "published_period": "THE_RETAINED_PUBLISHED_PERIOD",
  "publication_month": "2026-07",
  "charge_rules": []
}
```

Replace the empty example list with the **complete actual original charge-rule objects**. Each uses the CSV's `tariff_key`, `amount_nzd_ex_gst`, `charge_unit`, `mode`, `assessment_unit_factor`, `source_id`, `source_page` and other retained fields. Modes are `fixed`, `rate`, `site_administration`, `pass_through` and `cap`. A cap is a control rather than an invoice charge. The two original recognition-cap relationships are explicit in the module; any additional cap must supply its own `applies_to` tariff-key list. Overlapping caps require an explicitly received rule.

The application passes the full original profile. Its SHA and each used tariff SHA appear in every calculation trace.

## Exact input representation

Quantities, rates and amounts are bounded decimal **strings** or integers. Strings preserve the supplied decimal representation. Binary floats, exponent notation and booleans are rejected in monetary/numeric fields. The module uses `Fraction(Decimal(original_text))`; neither calculation nor aggregation depends on process Decimal precision.

Every exact calculated amount has:

```json
{"numerator": "1", "denominator": "3", "decimal": null}
```

`decimal` is populated only when the fraction has a terminating decimal. A null decimal leaves the exact rational available. Canonical invoice amounts are emitted after selected rounding as fixed-place strings. Missing, null, blank, invalid and numeric zero remain distinct in reconciliation.

Structural errors raise `BillingError`, a `ValueError` subclass with `code` and optional `details`. An incomplete but well-formed policy or applicability selection returns unavailable calculated amounts and explicit controls.

## Charge-line selection

Retain all canonical charge fields. Add these receiving and calculation fields in the immutable input/annotation:

| Field | Meaning |
| --- | --- |
| `invoice_key` | Exact selected original invoice or explicitly authored invoice group |
| `tax_basis` | Exact source classification |
| `quantity_origin` | `authored_operating_choice` or `received_invoice` |
| `group_scope` | Object containing exactly `kind` and `key`, identifying the original site, assessment unit, laboratory or inspection body |
| `applicability` | Selected decision, reason and source evidence |
| `issuer_account_key` | Required for the original IANZ initial-fee exception |
| `cap_group_key` | Required on a charge subject to the recognition cap |
| `source_document_key` | Original invoice/actual-cost/credit source, or the application's newly retained authored calculation source |

The group identity is the exact tuple:

`invoice_key / currency / tax_basis / fee_profile_id / billing_account_key / billing_period / group_scope.kind / group_scope.key`

Each cap further includes `cap_group_key` and the actual cap tariff. Distinct invoices, accounts, profiles, periods, currencies and sites/units remain separate even when their labels or amounts match. For AS19 recognition the scope kind is `laboratory`; for AS14 it is `inspection_body`.

An illustrative authored line, before its explicit source-document save:

```json
{
  "charge_line_key": "internal-example-recognition-1",
  "invoice_key": "internal-example-invoice",
  "billing_account_key": "internal-example-account",
  "fee_profile_id": "AS19-2026-07",
  "tariff_key": "AS19-2026-07:international-recognition",
  "quantity": "6",
  "quantity_unit": "accreditation",
  "currency": "NZD",
  "tax_basis": "exclusive of GST",
  "billing_period": "internal-selected-period",
  "group_scope": {"kind": "laboratory", "key": "internal-example-laboratory"},
  "cap_group_key": "internal-example-recognition",
  "quantity_origin": "authored_operating_choice",
  "applicability": {
    "decision": "apply",
    "note": "Authored arithmetic exercise using the selected original recognition tariff."
  }
}
```

Those identifiers and the quantity are authored exercise inputs. Real receiving uses supplied original account/programme/site/invoice identities.

Received invoice lines must contain their actual original `source_document_key`. Actual-cost and credit lines require that document as well. The module never invents such a key. An ordinary authored line may lack it during calculation: `needs_authored_source` and `calculated_ready_for_authored_source` expose that task. The application's explicit save action can retain a JSON source containing the selected authored inputs, full result and source/policy pins, then bind its native document key. It preserves the original calculation request unchanged.

For pass-through costs, the selected line retains one complete original cost total with quantity `1`. The engine does not multiply that total again. A different original currency remains in its own group and needs a matching explicit policy. A source fee or cap cannot be relabelled into another currency.

## Applicability and initial-fee exception

`applicability.decision` is `apply`, `not_applicable` or `unresolved`. Both resolved choices require a note. A not-applicable decision also retains supporting `source_refs`.

The initial-application exception specifically requires:

```json
{
  "decision": "not_applicable",
  "reason": "existing_other_ianz_programme",
  "reviewed_by": "THE_ACTUAL_OPERATOR",
  "account_programme_link_id": "THE_SELECTED_LINK",
  "source_refs": ["ORIGINAL ACCOUNT AND PROGRAMME EVIDENCE"],
  "note": "THE_ACTUAL RECORDED DECISION"
}
```

`policy.account_programme_links` contains the matching original record, with `link_id`, `issuer_namespace:"IANZ"`, `issuer_account_key`, `billing_account_key`, a different `programme_key`, `qualifies_for_application_exception:true` and its `source_refs`. The line's issuer and billing account must match. The selected profile's programme cannot itself satisfy an exception for a different programme.

These fields record the existing operator decision and original evidence. They do not introduce a new approval role. An unmatched link keeps the amount unavailable rather than applying the exemption.

The trace distinguishes the pre-decision source amount, `applicability_reduction`, the amount after applicability and the later `cap_reduction`.

## Selected finance policy

Policies are explicit retained objects. There is no default tax rate, rounding precision, rounding mode, cap allocation or foreign-exchange conversion.

```json
{
  "origin": "authored_operating_choice",
  "note": "Illustrative internal calculation policy; replace with the selected original finance rule.",
  "cap_allocation": "proportional",
  "rules": [{
    "policy_id": "internal-example-policy",
    "currency": "NZD",
    "tax_basis": "exclusive of GST",
    "rounding": {
      "decimal_places": 2,
      "mode": "HALF_UP",
      "net_scope": "line",
      "tax_scope": "line"
    },
    "tax": {"rate": "0.15", "basis": "rounded_net"}
  }],
  "account_programme_links": [],
  "credit_originals": []
}
```

This 0.15 rate is an illustrative selected operating choice. A received policy uses `origin:"received_finance_policy"` and actual `source_refs`. The top-level note is required for selected rules. Each currency/tax-basis pair has one selected rule with a stable `policy_id`.

Supported rounding modes are `HALF_UP`, `HALF_EVEN`, `UP` (away from zero), `DOWN` (toward zero), `FLOOR` and `CEILING`. Precision is explicitly 0–12 decimal places. Net and tax independently use `line` or `group` scope. Tax uses the chosen `rounded_net` or `unrounded_net`. Group rounding applies only within the full group identity above.

`rounding:null` preserves unrounded results and leaves canonical rounded money unavailable. `tax:null` preserves calculated net but leaves tax and gross unavailable. A declared zero tax rate produces zero; an absent rule does not.

The complete selected policy, including additional evidence, is hashed and retained. Profile-level tax/rounding metadata remains in the profile but is not silently adopted as a selected rule.

### Cap and rounding allocation

The engine computes source rate × exact quantity, applies the explicit applicability decision, then caps the positive recognition group. It exposes every uncapped amount, limit, reduction and participating line key.

When a cap reduces the group, `cap_allocation` is:

- `proportional`: allocate the exact cap by the original charge amounts, retaining any nonterminating rational.
- `line_key_order`: retain amounts up to the cap in ascending original `charge_line_key` order.

Missing allocation is unresolved when actually needed. Credits do not enlarge the positive-charge cap.

For group rounding, indivisible rounding units use largest remainder with original line-key tie breaking. For line rounding, each line uses the selected mode; a cap group needs constrained rounding allocation only if independently rounded values would exceed its cap. That correction also requires an explicit allocation choice. Every adjustment remains visible. The selected quantum must represent an enforced cap exactly.

The six-accreditation arithmetic control is 6 × 276 = 1,656, capped at 1,380 with a 276 reduction. These are public-tariff arithmetic controls, separate from actual client invoice counts.

## Credits and original invoice amounts

A negative charge retains its original `credit_of_line_key`, source document and signed net amount. It does not become a guessed negative service quantity. The trace keeps supplied quantity and amounts independently.

The referenced positive charge may be in the selected lines or `policy.credit_originals`. An identical reference supplied in both is reconciled; different editions of the same key are unresolved input. The original account, tariff, quantity unit, currency, tax basis, profile, site/unit and cap group must agree. Credit invoices and posting periods remain their own values; the referenced original invoice is separately retained.

Each credit component is checked independently against the positive net, tax and gross. Received invoice/credit components remain authoritative original values. For a current authored charge, the independent calculated component supplies its selected basis. Missing components, sign differences, missing source documents and over-credit amounts remain visible. Credits are checked after original lines; no unselected historical credit is inferred.

`controls.credits[].amounts` contains each original component, its basis, all selected credit components, remaining amount and any over-credit. These controls describe only the selected history.

## Calculation output and explicit canonical saving

Each result line includes:

```text
charge_line_key
group_id
original                         complete untouched original input
canonical                        native charge_line fields available from calculation
calculation                      exact source, applicability, cap, tax and rounding trace
original_amount_differences       independently calculated versus supplied original value
calculation_complete
needs_authored_source
calculated_ready_for_authored_source
canonical_ready
unresolved_controls
```

`canonical` contains original native contract fields where available. It normalizes exact quantity/source rate and emits rounded net, tax and gross strings. An unavailable calculation removes that canonical amount; it never falls back to a stale original amount. The complete original remains beside it.

`canonical_ready` is a data-completeness/control result. It requires calculated money, the source document and resolved relevant controls. `calculated_ready_for_authored_source` identifies an otherwise complete authored calculation whose only remaining item is its generated source document. Original rate/amount differences stay separately reviewable even when the independent calculation is complete.

Top-level `groups` contains full scope, line keys, exact known subtotals, complete totals, missing-line coverage, selected policy and rounding. `totals` is separated by currency. A complete group remains unavailable if a selected line's applicability/cap input is unresolved.

`controls` contains original dated arithmetic checks, cap receipts and credit lineage. Preserve the full output unchanged in the operation event/annotation. Filter only `canonical` into typed charge records after the user selects the native save action.

## Reconciliation and returned invoices

```python
result = reconcile_billing(expected_lines_or_calculation, returned_lines_or_calculation, profiles, policy)
```

Plain lines are compared at their original amounts; they are not rerated against a current tariff. A calculation result selects its independent canonical amounts. For calculated wrappers, original noncanonical scope/provenance is retained while canonical values take precedence. Missing canonical amounts stay missing.

The function performs:

1. Complete indexing of both original sets, retaining every duplicate and invalid identity.
2. Missing/extra line, original field, exact quantity/rate and net/tax/gross comparison.
3. Explicit group totals, unavailable when identity or amount coverage is incomplete.
4. Positive-charge cap controls and original credit lineage.

Comparison includes invoice, account, accreditation, assessment, facility, profile, tariff, currency, tax basis, billing period, quantity unit, credit link, source document, cap group, group scope and quantity origin. A compensating change on another line cannot erase the first difference.

Missing, null, blank and zero are distinct. Exact numeric equality with a different decimal representation is retained in `representations`; original strings remain available. There is no tolerance, implicit rounding or automatic correction.

Returned shape:

```text
schema
inputs_sha256
differences[]                    stable difference_id, kind and both original values
representations[]
groups[]                         expected and returned full group metrics
cap_allocations                  original positive-charge controls for each side
credits                          reference/component controls for each side
published_controls
summary
```

`summary.comparison_complete` reports whether required values/identity/control selections are available. `summary.matches` also requires no differences. A difference can be completely measured and still require correction. `summary.unresolved` retains actual missing or ambiguous inputs. Original source bytes remain the native application's responsibility; this function receives and hashes their selected decoded records.

The existing [reconciliation contract](contracts/reconciliation-contract.json) owns staff choices: correct mapping, receive a corrected original edition, retain an explicit representation/scope choice, or keep a difference visible. The module adds no approval tier.

## Integration and receiving

```python
from billing import BillingError, calculate_bill, reconcile_billing
```

Requires Python 3.10+ standard library. It performs no I/O, persistence or billing dispatch. Limits are 20,000 selected lines, 500 profiles, 5,000 rules per profile and 160 characters per original numeric value. Excess input is rejected rather than truncated.

The application retains in its immutable native request:

- selected original lines and complete profiles;
- full finance policy, applicability and source links;
- complete calculation/reconciliation result;
- explicit canonical save choices, document identities and resulting records.

Return receiving merges retained `financial_receiving.original` with the actual reverse-mapped current canonical fields last. A received target change remains the received change; an old calculated value must not replace it before reconciliation.

Current cumulative IANZ integration is owned by BC10. This module and guide are an exact-arithmetic and original-line reconciliation contribution for that application. Useful changes should enter the accepted engine and financial operator through their existing source/receiving flow.

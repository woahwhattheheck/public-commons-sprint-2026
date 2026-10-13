# Customer delivery funding protection

This option belongs to the existing Operating Forecast. It compares the original pooled cash projection with cash available after protecting customer-attributed money for remaining modeled delivery. It does not record a payment, transfer, bank reconciliation, legal escrow or restricted account. Original cash, invoices, currency valuation, customer terms and Portfolio dates remain authoritative.

## Prepare the original case

Open the existing case and its selected Forecast. Use **Reforecast current case** when changing an immutable saved edition. Keep the original customer scenario IDs, receipt assignments, invoice links, source attachments and complete delivery/support estimates. The original customer's selected flag controls speculative future work and collections; it does not cancel an unpaid original invoice.

Review the as-of date and enter the total available opening cash only when known. A missing bank opening balance is not zero. Actual cash records prove transactions, not the balance still available today.

Under **Protect remaining customer delivery funding**, choose **Plan customer funding protection**. This adds an explicit optional input. Merely opening an older forecast adds nothing to it.

For every original customer:

1. Enter its unspent attributed opening amount at the as-of date. Leave it blank if unresolved. Do not copy its gross collected receipts into this field.
2. Choose **Observed reconciled balance** or **Explicit planning assumption** for every entered amount, including zero.
3. Retain the relevant balance reconciliation sources. An observed amount requires original receipt or source evidence. Receipt IDs must already belong to that customer's original observed, valued CUSTOMER inflows through the as-of date; testnet transactions cannot establish a customer balance.
4. Write the reconciliation or assumption explaining what remains after completed delivery, costs and other uses. The note is required for each entered amount.
5. State the funding policy and scope. Keep this planning restriction separate from any actual legal or banking restriction.

Known attributed customer opening funds cannot exceed the known total opening cash while protection is enabled. When total opening cash is unknown, a specifically supported customer attribution may still be known, but actual available cash and the extra funding gap remain unresolved.

Turning protection off retains entered amounts, sources and notes in the same input. It disables the protection calculation; it does not release legally restricted money. Entered fields must still satisfy the original input/source validation when previewed. Complete working files preserve unfinished text, such as `0.`, before a valid native preview is available.

## What the native calculation includes

The remaining obligation for each customer is the selected **remaining uninvoiced delivery cost**, plus **included unpaid linked invoice amounts**. Each included invoice is counted once. The original Forecast already removes gross invoices and assigned observed direct costs from its uninvoiced estimate; this feature does not add full quoted costs or gross invoices again. Support included in the estimate remains part of the protected obligation.

Deselecting a speculative customer excludes that scenario's future quoted collections and uninvoiced work. It leaves included original invoice liabilities in the calculation. An explicit invoice exclusion continues to require the original reason and is visible in the original invoice review.

Customer attribution starts with the entered unspent opening amount. The existing dated customer receipt events increase it. The same customer's native delivery-cost and included invoice-payment events reduce it, while those payments reduce the remaining obligation. No additional FX conversion, receipt allocation or payment schedule is invented.

At each end of day:

```text
protected customer funds =
  min(max(attributed customer cash, 0), remaining modeled customer obligation)

unreserved available cash =
  original pooled available cash - total protected customer funds
```

Unknown values remain unknown. A definitely zero remaining obligation needs no protection even when attribution is unknown. A known zero or negative attribution protects zero at that point. Later unknown-valued customer inflows or outflows make attribution unknown from their own original dates. The native currency report remains authoritative: when the full dated pool is unvalued, this feature does not turn it into a numeric available balance.

Undated remaining delivery cost stays protected. It is not given an invented payment date. This may leave protected funds at the end of the original dated horizon. Review those unresolved work conditions and dates before treating the final balance as available for other work.

## Read the complete result

Use **Preview current forecast**. Native validation and exact Decimal arithmetic produce the original preview; the browser only displays that report.

The summary separates:

- **Maximum required starting cash:** the largest modeled starting amount needed to prevent the unreserved end-of-day position from falling below zero.
- **Extra funding after entered total opening cash:** that requirement less the known opening total, floored at zero. It stays unknown when the opening total is unknown.
- The peak date, final protected amount and final unreserved available cash.

A known portion omits unresolved flows or reservations. It is neither a complete funding requirement nor a guaranteed lower bound.

The attribution table shows each original customer, selected/excluded status, opening basis, receipt/source evidence, reconciliation note, included invoice IDs and unpaid value, uninvoiced cost, total remaining obligation and undated scope. Daily tables retain every original date and every customer movement, with 60 rows per visible page. The customer filter changes the view only. It does not select a different economic scenario or change saved inputs. The complete export contains all rows regardless of the currently visible page.

A planning example clarifies the distinction. With total opening cash 100, attributed customer opening 80 and remaining obligation 120, a future customer receipt of 70 gives pool 170, protection 120 and unreserved cash 50. Paying 50 of that customer's included delivery cost gives pool 120, protection 70 and unreserved cash 50. A subsequent grant cost of 80 produces an unreserved shortage of 30 until other funding arrives. These are explicit example assumptions, not observed transactions or an instruction to create customer cash records.

## Save, continue and reopen

Save through **Save this forecast** only after the original preview is current. The existing retained request is persisted before native dispatch. A missing response is continued with that same request identity and body; this feature adds no second writer. A saved Forecast freezes the complete inputs, source snapshot, native report and identity. Later changes create another original Forecast edition.

The existing full working download retains funding input, exact partially typed controls, workbook source and review, cash review, pending workbook request and pending save request. Recovery stays within the same retained case and pinned plan. An import validates its full candidate and reads any selected saved Forecast before disposing the current editors or adopting new state. A rejected saved-edition read leaves current work intact.

The existing thirteen-sheet preparation workbook preserves this optional policy and every opening attribution in its complete **Original** source. Funding values are edited in the native Forecast controls, not by creating extra undocumented spreadsheet columns. Unrelated returned worksheet changes merge with later native funding edits.

An explicit Customers REMOVE is reviewed together with its dependent opening attribution. If a concurrent customer or attribution change exists, resolve the actual removal conflict. Keeping the customer keeps its current attribution; taking the removal removes both. Conversely, restoring a returned customer after a concurrent local removal restores its retained attribution. Other customers' amounts, notes and evidence remain intact. A standalone deliberate attribution edit for a customer still present is not silently undone.

Removing an original customer directly in the native editor also removes only that customer's attribution and raw form controls. Disabling protection keeps all attributions.

## Full exports and original receiving

The existing Forecast ZIP retains its original members and additionally includes:

| Member | Complete content |
| --- | --- |
| `customer-funding.json` | Policy, opening evidence, full customers, all days, all movements, summaries and interpretation |
| `customer-funding-daily.csv` | Every pooled, protected and unreserved daily amount and unresolved customer IDs |
| `customer-funding-obligations.csv` | Every customer/day opening, receipt/cost movement, balance, remaining obligation, protected value and native event reference |

Disabled protection exports the complete policy JSON without pretending to have an active calculated report. Original full case export/import retains the saved inputs, reports, snapshots and history through the same native receiver. No customer balance is rebased or inferred merely by receiving a case. Older Forecasts with no `customerFunding` key retain their original normalized inputs, reports and saved hashes.

The original source distribution uses `managed-source.json` for both Python and JavaScript launchers. Its full closure includes `forecast_customer_funding.py`, `forecast-customer-funding.mjs`, this guide and the joined original Forecast/workbook modules. The existing authenticated host serves the new module and guide; no alternate service or store is required.

## Existing operator's complete course

F47A retains the complementary original Accounts/Forecast receiving course and its original equipped operation. Use the actual retained case and its source files. The original v32 archive (524,761 bytes, SHA256 `24166a4313e4c3667b75431957f826ce7a28cc2178c03dbdc4dfe06be6713aaf`) has three saved Forecasts and no actual cash; it cannot establish an observed customer balance. Explicit labeled sensitivities are permitted without fabricating transactions. A later actual cash-bearing source must come from the same original account owners and retain its existing identities.

The full course is:

1. Reopen the original case and all prior saved Forecasts with protection absent. Retain their identities.
2. Select its existing customers and enter clearly labeled opening assumptions or actual reconciled evidence. Operate unknown, explicit zero, partial text and disabled-with-retained-input states.
3. Preview the protected calculation, including an existing included linked invoice, a deselected speculative customer, an undated remaining obligation and any actual unvalued original currency case available. Preserve the original source distinctions.
4. Operate the customer filter and both paged tables; inspect first, middle and final pages. Review every error before continuing.
5. Export the complete working file, change unrelated current work, and receive it deliberately. Verify rejected original saved-edition retrieval preserves the current draft. Exercise both directions of a returned-customer removal conflict with retained attribution.
6. Save through the original native request; continue its exact request after an unknown response where the existing course supports that boundary. Verify one saved history event, not a duplicate Forecast.
7. Download the complete Forecast ZIP and whole original case; independently receive and cold reopen all original and new saved editions. Confirm full daily/obligation rows, amounts, source IDs, filenames and member hashes.
8. The producing owner must personally open/run the exact delivered version, LOOK at actual rendered pages/screenshots and operate the important controls on desktop and a narrow viewport, including populated, empty, loading and error states. Open every final outgoing attachment and operate export/reopen. Screenshot capture alone, DOM counts, source review, another peer's approval or a test suite cannot substitute. Play final audio/video if any is provided. Repair actual usability defects directly and repeat the affected journey. Do not call the app or attachments customer-ready before this is complete.

Current verification is explicit: the complete native Python semantics received independent source review; production JavaScript workbook/host functions ran against the actual retained v32 Forecast in V8, including all thirteen sheets, unchanged legacy inputs, partial amounts and both customer-removal directions. No native Python execution or rendered browser pass is claimed by that V8 exercise.

# Operating cash and remaining-work forecasts

Use **Delivery operations → Operating forecast** to answer two dated questions: how much cash is still needed to complete the retained work, and whether the selected delivery windows fit the available capacity.

The forecast is saved inside the original SF47 operations case. It uses the pinned planning revision, original work and invoices, observed payments, and source attachments. Saving a forecast adds one immutable planning record and an event to that case. The existing budget calculator continues to calculate the application and its conditional payouts.

## Create and use a forecast

1. Open the retained planning workspace and select **Delivery operations**. Select the original case and enter the recording operator in its existing controls.
2. Open **Operating forecast**. Set an **as-of date** and the explicit **plan day-zero date**. Actual payments and completed work are considered through the as-of date; future cash starts the following day. The plan anchor is a schedule choice and does not record an award.
3. Enter an opening available-cash amount if it is known. Choose **Observed balance** or **Planning assumption**, retain its source or assumption note, and attach the original source if available. A blank balance leaves the funding requirement visible without pretending that a bank balance is known.
4. Review the six remaining work packages, outstanding invoices, and conditional grant dates. Re-estimate the remaining uninvoiced cash and hours when the default does not reflect the work still owed. Retain the reason for each changed estimate or date.
5. Add customer delivery scenarios when useful. Each one needs the original case or offer identity, exact quoted price and milestone amounts, current relationship stage, customer-specific delivery cost and remaining hours, dates, and a source or assumption note.
6. Select **Preview current forecast**. Review the cash curves, complete dated table, capacity comparison and source decisions. Any subsequent input change requires another preview.
7. Select **Save this forecast**. The save is bound to the exact preview and reviewed case version. If another operator changed the case, reopen it and reconcile the changed records.
8. Use **Saved forecasts** to reopen a retained result. **Reforecast current case** copies its assumptions into a new draft and recalculates from the current original records. Each saved forecast retains its own original snapshot.

A closed case remains readable and previewable. Use the existing case **Reopen** action, with its reason, before saving a new forecast.

## What the three cash curves mean

| Curve | Cash included |
|---|---|
| Existing obligations and grant work | Included unpaid invoices and remaining uninvoiced grant-package costs |
| With conditional grant receipts | The same spending plus explicitly dated remaining conditional grant receipts |
| With selected customer deliveries | The same grant scenario plus selected customer collections and customer-specific remaining delivery costs |

The **cash needed before opening balance** is the maximum cumulative cash shortfall over the selected dates, starting from zero available cash. It describes the required funding across that scenario. **Gap after opening balance** subtracts the explicitly entered available balance. If no balance was entered, this column and ending available cash remain empty.

An invoice recorded in the case remains an existing obligation even when a proposed customer delivery is deselected. A recorded liability needs its own explicit invoice exclusion and reason. Excluding a speculative project cannot erase money already owed.

A customer price, proposed collection date or conditional grant amount never creates an observed payment. The original cash ledger and application state remain the source for actual receipts.

## Paid invoices and remaining package cash

The default remaining package amount is:

```text
maximum(
  pinned package allocation
  − full non-void invoice lines assigned to that package
  − explicitly assigned direct observed payments,
  0
)
```

The invoice section then includes only each invoice's unpaid balance after its original allocations and refunds. This removes paid obligations once while retaining completed but unpaid work.

For example, suppose a USD 7,600 package has USD 400 of invoiced package work. The invoice also has USD 200 of a separate expense, and USD 400 has actually been paid against that USD 600 invoice. The package retains USD 7,200 of uninvoiced work and the invoice retains USD 200 outstanding. The other USD 200 expense is preserved through the invoice instead of silently being folded into the grant package.

This default is an allocation calculation. It does not prove that all uninvoiced budget is still payable. Accepted work may have been completed without a vendor bill, or the remaining implementation may have changed. Enter an explicit **remaining uninvoiced cash** estimate for that case and retain the basis. The original accepted hours reduce remaining work independently of the cash estimate; their PREAWARD, GRANT, CUSTOMER or INTERNAL funding labels remain visible.

A direct observed outflow can be assigned to one package or customer project when it has no invoice allocation. The adapter requires a USD-valued, observed, non-testnet original payment through the as-of date. It rejects duplicate assignments across the forecast. Unassigned direct payments are listed for review.

Overpayments remain visible as source credits. The forecast does not assume that a credit will be refunded as cash. Disputed unpaid invoices stay included until an operator excludes one with a reason.

## Dates and payment timing

- Undated and overdue unpaid invoices are conservatively scheduled on the next day unless a new expected payment date is entered.
- Original package installment and completion schedules are retained when **Original payment schedule** is selected. Remaining amounts are proportionally allocated across the original installments with exact cent conservation. Completion timing respects the selected finish and the original completion-plus-lag date.
- To apply a different timing decision, choose **Evenly over remaining dates** or **At remaining work completion** and retain the reason.
- The original hours and costs use inclusive calendar dates. A ten-business-day customer scope needs actual chosen calendar start and finish dates; the forecast does not silently turn it into ten calendar days.
- If an original work window has elapsed, remaining hours move to the next day and a work-date decision is shown. Enter the actual new work window before relying on its capacity curve.
- A past-due conditional grant receipt without a new date is omitted from the curve and listed for review. The forecast never assumes that an unreceived payout happened on its original date.
- Forecast dates begin after the as-of date and remain within three years. Current retained record states are used: this feature does not reconstruct historical lifecycle states from an old as-of date.

Cash records dated after the as-of date do not pay invoices or fund this forecast. Work finishing after that date does not reduce the remaining hours. Those source records are identified in the result.

## Customer delivery scenarios

Retain the exact original offer alongside the estimate:

| Field | Meaning |
|---|---|
| Original case / offer identity | Existing sales or delivery case, offer and relevant original correspondence |
| Original commercial stage | Quoted offer, agreed scope, or implementation in progress |
| Original total quoted price | Complete price represented by the retained receipt milestones |
| Receipt milestones | Distinct identities, original quoted amounts, and optional future collection dates |
| Current total delivery cost | Customer-specific cost estimate, including linked invoices and direct payments |
| Remaining customer-specific hours | Work still needed for this customer's implementation |
| Actual collected receipts | Selected original CUSTOMER inflows; each can belong to one scenario |
| Delivery invoices | Original invoices whose lines are outside the grant packages; each can belong to one scenario |
| Source and assumptions | Original scope, prerequisites, estimate basis, date assumptions and relevant attachments |

The milestone amounts must add to the quoted price exactly. Selected observed customer receipts reduce those milestones in order; over-receipts remain explicit. A milestone with no collection date is excluded from the cash curve and listed as a date decision.

Customer-specific remaining uninvoiced cost equals its current total delivery estimate less the original linked invoice amounts and assigned direct payments, floored at zero. Included unpaid invoices remain separately due. Reusable product work completed before the proposed customer implementation belongs in its original scope; it must not be relabeled as work still needed for this customer.

A new internal effort estimate is valid as a forecast assumption when its author, scope and basis are explicit. It is distinct from a quoted customer commitment, measured hours or an agreed supplier rate. Keep each concept in its original field and source note.

## Capacity

The forecast distributes the selected remaining hours over their inclusive calendar windows and compares the seven-day equivalent with the entered weekly team hours. When that field is blank, it uses the pinned contributor capacities if available.

This is a shared capacity comparison, not a staff roster. The result retains the original contributors and reports peak required hours, overloaded days, and the first and last overloaded dates. The capacity note should describe actual availability or the planning assumption being examined. Selecting a proposed customer project adds its remaining hours to the same comparison.

## Exact saved identity and receiving

Every saved record contains:

- Schema and engine version.
- Original case ID/version, pinned plan ID/revision, plan content/source hashes, and complete business/facts hashes.
- Complete normalized inputs and calculated report.
- Original case, plan, records and source-metadata snapshot.
- Save ID/version, operator, time and note.
- Complete saved-record SHA-256 and the reviewed preview SHA-256.

Previewing is pure. Saving uses the original case transaction and stable request receipt. Retrying the exact command returns the original saved result. A changed command cannot reuse that request identity.

A reopened saved forecast is always its original result. The workspace separately reports whether the current source facts differ. Case or plan names changed by receiving do not falsely indicate different financial facts; the original IDs remain in the saved record.

**Download complete forecast** exports the complete JSON, dated cash and work, event-level cash, package estimates, invoices, commercial scenarios, grant dates, source decisions, and an exact file manifest. **Export complete case** additionally carries the original planning history, all case records and source attachment bytes, plus every saved forecast. Import that original case archive to reopen the complete operating workspace.

The receiver validates original source hashes, each saved forecast's full digest, its recalculated inputs/report, and its original save event before adopting it. Older operations archives without forecasts continue to import.

## HTTP and CLI

The existing authenticated local workspace exposes:

| Method | Path | Result |
|---|---|---|
| POST | `/api/operations/{case}/forecast-preview` | Pure normalized preview for the expected case version |
| POST | `/api/operations/{case}/command` | Original `forecast.save` command |
| GET | `/api/operations/{case}/forecasts` | Saved forecast summaries |
| GET | `/api/operations/{case}/forecasts/{forecast}` | Complete saved result and current-source comparison |
| GET | `/api/operations/{case}/forecasts/{forecast}/export.zip` | Complete retained forecast archive |

Use the original CLI with the same workspace ownership:

```sh
python3 workspace/cli.py operations --workspace /private/sf47 forecast-preview \
  --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --inputs /private/forecast-inputs.json --output /private/preview.json

python3 workspace/cli.py operations --workspace /private/sf47 forecast-save \
  --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --inputs /private/forecast-inputs.json \
  --expected-preview-sha256 "$PREVIEW_SHA256" \
  --actor "Delivery operator" --request-id "$REQUEST_ID" \
  --note "Reviewed source, remaining work, costs and collection assumptions"

python3 workspace/cli.py operations --workspace /private/sf47 forecasts --case "$CASE_ID"
python3 workspace/cli.py operations --workspace /private/sf47 forecast-show \
  --case "$CASE_ID" --forecast "$FORECAST_ID"

python3 workspace/cli.py operations --workspace /private/sf47 forecast-export \
  --case "$CASE_ID" --forecast "$FORECAST_ID" --output /private/forecast.zip
```

The browser and CLI use the same exclusive workspace owner. Close the browser server before opening that workspace in a separate CLI process. Output files use the existing private atomic publisher and must have new destination names.

Input JSON can be downloaded from the browser and loaded back into its normal form. Unknown fields, repeated protected assignments, changed source versions, out-of-range dates and mismatched milestone amounts are rejected before saving. Money remains decimal strings with cent precision; remaining hours preserve four decimal places.

Limits follow the original operating workspace: 100 saved forecasts per case, 50 customer scenarios per forecast, 30 receipt milestones per scenario, and the existing complete-case archive bound. Keep the complete original case export for portable receiving.

## Quotes whose dates depend on an original event

Choose **After an original deposit or other event** when work starts only after a deposit, agreed access, source inputs or another original prerequisite. The complete quote can then be saved before either work date is known. Keep both work dates empty together, enter the quoted delivery window in business days, and retain one original relative collection term for each payment milestone.

This is an optional extension to the original commercial row:

```json
{
  "startDate": null,
  "endDate": null,
  "timing": {
    "mode": "EVENT_DEPENDENT",
    "startCondition": "Original deposit received and all agreed source, access and reviewer prerequisites ready.",
    "deliveryBusinessDays": 12,
    "receiptConditions": [
      {"receiptId": "kickoff", "condition": "Due before customer implementation starts."},
      {"receiptId": "acceptance", "condition": "Due seven calendar days after accepted complete handover."}
    ]
  }
}
```

The two milestone IDs must be the IDs already in that row's `receipts`. Every milestone needs exactly one condition; normalization keeps them in original milestone order. `deliveryBusinessDays` is an integer from 1 through 1,096. The original note, offer identity, source attachments, prices and observed-payment rules continue to apply.

Full selected costs and hours stay in the existing scope totals. When the work window is empty, those uninvoiced costs and hours remain outside the dated cash and capacity curves, with a specific date decision. Original invoices retain their independent due dates. Quoted milestones without collection dates remain separately undated. The report's `eventTiming` section lists the complete terms, undated delivery cost, undated hours and undated collections beside the dated results.

To activate the dated work:

1. Record the actual deposit, acceptance or other event through the original operations records and preserve its source.
2. Refresh the current case and forecast, retaining the original customer and quote identities. Enter the known remaining-work window, or take the complete forecast to Portfolio and choose its reviewed release date.
3. Portfolio derives the promised deadline using the same selected working calendar as its allocator. Day one is the first working date on or after the release. An earlier observed release remains the deadline's anchor, including when it precedes the future forecast window. Enter any holidays or special working dates needed for the original commercial calendar.
4. Review the complete allocation, deadline exceptions and cash timing before selecting the work dates back into Forecast. The quoted delivery window is a deadline; the separate minimum effort duration remains its original Portfolio input.
5. Enter collection dates when those dates are known, and retain the original deposit or accepted-handover terms in the milestone conditions. Save with the current case version and exact preview identity.

An allocation keeps the whole undated task, including its effort, assignments and source terms. It reports `EVENT_RELEASE_DATE_REQUIRED` while the original release remains unresolved. A deadline outside the selected horizon needs a longer calendar; a manually entered due date later than the original relative deadline is returned for correction. Existing saved allocations stay available alongside that unfinished date decision.

The complete forecast ZIP adds `event-dependent-timing.json`, `event-dependent-work.csv` and `event-dependent-receipts.csv` only when this timing mode is used. Complete case export and import retain these inputs through the original saved forecasts and snapshots. Ordinary dated rows omit `timing`; their normalized values, calculations and saved identities are unchanged.

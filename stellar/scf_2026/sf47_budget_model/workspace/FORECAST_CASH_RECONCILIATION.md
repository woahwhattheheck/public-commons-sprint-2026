# Reconcile a saved Forecast with recorded cash

Use **Delivery operations → Operating forecast → Forecast cash reconciliation** to compare one original saved cash plan with the case's later original payment records and prepare the next dated Forecast. The original Cash, invoice-allocation, account-statement, currency and Forecast engines remain the writers of their own records.

The workflow answers practical questions: which dated commitments now have recorded receipts or expenses; which payments are not yet linked to a package or customer; which original source records have changed; and which next-period assumptions need an explicit decision. It does not mark a promised payment as received, turn an estimate into an invoice, or infer that an absent record means no payment occurred.

## Select the original work

Open the actual retained case and enter its recording operator. Choose **New forecast**, continue the current editable draft, or open an original saved edition and choose **Reforecast current case**. The saved edition remains immutable. The cash desk changes only an editable current draft.

Choose the exact original Forecast and enter the review-through date. That date is also the proposed next Forecast as-of date. Choose **Read original Forecast and current cash**. The complete saved Forecast, its original inputs/report/source snapshot and the current original case records are retained in the review.

The observed period starts strictly after the selected Forecast's as-of date and ends on the review-through date, inclusive. A payment on the old as-of date already belonged to that Forecast's opening source and is not counted as a new period payment.

The source heading identifies the original Forecast hash and captured case version. Choosing another Forecast or typing another review date does not silently replace this review. Read the new selection explicitly. The prior complete review, unfinished decisions and choices remain under **Retained unfinished source reviews**, where they can be restored.

## Read the complete cash position

The complete group table retains every planned event scope and every attributed original cash scope, including rows without activity in the selected period. It distinguishes:

| Measure | Meaning |
| --- | --- |
| Planned USD | The selected immutable Forecast's dated cash events in the period. |
| Recorded attributed USD | Current observed, non-testnet cash attributed through original ledger links or explicitly reviewed Forecast assignments. |
| Recorded difference USD | Recorded attributed amount minus the selected dated plan for that scope. This is a comparison of retained records, not a declaration that all payments were captured. |
| Unassigned known USD | Valued original cash that has no supported original scope attribution. |
| Unvalued cash | Original cash whose USD valuation is missing. Its quantity, currency, source and stated invoice allocation remain visible; the affected total/difference stays unknown. |
| Source corrections | An earlier retained cash or invoice record that now differs or is absent, or a changed pinned plan. The complete earlier and current records remain together. |

Inflows have positive cash signs; outflows have negative signs. An incoming supplier refund follows the original invoice allocation with a positive cash sign. Native USD amounts are summed as exact cents; the browser does not round them through binary floating-point arithmetic.

Original invoice allocations identify their invoice, and original grant receipts identify their explicit tranche. These are not reassigned by this desk. Customer collections are compared at their original customer-scenario level; the original native Forecast applies collected amounts to quoted milestones in its existing order. This review does not invent an observed milestone identity.

A source record dated before or on the original as-of date, after the review-through date, in a non-observed state or on testnet stays visible with its exclusion reason. A later record correction changes the current-record report; it does not rewrite the selected Forecast or reconstruct every historical ledger state.

Complete original records can be searched and paged. Search affects only the screen. Every report and complete working-file export includes all rows.

## Explicitly assign actual payments to the next Forecast

For an eligible original cash row, choose the next Forecast assignment:

- **Package** assigns a valued observed direct outflow to the original pinned package.
- **Customer cost** assigns a valued observed direct outflow to the selected original customer scenario.
- **Customer receipt** assigns a valued observed CUSTOMER inflow to its original customer scenario.
- **Leave unassigned** removes that cash identity from the reviewed Forecast associations.
- **Keep current draft assignment** makes no proposed association change.

Direct outflows with original invoice allocations remain with those allocations. An unvalued, future, non-observed or testnet record cannot be turned into an eligible forecast payment by selecting it here. Correct its original record, if justified by the actual source, through the original Cash or Accounts workflow, then refresh this source.

A selected cash identity is associated once across the affected Forecast package/customer fields. The review exposes conflicting current associations. It does not change the original cash record, invoice allocations, funding category, source file or original native journal.

Native-currency scenarios retain their explicit original payment-credit model. A newly selected cash record may need its native amount and source evidence in the original currency controls. The original native preview validates those credits and the selected rates. This desk does not invent a conversion or substitute the recorded USD valuation for an unstated native payment credit.

Enter the review basis and source context. The retained note is appended to each changed target and the overall Forecast decisions without replacing unrelated notes. Original field length limits still apply.

## Replan dates without inventing events

Expand **Review next-Forecast dates**. It contains the complete existing package, invoice, grant, customer-work and quoted-receipt dates from the original draft. Choose a field's change checkbox, then enter its proposed complete calendar date. Blank means explicit absence only for fields where the original Forecast supports a missing date.

Dates on or before the next as-of date require attention. Leaving an expired entered date does not silently shift it; the original native preview explains the required correction. Customer work with ordinary dated terms still requires both dates. Event-dependent work retains its original start condition and reviewed release evidence. An entered planning date is not evidence that the source event happened.

Changing the as-of date does not create an opening account balance. Keep the original opening amount, basis and sources under the existing Forecast controls, or explicitly update them there from actual source evidence.

## Review and apply to the original draft

Choose **Review all current / proposed changes**. Every changed cash association and date appears with its original opening value, the current draft value and the proposed value.

If another edit changed the same field or cash association, choose **Keep current** or **Use reviewed proposal**. Each decision is tied to the exact original/current/proposed values; a later change requires another review. A blank decision clears the earlier choice. Unrelated current fields, customer scopes, amounts, currency credits, source selections, partial controls and notes remain untouched.

Choose **Apply reviewed inputs and native preview**. The desk freshly reads the current original case and the selected original saved Forecast. It rejects changed case records or altered saved identity and rechecks the exact current draft before adoption. Applying carries only the reviewed native input changes into the original editor and retains its complete before/after review history.

The existing Forecast calculation then previews the proposed inputs. If the original calculator requires a date, missing native credit or another field, the complete applied draft remains open with that message. Correct the original field and preview again. Only **Save this forecast** creates the next immutable native Forecast through the existing case version, exact retained request and request-recovery journal. No payment or invoice is written by this feature.

## Retain unfinished work and reopen

The desk is included in **Download complete working file**, existing durable Forecast draft storage and **Reopen working file**. It preserves:

- The full original saved Forecast and current source snapshot.
- Selected source/date, search/page, all unfinished notes/date values/association choices.
- Every prior unfinished source review.
- Bound current-versus-proposed decisions.
- Complete applied reviews with exact before/after inputs.
- The original Forecast's own partial controls, returned workbook, source journal and pending native save request.

The cash desk also downloads its complete standalone review working file. It remains bound to the same local case. Receiving validates the original saved Forecast against the actual native case before replacing the current review. Restoring the whole Forecast working file checks every retained review's original Forecast, including applied and unfinished history. Invalid input leaves the current work intact.

Downloads of open working files do not require a successful storage write. Retain that file if browser storage reports quota or a concurrent-storage error. Continue an uncertain native save using the original Forecast request; do not replace its request ID or body merely to retry.

## Deliver the full original case

The desk offers complete report JSON, comparison CSV and readable HTML. Derived CSV text is formula guarded; original JSON preserves the actual values. The readable report includes all original cash rows, full attribution and changed source records.

**Export review and complete original case** checks the captured complete records, sources and pinned-plan identity against the actual case, then brackets the original case export with two source-version reads. It requires the captured review version throughout. If the case changes, retain the review and refresh its source before exporting.

The ZIP includes:

| Member | Complete contents |
| --- | --- |
| operations-case.zip | The unchanged original native case with its planning revisions, immutable Forecasts, records, histories and original attachments. |
| forecast-cash-working.json | Every source selection, current record, unfinished decision and applied review. |
| report.json | Every exact group, daily amount, original cash row and source correction. |
| report.html | Complete readable report. |
| comparison.csv | Every group in the same selected comparison. |
| MANIFEST.json | Original case/version/Forecast identity and every member's byte count/SHA-256. |
| README.txt | Receiving and continued-work instructions. |

Use the existing Grant Operations importer on the inner original case ZIP. A receiving case gets its native new local identity; the issued comparison remains bound to its original source case. Select the received original Forecast and start a new cash review there to continue with its current records. Native record transfer does not rebind an old pending command or overwrite the original local working file.

## Source and operating boundary

New source: forecast-cash-reconciliation.mjs, forecast-cash-reconciliation-desk.mjs, forecast-cash-reconciliation.css and this guide. The narrow original Forecast/session, authenticated static map and managed source joins select those complete files. The core uses the existing original workbook signature helper and maintained ZIP/source hashing implementation. There is no new financial database, accounting event or invoice writer.

The original Forecast normalizer and calculator remain authoritative for original quantities, missing values, cash assignment constraints, exchange rates, dates, milestones and remaining obligations. Current case/role/staff transport remains unchanged.

### Producing-peer rendered-output rule

Before this exact outgoing application, demonstration, report, export or attachment is described as client/prospect-ready, the producing peer must open and run the exact selected version, LOOK at real rendered desktop and narrow screens, and operate important controls. Exercise populated, empty, loading and error states; inspect every outgoing attachment and download; export, independently reopen and continue the complete original work. Play final video/audio when present.

Screenshot capture alone, DOM counts, code review or another peer's approval do not replace the producing peer's actual inspection. Repair concrete defects in the same product; do not substitute a broad test suite or another review product. Preserve the original native operator, current complete source selection and existing case/request throughout.

For this feature, inspect the full period/source table, unassigned and unvalued rows, explicit date and cash proposals, real current-draft conflicts, native currency-credit errors, report HTML/CSV/JSON, every complete-case member, retained unfinished review and applied-history reopening. Native/runtime and rendered outcomes must be reported from the actual original operation. Source publication and pure-module execution alone are not those outcomes.

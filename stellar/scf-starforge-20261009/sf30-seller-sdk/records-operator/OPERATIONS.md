# Records operator — operating and receiving guide

## 1. Prepare one actual review scope

Choose the actual legal entity, records provider, currency and closed start-inclusive/end-exclusive period. All four ledger generations must refer to that same scope. The original engine accepts at most 90 days per analysis; use separate named periods for subsequent operation.

Retain the original policy/rate authority, full selected custody export, service tickets/events and invoice line export. Keep their actual capture timestamps and source completeness statements. Do not move a historic capture date to the present. For a historical review, select the actual intended evaluation time; current review uses the process time.

Policy has sites and rates. Custody has cartons, including termination information. Services have exact event IDs, dates, quantities and source evidence. Invoices have exact line/invoice IDs, charge/UOM, service and billing dates, quantities, rates and signed amounts. INPUT_HANDOFF.md lists the original fields, and CORE_CONTRACT.md adds their V2 extensions.

Every original source is a regular local file named captures/SHA256.csv or captures/SHA256.json. JSON sources may select an explicitly supplied rowPath. JSON duplicate keys, malformed UTF-8, duplicate/blank CSV headers and uneven row widths remain source errors. A valid original UTF-8 BOM is retained in the file hash.

## 2. Map the original columns

Map exact case-sensitive source keys to the original engine fields. An empty mapping means canonical names. Constants fill explicitly absent fields; valueMaps translate only specified raw values. All original columns remain available in the operator view.

Set moneyScale to minor or major for rate and invoice files. In a two-decimal currency, a major-unit rate 0.125 is12.5 minor units; it remains an exact fractional price. A billed amount0.125 cannot become an integer minor-unit invoice amount without an actual source correction. The importer does not round it. Decimal quantity text stays exact.

Declare pricing objects or dotted pricing fields for unit/fixed/percentage/graduated/volume models. A CSV pricing.tiers or basis_row_ids cell contains JSON. The rate's minimum_minor/maximum_minor fields are explicitly minor units; source moneyScale applies to unit and tier prices. Percent is a percentage number such as3, not a factor0.03.

Use canonical whole-second UTC timestamps. If an original export uses local time, its conversion must be explicit and documented by the source owner. The application does not guess timezone, midnight, daylight-saving fold or subsecond rounding.

Save the source edition before inspection. A saved edition and its input hash are the unit of review.

## 3. Inspect and correct

Run inspect_records for the desired named period/edition. The result evaluates the entire input; pagination changes only the displayed detail. Use literal query or exact id selection for specific rows. Source, mapped values, original cells, correction metadata and calculated findings remain accessible.

Input-correction status means the named source or contract value needs repair. Original engine reasons identify mismatched scope, incomplete ledgers, future captures, unclosed periods and other real input conditions. The result does not replace unavailable calculations with a successful zero.

Correct the mapped input value, not the original file. A correction retains author, time, note, source SHA, row index, mapping SHA and before/after values. For major-unit files, the correction value remains in major-unit input text. The calculation projection scales it afterwards.

Use a new corrected edition for an operational correction cycle and compareToEdition to the earlier edition in the same named period. A changed mapping/source invalidates an old cell correction until the operator inspects and explicitly reapplies it. An erroneous row can be explicitly omitted with an attributed omission record; it remains in operator source/corrections and is never quietly deleted.

The original native history also retains every source save. Restoring an earlier revision is a new original workspace head; it does not erase later revisions or saved previews.

## 4. Interpret original engine calculations

The engine chooses the unique effective rate by charge/UOM and service time, checks account/carton scope and custody, and relates billed events to the original service evidence. Repeated IDs/changed semantics, duplicate economic rows, unbilled admitted events and unmatched charges remain visible.

V2 quantity and price use exact fractions. Unit and fixed prices, graduated and volume tiers, minimums/maximums and declared percentages run through the original calculation path. A finite tier table does not extrapolate its last price.

Choose the actual rounding rule. HALF_UP rounds half away from zero; HALF_EVEN uses an even final minor unit; DOWN truncates toward zero; UP rounds away from zero. EXACT requires an integral result. The original unrounded value and chosen rule remain in the finding.

A CREDIT line has a nonpositive amount and a positive credited quantity. credit_of points to an included original CHARGE. A prior-period original uses row_role REFERENCE; it is inspectable but not counted as selected billed sales. billed_at selects the accounting period; service_at retains the original contract/custody timing.

The declared credit_method matters. CONTRACT_QUANTITY applies the stated contract formula to the credited quantity. ORIGINAL_PROPORTION reverses the actual original amount in proportion to its original quantity and does not apply a minimum twice. A reference original's pricing is examined; missing/incorrect originals and cumulative excess remain review items.

Percentage invoice rows declare all basis_row_ids. The actual policy declares included charge codes and INVOICE or PERIOD scope. A nested/circular fee, missing basis, unmatched credit or out-of-scope row remains visible. The application does not invent tax treatment, percentage bases, FX or monthly prorating.

## 5. Record a review and prepare AP output

Inspect the finding's complete original row and calculation. Record a named disposition: open, accepted, dispute-prepared, resolved-in-source or revisit. Include the actual reviewer, explanation and source references. Batch review applies only to the explicitly selected finding identities.

A current review binds the exact named period, edition, normalized request SHA and finding SHA. If source changes, the earlier review remains in history and is shown as stale. It cannot silently approve a changed amount.

AP reconciliation contains every BILLED projected invoice row, current calculation, variance, engine states, review status and source identity. Reference-only originals and omitted/error rows are retained in operator data, with explicit counts. The operator decides what to send to the actual AP owner. An accepted review is not an invoice posting, bank payment or supplier credit receipt.

Use customer column mappings to select the agreed field names and RFC6901 paths. The selected fields may include original supplier columns. Only those explicitly selected original fields enter customerFields/customer.csv; the complete raw row and private notes remain in the operator package by default. Spreadsheet formula prefixes are escaped in derived CSV text; numeric money remains numeric text, and original input bytes remain unchanged.

## 6. Operate inventory and transition

The inventory view keeps each original carton/site/admission/termination record. Active availability is evaluated at the selected review boundary and displayed. A carton with original destruction/withdrawal outside that window is not silently treated as a transferable active carton.

Create a named wave with actual owner, target and notes. Assign exact cartons to a destination and record planned, ready, in-transit, received, reconciled or exception status. Unknown/double assignments, missing owners/destinations and unavailable cartons appear in the manifest.

Record the five independent checkpoints: manifest, custody-transfer, destination-receipt, inventory-reconciliation and access-handoff. Each accepted checkpoint needs its actual named operator and supporting references. Complete wave acceptance also requires an assigned cohort without assignment issues. The digital record describes supplied operator observations; the application performs no transfer or destruction.

Export inventory.csv, transition-manifest.csv and transition-checks.csv for the receiving team. Retain the exact source/period identities with those files.

## 7. Prepare the cooperative monthly report when applicable

The actual agreement supplies the percentage, qualifying sales and reporting obligations. Keep cooperative:null until the operator has the required contract, source, agency and calendar inputs.

Supply actual supplier/contract/lead-agency identifiers, the percentage, rounding rule, credit treatment, reporting timezone, included charge codes and exact invoice-to-agency mappings. NET_BILLED includes signed billed credits; EXCLUDE_CREDITS is a separate declared choice. The application requires that choice explicitly.

Monthly boundaries use the explicitly supplied IANA reporting timezone. Reference rows and out-of-review-period billing do not enter selected monthly totals. Excluded codes and credits are counted. A missing agency ID stays blank and tied to its original invoice; no account number is invented.

The same original exact percentage calculator computes each agency/month basis and fee. Negative net sales, unresolved basis invoices, fractional EXACT fees and missing report headers remain visible. Supplied check/wire references and amounts are merely retained remittance records; no payment occurs. A missing remittance is distinct from a known variance.

cooperative-monthly.csv includes Agency ID, Agency Name, Monthly Net Sales and Monthly Admin Fees, expressed in currency major units with the currency/period. The operator appendix retains all exact minor-unit basis rows and calculation values. Review the original report instructions before an actual submission.

## 8. Keep procurement responses source-bound

The question register preserves the complete supplied questions, source sections, workbook/sheet/row and response-cell locators. Enter an attributed draft or reviewed response and reference the real supporting material. Blank answers stay blank. The original cost catalog remains a reference with its supplied values and unfilled price cells.

The application supports source-bound technical responses and staff operation. The responsible supplier retains the actual qualifications and authority behind any submitted representation.

## 9. Deliver and independently reopen

Save source and run build_records for the selected period/edition. Retain the completed native preview ID. Use the original workbench handoff command with that ID and a new destination. The wrapper reads that preview's exact saved revision, reconstructs its original source files, invokes the full exporter, verifies every output and adds the unchanged original portable history.

The full exporter produces all mapped rows; it is not the paged preview. customer/ includes customer.csv, customer.ndjson, AP reconciliation, inventory/transition, monthly report, requirement responses, original catalog reference, edition changes, summary/report and field mapping. operator/ adds normalized request, original engine packet, source inventory, mapped/omitted/error records, private reviews/corrections, fee basis, native preview and full portable workspace.

If an input is invalid, completeRowExport is false and inputErrorCount remains explicit; the operator source still contains the exact omitted/error/original records. Such a preparation is not a completed customer reconciliation.

A completed handoff with the same selection can be reopened and verified without another calculation or preview. An interrupted private work directory retains the exact selection and reconstructed source. Resume the same command after reconciling its existing completion; do not change preview IDs to hide a failure or copy over an earlier customer's package.

On the receiving machine, reopen operator/workspace.python-workspace.json into a new original workspace and inspect the selected source, prior revision, review and output. Compare the delivered files' exact hashes/byte counts to manifest.json and handoff.json. Keep the customer's original data and legal source rights with the agreed authorized team.

## 10. Continue the same operating workspace

Use later named periods and editions in the existing workspace for subsequent supplied records. Retain the selected entity/provider/currency, source-layout versions, ownership of exceptions and receiving conventions. Reopen completed earlier previews and handoffs for historical inspection; use a new saved source revision for an actual correction. Normal service ownership, physical records operation, actual account access and any continuing support agreement belong to their named operators.

## Customer field availability

Customer column pointers address the sanitized invoice projection: normalized values, calculation/disposition, and source identifiers/hashes. Private review notes/owners, the raw original/mapped row, and internal source paths are outside that projection, including when a whole parent object is selected. The mapping screen uses the original customer-invoices inspection view. Missing paths produce an empty CSV cell or JSON null plus PATH_UNAVAILABLE in the row and column availability counts in customer-field-mapping.json. A present source null is counted separately. Both CSV and NDJSON use the same projection.

## Packaged operator application

operator/application/ includes the selected native processor/engine source and the wrapper, browser, input contract, operating guides and UI.md needed by the receiving operator. operator/REOPEN.md opens operator/workspace.python-workspace.json through that included wrapper using the existing maintained runtime. handoff.json identifies every packaged source file and distinguishes saved-revision code from the product browser/wrapper. Keep the exact selected build ID when reopening an older report from a workspace that also contains later history. The compact preview is not the complete row export.

### Complete calendar-month source

Monthly amounts retain the selected reconciliation period. Each group and month includes `coverage` with the full calendar month's UTC bounds in the explicitly selected IANA reporting timezone, the original source-period bounds, and `complete`. A source period that covers only part of that month retains its known sales/fee amounts and receives `PARTIAL_REPORTING_MONTH_SOURCE`; group `complete`, monthly `reportComplete` and overall completeness remain false. `calculationComplete` identifies available exact arithmetic separately. For example, the authored September11–20 walkthrough can prepare its known subtotal but cannot establish a complete September filing. No source period is silently expanded or filled with zeros.

### Receiving the customer directory

The customer summary, HTML report and README use the customer projection even when delivered inside a complete operator package. The operator retains the detailed source errors and original native preview separately. A customer input-correction code identifies a remaining source issue; open the same retained operator revision for its exact original value and diagnostic, then save an explicit correction edition.

## Receive an original workbook in the same operation

The complete workflow and exact commands are in [WORKBOOKS.md](WORKBOOKS.md). Use `adopt-workbooks` on an existing original Records head, or include original workbook descriptors when creating the prepared workspace. Receive and map exact sheet ranges; retain original documents and actual custody evidence; record source-bound row/context reviews; explicitly promote only a complete eligible custody descriptor; then use the unchanged four-ledger reconciliation.

Workbook-only receiving and full workbook export remain available before financial or custody input completion. Use `records-workspace workbook --dir OPERATION --revision REVISION --workbook ID --out NEW_DIRECTORY` to retain the whole original source, all selected rows and the complete native portable. A mapping correction becomes a new saved revision, never a rewritten original file. The 22-file workbook-capable operator application and separate installation declaration travel with that handoff. Its manifests state every output identity and whether any custody rows were actually established.

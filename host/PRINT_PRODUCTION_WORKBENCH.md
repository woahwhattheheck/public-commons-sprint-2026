# Print-production workbench

A complete editable preparation for a shop's existing decoration tariff, estimates, goods intake, artwork decisions and production handover. The public-source starter contains the source's real price matrix and no actual customers, quotes or jobs. The module is `host/print_production_workbench.cjs`; it uses no network or filesystem and receives the maintained SHA-256 function when saving immutable content.

## Operator workflow

1. Review the complete source index, quantity bands, screen/embroidery matrices, add-on units, rush choices and unresolved source decisions. Preserve the published edition. A new price edition is an additional complete snapshot, never an edit to an earlier edition.
2. Add the actual customer and garment lines. Each line has explicit size quantities and the actual supplied unit price; use explicit zero and an explanatory description for customer-supplied goods. Blank garment prices are unresolved.
3. Define one decoration batch per actual artwork and location. Select its garment line IDs and actual ink-color count or stitch count. Pooling different garment lines requires an operator note because public price tables do not establish its scope. A garment line/location cannot be charged twice accidentally.
4. For screen work, state whether an underbase is needed and how it is included in the actual color count; record the new/reorder setup choice. The source's setup amounts do not establish how many screens or changes apply. Add each selected charge with its actual quantity and scope.
5. For embroidery, retain the full stitch matrix. A non-integer additional-thousand increment needs an explicit `whole_blocks` or `fractional` decision. Record whether digitizing is new or previously paid. Digitizing is a separate selected charge, with explicit units.
6. Enter actual shipping, discount and tax treatment. The source does not provide every customer's tax or freight. The engine requires explicit values before approval, including explicit zero where appropriate.
7. Standard estimates use the published matrix. Work at or above the custom-quote threshold, an unlisted color count, or custom methods needs an approved per-piece amount and an explanation. Rush needs the selected published tier, actual approval, an explicit calculation base and its explanation.
8. Save a complete immutable approved quote. A later revision creates a new quote with `supersedes` and a change reason. Jobs retain the original frozen quote and source edition.
9. Create the job from that approved quote. Enter an operator-confirmed promised date. Record actual goods received by original garment and size, rejected units and the receiving reference. Record each actual artwork decision, version and original approval reference.
10. Start production after all required usable goods and current artwork approvals are present. Record actual printed, finished, spoiled and reworked quantities. Every spoil entry identifies raw, printed-unfinished or finished pieces. Replacement garments must actually be printed and finished; gross production history is retained separately from surviving usable quantities. The job moves from intake to scheduled, printing, finishing, ready and collected; earlier stages remain in the event history.
11. Record actual collection/shipping quantities and references from the ready stage. Dispatch cannot exceed the order, received usable goods or recorded finished count. Close the job only once all quoted pieces are dispatched.
12. Save the complete project and download its CSV exports. Reopen the full project, including original editions, approved quotes, actual receipt/approval/production history and unfinished worksheet.

This preparation does not submit an order to a print shop or vendor, send an approval request, charge a customer, promise press capacity or silently install a vendor importer. An existing vendor migration can use the full source tables and original IDs; any exact vendor-specific import schema must come from the actual vendor.

## Source semantics

All monetary values are integer minor units in the business's explicit currency. Public price grids are per piece and per decoration location. Garment costs stay separate. The whole-order small-run threshold is distinct from the per-batch decoration quantity tier.

Published source quantities may be pooled only when the operator defines the actual common artwork/color batch. The estimator computes each batch's quantity from its selected garment lines; it does not accept a free-floating discounted quantity. Unit prices from a table and selected extras are rounded to minor units at the documented calculation step. The approved quote retains every row and selected rule.

The source may list overlapping rush intervals. Selecting the lowest fee automatically would change the source. The operator chooses the actual approved tier and records its scope. The rush base choices are `whole_pre_tax_job`, `decoration_only` or `custom`; the latter includes an explicit approved base amount. Taxable amount can be provided separately from the full net job amount. Its basis must be recorded.

A published month is recorded with month precision. It does not establish a publication day. A marketing summary and detailed tariff may disagree; preserve both source observations in the original record and record a decision before relying on them.

`addBusinessDays(start,count,holidays)` uses calendar dates, skips weekends and only the explicitly supplied holiday dates. It counts subsequent business days after the starting date. It does not infer a jurisdiction's holiday calendar or promise a delivery date. Standard turnaround may start only after actual goods receipt and artwork approval; the saved promised date remains an operator decision.

## Engine API

`validateRecord(record)`, `validateEdition(edition)` validate the complete shape. `estimate(record, request)` returns garment and decoration rows, totals, unresolved choices and warnings. `freezeQuote(record,{id,created_at,operator,request,supersedes?,change_reason?},hash)` requires a complete resolved estimate and returns an immutable snapshot and SHA-256. `verifyQuote(quote,hash)` checks its original contents.

`jobRequirements(record,jobId)` returns each original garment/size's required, received, rejected, spoiled, usable, printed, finished, dispatched and remaining quantities, plus original artwork decisions. `printed` and `finished` are surviving quantities, including pieces already dispatched; `printed_gross` and `finished_gross` retain all actual production runs. It also returns raw_available, printed_unfinished, finished_available, spoiled_raw, spoiled_printed, spoiled_finished, unclassified_spoilage, reworked_printed, reworked_finished, printing_remaining, finishing_remaining and inventory_valid. `ready_for_dispatch` requires all ordered pieces finished and current artwork approval. `readiness(record,jobId)` adds current stage and warnings.

`apply(record,{operation_id,expected_revision,kind,at,operator,input},hash)` returns `{record,changed,result}`. Save the entire action before applying it. The original operation ID can be resumed with the same contents; an ID reused for different input is rejected. A current-revision mismatch requires reopening the saved current project. Every completed action increments the revision and appends retained history.

Actions and exact input shapes:

- `customer-save`: `{id,name,email?,phone?,notes?}`.
- `price-edition-add`: complete `{id,label,effective_on,effective_precision,source_id,quantity_bands,rates,charges,rush_options,small_run_threshold,small_run_minor,custom_quote_threshold}`.
- `decision-save`: `{id,choice,reason}`, where id is an original conflict ID.
- `quote-save`: `{id,request,supersedes?,change_reason?}`. The action time/operator become its immutable approval fields.
- `job-create`: `{id,quote_id,reference?,promised_on?,notes?}`.
- `job-requote`: `{job_id,quote_id,reason}`, only before production and before original receipts/artwork decisions have been recorded. Preserve an in-progress job; use an explicit linked change job for later scope.
- `goods-receive`: `{job_id,garment_id,size_id,quantity,rejected_quantity?,reference,note?}`.
- `artwork-review`: `{job_id,artwork_id,version,decision:'approved'|'changes_requested',reference,note?}`.
- `production-record`: `{job_id,garment_id,size_id,action:'printed'|'finished'|'spoiled'|'reworked',quantity,note,spoil_stage?:'raw'|'printed'|'finished',rework_stage?:'printed'|'finished'}`. A spoiled entry requires spoil_stage; a reworked entry requires rework_stage.
- `production-classify`: `{job_id,production_id,spoil_stage:'raw'|'printed'|'finished',reason}`. This appends a stage classification for a retained original spoil entry; it never rewrites or removes that event.
- `dispatch-record`: `{job_id,garment_id,size_id,quantity,reference}`.
- `job-stage`: `{job_id,stage,note}`. Stages: intake, scheduled, printing, finishing, ready, collected, cancelled.
- `job-date`: `{job_id,promised_on,reason}`.

An estimate request is:

```json
{
  "customer_id": "original-customer-id",
  "edition_id": "original-price-edition",
  "garments": [{
    "id": "original-garment-line",
    "description": "Actual quoted garment style and color",
    "unit_minor": 0,
    "sizes": [{"id":"original-size-row","label":"M","quantity":24}]
  }],
  "decorations": [{
    "id":"original-print-batch",
    "method":"screen",
    "location":"Front",
    "artwork_id":"original-design-reference",
    "garment_ids":["original-garment-line"],
    "colors":1,
    "underbase_required":false,
    "setup_note":"Actual original setup decision"
  }],
  "charges": [],
  "rush": null,
  "shipping_minor": 0,
  "tax_basis_points": 0,
  "tax_note": "Actual applicable tax treatment"
}
```

The example above is a schema illustration, not an actual customer/order. Embroidery uses `stitches`, `increment_mode` when needed and `digitizing_note`; custom pricing uses `approved_unit_minor` and `approval_note`. An undecorated garment needs `undecorated_note`. Optional discount fields are `discount_minor` and `discount_note`. Orders above the source threshold need `order_approval_note`.

## Physical production quantities and approval changes

A printed event records completion of all decoration locations assigned to those pieces. A finished event consumes surviving printed-unfinished pieces. Both retain the exact current artwork approval IDs used when production was recorded. Receiving replacement blanks alone cannot restore printed or finished output.

Spoilage identifies the actual physical stage: raw means received but not yet printed; printed means printed but unfinished; finished means completed and undispatched. Raw spoil removes available blanks. Printed spoil removes usable printed output. Finished spoil removes both usable printed and finished output. The engine rejects spoilage larger than the undispatched stock in that stage. Gross event counts remain unchanged.

For example, 40 printed pieces minus three printed-stage losses leave 37 usable printed pieces. Receiving three replacements restores stock but leaves usable printed output at 37. Record the three actual replacement prints before finishing all 40. If one finished piece is then damaged, receive and print and finish its replacement. The original events remain visible alongside gross and surviving totals.

Rework records work on existing pieces in an explicit stage. It does not manufacture extra garments, restore spoiled pieces or increase printed/finished totals. Repeating work may legitimately make cumulative rework effort exceed the number of distinct garments; each action is independently bounded by stock available at that time. Replacements for destroyed pieces use ordinary receiving, printing and finishing entries.

A retained older spoil event without a stage is unresolved. Append a production-classify action with its original event ID, actual stage and reason before continuing that affected size. Legacy rework remains in the original history without changing physical inventory. Classification rejects inconsistent physical totals and preserves all original entries.

A later changes_requested artwork decision immediately prevents further printing, finishing, rework, ready transition and dispatch until an actual current approval is recorded. Spoilage can still be recorded because physical loss must remain recordable. Approval references are saved on production and dispatch events. Approval of a different artwork version does not itself assert that earlier pieces have been physically updated: the operator must inspect their actual disposition, retain the decision reference and record any required rework or spoil/replacement before dispatch.

CSV exports prefix text beginning with optional whitespace followed by =, +, -, or @ with an apostrophe so spreadsheet applications treat those cells as text. Numeric values remain numeric text. The unchanged original values are retained in the complete JSON project.

## Complete export and reopening

`exportFiles(record)` returns 18 full original members: Working_Record.json; Quantity_Bands.csv; Rate_Catalogue.csv; Additional_Charges.csv; Rush_Options.csv; Price_Editions.csv; Customers.csv; Approved_Quotes.csv; Quote_Lines.csv; Jobs.csv; Goods_Requirements.csv; Artwork_Approvals.csv; Goods_Receipts.csv; Production_Entries.csv; Dispatches.csv; Source_Policies.csv; Source_Decisions.csv; Source_Index.csv.

Use the entire Working_Record for editing and reopening. Individual CSVs are useful operational extracts, not substitutes for the original history or immutable quote snapshots. A receiving application validates the record and calls `verifyQuote` for every saved quote before enabling further actions. Customer data and private original documents stay with the authorised recipient and original case.

## Actual rendered-product receiving

Before presenting the app or any attachment as ready, open/run/render the exact outgoing version, look at its real screens or screenshots and operate it as the recipient would. Inspect desktop and relevant narrow width, populated/empty/error states, important controls, complete exports and reopened source. View the screenshots you capture. Open the usable contents of the full ZIP and applicable documents. Code review, DOM counts, callback exercises and a peer's approval do not substitute for seeing the actual product.

Use plain industrial styling: explicit light/dark panel palettes, readable text and tables, restrained controls, clear labels and compact narrow actions. Repair visible clipping, overflow, contrast or broken controls in the original application and continue delivery. This is a delivery requirement, not a new approval queue, broad test programme or stopping point. Preserve existing owner instructions and active receiving ownership.

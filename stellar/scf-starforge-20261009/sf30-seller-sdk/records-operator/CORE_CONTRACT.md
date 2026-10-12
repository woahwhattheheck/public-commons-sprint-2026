# Records operator — complete native contract

This application composes the original offsite-records reconciliation engine with the existing Python merchant workspace. The original workspace owns source versions, previews, history, restore, downloads, authentication, release and portable export. There is no separate application database or HTTP server.

## Owned source and operation

Reusable product: stellar/scf-starforge-20261009/sf30-seller-sdk/records-operator/.
Product files: processor.py, application.py, workbench.mjs, browser-assets.json, web/index.html, web/browser.mjs, web/style.css, README.md, OPERATIONS.md and this contract. The exact original package is copied into offsite_records_storage_invoice_reconciliation/{__init__.py,engine.py,_output_custody.py} for a self-contained customer source handoff. Generic engine changes are published to the original smb-showcase-inventory application; the packaged copy must match that exact original source.

Runtime closure: stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace under an explicitly selected original source root. Source capacity is 8 MiB per file, 32 MiB and 512 files per revision. Native output is at most 1 MiB. Full exports use the same processor's streaming command and do not truncate rows to fit native output.

Native functions:

- inspect_records({periodId?,editionId?,view?,offset?,limit?,query?,id?}, workspace_path=...): assess the whole selected period and return one paged view. Views: sources, sites, rates, cartons, events, invoices, findings, transition, changes, requirements, catalog, reviews, checks, cooperative, cooperative-basis, input-errors and customer-invoices. query is a literal case-insensitive substring; id selects an exact returned record identity. Default limit 100, maximum 500; a smaller returned page reports byteLimited and its exact nextOffset.
- build_records({periodId?,editionId?}, workspace_path=...): complete counts, exact money summaries, input/decision/transition status, compact operator report and export instructions.
- customer_records({periodId?,editionId?}, workspace_path=...): customer report and safe compact handoff, excluding private review notes and original source bodies.
- processor.py export --workspace FILE --out NEW_DIRECTORY --audience operator|customer [--period ID] [--edition ID]: assesses the same saved inputs once and writes complete row files plus exact manifest. The wrapper's handoff command binds the selected saved build preview, materializes its exact revision, calls this exporter, verifies every output and adds the original portable for operator delivery.

All file results use {name,body,contentType,bytes,sha256}. Financial minor-unit values are integers within the original safe range or explicitly labelled decimal text. JSON floating-point money is not accepted. No invoice dispute, payment, storage transfer, account creation or outbound message is performed by these functions.

## workspace.json

The saved source file has this shape:

{
  "schema": "tj.records-operator-workspace.v1",
  "title": "Records reconciliation",
  "selectedPeriod": "2026-09",
  "periods": [{
    "id": "2026-09",
    "label": "September 2026",
    "selectedEdition": "original",
    "editions": [{
      "id": "original",
      "label": "Original exported ledgers",
      "capturedAt": "2026-10-01T12:00:00Z",
      "sourceKind": "operator-provided-export",
      "mode": "HISTORICAL_INTEGRITY_ONLY",
      "evaluatedAt": "2026-10-01T12:00:00Z",
      "ledgers": {
        "policy": {
          "authority_id": "contract-v1", "entity_ref": "entity-1", "provider_ref": "provider-1",
          "period_start": "2026-09-01T00:00:00Z", "period_end": "2026-10-01T00:00:00Z",
          "captured_at": "2026-10-01T12:00:00Z", "complete": true,
          "currency": "USD", "minor_unit_digits": 2,
          "rounding_mode": "EXACT", "max_authority_age_days": 365
        },
        "custody": {
          "authority_id": "inventory-v1", "entity_ref": "entity-1", "provider_ref": "provider-1",
          "period_start": "2026-09-01T00:00:00Z", "period_end": "2026-10-01T00:00:00Z",
          "captured_at": "2026-10-01T12:00:00Z", "complete": true
        },
        "services": {
          "authority_id": "events-v1", "entity_ref": "entity-1", "provider_ref": "provider-1",
          "period_start": "2026-09-01T00:00:00Z", "period_end": "2026-10-01T00:00:00Z",
          "captured_at": "2026-10-01T12:00:00Z", "complete": true
        },
        "invoices": {
          "authority_id": "invoices-v1", "entity_ref": "entity-1", "provider_ref": "provider-1",
          "period_start": "2026-09-01T00:00:00Z", "period_end": "2026-10-01T00:00:00Z",
          "captured_at": "2026-10-01T12:00:00Z", "complete": true, "currency": "USD"
        }
      },
      "sources": [],
      "corrections": []
    }]
  }],
  "reviews": [],
  "transition": {"waves": [], "assignments": [], "checks": []},
  "cooperative": null,
  "requirements": {"path": "reference/technical_questions.json", "responses": []},
  "catalog": {"path": "reference/cost_catalog.json"},
  "customer": {"columns": []}
}

The values above illustrate the schema; they are not agency/provider data. Every generation's declared completeness, scope, capture time, contract source and declared rounding remain visible. Current review uses the real process UTC; historical review preserves the explicitly selected evaluatedAt. The original engine enforces closed periods and its existing source constraints. A missing input produces an actionable correction status rather than a fabricated result.

There may be multiple named periods and multiple editions in each. IDs are unique within their respective lists, nonempty strings up to160 characters. A corrected edition may set compareToEdition to another retained edition of the SAME period. Cross-period dashboards show actual selected period totals separately and do not label unrelated records as missing.

For the unchanged maintained original walkthrough, an edition can instead contain requestSource:{path,sha256,bytes}, pointing to the complete exact V1/V2 request JSON, with sources:[] and no ledgers. The application loads that original request without regenerating its evidence. Corrections are still explicit; imports can promote it into separate four-ledger sources for later operation. Do not claim maintained example data is a customer export.

## Exact source descriptors and mapping

Each entry in edition.sources is:

{
 "id":"invoice-export-1", "table":"invoices", "format":"csv",
 "path":"captures/<sha256>.csv", "sha256":"<exact lowercase SHA256>", "bytes":1234,
 "capturedAt":"2026-10-01T12:00:00Z", "sourceKind":"operator-provided-export",
 "label":"Original AP export",
 "rowPath":"",
 "mapping":{"row_id":"InvoiceLineId","invoice_ref":"Invoice","quantity":"Qty","amount_minor":"LineAmount"},
 "constants":{"line_kind":"CHARGE","row_role":"BILLED"},
 "valueMaps":{},
 "moneyScale":"major"
}

Supported tables: sites, rates, cartons, events, invoices. Policy comprises the sites and rates tables; the other logical ledgers each have one table. Multiple files for the same table are concatenated before the SAME original normalization/deduplication. Empty original exports are valid only with the generation's explicit completeness statement.

Supported formats: UTF-8 CSV, preserving a valid original BOM; JSON array or JSON object with an explicit RFC6901 rowPath pointing to the array. Duplicate JSON keys, duplicate/blank CSV headers, malformed UTF-8, short/long CSV rows and wrong file identities are reported; original bytes stay unchanged. Source paths are local relative regular files, never network URLs or credentials. Captures are content-addressed. Reference documents are separately declared and never mistaken for invoice rows.

mapping keys are canonical engine fields; values are exact case-sensitive original column/key names. Dotted canonical fields such as pricing.kind, pricing.percent, pricing.tiers and pricing.credit_method address nested pricing fields. An empty mapping uses identical canonical column names. constants supplies only explicitly absent canonical fields; mapping and a constant cannot define the same field. valueMaps maps an exact raw source value to an explicitly supplied value before typed conversion. No name matching, date shifting or guessed account joins.

moneyScale must be minor or major for rates/invoices. Major-unit rate text is scaled exactly by policy.minor_unit_digits; major-unit invoice amounts must land on an integer minor unit. Quantities and rate_minor remain decimal text; amount_minor is a signed integer. A nonzero fractional minor unit is an input correction, not silently rounded at import. Contract pricing determines calculation rounding separately.

Timestamps must be canonical whole-second UTC, as required by the original engine. Convert a provider local date/time explicitly in its source export procedure and retain the original export/capture as a separate source if necessary; the application does not guess a timezone or discard subsecond information.

Optional engine fields can be supplied in CSV as JSON text: pricing.tiers is an array of {upto,rate_minor}; basis_row_ids is an array of original invoice row IDs. Boolean fields accept only true/false or exact 1/0. Missing optional nullable fields become null, not zero. Original business IDs remain exact.

Mapped records carry _source:{id,path,sha256,recordIndex,locator,mappingSha256,rawRowSha256} and original:{...original cells} in the operator inspection. These annotations are removed only from the exact engine request, whose new generation/row evidence refers to the retained source row and mapping. This is source provenance, not provider authentication.

## Source corrections

Each edition.corrections entry is:

{
 "id":"correction-1", "sourceId":"invoice-export-1",
 "sourceSha256":"<exact original source SHA>",
 "recordIndex":0, "mappingSha256":"<mapping identity returned by inspect>",
 "field":"amount_minor", "before":"12.34", "value":"12.35",
 "author":"Operator name", "note":"Reason and source reference",
 "at":"2026-10-01T12:10:00Z"
}

Corrections operate on MAPPED source cell values before canonical type/money conversion. Thus values shown as major-unit amounts remain major-unit input values until the mapped projection. before must equal the current mapped value at that step, including prior corrections. source identity, row index and mapping identity must match. A changed mapping/source or stale before produces an explicit correction error. The original file is never overwritten.

A correction can use field="$omit", before:false, value:true to explicitly exclude an erroneous source row. It retains author/note/identity and remains in the operator export; omission is not a quiet row deletion. The UI must show omitted rows and correction counts.

The UI should offer Save as new edition for a correction cycle and set compareToEdition to the old edition. The original workspace also retains every save revision. A review cannot be silently carried onto a changed request.

## Original engine V2 pricing

Same original normalize_request/compile_current/compile_historical path, schema OFFSITE_RECORDS_STORAGE_INVOICE_RECONCILIATION_V2. V1 behavior stays available.

- Decimal quantity and unit price are exact rational values, at most 18 fractional places. JSON binary floats are not accepted.
- Rates have pricing.kind unit, fixed, percentage, graduated or volume; optional minimum_minor/maximum_minor.
- Tiers are explicitly increasing {upto,rate_minor} rows; an optional unbounded last tier has upto:null. A finite table does not extrapolate beyond its last tier.
- Percentage rates require exact percent, basis_scope INVOICE/PERIOD and explicit included basis_charge_codes. Each fee invoice row declares basis_row_ids. Missing/circular/nested/out-of-scope bases stay review items. Tax is excluded by declared included charge codes, not a guessed tax field.
- policy.rounding_mode is EXACT, HALF_UP, HALF_EVEN, DOWN or UP. EXACT leaves a fractional minor-unit result unresolved. Each finding retains unrounded amount, min/max result, rounding method and expected amount.
- Invoice line_kind is CHARGE or CREDIT; credit_of binds a retained original CHARGE. A prior-period original can have row_role REFERENCE; it is inspected but not included in the selected period's billed totals. billed_at selects the accounting period while service_at selects actual contract/custody timing.
- pricing.credit_method must explicitly select CONTRACT_QUANTITY or ORIGINAL_PROPORTION to resolve credits. The latter reverses the declared quantity's proportion of the original bill without applying minimums twice. Missing methods, missing originals, inconsistent bindings, cumulative excess and unresolved originals remain review items.
- Signed credit totals, debit totals and gross review exposure are separate. Review exposure is not confirmed overcharge, savings, cash or revenue.

## Reviews, comparison and AP handoff

reviews entries:

{periodId,editionId,requestSha256,findingId,findingSha256,
 status:"open"|"accepted"|"dispute-prepared"|"resolved-in-source"|"revisit",
 owner,note,evidence:[{sourceId,reference}],at}

Only exact current request/finding bindings apply. Older decisions remain in the source with stale counts and can be inspected. A decision does not rewrite engine states or mark an invoice paid. Batch review uses explicit selected finding IDs and each finding's own digest.

Inspection findings contain the original engine finding plus id, sha256, currentReview and staleReviewCount. Full AP CSV includes every BILLED invoice row, engine states, calculated amount/variance, current disposition and invoice/source bindings. Matched and accepted-for-review amounts remain distinguishable. Customer fields are configured as [{name,path}] using RFC6901 pointers into the sanitized customer invoice projection: id, table, normalized values, analysis without reviewOwner/reviewNote, and _source without its internal path. Original/mapped source bodies remain in operator data. Parent-object pointers are evaluated only after this projection. An unavailable path becomes null with a PATH_UNAVAILABLE entry in unavailableFields; a present null remains distinct. report.customerMapping and customer-field-mapping.json contain each column’s available/null/unavailable row counts and complete flag. view=customer-invoices returns the actual safe projected rows and customerFields for the mapping screen. customer.csv and customer.ndjson use exactly this same projection. There are at most 100 unique nonempty columns. Default fields include original invoice/line/account references, amount, expected amount, variance, states, disposition and source identity. CSV spreadsheet formula prefixes are escaped only in derived exports, not in original retained bytes.

Same-period edition comparison uses exact stable row_id, event_id and carton_ref. It reports added, removed and changed records and explicit comparableScope. It does not call absence destruction or cancellation. Corrected totals and original totals are both retained.

## Inventory and transition

transition:
{
 "waves":[{id,label,owner,targetAt,notes}],
 "assignments":[{periodId,editionId,cartonRef,waveId,destination,owner,status,notes}],
 "checks":[{periodId,editionId,waveId,kind,status,owner,note,evidence:[{sourceId,reference}],at}]
}

Assignment status: planned, ready, in-transit, received, reconciled, exception.
Check kind: manifest, custody-transfer, destination-receipt, inventory-reconciliation, access-handoff.
Check status: pending, accepted, rejected.
These are named operator records. Original custody admission/termination remains separate, and the tool performs no transfer or destruction.

The backend joins assignments to exact cartons/sites, flags unknown/multiple assignments and missing/rejected checkpoints, retains unassigned cartons, and exports complete inventory.csv, transition-manifest.csv and transition-checks.csv. A ready wave requires explicit accepted checks; missing owners/destination/source references remain actionable.

## Optional cooperative monthly reporting

cooperative is null until an actual operator supplies:
{supplier,contractId,leadAgencyId,percent,roundingMode,creditTreatment,reportingTimeZone,
 includedChargeCodes:[...],
 agencyAssignments:[{invoiceRef,agencyId,agencyName}],
 remittances:[{month,checkWireNumber,amountMinor}]}

creditTreatment is explicitly NET_BILLED or EXCLUDE_CREDITS. reportingTimeZone is an explicitly supplied IANA timezone used for the monthly boundary; the application does not infer it from the issuer deadline. The original engine's exact percentage calculator is reused for grouped monthly sales/fees. Each report binds the exact BILLED invoice rows and includes only the declared codes; tax exclusion is visible. Unknown agency IDs, unresolved engine inputs, negative sales requiring a credit policy, fractional fee under EXACT, missing remittance or fee variance remain listed. No remittance is performed. Do not use invoice_ref as an invented agency ID.

The issuer's retained schedule says3% billed sales excluding tax. It does not provide an actual agency roster, credit/rounding policy, sales volume or account/API. The operator must supply those. Exports preserve the issuer labels Agency ID, Agency Name, Monthly Net Sales and Monthly Admin Fees with the source period/currency and complete basis rows in the operator appendix. This is a prepared report, not an actual submission or supplier appointment.

## Original requirements and cost catalog

requirements.path retains the complete supplied question source (IDs, exact question text, original workbook/sheet/row/cells). requirements.responses entries are {id,status:"unanswered"|"draft"|"reviewed",response,owner,evidence:[{sourceId,reference}],at}. No response is invented or represented as a supplier certification. catalog.path retains the supplied complete source cost items and their original price fields, with exact workbook/sheet/row/UOM. These reference files are copied into the same portable source.

## Result contract

inspect_records returns:
{
 "schema":"tj.records-operator-inspection.v1",
 "report":{
  "workspace":{title,periodCount,editionCount},
  "period":{id,label}, "edition":{id,label,capturedAt,sourceKind},
  "input":{sourceCount,sourceBytes,correctionCount,omittedRows,errors:[],...},
  "reconciliation":{status,requestSha256,packetSha256,mode,evaluatedAt,summary,holdReasons},
  "counts":{sites,rates,cartons,events,invoices,billedRows,referenceRows,findings,reviewRequired},
  "reviews":{current,stale,byStatus}, "comparison":{...},
  "transition":{...}, "cooperative":{...},
  "requirements":{total,answered,reviewed}, "catalog":{total,priced}
 },
 "page":{"view","offset","requestedLimit","limit","total","items",
         "nextOffset","hasMore","byteLimited"}
}
Build/customer use tj.records-operator-build.v1 / tj.records-operator-customer.v1, with report and files. Input errors are shown in report.input.errors and reconciliation.status INPUT_CORRECTION_REQUIRED, while source/mapping views remain usable. Original engine source reasons are shown with the concrete affected inputs. No empty error result is called a successful reconciliation.

## Browser contract

The existing original token, /api/state, /api/file, /api/revisions, /api/preview, preview output/file routes, history, restore and portable endpoints are used unchanged. UI draft and unknown-write recovery uses the original /local-draft-store.mjs. All edits preserve unsaved source across tabs; async writes disable affected editors. No extra authentication, polling loop, server or database.

The complete operator UI includes:
1. Named period/edition editing and selection; source metadata and actual completeness.
2. File upload with exact SHA, table/format/column mapping/constants/value maps and raw inspection.
3. Typed contract/ledger and mapped-row corrections, saved new editions.
4. Paged reconciliation findings with exact row/calculation/source detail and individual/selected batch reviews.
5. Inventory, wave assignments and all five acceptance checkpoints.
6. Monthly fee inputs/basis/variance and complete AP/customer field mapping.
7. Original question/cost-catalog inspection and editable attributed responses.
8. Source save/history/restore, retained preview reopen, compact reports, complete handoff/portable commands and download links.

## Complete operator source in the handoff

An operator handoff includes operator/application/ with application.py, processor.py and the three exact engine-package files from its selected saved build revision. It also includes the actual product workbench.mjs, browser-assets.json, three browser files, README.md, OPERATIONS.md, CORE_CONTRACT.md, INPUT_HANDOFF.md, PRICING_V2.md and UI.md. handoff.json.operatorApplication lists their exact size/hash and source basis; operator/REOPEN.md supplies the original reopen/serve commands. The maintained native runtime remains an explicit existing dependency; this copy does not claim to embed it. Customer-only handoffs contain the complete agreed data/report projections. Partial exports remain in the same owned operation until complete.

### Complete calendar-month source

Monthly amounts retain the selected reconciliation period. Each group and month includes `coverage` with the full calendar month's UTC bounds in the explicitly selected IANA reporting timezone, the original source-period bounds, and `complete`. A source period that covers only part of that month retains its known sales/fee amounts and receives `PARTIAL_REPORTING_MONTH_SOURCE`; group `complete`, monthly `reportComplete` and overall completeness remain false. `calculationComplete` identifies available exact arithmetic separately. A partial-month source can prepare its known subtotal while the calendar-month report remains incomplete. No source period is silently expanded or filled with zeros.

### Customer-directory report consistency

The customer directory uses the same sanitized customer report and invoice projection in either a customer-only or complete operator handoff. Customer error summaries retain the source error code/count and row identity without copying private original-path/error text. Full input diagnostics, mapping/correction source and review notes stay in the original operator files and native preview. An exception while opening a comparison retains a customer-visible comparison error code with its detailed message available to the operator.

## Original XLSX intake extension

`edition.workbooks` retains source-owned workbook intake descriptors separately from the original four-ledger sources. `inspect_workbook({periodId?,editionId?,workbookId?,sheet?,offset?,limit?,query?,row?})` returns `tj.records-workbook-inspection.v1`: exact workbook metadata, attributed intake assessment, complete paged original rows and an eligible `custodySource` only after the declared review. The full descriptor, row/source hash, context, custody-acknowledgment and export schemas are specified in [WORKBOOKS.md](WORKBOOKS.md).

The original `edition.sources` additionally accepts `format:"xlsx"` only for the `cartons` table, referencing the exact `workbookId` and current `workbookBindingSha256` returned by this review. Its original file identity and canonical mapping are verified again on compilation. Workbook evidence is retained in `_source.workbook` and original sheet/cell provenance. Invalid or stale promotion is an input correction, not an empty custody population. The original engine and customer projection are unchanged.

`report.workbooks` gives selected intake counts and status. Complete operator exports add `workbook-intakes.json` and `workbook-rows.ndjson`, with `completeWorkbookRowExport` and `workbookInputErrorCount` in their manifest. The separate original-workbook handoff includes every selected physical row, original binary file and document even when financial inputs or custody admission are incomplete. Source adoption, native declaration and complete application closure use the original workspace CAS/history.

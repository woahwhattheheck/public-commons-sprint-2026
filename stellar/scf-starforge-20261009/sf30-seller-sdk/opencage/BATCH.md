# CSV geocoding and customer review

The CSV workbench turns an address or coordinate file into retained row-by-row work in the existing OpenCage workspace. It uses the original provider source, request records, candidate decisions and customer decoder. The same browser, command interface and merchant MCP operator can prepare, run, review and reopen the work.

Every source row remains in the joined delivery. Repeated queries can reuse one retained provider response while keeping separate record IDs and separate candidate choices. The original CSV bytes, provider responses, returned licenses and complete decision histories travel with the customer output.

## Open the operator

Use the existing initialized workspace:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs serve --workspace /absolute/workspace
~~~

Open the private browser URL printed by that process and choose CSV batches. The operator retains its original process environment, configured provider connection, source identity and merchant release controls. An existing managed Application uses the same command and saved workspace.

1. Choose a UTF-8 CSV and inspect its original column names.
2. Select the forward or reverse product, ID column and query mapping.
3. Review the normalized queries, invalid rows, duplicate-query count and expected fresh query count.
4. Prepare that exact review. The saved intake receives a stable batch ID.
5. Start a named run. Progress remains in the same batch across refresh and reopen.
6. Review each row's candidates and save its own choice.
7. Export the current reviewed batch revision and reopen the resulting customer delivery.

The source file may contain a UTF-8 BOM, quoted commas or quoted newlines. The complete intake is limited to 2 MiB, 10,000 data rows and 256 columns; a cell can contain up to 65,536 characters. Headers must be unique, nonempty printable names. A row with the wrong number of cells remains an invalid row with its original values.

The one-based ordinal identifies the original record. An optional ID column adds the customer's identifier; duplicate or empty customer IDs do not collapse records.

## Map actual source columns

Forward geocoding accepts either one query column:

~~~json
{
  "idColumn": "record_id",
  "queryColumn": "address",
  "options": {"language": "en"},
  "optionColumns": {}
}
~~~

or an ordered address composition:

~~~json
{
  "idColumn": "record_id",
  "addressColumns": ["street", "city", "postal_code", "country"],
  "separator": ", ",
  "options": {"countrycode": "de"},
  "optionColumns": {}
}
~~~

Reverse geocoding accepts one query column containing latitude,longitude, or separate columns:

~~~json
{
  "idColumn": "record_id",
  "latitudeColumn": "latitude",
  "longitudeColumn": "longitude",
  "options": {},
  "optionColumns": {"language": "preferred_language"}
}
~~~

Fixed options and option columns must be allowed by the selected original product. An option cannot appear in both mappings. Empty option cells use the original product's defaults. The original query compiler validates coordinate order, ranges, option values and provider query length.

The mapping, product, workspace, payment terms, complete raw source and normalized rows are included in the review hash. A changed source or mapping produces a different review and batch. A corrected file can name the prior batch as supersedesBatchId; both intakes remain available.

## Command workflow

All paths below refer to files chosen by the operator. The supplied example CSV and mappings are under examples/.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-source \
  --source /absolute/locations.csv

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-review \
  --workspace /absolute/workspace --source /absolute/locations.csv \
  --product reverse --mapping /absolute/reverse-columns.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-prepare \
  --workspace /absolute/workspace --source /absolute/locations.csv \
  --product reverse --mapping /absolute/reverse-columns.json \
  --review-sha256 REVIEW_SHA_FROM_PREVIOUS_OUTPUT

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-run \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --run locations-pass-1

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-status \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --offset 0 --limit 50
~~~

The original process must have the plan's named API-key environment variable for fresh provider requests. Review, retained-result reuse, candidate decisions and customer reopen use the saved bytes.

Review and prepare accept --reuse with a comma-separated list of successful original request IDs. Their complete product, normalized query, capture identity and response hash are bound into the review. Matching rows reuse those captures. Within a run, a completed successful query also becomes available to later identical rows.

Reused captures retain the original source manifest, request, body and observation timestamps. Their receiving row records dispatched:false and the original capture reference. Candidate choices start unselected and remain independent of the source record's decision.

## Execution and recovery

The API processes one location per request. The original source admits one request at a time; the CSV runner waits for its configured interval between starts. Serial request ownership, provider deadlines, configured host egress and returned status remain in the original source.

| Row or run outcome | Operator continuation |
| --- | --- |
| CANDIDATES | Review the original ordered candidates and save a choice for this row. |
| NO_RESULTS | Retain the successful HTTP 200 response and empty result. Correct the input through a new source review when needed. |
| INVALID | Correct the source column values or mapping and prepare the corrected CSV. |
| PAUSED_QUOTA | Wait for the provider's allowance or adjust the provider account, then review a new attempt for the exception row. |
| PAUSED_RATE | Respect the provider's retry timing, review a new attempt for the exception row, and continue with the configured pacing. |
| PAUSED_AUTH | Restore the original provider key or allowed caller configuration, reopen the same workspace, then review the failed row's new attempt. |
| NEEDS_RECONCILIATION | Inspect the original request and import its actual matching observation/result if available. An explicit new attempt retains the uncertainty and its reason. |
| INTERRUPTED | Reopen the same batch and run identity to continue the interrupted loop. Completed original captures are reused. |
| STOPPED | Keep the same batch and choose a new run ID to process its remaining ready rows. The stopped run remains terminal. |

HTTP 200 can contain no results. Provider quota exhaustion (402), rate limiting (429), and authentication or caller refusal remain distinct from the merchant's own payment challenge. Subscription responses can omit rate fields; missing fields do not imply zero allowance.

Each retry retains the predecessor request hash, the state reviewed at that time, the expected response and the operator's reason. An acknowledged uncertain predecessor can later receive its actual result without erasing that earlier decision. Reconciliation requires every retry receipt and its contiguous predecessor chain. Customer exports carry those receipts and the original predecessor request/capture bytes.

A completed failed attempt remains a completed original record. A deliberate retry creates the next row attempt only after checking the current request ID, response hash and reason:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-retry \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --row 4 \
  --request ORIGINAL_REQUEST_ID --response-sha256 ORIGINAL_RESPONSE_SHA \
  --reason "Provider allowance restored"

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-run \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --run locations-pass-2
~~~

For an uncertain attempt with no retained response, select --response-sha256 none and explicitly use --acknowledge-uncertain true. The prior request remains selected in the immutable retry receipt.

The SQLite progress index is derived from the immutable CSV intake, original request/capture bundles and retained retry receipts. Reconcile restores its current attempt and capture summaries from those sources. It dispatches no provider request:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-reconcile \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID
~~~

The workspace owner serializes writes and holds the original lease. Managed Stop first stops the batch after its current provider operation settles, then drains accepted workspace operations, read admissions and progress connections before releasing the original source and lease.

## Candidate choices and joined export

Confidence describes spatial precision. It does not establish address correctness or change the provider's candidate order. Select an exact index against the actual response hash and current decision revision:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-row \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --row 1

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-select \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --row 1 \
  --request ORIGINAL_REQUEST_ID --response-sha256 ORIGINAL_RESPONSE_SHA \
  --revision CURRENT_DECISION_REVISION --index 0 --note "Reviewed source address"

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-export \
  --workspace /absolute/workspace --batch SAVED_BATCH_ID --revision CURRENT_BATCH_REVISION
~~~

An export freezes the actual row attempts, captures, responses and complete decisions while the original workspace owner is held. Its name contains the resulting source/decision snapshot identity, so rebuilding the derived progress index does not create a conflicting customer package. The export budget defaults to 64 MiB and can be explicitly selected with --max-bytes up to 512 MiB. Metadata indexes remain within 32 MiB and original per-capture bundle limits stay unchanged.

| File | Contents |
| --- | --- |
| source.csv | Exact original source bytes, including its original encoding marker and quoted fields. |
| review.json and intake-rows.json | Reviewed source/product/terms/mapping and every original row with its normalized query or input error. |
| results.csv | Every original row plus its current attempt, outcome, selected coordinates and source/decision identifiers. |
| exceptions.csv | Every row without a selected candidate: invalid input, unrun work, provider exceptions, empty results and pending review. |
| selected.geojson | Explicit saved choices as EPSG:4326 points, retaining the source ordinal and customer ID. |
| rows.jsonl | Per-row request, capture, response, decision and object references. |
| objects/ and objects.jsonl | Exact original capture/request/response/manifest bytes, deduplicated by SHA256. |
| licenses.jsonl | Returned data licenses and original geocoding semantics, joined to each response hash. |
| configuration.json | The original product and merchant terms; the key remains a named environment reference. |
| delivery.json, manifest.json and README.md | Joined counts, output columns, complete file hashes and receiving instructions. |

Generated spreadsheet projections escape formula-like text; source.csv and intake-rows.json preserve the original values. Extra cells from invalid rows are retained in the generated source_overflow_json column as well as the raw intake.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-read \
  --delivery /absolute/customer-output --verify true

node stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/cli.mjs batch-serve \
  --delivery /absolute/customer-output
~~~

The customer browser reopens the retained output and original candidate decisions. It provides paged rows and complete downloads without an API key. The reader checks the source/mapping, original capture decoder and per-row customer identity; retained file streams are selected from the original manifest.

## Merchant MCP operation

Add CSV inputs to the original private workspace connection:

~~~json
{
  "schema": "stellar-forge.opencage-workspace-connection.v1",
  "workspaces": {
    "locations": {
      "directory": "/absolute/workspace",
      "csvSources": {
        "customer_locations": "/absolute/private/locations.csv"
      }
    }
  }
}
~~~

The host reader selects canonical private files and pins their complete size/hash. Agent calls choose that alias; a changed source requires reloading the host's reviewed configuration.

The existing merchant_opencage_open opens the original workspace. The CSV tool family is:

- merchant_opencage_batch_source
- merchant_opencage_batch_review
- merchant_opencage_batch_prepare
- merchant_opencage_batch_inspect
- merchant_opencage_batch_run
- merchant_opencage_batch_select
- merchant_opencage_batch_retry
- merchant_opencage_batch_export

Use merchant_opencage_customer with kind:batch-delivery to open the exported customer browser. merchant_opencage_file_read accepts the same kind and export ID for manifest.json, CSV, GeoJSON, row indexes or content-addressed objects. It transfers an original immutable descriptor to the maintained retained-file reader; complete output files are streamed in resumable hash-bound chunks.

The managed source selection includes batch.mjs, batch-delivery.mjs and ui/batch.js alongside the original source files. After installing a new source release, use the original Applications source review/adoption flow to select it for the same saved workspace.

## Provider contract

Primary references: [OpenCage API](https://opencagedata.com/api), [batch guidance](https://opencagedata.com/api#batch), and [terms](https://opencagedata.com/terms).

The provider's documented success test key returns its fixed sample location for ordinary queries. A receiving example built from those actual retained responses demonstrates the workflow using that sample behavior. The original request, response, source description and timestamps remain in the delivery.

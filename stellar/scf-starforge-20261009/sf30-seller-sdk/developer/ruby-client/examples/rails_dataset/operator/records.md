# Working dataset records

The dataset operator now provides a complete staff view of the rows that have been imported into the application. Open a committed review and choose **Records**. Capture the current working dataset, select the rows you need, inspect their original source and current application values, and download the complete selection.

A capture is tied to one application stream, one database revision and the original committed receipt. It includes every managed key in that stream, including keys removed by a later source edition. Saved captures remain available from the same review, so a colleague can reopen the exact selection used for a report.

## Everyday operation

1. Open the received dataset review for the current application edition. The page identifies the committed revision and receipt. If another review owns the current edition, follow its link.
2. Choose **Capture working data**. The application saves the selected operation before the background job starts. The page shows the original request while it runs and offers the same request after an interruption.
3. Open the completed capture. The totals distinguish current source rows, removed keys, unchanged targets, changed targets and missing targets.
4. Search across the complete original source and mapped working values. Apply typed filters and choose a stable sort. Move through every results page; the saved query identifies the full selection.
5. Open a record to compare the exact source row, the values last assigned by the import and the application values observed at capture time. Download an original attachment from its row and output column.
6. Export the full selected CSV or JSON. The export retains the same capture and query. Reopening the same selection returns the same complete file.

The capture job reads a consistent database snapshot and writes its retained output in the private operator directory. The original dataset import tables continue to own stream revisions, immutable edition entries and receipts. The host application's tenant and target relation control access to the records and their files.

## What the record states mean

| Field | Value | Meaning |
| --- | --- | --- |
| Source membership | Active | The key belongs to the last complete dataset edition applied to this stream. |
| Source membership | Removed | The key was absent from a later complete edition under the same selected source membership. Its prior source row and import history remain available. |
| Target observation | Unchanged | Every mapped application value equals the last value retained for that key. |
| Target observation | Changed | At least one mapped application value differs from the retained import state. The detail page lists the affected columns. |
| Target observation | Missing | The target row was absent from the authorized application relation at capture time and was not found outside that relation. |

An absent field and a field whose value is null remain distinct in the original source and committed-value details. A mapping that preserves a missing or null value continues to preserve that behavior. Integers and decimals retain their exact values; no floating-point conversion is used for filtering or sorting.

A capture is an observation of the working application at its displayed capture time. Create another capture to observe later application edits. Each capture retains its own original receipt and source identities.

## Search, filters and ordering

The browser accepts the mapped application columns declared by the original import mapping. It also exposes the key, source membership and target observation columns. The JSON API uses these exact column keys:

| Key | Type |
| --- | --- |
| `@key` | String containing the readable original key |
| `@status` | String: `active` or `removed` |
| `@target_state` | String: `unchanged`, `changed` or `missing` |
| `target.<column>` | The declared target column type: string, integer, decimal, boolean, date or datetime |

Search is case-insensitive across the full original source values, the mapped target values and record identity. Filters are combined with AND. String equality and ordering use the exact value; `contains` and `starts_with` are case-insensitive. Null predicates are explicit. A comparison with a non-null value excludes null cells.

Supported operators are `eq`, `ne`, `contains`, `starts_with`, `gt`, `gte`, `lt`, `lte`, `is_null` and `not_null`. String containment applies to string columns. Ordered comparisons apply to strings, exact numbers and dates. Boolean filters use equality, inequality or null predicates.

Use decimal strings for integer and decimal filter values, JSON booleans for boolean values, `YYYY-MM-DD` for dates, and an ISO datetime with `Z` or an explicit offset for datetimes. For example, a decimal filter uses `"12.34"`, not a JSON floating-point number.

A complete selection can contain up to 32 filters and eight ordered columns. Each sort column declares ascending or descending order and whether nulls appear first or last. The original key digest provides the final stable tie-break. Results use 100 records per page. The query and its complete export have no page-count truncation.

Example query for an application's declared `amount` and `name` columns:

```json
{
  "search": "",
  "statuses": ["active"],
  "target_states": ["unchanged", "changed"],
  "filters": [
    {"column": "target.amount", "operator": "gte", "value": "12.34"}
  ],
  "sort": [
    {"column": "target.name", "direction": "asc", "nulls": "last"}
  ]
}
```

Select actual names from the capture's `columns` descriptors. A query with no filters or sort is simply `{}`; it includes all source and target states in a stable key order.

## Original source, working values and files

Every detailed record retains:

- Its original key and digest, source membership and target observation.
- The full original source row, raw JSON, row digest, source edition and source entry identity.
- The exact values assigned by the retained import entry.
- The mapped application values observed in the capture, target model and original target ID.
- The complete selected attachment links, including original file identity, row, output alias and index.

The source row for a removed key comes from its most recent included edition. The removal entry and current receipt remain separately identified. The application retains the original source package for that review, so an attachment from an earlier edition resolves to those original bytes.

A file referenced under two output aliases keeps both links. The download matches the chosen record, original row, alias and index before opening the complete private snapshot. Its byte count and SHA-256 are checked against the retained attachment descriptor.

Access is evaluated again when reading a capture, a results page, an export or an attachment. If an original target has moved outside the application's permitted relation, the response requires the application's current authorized scope. A target that was deleted remains visible as a missing target with its retained source history.

## Complete exports

**CSV** contains all selected records in the saved order. Its columns include the displayed typed values and the exact source JSON, tagged committed values, tagged working values, attachment references and source/edition/key metadata. It is suitable for ordinary tabular review while retaining the complete record context.

**JSON** contains the full capture identity, normalized query and complete ordered record objects. Original integers, decimals, nulls, dates and nested values use the maintained `RailsDataset.pack` representation in typed value fields. The original raw source JSON is retained separately.

The server streams the complete file through its existing private download response. The CLI writes the same complete bytes and verifies the download size and digest. Each download is built from the same retained capture and query and exposes its complete verified bytes. The CLI publishes an output file create-only and verifies that file on repeat use.

For portable application receiving, stop the managed application and choose **Export application** with the saved working-data profile. Select the original review, capture UUID and capture checksum. The runtime compares every current managed key and value with that exact saved capture, verifies the original edition history, copies the closed database and files, and verifies the copied application again before publishing its full archive. The full working application includes its database, every retained review, data capture, query and original source package. Receiving verifies the same profile and original observation before registering the application. The default application profile continues to check the current received edition against its imported target values. The explicit saved working-data profile preserves the changed or missing targets observed in the selected complete capture. Received applications retain that profile for verification; select a fresh capture when later working changes need to travel. The single-review handoff is useful for one review; the whole application export carries earlier reviews referenced by removed rows and their attachments.

## Install in the existing Rails application

Use the complete current Ruby customer package. The operator's existing setup and authenticated host callbacks are documented in [README.md](README.md). The existing workspace now requires `records.rb`; the two new views are delivered with the same operator.

The application retains its original `DatasetOperator.workspace_resolver`, tenant key, actor callback, scoped stream relation, scoped target relation and background queue. The new job receives only the tenant key, original review ID and retained capture UUID. The controller saves the capture selection before enqueueing that job.

The existing `dataset_imports` member routes include:

```ruby
get :records
get :record
post :capture_data
get :data_export
get :data_attachment
```

`capture_data` uses the existing authenticated controller, CSRF middleware and signed selection envelope. The selection binds the original review, capture UUID, expected application revision and receipt digest. A repeated submission resumes that same capture.

The standalone commissioning installation includes these routes and runs the original capture job inline. A production host keeps its configured durable Active Job adapter.

## Ruby API

All operations use the same existing `Starforge::DatasetOperator::Workspace`.

```ruby
current = workspace.data_captures(review_id).fetch("current")

selected = workspace.select_data_capture(
  review_id,
  id: capture_uuid,
  actor: authenticated_actor,
  expected_revision: current.fetch("revision"),
  expected_receipt_sha256: current.fetch("receipt_sha256")
)

capture = workspace.complete_data_capture(review_id, selected.fetch("id"))
query = workspace.query_data(review_id, capture.fetch("id"), query: {})

page = workspace.data_rows(
  review_id, capture.fetch("id"), query.fetch("id"), page: 0
)

detail = workspace.data_record(
  review_id, capture.fetch("id"),
  key_sha256: page.fetch("rows").first.fetch("key_sha256")
)
```

The page API is zero-based. Browser page numbers are one-based. An empty dataset still has a valid capture and complete exports; check the row count before selecting a record.

Use `data_capture_state(review_id, capture_uuid)` to reopen the original request. States are `selected`, `running`, `error` and `complete`. A completed state always includes the original capture. Use `complete_data_capture` again to continue a retained request after a process interruption. If the application revision changed before the capture completed, the original request remains available and reports that mismatch; select the current revision with a new capture UUID.

`data_captures` returns the current edition, completed captures, pending requests and a `next_before` cursor. Its `before`/limit arguments page the capture history. The complete query result contains the normalized query, full row count, page count and exact file descriptors.

For full files:

```ruby
download = workspace.data_export(
  review_id, capture_id, query_id, format: "json"
)
begin
  File.open(selected_output_path, "wb", 0600) do |file|
    download.each { |bytes| file.write(bytes) }
  end
ensure
  download.close
end

attachment = workspace.data_attachment(
  review_id, capture_id,
  key_sha256: original_key_sha256,
  file: link.fetch("file"),
  record_id: link.fetch("record_id"),
  column: link.fetch("column"),
  index: link.fetch("index")
)
```

The host selects filesystem output paths. HTTP requests select only original review, capture, query, record and file identities.

## CLI

Run `records_cli.rb` through the existing application environment. In a normal Rails application:

```sh
bin/rails runner /absolute/client/examples/rails_dataset/operator/records_cli.rb \
  current --tenant ACCOUNT --review REVIEW_UUID
```

For a received managed application, use its selected Ruby and installed bundle:

```sh
bundle exec ruby /absolute/client/examples/rails_dataset/operator/records_cli.rb \
  current --application PRIVATE_WORKING_APPLICATION \
  --runtime-source INSTALLED_RUBY_RUNTIME \
  --environment PRIVATE_RUBY_ENVIRONMENT --review REVIEW_UUID
```

Keep those same application or tenant options for each following command. Select actual IDs, revision and receipt digest from `current`:

```sh
records_cli.rb capture --review REVIEW_UUID --id CAPTURE_UUID --actor OPERATOR \
  --revision CURRENT_REVISION --receipt-sha256 ORIGINAL_RECEIPT_SHA256

records_cli.rb status --review REVIEW_UUID --capture CAPTURE_UUID
records_cli.rb resume --review REVIEW_UUID --capture CAPTURE_UUID

records_cli.rb query --review REVIEW_UUID --capture CAPTURE_UUID --input query.json
records_cli.rb rows --review REVIEW_UUID --capture CAPTURE_UUID --query QUERY_SHA256 --page 0
records_cli.rb record --review REVIEW_UUID --capture CAPTURE_UUID --key ORIGINAL_KEY_SHA256

records_cli.rb export --review REVIEW_UUID --capture CAPTURE_UUID --query QUERY_SHA256 \
  --format csv --out PRIVATE_OUTPUT/records.csv
records_cli.rb export --review REVIEW_UUID --capture CAPTURE_UUID --query QUERY_SHA256 \
  --format json --out PRIVATE_OUTPUT/records.json

records_cli.rb attachment --review REVIEW_UUID --capture CAPTURE_UUID \
  --key ORIGINAL_KEY_SHA256 --file ORIGINAL_FILE --record-id ORIGINAL_ROW \
  --column OUTPUT_ALIAS --index ORIGINAL_INDEX --out PRIVATE_OUTPUT/original-file.bin
```

These abbreviated commands retain the same Ruby/Rails invocation and application selection shown above. Output parents must be existing private directories. The CLI reports the complete byte count and SHA-256 for written files. Repeating a command with the same output retains the original file and verifies its full bytes.

## Managed working-data profile

The managed runtime keeps the same original environment, application and operation selection. An explicit saved capture adds the following field to `start`:

```javascript
await runtime.start({
  id: environmentId,
  applicationId,
  action: "export",
  operationId: originalExportUuid,
  workingCapture: {
    reviewId,
    captureId,
    expectedCaptureSha256: capture.sha256
  }
});
```

The same selection works with `action: "verify"`. Omitting the field keeps the previous operation shape. The capture identifiers are taken from the application's **Dataset and source details**, never from a filesystem path.

```sh
starforge ruby-runtime export --directory PRIVATE_RUNTIME --id ENVIRONMENT \
  --application-id APPLICATION --operation-id EXPORT_UUID \
  --capture-review-id REVIEW_UUID --capture-id CAPTURE_UUID \
  --capture-sha256 CAPTURE_SHA256 --wait
```

Read the resulting operation and receive its full `ruby-runtime.tar` through the existing file/download and archive receiving commands. Its source, lock, gem cache, working database, capture, original file set and selected working-data profile travel together. The receiving environment installs the retained dependencies offline with its selected compatible Ruby.

New managed environments retain the data-record support capability and full current customer source. A previous environment whose original retained source predates this capability remains identifiable before a new capture operation is reserved. Use an installation of the current complete package for the saved-data workflow.

## Application commissioning and receiving

[records_example.rb](records_example.rb) operates the actual received managed application and its original dataset. It selects the current committed review, saves and resumes one capture through the real authenticated Rails form, walks the complete result, downloads every selected original attachment and compares both complete exports. It then closes the original database, copies the complete working application, parks the producer while a new Ruby process opens the receiving copy, and reopens the original retained result.

Run the complete example through the same installed Ruby environment:

```sh
starforge ruby-runtime run --directory PRIVATE_RUNTIME --id ENVIRONMENT \
  --operation-id ORIGINAL_CUSTOMER_OPERATION --entry dataset-records-lifecycle --wait -- \
  run --application PRIVATE_WORKING_APPLICATION \
  --runtime-source PRIVATE_RUBY_ENVIRONMENT/support --out PRIVATE_RECORDS_JOURNEY
```

The result includes `workingCapture` for the full managed export above. Use the same application's original identity with a retained export UUID.

For the whole managed archive journey, the maintained continuation consumes the completed original managed customer directory:

```sh
node /absolute/source/stellar/scf-starforge-20261009/distribution/ruby-runtime/examples/customer-records.mjs \
  --managed-directory ORIGINAL_COMPLETED_MANAGED_JOURNEY --recipient-port AVAILABLE_PORT
```

It invokes the Ruby record journey in the original selected environment, verifies its exact capture, exports the complete runtime TAR and installs that archive offline in its own receiving directory. While the producer is parked, it compares the entire original CSV and JSON, opens every received records page, stops the Rails process and reopens the complete working application. Source capture, export, receiving and verification each retain their original operation UUID before dispatch. A restarted command resumes those same operations.

The continuation writes `committed-records/records-customer-result.json` beside the original managed result, with the selected working capture, complete archive descriptor, original and received observations, records page outputs and the receiving application's complete file inventory. A completed repeat verifies those files and the same received application. The complete example's `reopen --out PRIVATE_RECORDS_JOURNEY --runtime-source INSTALLED_SUPPORT` entry checks the receiving application without its original producer path.

The executable retains its own original selection and operation UUIDs under the selected output directory. Repeating the same command resumes those operations; a completed repeat verifies the same result and receiving files. It uses the existing received source and selected Ruby bundle. Its complete output includes the native record/export results, rendered application pages, original attachments, file digests and independent receiving observation.

Saved capture IDs, query digests and original attachment references remain the same after full application receiving.

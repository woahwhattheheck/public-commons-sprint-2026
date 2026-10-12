# Finalized datasets in Ruby and Rails

Receive an existing complete SF100 data room as a portable customer edition, use
every original typed row, and import a reviewed edition into the application's
Rails database. The original SF88 acquisition route and this direct SF100 route
share `Starforge::DatasetDelivery` and `Starforge::RailsDataset`.

The direct entrypoint uses the maintained Python `open_finalized` receiver and
the original Node `scan(room, {retainPayload:false})`. It retains the exact Python
result, original source manifest, session and numbered pages, complete JSONL and
CSV, review page, and the source's semantic dictionary when present. Its customer
packet can subsequently be opened, copied and imported using Ruby alone.

## Choose the original source

| Existing source | Customer entrypoint | Retained source identity |
| --- | --- | --- |
| Original SF88 Dataset acquisition | `DatasetReceiving` in [DATASETS.md](DATASETS.md) | Original session, request, merchant contract and configuration |
| Finalized SF100 room with `manifest.json`, `session.json` and `pages/` | `NativeDatasetReceiving` in this guide | Original final manifest and complete native scan/receiving result |

Choose the actual completed room retained by the source owner. The original
receiver checks complete pagination, source/query/cursor bindings, every page
record, the published meaning, and the complete native JSONL against the original
page rows. A zero-row completed dataset remains a valid complete edition.

Use a stable `source_key` for one logical customer source across refreshes. Give
each newly received edition its own `dataset_id` and receiving directory. Keep
the original selected native manifest digest with that edition.

## Export the complete customer source

The standalone native package needs no merchant OpenAPI file. From the source
checkout or the original installed `starforge client ruby` command:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/ruby-client/export.mjs \
  native-export --out /absolute/new-native-ruby-package

node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/ruby-client/export.mjs \
  native-status --dir /absolute/new-native-ruby-package

node stellar/scf-starforge-20261009/sf30-seller-sdk/developer/ruby-client/export.mjs \
  native-copy --dir /absolute/new-native-ruby-package --out /absolute/customer-copy
```

The package contains sixteen complete source/guide/example files and
`native-dataset-client.json` with the exact file digests. Its source selection is
saved before file publication. `native-resume --dir ORIGINAL_DIRECTORY` completes
an interrupted export from the retained source edition.
`native-copy-resume --dir ORIGINAL_PACKAGE --out INTERRUPTED_COPY` resumes an
exact copy of the original complete package.

The original seller export now contains all twenty-six Ruby customer files:
single responses, SF88 acquisition, direct SF100 receiving, and the complete Rails
edition importer. Existing eight-file and twenty-one-file seller packages retain
their original manifests and bytes when inspected or copied.

Ruby 3.1 or later handles offline packet receiving. The initial native receiving
uses the source owner's original complete checkout, Python interpreter and Node
executable. Select the same Python environment used for the existing native
receiver. Rails application integration uses the application's ActiveRecord
version and database connection; the supplied migration targets the Rails 7.1
migration interface. The standalone commissioning program additionally uses the
SQLite adapter from that Ruby environment.

## Receive the original finalized room

The native manifest digest selects the exact source edition. The source owner's
retained result may already supply it; it is also the SHA-256 of the original
room's complete `manifest.json`.

```sh
ruby /absolute/native-ruby-package/native_dataset_customer.rb receive \
  --directory /absolute/private/customer-receiving \
  --room /absolute/original/finalized-room \
  --source-key customer-resource \
  --dataset-id customer-resource-edition-1 \
  --native-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --checkout /absolute/original/source-checkout \
  --python /absolute/original/python \
  --node /absolute/original/node
```

The receiving directory and its parent must be private to the operator. The
receiving directory is separate from the selected original room. Interpreter
paths are explicit absolute paths. The original source modules and executable
selection are retained in the receiving request and checked around the original
read operation.

```ruby
require_relative "native_dataset_receiving"

receiver = Starforge::NativeDatasetReceiving.new(
  directory: "/absolute/private/customer-receiving",
  room: "/absolute/original/finalized-room",
  source_key: "customer-resource",
  dataset_id: "customer-resource-edition-1",
  expected_native_manifest_sha256: selected_original_manifest_sha256,
  checkout: "/absolute/original/source-checkout",
  python: "/absolute/original/python",
  node: "/absolute/original/node"
)
delivery = receiver.receive
```

The result's `directory` points to `customer-receiving/received`.
`manifest_sha256` selects its complete `dataset-customer.json`.

### Resume the same customer operation

```sh
ruby native_dataset_customer.rb status --directory /absolute/private/customer-receiving
ruby native_dataset_customer.rb resume --directory /absolute/private/customer-receiving
```

The original receiving request is create-only. Reusing its directory with another
source, manifest, source key, dataset ID or selected runtime fails with the
original files retained. A successful native result is saved before copying the
customer packet. An interrupted copy resumes from that exact result and its
original descriptors. Already copied files are checked and reused.

The native call records its actual stdout, stderr and process outcome under
`attempts/`. Cancellation drains the private Python/Node process group. The
source room is read through its original receiver. Once the customer operation
is complete, status and resume reopen the retained customer packet offline.

| Retained file | Purpose |
| --- | --- |
| `request.json` | Exact source/runtime/customer selection |
| `native-receiving.json` | Unmodified stdout from the original Python receiving entrypoint |
| `attempts/UUID/` | Actual native call output and outcome |
| `received/dataset-customer.json` | Complete portable customer manifest |
| `received/selection.json` | Original receiving request bytes |
| `received/source.json` | Original source IDs, columns and provider identity |
| `received/session.json` and `received/pages/NNNNN.json` | Every original native session/page archive |
| `received/manifest.json` and its outputs | Original published manifest, data and meaning |
| `received.json` | Customer operation bound to the completed portable edition |

## Open and use every original row

```ruby
require_relative "dataset_delivery"

delivery = Starforge::DatasetDelivery.open(
  "/absolute/complete-customer-packet",
  expected_manifest_sha256: selected_customer_manifest_sha256
)

puts delivery.source_format       # SF100_SCAN
puts delivery.row_count
p delivery.fields
p delivery.membership

delivery.each_record do |record|
  ordinal = record.fetch("ordinal")
  values = record.fetch("values")
  original_json = record.fetch("raw_json")
  original_row_sha256 = record.fetch("sha256")
  # Pass the original values or raw JSON into the application's consumer.
end
```

Integer values remain Ruby Integer. JSON decimal values use BigDecimal. The
original JSON line and digest remain available for exact source retention.
Strings, booleans and nulls preserve their original native types. The whole
source dictionary is `delivery.semantics`, and the original native result is
`delivery.native_receipt`. The direct route's `acquisition` is nil because its
source format is the original finalized SF100 room.

All selected bytes are copied to an unlinked, hash-checked snapshot before a
caller receives them. Complete-file iteration closes that snapshot after normal
consumption, an exception or early return. Opening verifies the original archive
record chain and compares every original page row with the native JSONL.

The machine-readable source is the original JSONL. The original CSV remains
available with its producer's spreadsheet escaping and representation of nulls.

```sh
ruby native_dataset_customer.rb rows \
  --delivery /absolute/complete-customer-packet --manifest-sha256 CUSTOMER_MANIFEST_SHA256

ruby native_dataset_customer.rb file \
  --delivery /absolute/complete-customer-packet --manifest-sha256 CUSTOMER_MANIFEST_SHA256 \
  --file dataset.csv --out /absolute/private/customer-data.csv

ruby native_dataset_customer.rb file \
  --delivery /absolute/complete-customer-packet --manifest-sha256 CUSTOMER_MANIFEST_SHA256 \
  --file semantics.json --out /absolute/private/source-dictionary.json
```

Choose `semantics.json` when that original edition includes it. Any original
retained page, output or receiving metadata file can be selected through its
manifest name. A repeated file export accepts the original exact bytes.

## Copy and reopen the full customer edition

```ruby
copied = delivery.copy_to("/absolute/private/recipient-dataset")

reopened = Starforge::DatasetDelivery.open(
  copied.directory,
  expected_manifest_sha256: delivery.manifest_sha256
)
```

`copy_to` carries every original page and output, the full native receiving
result, source selection, dictionary and customer manifest. It publishes each
file create-only and completes with the exact original customer manifest.
Repeating the copy resumes the same selected transfer.

The packet's retained original absolute paths describe its provenance. All
offline file reads use the copied packet's own relative files. The original
source room, interpreter, checkout, customer receiving workspace and network
connection are unnecessary for opening the completed copy.

```sh
ruby native_dataset_customer.rb copy \
  --directory /absolute/private/customer-receiving --out /absolute/private/recipient-dataset

ruby native_dataset_customer.rb inspect \
  --delivery /absolute/private/recipient-dataset --manifest-sha256 CUSTOMER_MANIFEST_SHA256
```

## Keep resource identity stable across actual revisions

The final native manifest hash is the direct edition's `source_sha256` and
`sourceId`. It stays in every source/receipt/edition binding. Logical Rails stream
membership uses the following original identities:

| Source | Stable provider fields |
| --- | --- |
| CKAN semantic dictionary | Catalog origin, package ID, resource ID |
| OData semantic dictionary | Service URL, entity container, entity set |
| Superset semantic dictionary | Apache Superset provider/version, complete normalized server URL, chart ID/optional UUID, query ordinal, saved query-context and principal digests, selected result limit/offset |
| Directus semantic dictionary | Directus provider/version, complete normalized server URL, collection, primary field, complete authenticated principal object and original source query |
| Original room without a dictionary, including existing Baserow rooms | The explicitly retained customer source key and native dataset name |

Every direct membership also includes `source_format=SF100_SCAN`, the customer
`source_key`, original dataset name, exact `originalQueryHash` and ordered
projected fields. The original query hash retains the selected filters, ranges
and ordering while excluding the changing cursor and snapshot.

The full original source attribution, capture and schema hashes, dictionary
definition hash, timestamp-bearing capture material, and original scan stay with
their edition. A title or description change does not rename a CKAN resource.
Different query membership or a different provider/resource produces a different
stream binding. Rails separately retains tenant scope and the stable key mapping.

SF88 customer packets retain their existing membership object exactly: merchant
contract digest, original operation ID, GET endpoint, selected query and fields.
Previously saved SF88 stream hashes continue to match.

### Superset and Directus source editions

The direct receiver accepts the original producer contracts
`stellar-forge.superset-semantics.v1` (Apache Superset 6.1) and
`stellar-forge.directus-semantics.v1` (Directus 12.5). Receive them through the
same original SF100 room and Python native receiver. The complete common
receiving cohort is [PR2108](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2108),
merge `fd2a5be61f88c088bc128d17e061cdfd8a5bcec7`; its
[receiving guide](../../../sf100-buyer-dataset-delivery/SEMANTIC_RECEIVING.md)
describes the SF100 finalizer, SF88 page headers, Python dictionary loader and
native MCP file adapter that accompany this Ruby reader.

`delivery.membership.fetch("provider_source")` retains these exact shapes:

~~~ruby
# Superset
{
  "provider" => "apache-superset",
  "protocol_version" => "6.1",
  "server_url" => source.fetch("baseUrl"),
  "chart_id" => source.fetch("chartId"),
  "chart_uuid" => source.fetch("chartUuid"),
  "query_ordinal" => source.fetch("queryOrdinal"),
  "query_context_sha256" => source.fetch("queryContextSha256"),
  "principal_sha256" => source.fetch("principalSha256"),
  "row_limit" => semantics.fetch("query").fetch("rowLimit"),
  "row_offset" => semantics.fetch("query").fetch("rowOffset")
}

# Directus
{
  "provider" => "directus",
  "protocol_version" => "12.5",
  "server_url" => source.fetch("baseUrl"),
  "collection" => source.fetch("collection"),
  "primary_field" => source.fetch("primaryField"),
  "source_principal" => source.fetch("principal"),
  "source_query" => source.fetch("query")
}
~~~

The retained server URL includes any reverse-proxy prefix, for example
`https://data.example.org/analytics/`. The original producer supplies its
normalized URL; the customer checks that form and keeps the entire path.
Superset numeric chart IDs, query ordinals and row limits remain integers, and
an unspecified chart UUID or row limit remains null. Directus retains the
complete original query object, including its selected fields, sort and any
filter/window options. The original query/principal selection is therefore
part of the logical resource stream. Directus keeps the producer's entire principal object, including any retained role/scope fields. A different authenticated source identity
or source window requires its own reviewed stream binding.

Capture timestamps, capture/schema hashes, dictionary definition/document
hashes, physical snapshot and native manifest hashes remain in the edition's
complete source binding and retained original files. Updated source values or
attribution can be received as another edition of the same logical stream.
The existing CKAN, OData, dictionary-free Baserow and SF88 membership objects
keep their original shape.

Superset pairs each native result column with its original presence column.
Directus uses independently named value and state aliases, and its value cell
contains the exact original JSON text. Keep the actual pair in the Rails
mapping: `value`, `null` and `missing` are separate source states.
The native receiver retains original field definitions, relations, source
column ordinals/type codes and full raw rows with the edition. Application
mapping remains explicit; the semantic dictionary does not choose a database
column or coerce a Directus JSON number into a Ruby Float.

Use the same complete commissioning, application export, copy and independent
receive commands below for these source kinds. Choose a real finalized source
room and its exact manifest, the existing customer source key, an explicit
original key mapping and the original application operation. A completed
customer package reopens with its own relative files after the source host
is unavailable.

## Import into the original Rails application

Use the [Rails application guide](examples/rails_dataset/README.md), its original
models/migration and the same `Starforge::RailsDataset` importer. Open the direct
customer packet through `DatasetDelivery.open`; the importer receives its native
membership through the common accessor.

```ruby
importer = Starforge::RailsDataset.new(
  delivery: delivery,
  scope: current_account.catalog_records,
  stream: current_account.dataset_streams.find(selected_stream_id),
  models: {edition: DatasetEdition, row: DatasetRow, entry: DatasetEntry},
  mapping: application_mapping
)

preview = importer.preview
begin
  File.open("/private/review.json", "wb", 0600) { |io| preview.write_json(io) }
  selected_preview_sha256 = preview.sha256
ensure
  preview.close
end

receipt = importer.import!(
  operation_key: original_application_job_key,
  expected_preview_sha256: selected_preview_sha256
)
```

The actual application supplies its authenticated tenant scope and same-database
models. Its explicit mapping selects source fields, target columns, exact types,
keys, missing/null behavior and any archive policy. The complete preview exposes
inserts, updates, unchanged rows and absent keys from the same full source
membership. The original importer commits target rows, current key state, complete
raw source entries, revision and business receipt in one transaction.

For the next actual source edition, receive its original finalized room in a new
receiving directory with the same `source_key` and a new `dataset_id`. Open that
complete packet, select the same application stream and mapping, and use a new
application operation key. Review and commit its complete preview. Repeating a
committed operation key reopens its original receipt.

The delivered `examples/rails_dataset/commission.rb` supports init, preview,
commit, receipt and status through the application's normal `bin/rails runner`.

## Run the complete native customer commissioning

The executable example consumes an actual original finalized room. It receives
every source file, maps every original selected field into its own private
ActiveRecord application database, commits the first reviewed application
revision, exports all preview/history rows, and produces one complete application
delivery folder. It copies that folder, moves its own producer files aside, and
reopens the independent recipient through the same importer.

It uses the original dictionary's complete projected key when available.
`--key` explicitly selects an original field otherwise and can be repeated for
a composite key. The source's strings, integers, booleans and nulls keep their
native values. Native JSON number fields use exact decimal text in this portable
SQLite example; the raw JSON source remains in the edition history. An existing
application can map them to its own exact decimal columns.

```sh
ruby /absolute/native-ruby-package/examples/native_dataset_lifecycle.rb run \
  --out /absolute/private/native-customer-operation \
  --room /absolute/original/finalized-room \
  --native-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --source-key customer-resource \
  --dataset-id customer-resource-edition-1 \
  --checkout /absolute/original/source-checkout \
  --python /absolute/original/python \
  --node /absolute/original/node
```

The same command and output directory resume the original source selection,
native receiving, reviewed import and complete delivery. It retains the closed
application database and full committed receipt before beginning the application
export, so an interrupted export reuses that exact committed state.

The operation's complete outputs include:

- `native-rails-result.json` with the actual source, runtime, row/type, revision,
  full receipt, application manifest, first receiving and detached receiving.
- `outputs/preview.json` and `outputs/preview.csv` with every selected row and
  proposed application action.
- `outputs/edition.json` with the complete committed source/target history.
- `recipient/` with the complete portable application delivery described below.
- `received-application/` with the independently copied application and its
  reopened working database.

### Transfer the complete application

The application is selected by the SHA-256 of its complete
`application-delivery.json`. That manifest contains relative file names and
complete byte counts and hashes. Its `dataset` entry binds the native packet's
own complete customer manifest.

| Delivered relative file | Complete retained content |
| --- | --- |
| `application-delivery.json` | Application/source/receipt identities and every selected file |
| `dataset/` | Entire original native data, pages, meaning, receiving result and customer manifest |
| `mapping.json` | Exact original application field/type/key mapping |
| `selection.json` | Original source, native manifest and customer operation selection |
| `receipt.json` | Full original committed Rails receipt metadata |
| `preview.json` and `preview.csv` | Every reviewed application/source row |
| `edition.json` | Every committed source/target history entry |
| `application.sqlite3` | Complete closed application database |
| `readback.sqlite3` | Receiver's working database, created from the immutable delivered artifact |

The exported database stays separate from the receiver's working copy. Adapter
connection pragmas and receiving activity therefore do not change the selected
database artifact. Original room and runtime paths in `selection.json` and the
native receipt remain provenance; receiving reads files relative to the moved
application folder.

Use the exported native Ruby customer package on the receiving machine. Copy the
application with its complete original manifest:

~~~sh
ruby /absolute/native-ruby-package/examples/native_dataset_lifecycle.rb copy \
  --delivery /absolute/private/native-customer-operation/recipient \
  --manifest-sha256 APPLICATION_MANIFEST_SHA256 \
  --out /absolute/private/moved-application
~~~

The same copy command resumes its retained transfer. A completed copy keeps the
exact original application manifest and every selected file. The new host can
then open it with only the local application directory and its selected hash:

~~~sh
ruby /absolute/native-ruby-package/examples/native_dataset_lifecycle.rb receive \
  --delivery /absolute/private/moved-application \
  --manifest-sha256 APPLICATION_MANIFEST_SHA256
~~~

Receiving verifies the complete data and database artifacts, matches the original
business receipt, and streams the entire committed edition to match
`edition.json`. It also runs the actual importer preview against the receiver's
current target records: every original source row must be unchanged, with zero
inserts, updates, removals, adoptions, restorations or source changes. The returned
`currentTargets` contains that complete preview's identity and counts.

The native commissioning run performs this same receive on its fresh
`received-application/` copy while the producer's own input, mapping, outputs,
receiving directory, application database and first recipient are unavailable.
It restores those producer files afterward. A retained detach record also
restores them before a resumed operation if the process was interrupted. The
source owner's original finalized room and source checkout remain at their
original locations throughout the operation.

To reopen the original commissioning record and the copied application's current
state:

~~~sh
ruby /absolute/native-ruby-package/examples/native_dataset_lifecycle.rb reopen \
  --out /absolute/private/native-customer-operation
~~~

The independent `receive` command above is the customer handoff. It works after
the original commissioning directory, source room, Python and Node environments
are unavailable. Ruby, the delivered customer source and its ActiveRecord/SQLite
dependencies are sufficient.

## Original implementation and actionable recovery

The same product contains [the native Ruby reader](native_dataset.rb), [receiving
operation](native_dataset_receiving.rb), the `native_dataset_customer.rb` CLI, and
[complete native application example](examples/native_dataset_lifecycle.rb).
The producer remains the [original Python receiving entrypoint](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/c50a72f634f3c17509b9fd717d5dee2b1f741090/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/native-dataset-receive.py),
[original Python finalized-room receiver](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/c50a72f634f3c17509b9fd717d5dee2b1f741090/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/analysis_native_delivery.py),
and [original SF100 engine](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/c50a72f634f3c17509b9fd717d5dee2b1f741090/stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs).

| Result | Customer action |
| --- | --- |
| `PREPARED` | Resume the same native receiving request. |
| `NATIVE_RECEIVED` | Resume copying the original result's remaining files. |
| `RECEIVED` | Open the complete local packet or transfer it to the recipient. |
| `RUBY_NATIVE_DATASET_SOURCE_MANIFEST_CHANGED` | Re-select the original retained room and its manifest, or receive an actual new edition in a new directory. |
| `RUBY_NATIVE_DATASET_RUNTIME_CHANGED` | Restore the source/runtime files named in the retained request before its native read. |
| `RUBY_NATIVE_DATASET_ORIGINAL_KEYS_REQUIRED` | Select the original unique source field or complete composite key. |
| `RUBY_NATIVE_DATASET_CURRENT_APPLICATION_ROWS_CHANGED` | Inspect the receiver's actual current target changes using the application importer and its original mapping. |
| `RUBY_NATIVE_DATASET_APPLICATION_FILE_CHANGED` | Restore the exact file selected by the application manifest or receive a complete original copy. |
| `DATASET_PREVIEW_CHANGED` | Review the application's actual current revision and retain the new selected preview under the appropriate application operation. |
| `DATASET_OPERATION_CHANGED` | Reopen the original operation, or choose a new operation key for the distinct source/mapping/preview. |

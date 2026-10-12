# Import complete dataset editions into an existing Rails application

This example turns an original received SF88/SF100 dataset into a reviewed, repeatable database import. It includes the migration, application models, field mapping, background job and commissioning command. The importer keeps the application's existing tenant relation, target records, database connection and native dataset source together.

A complete preview shows every incoming and removed key. Committing that selected preview writes all target changes, current key state, original source rows, edition history and the final receipt in one Active Record transaction. A repeated business operation key reopens its original committed result.

## Install the application side

Use Ruby 3.1 or newer, Rails/Active Record 7.1 or newer and the application's existing database. The merchant package already includes the Ruby standard-library reader and source-bound Dataset receiving client. The application adds Active Record and Active Job through its normal Rails bundle.

Copy the example migration into the application's migration directory with an unused timestamp and run the application's usual migration command. The migration creates four import/history tables and one example target table:

| Table | Stored application state |
| --- | --- |
| starforge_dataset_streams | Tenant/name identity, source/key/scope bindings, current revision and latest edition |
| starforge_dataset_editions | Stable operation identity, selected preview and complete committed receipt |
| starforge_dataset_rows | Current exact source key, original target ID, active/removed state and last source values |
| starforge_dataset_entries | Every edition's original JSON row, exact changes, target ID and source position |
| starforge_dataset_catalog_records | Example tenant-scoped business records with an actual unique source key |

~~~sh
dataset_package=/absolute/customer-package
cp "$dataset_package/examples/rails_dataset/create_dataset_import_tables.rb" \
  db/migrate/20261012085000_create_dataset_import_tables.rb
bin/rails db:migrate
install -d -m 0700 tmp/dataset-review
~~~

Choose a new migration timestamp if that path already exists. Keep the delivered package hierarchy intact: the example models load the verified importer through its relative package path.

For a customer's established schema, keep the four history tables and replace the example CatalogRecord with the application's original model. The relation passed to RailsDataset must already enforce the authenticated tenant's record scope. The stream and all four model classes must use the very same Active Record connection pool. Add or retain a real unique index covering the selected key within that scope; for this example it is tenant_key plus external_id.

The model examples make completed editions and source entries immutable through normal Active Record writes. The stream and current-key state advance as later complete editions are committed. Retain all four history tables with the application's regular database backups.

## Receive the original complete dataset

Follow the merchant package's [Dataset receiving guide](../../DATASETS.md) to prepare, review, acquire or attach, receive, and reopen the original dataset. Retain its actual dataset-customer.json SHA-256 with the application import record.

The Rails side opens that completed directory offline. The receiving reader checks every required original file, whole-file byte count and SHA-256, final native status, full page/row range and projected field set before yielding rows. It parses original integer tokens as Ruby Integer and decimal tokens as BigDecimal; the original JSON spelling and row order remain available for each row.

The same completed packet can be reopened by a background job. Each iteration reads a private immutable verified snapshot. Original payment review, native acquisition and recovery belong to the existing merchant Dataset client.

## Map the customer's real fields

Copy mapping.json into the application's configuration and change its field names to the actual received dataset. Remove unused example mappings. Every mapped source field must appear in the received manifest's projected fields.

The included mapping expects these example source names: id, name, amount, quantity, active, observed_on and recorded_at. Their names are application examples; inspect the actual delivery's fields before selecting them:

~~~ruby
delivery = Starforge::DatasetDelivery.open(
  "/absolute/private/received-dataset",
  expected_manifest_sha256: actual_manifest_sha256
)
puts JSON.pretty_generate(delivery.fields)
~~~

The mapping has three decisions:

| Setting | Result |
| --- | --- |
| key_columns | Exact stable business key; one or several mapped target columns |
| columns | Source field and explicit native target type for each managed attribute |
| removal | Retain missing records, or set a separate Boolean archive column inactive |

Supported target types are string/text, integer, decimal, Boolean, date and datetime. A source integer stays exact. A decimal string or native decimal token is accepted only when the target column preserves its value and range. A datetime must carry an explicit UTC or numeric offset and fit the database column's precision. Date strings use YYYY-MM-DD. Boolean fields accept actual true/false values.

A string column accepts a string by default. Set stringify to true only when the application intentionally converts a numeric or Boolean source value to its literal text. Stable keys retain capitalization, whitespace and leading zeroes supplied as strings.

For each mapping, null is assign or preserve; missing is error or preserve. These are independent choices. Key columns always require an actual value. The original SF100 reader supplies the complete projected row shape, and a field left out of the application's mapping remains application-owned. Explicit null assignments must fit the target column's null constraint. Target primary keys, timestamps, lock versions, STI columns and fixed scope attributes cannot be overwritten by source mapping.

The supplied archive policy uses source_active:

~~~json
{
  "strategy": "archive",
  "column": "source_active",
  "active": true,
  "inactive": false
}
~~~

A key absent from a later complete selected dataset becomes removed in the import state and its original target record receives source_active=false. If the key reappears, its record becomes active and the preview reports restored. With {"strategy":"retain"}, removal changes the import history while preserving the target record's attributes.

Removals are calculated from previously managed active keys in this exact stream. The importer requires the original complete selection: a final native snapshot, original merchant contract, operation, resolved endpoint, selected query and tenant scope. Page cursor, page size and dataset snapshot can change as the same selected dataset advances. Changing the merchant contract, dataset endpoint, key definition or selected membership requires an explicit application migration or another authorized stream.

## Create the stable stream and review the complete edition

Run commissioning through the actual Rails application's runner so the original database and model configuration are loaded. Paths below are templates for the customer's retained package, received delivery, configuration and private output directory.

~~~sh
bin/rails runner "$dataset_package/examples/rails_dataset/commission.rb" init -- \
  --tenant account-42 --stream merchant-catalog

bin/rails runner "$dataset_package/examples/rails_dataset/commission.rb" preview -- \
  --tenant account-42 --stream merchant-catalog \
  --delivery /absolute/private/received-dataset \
  --manifest-sha256 ACTUAL_DATASET_CUSTOMER_MANIFEST_SHA256 \
  --mapping /absolute/application/config/dataset-catalog-mapping.json \
  --out /absolute/application/tmp/dataset-review
~~~

The preview command writes the entire JSON and CSV revision into files named by its full preview SHA-256. It also prints counts and the exact output descriptors. Every preview entry includes:

- Original source ordinal, original JSON line and row SHA-256.
- Exact stable key and existing native target ID.
- Inserted, updated, unchanged or removed action.
- Adopted existing record, restored key and changed-source indicators.
- Exact before/after values and the selected target's current version fingerprint.

The complete JSON uses tagged values for precise types. For example, ["integer","9007199254740993"] is an exact integer, ["decimal","12.34000001"] is an exact decimal, ["null"] is explicit null, and ["datetime","2026-10-12T08:00:00.000000000Z"] is a UTC instant. The original unmodified source JSON is retained beside those mapped values.

Review all changes through these files or embed Preview.each_entry in the application's existing review screen. The neutral JSON/CSV surfaces carry the full dataset; the printed summary provides navigation and the selected hash. No preview is committed by creating or exporting it.

## Apply that selected preview

Use a persistent operation key from the application's own import/job record. Preserve that exact key and preview hash when a job retries.

~~~sh
bin/rails runner "$dataset_package/examples/rails_dataset/commission.rb" commit -- \
  --tenant account-42 --stream merchant-catalog \
  --delivery /absolute/private/received-dataset \
  --manifest-sha256 ACTUAL_DATASET_CUSTOMER_MANIFEST_SHA256 \
  --mapping /absolute/application/config/dataset-catalog-mapping.json \
  --operation catalog-edition-2026-10-12 \
  --preview-sha256 ACTUAL_COMPLETE_PREVIEW_SHA256 \
  --out /absolute/application/tmp/dataset-review
~~~

The importer locks the stream, rebuilds the complete current preview and compares it to the selected hash. It then saves the actual application models using their normal validations and callbacks, verifies the stored mapped values and scope, and commits the target updates plus complete edition history together. A changed target, changed stream revision or changed source/mapping produces a fresh-preview requirement before any edition is applied. Database/model validation failures roll back the whole transaction.

If a process exits after the database commit but before exporting its receipt, the same command with the original operation and preview returns that already committed edition and recreates its complete receipt export. Using that operation key for another source, mapping or preview is rejected.

The importer owns its database transaction boundary. Call it outside another open application transaction. Use database-side work or the application's after_commit/outbox arrangement for external effects in model callbacks. Active Record documents [transaction scope and callback behavior](https://api.rubyonrails.org/v7.1.0/classes/ActiveRecord/Transactions/ClassMethods.html) and [row locking with with_lock](https://api.rubyonrails.org/v7.1.0/classes/ActiveRecord/Locking/Pessimistic.html).

## Use the actual application job

The provided ImportDatasetJob consumes an already received complete packet and selected application preview. Resolve tenant identity and paths within the authenticated application, then enqueue the stable values:

~~~ruby
Starforge::DatasetExample::ImportDatasetJob.perform_later(
  stream_id: stream.id,
  tenant_key: current_account.dataset_tenant_key,
  delivery_directory: import_record.received_directory,
  manifest_sha256: import_record.dataset_manifest_sha256,
  mapping_path: Rails.root.join("config", "dataset-catalog-mapping.json").to_s,
  operation_key: import_record.operation_key,
  preview_sha256: import_record.selected_preview_sha256,
  receipt_path: import_record.receipt_path
)
~~~

Require the delivered job from an application initializer, for example require "/absolute/customer-package/examples/rails_dataset/import_dataset_job". To move it into the application's normal autoload paths, move its model classes with it and update the relative require to their actual location. The importer takes those classes explicitly:

~~~ruby
importer = Starforge::RailsDataset.new(
  delivery: delivery,
  scope: current_account.catalog_records,
  stream: stream,
  models: {edition: DatasetEdition, row: DatasetRow, entry: DatasetEntry},
  mapping: mapping
)
preview = importer.preview
begin
  File.open(review_path, "wb") { |io| preview.write_json(io) }
  selected_hash = preview.sha256
ensure
  preview.close
end
# Persist selected_hash with the application review decision, then use it:
receipt = importer.import!(
  operation_key: import_record.operation_key,
  expected_preview_sha256: import_record.selected_preview_sha256
)
~~~

The source key is resolved against the real scoped target relation. An existing matching record can be adopted once; a record already managed by a different stream is rejected. If a tracked target has moved outside the authorized scope, the application must resolve that relationship before applying another edition. All new records inherit the fixed values from the original scope.

## Reopen a committed edition and continue revisions

The status command reads the current stream and complete active/removed key counts:

~~~sh
bin/rails runner "$dataset_package/examples/rails_dataset/commission.rb" status -- \
  --tenant account-42 --stream merchant-catalog
~~~

The receipt command exports every retained entry from an existing operation, including original source JSON and exact before/after values:

~~~sh
bin/rails runner "$dataset_package/examples/rails_dataset/commission.rb" receipt -- \
  --tenant account-42 --stream merchant-catalog \
  --delivery /absolute/private/received-dataset \
  --manifest-sha256 ACTUAL_DATASET_CUSTOMER_MANIFEST_SHA256 \
  --mapping /absolute/application/config/dataset-catalog-mapping.json \
  --operation catalog-edition-2026-10-12 \
  --out /absolute/application/tmp/dataset-review
~~~

Reopen can use a current complete packet belonging to the same bound stream while exporting an earlier operation's saved source rows. The exporter checks every retained row hash, complete entry count and edition digest. All output writes are streamed into a private temporary file; an interrupted export can be repeated, and an existing path is accepted only when its full bytes match.

For the next original dataset edition, retain the same stream and stable key mapping, receive its complete packet, create a new application operation key, preview its entire diff and commit that selected preview. The existing target identities, source history and application records advance together.

# Baserow customer data and Rails editions

This package turns one existing Baserow publication into a complete customer delivery: its original source selection and field definitions, every selected native dataset page, the complete row files, and the original attachment bytes with their row and column links. Ruby receives that packet through the maintained SF100 receiver. The completed delivery opens and copies in Ruby and supplies its original dataset to the transactional Rails importer.

The publisher selects the edition. The Rails application selects its authenticated tenant, target model, key mapping and import policy. The installed [Rails operator](../../developer/ruby-client/examples/rails_dataset/operator/README.md) provides source selection, mapping, complete preview, background import, committed editions and attachment downloads.

## Prepare the published edition

Use the existing Baserow authoring workspace or [publisher](../README.md) to select the original view/table, save the source projection, extract the full source, review the candidate and publish its dataset version. Retain the published run ID, candidate digest and snapshot shown by that original publisher.

The customer projection includes an original record identity. A suitable source column is:

~~~json
{
  "record_id": {
    "source": "$recordId",
    "type": "string",
    "encoding": "identity-text",
    "nullable": false
  }
}
~~~

Keep the actual customer aliases for the other selected columns. Each original provider field uses its actual field ID and provider type. For full file receiving, select the original file field with type **string** and encoding **attachments**. The source capture retains those files through its declared original storage origins.

Run the installed command, or use **node baserow/customer/cli.mjs** from the seller SDK:

~~~sh
starforge baserow-source customer prepare \
  --publisher "$ORIGINAL_PUBLISHER" \
  --run "$PUBLISHED_RUN_ID" \
  --candidate-sha256 "$PUBLISHED_CANDIDATE_SHA256" \
  --snapshot "$PUBLISHED_SNAPSHOT" \
  --customer-key "$CUSTOMER_KEY" \
  --request-id "$RETAINED_REQUEST_UUID" \
  --out "$CUSTOMER_PACKET" \
  --result "$CUSTOMER_RESULT_JSON"
~~~

All shell variables in these examples are selected host inputs. Choose one request UUID before starting and reuse it with the same output directory. The optional **--query** is the original dataset query string: it can select fields, native filters, ranges, order and a page limit. Include the record identity column. The exporter pins the published snapshot and follows every original cursor to the terminal page.

The command opens the existing publisher, so close its current CLI/browser owner before using this separate CLI. An embedded application that already owns the publisher passes that same object to **prepareBaserowCustomer**.

The output's completed manifest is **customer-manifest.json**. Retain the reported **manifestSha256** with the customer handoff.

~~~sh
starforge baserow-source customer resume --directory "$CUSTOMER_PACKET"

starforge baserow-source customer inspect \
  --directory "$CUSTOMER_PACKET" \
  --manifest-sha256 "$CUSTOMER_MANIFEST_SHA256"

starforge baserow-source customer copy \
  --directory "$CUSTOMER_PACKET" \
  --manifest-sha256 "$CUSTOMER_MANIFEST_SHA256" \
  --out "$COPIED_CUSTOMER_PACKET"
~~~

The original request and raw native page files are retained before finalization. Restart uses those exact selected bytes, request ID, source run and query. A completed resume reads the packet. Changed arguments against an existing operation return an explicit selection error.

## Receive the complete packet in Ruby

The initial receiving host needs Ruby 3.1 or later, the installed original Python receiving environment, Node 24, and the complete selected Starforge checkout. The original receiver checks and retains the native SF100 room. Its stdout, stderr, original source modules, page chain and receiving result remain in the same receiving job. Supply the selected environment's absolute Python path, such as **/private/runtime/.venv/bin/python**; the receiver validates its target and invokes that original path so Python can find the environment's **pyvenv.cfg** and installed packages. This follows [Python's original virtual-environment contract](https://peps.python.org/pep-0405/#specification). Saved historical requests retain their original runtime paths.

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" receive \
  --package "$CUSTOMER_PACKET" \
  --manifest-sha256 "$CUSTOMER_MANIFEST_SHA256" \
  --directory "$RECEIVING_JOB" \
  --dataset-id "$CUSTOMER_DATASET_ID" \
  --checkout "$STARFORGE_CHECKOUT" \
  --python "$ORIGINAL_PYTHON" \
  --node "$ORIGINAL_NODE"

ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" status \
  --directory "$RECEIVING_JOB"

ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" resume \
  --directory "$RECEIVING_JOB"
~~~

The receiving job first copies the complete selected source packet into **source/**. It then uses **NativeDatasetReceiving** under **native/** and publishes the complete compound delivery under **received/**. Each phase preserves its original request and exact manifest binding. Use the same job directory to continue an interruption.

A completed compound delivery contains:

| Path | Content |
| --- | --- |
| baserow-delivery.json | Completed Ruby customer manifest and bindings to both complete child packages |
| customer/source.json | Original Baserow selection, field policies and selected published edition |
| customer/attachments.json | Every selected original file and all row/field/index/output-column links |
| customer/attachments/ | Exact retained attachment bytes |
| customer/dataset/ | Original finalized SF100 pages, native manifest and complete JSONL/CSV/review files |
| dataset/ | Original Ruby NativeDatasetDelivery, including its complete receiving record and source files |

Use the outer **baserow-delivery.json** hash to move the complete customer edition:

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" copy \
  --directory "$RECEIVING_JOB" --out "$DELIVERED_CUSTOMER_DIRECTORY"

ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" inspect \
  --delivery "$DELIVERED_CUSTOMER_DIRECTORY" \
  --manifest-sha256 "$RUBY_CUSTOMER_MANIFEST_SHA256"
~~~

The copied directory contains everything needed to reopen the completed source and attachments. Its dataset object opens without the original publisher, source capture, Python process or Node scanner. Original absolute source paths remain historical metadata in the original receiving record.

## Use the same edition in Rails

Require the adapter and open an application-declared completed source:

~~~ruby
require "/installed/customer-source/baserow/customer/baserow_customer"

customer = Starforge::BaserowCustomerDelivery.open(
  directory: configured_delivery_directory,
  expected_manifest_sha256: configured_delivery_manifest_sha256
)

dataset = customer.dataset
source = customer.source
~~~

The dataset is the original **Starforge::NativeDatasetDelivery**, so the existing [Rails importer](../../developer/ruby-client/examples/rails_dataset/README.md) accepts it directly:

~~~ruby
importer = Starforge::RailsDataset.new(
  delivery: customer.dataset,
  scope: current_account.catalog_items,
  stream: retained_stream_for_current_account,
  models: { edition: DatasetEdition, row: DatasetEditionRow, entry: DatasetEntry },
  mapping: reviewed_mapping
)

preview = importer.preview
begin
  preview.write_json(full_preview_json)
  preview.write_csv(full_preview_csv)
  reviewed_preview_sha256 = preview.sha256
ensure
  preview.close
end

receipt = importer.import!(
  operation_key: retained_business_operation_key,
  expected_preview_sha256: reviewed_preview_sha256
)
~~~

Use the actual application model, tenant scope, stream and explicit mapping in place of the example names. Source directories, target classes and tenant identity come from application configuration and authentication. The Rails operator retains a complete **copy_to** snapshot per selected review and uses the actual stream lock and original importer transaction when the selected operation runs.

Keep key mapping stable across editions. Map the declared identity alias to an exact text column, or use explicitly configured original key columns. Review all inserted, updated, unchanged and removed rows before selecting an import. A repeated business operation returns the original committed receipt. A successor complete snapshot of the same logical query can identify removed keys according to the selected retain/archive policy.

The original row JSON and source edition remain in importer history alongside mapped target values. Source values stay available when a target column uses a narrower application representation.

### Field and null policies

The source manifest retains the actual output aliases and every normalized projection setting. The maintained [source declaration](../declaration.mjs) and [value conversion](../values.mjs) define the encodings:

| Encoding | Source value delivered to the dataset |
| --- | --- |
| identity-text | Exact original record ID or row-order value as text |
| number-text | Exact original numeric text for an explicit text column |
| decimal-number | Original source's explicit checked numeric conversion |
| native | Checked native value for the selected declared scalar type |
| json-text | Original complex value serialized into one text cell |
| select-value | Original single-select display value |
| attachments | Complete file metadata in the row, joined to exact retained bytes |

Each source column also retains **nullable** and **empty**. Selecting **empty: "null"** is an explicit source transformation and requires a nullable column. Rails mapping separately selects application type conversion and treatment of source nulls or missing fields. Numeric text can remain text or be mapped to an exact decimal target with explicit precision and scale.

Public Baserow field metadata includes placeholder entity IDs. The customer source uses the real API server and fixed proxy path plus the original public slug for logical identity. A private source uses its original table and optional view IDs. The source also retains native filter values, search, order, selected field IDs, aliases and every encoding/null policy. Original filter values are strings in the maintained declaration.

### Successor edition identity

The customer packet preserves two related identities:

- **source.logicalSourceSha256** binds the stable Baserow selection and projection. Its corresponding source key is **baserow-** followed by that SHA.
- The original SF100 **originalQueryHash** binds the selected dataset fields, filters, ranges and order. The source record separately retains the exact snapshot, source/capture/plan/candidate digests and original request query.

The original NativeDatasetDelivery membership combines the stable source key and native logical query. A new capture or dataset snapshot does not replace that membership merely because its edition hashes changed. The Rails importer binds source membership, target scope and stable key mapping before deriving a successor edition's changes.

Capture metadata preserves the original Baserow **PAGED_TABLE_READ** observation and **atomicSourceSnapshot: false**, including the original opening/closing metadata and full row/page counts. The customer packet retains that observation in its selected edition.

## Read and download the original files

The CLI can stream every original selected dataset row or copy an exact dataset file:

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" rows \
  --delivery "$DELIVERED_CUSTOMER_DIRECTORY" \
  --manifest-sha256 "$RUBY_CUSTOMER_MANIFEST_SHA256"

ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" file \
  --delivery "$DELIVERED_CUSTOMER_DIRECTORY" \
  --manifest-sha256 "$RUBY_CUSTOMER_MANIFEST_SHA256" \
  --file dataset.csv --out "$CUSTOMER_CSV"
~~~

Page the complete file index:

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" attachments \
  --delivery "$DELIVERED_CUSTOMER_DIRECTORY" \
  --manifest-sha256 "$RUBY_CUSTOMER_MANIFEST_SHA256" --offset 0 --limit 100
~~~

The result has **offset**, **total**, **next_offset** and **files**. Each file has its exact **file**, **bytes**, **sha256**, visible **filename**, **mime_type** and all **references**. A reference includes **record_id**, selected output **column**, original source **field**, **index** and its visible name. Pagination selects files; each returned file retains its complete reference list.

Download with the actual selected row and output alias:

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/customer.rb" attachment \
  --delivery "$DELIVERED_CUSTOMER_DIRECTORY" \
  --manifest-sha256 "$RUBY_CUSTOMER_MANIFEST_SHA256" \
  --file "$SELECTED_ATTACHMENT_FILE" \
  --record-id "$SELECTED_ORIGINAL_RECORD_ID" \
  --column "$SELECTED_OUTPUT_ALIAS" \
  --out "$CUSTOMER_FILE"
~~~

In Ruby, the equivalent block receives a verified, unlinked file snapshot:

~~~ruby
customer.attachment(
  file: selected_file,
  record_id: selected_original_record_id,
  column: selected_output_alias
) do |io, metadata|
  while (chunk = io.read(1_048_576))
    customer_output.write(chunk)
  end
end
~~~

The adapter checks the full file bytes and SHA before the block runs. It preserves the returned storage URL, storage filename, declared size, MIME type and every row/field/index link. A source file projected under two aliases has both alias links and one stored byte stream. Visible names remain separate from original storage filenames.

## Export the customer source package

The installed Node front door prepares the complete Ruby customer source:

~~~sh
starforge baserow-source customer client-export --out "$CUSTOMER_SOURCE"

starforge baserow-source customer client-inspect \
  --directory "$CUSTOMER_SOURCE" \
  --manifest-sha256 "$CLIENT_SOURCE_MANIFEST_SHA256"

starforge baserow-source customer client-copy \
  --directory "$CUSTOMER_SOURCE" \
  --manifest-sha256 "$CLIENT_SOURCE_MANIFEST_SHA256" \
  --out "$RECIPIENT_CUSTOMER_SOURCE"
~~~

**client-resume --directory** completes the same interrupted export using its selected source edition. **baserow-ruby-client.json** binds the exact Baserow source files and the maintained original Ruby native client manifest. The package preserves the working **baserow/customer** and **developer/ruby-client** layout. The selected native client includes its complete Rails importer and operator example sources.

Source export and data delivery have separate manifests. Keep both hashes with the operating handoff: one identifies client code, the other identifies selected customer data and files.

## Continue the original source through the complete operator

**lifecycle.rb** takes the completed result of the original [public-catalog journey](../examples/public-catalog.mjs). It reuses that result's retained capture, publisher, reviewed candidate, source version and published snapshot. Run the continuation in the same assigned source operation after the original program has closed its publisher.

The original receiving host supplies its actual Ruby, Rails/Active Record/SQLite, Python receiving environment and Node runtime. The [operator guide](../../developer/ruby-client/examples/rails_dataset/operator/README.md) describes its application dependencies and mounting contract.

~~~sh
ruby "$STARFORGE_CHECKOUT/stellar/scf-starforge-20261009/sf30-seller-sdk/baserow/customer/lifecycle.rb" run \
  --native-run "$ORIGINAL_COMPLETED_BASEROW_RUN" \
  --out "$BASEROW_CUSTOMER_PHASE" \
  --source-ref "$EXACT_CHECKOUT_SHA" \
  --checkout "$STARFORGE_CHECKOUT" \
  --python "$ORIGINAL_PYTHON" \
  --node "$ORIGINAL_NODE" \
  --customer-key "$RETAINED_CUSTOMER_KEY" \
  --dataset-id "$RETAINED_DATASET_ID"
~~~

The optional **--query** is the exact first-page dataset selection. The continuation keeps its generated request UUID in **lifecycle-input.json** before invoking the publisher. Repeating the run with different original inputs returns a selection error. Use the retained directory for ordinary restart:

~~~sh
ruby "$CUSTOMER_SOURCE/baserow/customer/lifecycle.rb" resume \
  --directory "$BASEROW_CUSTOMER_PHASE"

ruby "$CUSTOMER_SOURCE/baserow/customer/lifecycle.rb" status \
  --directory "$BASEROW_CUSTOMER_PHASE"

ruby "$CUSTOMER_SOURCE/baserow/customer/lifecycle.rb" reopen \
  --directory "$BASEROW_CUSTOMER_PHASE"
~~~

The full continuation performs these connected customer operations:

1. Reopen the original completed source result and select its exact published run, candidate digest, capture and snapshot. Follow the selected native dataset's complete page chain and receive its original files.
2. Copy the complete source packet, execute the maintained Python/Node SF100 receiver, and retain its original receiving record in the compound Ruby delivery.
3. Read every selected attachment through the row-and-column-bound Ruby file interface. Compare full received sizes and SHA-256 values, preserving every reference.
4. Export and copy the complete Ruby client, importer and operator source. Copy the whole customer delivery. Temporarily move only this continuation's producer packet, receiving job and source-client directories, then use the copied Ruby command to reopen the independent customer delivery.
5. Load the operator commissioning entry from the verified copied client in a separate Ruby process. The actual application maps all delivered fields, selects the original record identity, retains a complete change preview, commits through the original importer, and exercises its operator and receiving workflow.
6. Copy every declared application file after the original database closes, including the complete database, customer source, mapping, previews, historical receipts and operator result. Publish the copied completion last. Temporarily move the producer application out of its original path and invoke the operator's offline reopen on **delivered-application/**. Require the same complete result and actual current target rows.

### Retained directories and results

| Path in the continuation directory | Purpose |
| --- | --- |
| lifecycle-input.json | Original source result hash, source/run/capture selection, request UUID and exact selected runtime source files |
| customer-packet/ | Complete Node customer packet and original source-page continuation |
| receiving/ | One original Ruby/Python/Node receiving job and its complete native result |
| delivered-customer/ | Independent complete source, dataset, receiving record and original attachments |
| delivered-client/ | Complete copied customer, importer and operator source under its original relative paths |
| application/ | Original configured operator application with its complete source, preview and committed history |
| delivered-application/ | Independent complete application copy, reopened while its producer path is unavailable |
| attempts/ | Each actual subprocess invocation, original arguments, complete stdout and stderr, exit state and byte hashes |
| operator-result.json | Complete original Rails operator commissioning result |
| native-result.json | Completed continuation, original identities, full attachment receiving and client/application result bindings |

**native-result.json** is written after customer receiving, copied-client reopen and the copied operator application's complete reopen succeed. **reopen** uses **delivered-client/**, **delivered-customer/** and **delivered-application/**. Original source paths remain recorded as provenance; the actual database and source are opened from the receiver's complete copied directory.

The source-client hash and compound customer hash remain separate. The original source's complete result stays in its existing native directory; this continuation adds its own receiving and application directories. The application copy streams every full file and retains its original byte count and hash, including outputs larger than the source dataset. An interrupted copy resumes those same files. A saved parking selection restores the original application after cancellation or process restart. The received application carries its original receipt and transport metadata and opens independently when moved.

The callable operator composition is:

~~~ruby
require File.join(
  copied_client_directory,
  "developer/ruby-client/examples/rails_dataset/operator/commission"
)

result = Starforge::DatasetOperator::Commission.run(
  customer_directory: delivered_customer_directory,
  manifest_sha256: compound_customer_manifest_sha256,
  directory: retained_application_directory,
  source_key: customer.manifest.fetch("sourceKey"),
  record_id_column: customer.source.fetch("recordIdColumn")
)

reopened = Starforge::DatasetOperator::Commission.reopen(
  directory: retained_application_directory
)
~~~

This commissioning example uses its own private application. A production Rails application mounts the operator with its existing authenticated account, declared sources, target relation, background job adapter and policy. The operator guide covers those application-owned choices.

## API reference

| API | Result |
| --- | --- |
| prepareBaserowCustomer({publisher,runId,expectedCandidateDigest,expectedSnapshot,customerKey,query,directory,requestId,signal}) | Complete Node packet with manifest hash, source, native dataset and selected attachments |
| readBaserowCustomer(directory,{expectedManifestSha256,signal}) | Validated complete original packet |
| resumeBaserowCustomer(directory,{signal}) | Original operation or completed packet |
| copyBaserowCustomer(directory,destination,{expectedManifestSha256,signal}) | Complete portable Node packet |
| BaserowCustomerPackage.open(directory:,expected_manifest_sha256:) | Verified Node packet in Ruby |
| BaserowCustomerReceiving.new(directory:,customer_package:,dataset_id:,checkout:,python:,node:) | Retained original receiving operation |
| BaserowCustomerReceiving.resume(directory:,cancel:,timeout:) | Continue the same receiving job |
| BaserowCustomerReceiving.received(directory:,expected_manifest_sha256:) | Completed delivery from its original business receipt |
| BaserowCustomerDelivery.open(directory:,expected_manifest_sha256:) | Completed compound delivery from its outer hash |
| customer.copy_to(destination) | Complete copied dataset, source and attachments |
| customer.dataset | Original NativeDatasetDelivery for RailsDataset |
| customer.attachment_page(offset:,limit:) | File metadata and all selected references, paged by file |
| customer.attachment(file:,record_id:,column:) { ... } | Verified original file snapshot and selected link metadata |

### Operating errors and recovery

**BASEROW_CUSTOMER_PUBLISHED_RUN_REQUIRED** selects the actual completed publication. **BASEROW_CUSTOMER_ORIGINAL_RECORD_ID_REQUIRED** asks for the original identity column in the source/query. **BASEROW_CUSTOMER_ORIGINAL_FILE_ENCODING_REQUIRED** asks for retained attachment encoding in a selected file column.

A changed original request, candidate, source file, native page or completed manifest is reported with its corresponding changed-input error. Retain that operation and choose corrected source as a new explicit customer selection. A stopped native receiver resumes under its original job directory, where full attempt stdout/error and source binding remain available.

Current complete packet limits are 4,096 native pages, 2 MiB per original page, one million rows, 64 selected fields, 10,000 retained files and 32 MiB per retained file. The actual publisher/source can impose a smaller selected limit. Choose a smaller original query **limit** when a complete row page exceeds its declared byte budget; preserve selected fields and filters.

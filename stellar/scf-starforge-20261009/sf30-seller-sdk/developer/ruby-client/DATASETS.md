# Complete datasets in Ruby and Rails

The generated Ruby customer package can acquire an entire selected dataset through the installed SF88 buyer, receive the original SF100 files, and import a reviewed edition into a Rails application. The package keeps one application business key, the original native session, every delivered file and the committed application receipt together across restarts.

Use this workflow for a complete table or selected query that spans several source pages. The existing [single-response customer](RUBY.md) remains available for other merchant operations. The [Rails edition importer](examples/rails_dataset/README.md) provides the full application migration, models, job, mapping and commissioning command.

For an already finalized SF100 room, use [direct finalized dataset receiving](NATIVE_DATASETS.md). That source entrypoint retains the original complete room and uses the same `DatasetDelivery` and Rails importer; its standalone customer package and complete portable application receiving are included.

## Customer workflow

1. Deliver the complete seller package from the actual OpenAPI contract.
2. Save the selected GET operation, query, per-page ceiling, whole-acquisition limits and existing host configuration under one business key.
3. Review and run that selection through the original native operator, or attach an existing original acquisition with its exact session digest.
4. Receive every original data file and the source/selection/acquisition records. Reopen and inspect the packet offline.
5. Preview the complete application mapping and revision changes, then apply that exact preview in the Rails application's transaction. A repeated application operation key returns the committed receipt.

Dataset receiving and application import have separate durable receipts. The native buyer owns acquisition and original approvals. The Rails importer consumes the completed local packet.

## Export a complete package

~~~sh
starforge client ruby export --openapi /absolute/seller-openapi.json --out /absolute/customer-package
starforge client ruby status --dir /absolute/customer-package
starforge client ruby copy --dir /absolute/customer-package --out /absolute/recipient-package
~~~

The current package adds 26 Ruby/application files to the original five JavaScript customer files. Its `ruby-client.json` lists their exact relative paths, byte counts and SHA-256 hashes, and binds the original seller export manifest. Nested Rails examples are included in export, inspection, copy and interrupted-copy recovery.

The inspector also accepts existing complete eight-file and twenty-one-file Ruby editions. Those original editions retain their exact files. Export the current complete package to a new destination to add Dataset and Rails edition capabilities; `client.dataset_available?` reports whether those verified companions are present.

Source entry points:

| File | Role |
| --- | --- |
| dataset_delivery.rb | Complete, offline original-file verification and exact row iteration |
| dataset_receiving.rb | Stable business selection, original native Dataset calls and receiving receipt |
| seller-dataset-bridge.mjs | Fixed Dataset actions over the installed original Node/SF88/SF100 implementation |
| dataset_customer.rb | Operator/customer CLI with explicit run and offline receiving commands |
| rails_dataset.rb | Application mapping, complete revision preview and transactional edition import |
| examples/dataset_lifecycle.rb | Continue one actual completed native session through full customer receiving and offline reopen |
| examples/rails_dataset/ | Migration, example models/job, mapping, commissioning command and application guide |

The bridge source is named `dataset-bridge.mjs` in this repository and delivered as `seller-dataset-bridge.mjs`.

## Host and original source selection

Use Linux, Ruby 3.1 or newer, and the existing installed Node 24 SF88 runtime with its paired SF100 delivery source. Ruby uses its standard JSON, BigDecimal, Digest, Tempfile and related libraries. The [Ruby JSON parser](https://docs.ruby-lang.org/en/3.1/JSON/Ext/Parser.html) accepts the decimal class used by the exact receiving reader.

Choose the application's existing operator profile or initialized buyer workspace. The configuration below is a path template; replace each value with its actual retained host path:

~~~json
{
  "schema": "stellar-forge.ruby-customer-settings.v1",
  "runtimeDirectory": "/absolute/scf-starforge-20261009/sf88-operator-buyer-cli",
  "buyerDirectory": "/absolute/private/ruby-buyer",
  "jobsDirectory": "/absolute/private/customer-jobs",
  "workspaceDirectory": "/absolute/private/original-buyer-workspace",
  "node": "/absolute/bin/node",
  "timeout": 420
}
~~~

For profile-based operation, supply `operatorProfile` instead of `workspaceDirectory`. Dataset settings omit `responseFile`: the original Dataset session owns its page-output directory. All other original operator/signing settings remain with the selected host. Relative configuration imports are resolved against their original configuration directory before the Dataset selection is retained.

Inspect the seller's real operation IDs and input schema:

~~~sh
ruby /absolute/customer-package/customer.rb contract --package /absolute/customer-package
~~~

Create `selected-dataset-request.json` with the existing customer request shape: `operationId`, `inputs`, `maxAtomic`, and optional `acceptIndex`/`paymentFlow`. Select the actual dataset GET operation and actual path/query values. `inputs.query` can carry the original dataset's projected fields, equality/range filters, ordering and page limit where that seller enables them. The first request has no cursor. A selected snapshot remains part of that original selection.

`maxAtomic` is the selected per-page atomic ceiling. The separate limits file contains:

| Key | Required/default | Meaning |
| --- | --- | --- |
| maxPages | Required; 1–4096 for a new session | Maximum pages the original acquisition can admit |
| maxTotalAtomic | Required positive decimal string | Whole-acquisition atomic ceiling under the original buyer's admission rules |
| maxRows | Default 1,000,000; range 1–1,000,000 | Maximum selected rows |
| maxPageBytes | Default 1,048,576; range 1024–2,097,152 for a new session | Maximum original page response size |
| expectedSnapshot | Optional original 64-character SHA-256 | Explicit snapshot selection |

Choose the atomic ceiling from the actual operator decision. The original runtime validates its relation to the selected per-page request and applies its existing approval rules. New sessions are checked against the actual paired SF100 exported ceilings before reserving the native entry. Explicit attachment and recovery preserve valid historical definitions, including their original larger ceilings.

The original exporter also applies its combined output/archive limits. A page budget ending before the terminal cursor leaves an acquisition incomplete; the application cannot treat that prefix as a complete delivered edition.

## Prepare, review and explicitly run

Use a persistent business key from the application's source-import record. These example paths and key identify one operator journey; replace them with the selected application's values.

~~~sh
ruby /absolute/customer-package/dataset_customer.rb prepare \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --request /absolute/private/selected-dataset-request.json \
  --limits /absolute/private/dataset-limits.json \
  --key source-import-account-42-edition-2026-10

ruby /absolute/customer-package/dataset_customer.rb review \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --key source-import-account-42-edition-2026-10 \
  --out /absolute/private/dataset-review.json

ruby /absolute/customer-package/dataset_customer.rb run \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --key source-import-account-42-edition-2026-10 \
  --review /absolute/private/dataset-review.json \
  --action-key application-action-0001
~~~

The first command saves the exact customer request, settings, limits and selected source. Later commands can omit `--request` and `--limits` to reopen them. Supplying either again verifies equality with the original saved values.

Run requires the full retained review and a stable caller action key. The adapter saves that action's original call UUID before dispatch. Repeating the same action reopens that original call; changing its review or business selection is rejected. If the process stops with an unavailable reply, recovery observes the same native session. A later explicit continuation uses a fresh native review and a new application action key after the original state is understood.

The original native operator still handles page approval and execution in its retained terminal or scoped browser session. Host environment and initialized workspace routing reach that original implementation. The Ruby process runner forwards cancellation to the child and drains it on close.

Read evolving state and recover with:

~~~sh
ruby /absolute/customer-package/dataset_customer.rb status \
  --package /absolute/customer-package --settings /absolute/private/dataset-settings.json \
  --key source-import-account-42-edition-2026-10

ruby /absolute/customer-package/dataset_customer.rb recover \
  --package /absolute/customer-package --settings /absolute/private/dataset-settings.json \
  --key source-import-account-42-edition-2026-10
~~~

Review/status include the original native state and its source-bound review digest. Recovery never starts a new acquisition. A recovered run result with `outcome: ORIGINAL_STATE_OBSERVED` retains the original error and observed review; the CLI returns exit code 3 so a caller can present that actual state. Input/I/O failures return 2. Successful commands return 0.

## Adopt an existing original acquisition

To continue work already performed by the original native buyer, select its actual private session directory and the SHA-256 of that directory's exact `session.json` bytes:

~~~sh
ruby /absolute/customer-package/dataset_customer.rb prepare \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --request /absolute/private/selected-dataset-request.json \
  --limits /absolute/private/original-session-limits.json \
  --key existing-source-import-account-42 \
  --original-session /absolute/private/original-dataset-session \
  --session-sha256 ORIGINAL_SESSION_JSON_SHA256
~~~

The request must match the original operation's URL, method, payment choice and per-page ceiling; limits and expected snapshot match the original definition. Attachment preserves the native session intent, configuration and workspace. The Ruby business key has its own seed identity, both of which are retained in the delivery. A mismatched original source or definition is rejected before it can be substituted.

Use the exact original acquisition limits in `original-session-limits.json`. The normal native definition validator remains authoritative for historical sessions.

## Receive and deliver every original file

After the original native acquisition reaches COMPLETE:

~~~sh
ruby /absolute/customer-package/dataset_customer.rb receive \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --key source-import-account-42-edition-2026-10 \
  --out /absolute/private/dataset-received-result.json
~~~

The adapter recovers that exact native session, uses its original Dataset delivery exporter, and copies every original delivered file. It retains the source and complete reports before recording their hashes in its receiving plan. A restart continues the same selected files and publishes `dataset-customer.json` last.

The result includes the packet directory, expected manifest SHA-256, original native intent and source/snapshot/row/field identity. Save that expected manifest in the application record or receiving handoff.

The full packet contains:

| File | Retained content |
| --- | --- |
| source.json | Original source/operation binding from the prepared Ruby request |
| selection.json | Original business/session/configuration/limits/snapshot selection |
| acquisition.json | Complete original native acquisition report |
| native-delivery.json | Complete original SF88-to-SF100 delivery report |
| manifest.json | Original SF100 dataset, query, source-page chain and output manifest |
| dataset.jsonl | Every original delivered JSON row |
| dataset.csv | Complete original CSV output |
| review.html | Original complete delivery review |
| semantics.json | Original published semantic dictionary when present |
| dataset-customer.json | Complete customer-file manifest and source/native bindings |

A local receiving plan or copy marker can accompany those files. The completed manifest enumerates the full transferable packet. Native outcome/payment fields remain available in their original reports.

Offline commands need only the original packet or business receipt:

~~~sh
ruby /absolute/customer-package/dataset_customer.rb reopen \
  --jobs-directory /absolute/private/customer-jobs \
  --key source-import-account-42-edition-2026-10 \
  --manifest-sha256 ORIGINAL_DATASET_CUSTOMER_SHA256

ruby /absolute/customer-package/dataset_customer.rb inspect \
  --directory /absolute/private/received-dataset \
  --manifest-sha256 ORIGINAL_DATASET_CUSTOMER_SHA256

ruby /absolute/customer-package/dataset_customer.rb rows \
  --directory /absolute/private/received-dataset \
  --manifest-sha256 ORIGINAL_DATASET_CUSTOMER_SHA256 --offset 0 --limit 20

ruby /absolute/customer-package/dataset_customer.rb copy \
  --directory /absolute/private/received-dataset \
  --manifest-sha256 ORIGINAL_DATASET_CUSTOMER_SHA256 \
  --out /absolute/private/recipient-dataset
~~~

Rows prints the original selected JSON lines. Copy publishes complete source and data files with the same expected manifest. An interrupted copy resumes into the same directory after comparing every existing file. Completed business reopen checks the original request, selected limits, source, native intent and saved packet before returning.

## Ruby receiving API and exact row values

~~~ruby
require_relative "customer-package/dataset_delivery"

delivery = Starforge::DatasetDelivery.open(
  "/absolute/private/received-dataset",
  expected_manifest_sha256: ENV.fetch("DATASET_CUSTOMER_SHA256")
)

delivery.each_record do |record|
  ordinal = record.fetch("ordinal")
  values = record.fetch("values")
  original_json = record.fetch("raw_json")
  original_row_sha256 = record.fetch("sha256")
  # Apply the application's declared mapping to values.
  # Retain original_json and its digest with the accepted edition row.
end
~~~

`fields` is the frozen original ordered array of field names; `row_count` is an Integer. `each_row` yields the values hash. `each_record` adds the zero-based ordinal, exact original UTF-8 JSON line without its newline and that line's SHA-256.

Integer JSON values use arbitrary-precision Ruby Integer. Fractional and exponent values use BigDecimal. Strings, booleans and null remain their native Ruby values. The reader rejects duplicate JSON keys, nonfinite values, undeclared/missing projected fields and a final row count that differs from the original manifest. The full original file is hashed into a private unlinked snapshot before any row is exposed; database callers consume the complete iterator inside their import transaction.

Additional methods include `file_bytes`, `json_file`, `each_chunk`, `descriptor` and `copy_to`, plus the original `source`, `selection`, `acquisition`, `native_delivery`, `native_manifest` and optional `semantics` records. The bounded `file_bytes` default is 8 MiB; use `each_chunk` for a complete large file. The complete packet reader supports original files up to 256 MiB, subject to the original exporter limits.

A framework-independent receiving service uses the existing Buyer:

~~~ruby
require_relative "customer-package/dataset_receiving"

client = Starforge::SellerClient.new("/absolute/customer-package")
buyer = Starforge::Buyer.new(
  client: client,
  runtime_directory: "/absolute/scf-starforge-20261009/sf88-operator-buyer-cli",
  state_directory: "/absolute/private/ruby-buyer",
  workspace_directory: "/absolute/private/original-buyer-workspace"
)

begin
  key = source_import.business_key
  bound = client.load_request(source_import.request_directory)
  service = Starforge::DatasetReceiving.new(
    client: client, buyer: buyer,
    directory: source_import.jobs_directory,
    key: key, bound: bound,
    limits: source_import.dataset_limits
  )
  service.prepare
  # Existing operator code owns review and explicit service.run.
  service.recover
  delivery = service.receive
  # Persist delivery.directory and delivery.manifest_sha256 for application import.
ensure
  buyer.close
end
~~~

When first constructing that saved request, use `DatasetReceiving.dataset_id(key)` as its intent. The service stores jobs in the dedicated `datasets` namespace under the existing jobs root. Each selected action's request UUID is distinct from the stable dataset/business identity.

## Rails edition import

The full Rails product is in [examples/rails_dataset/README.md](examples/rails_dataset/README.md). It provides explicit source-to-target column specifications, target key columns and a tenant-scoped relation. The importer retains the original raw row and its digest with each accepted edition.

The preview reports the full inserted, updated, unchanged and removed membership against the prior accepted edition and selected target state. Applying a preview uses the same connection and one transaction for mapped target changes, edition rows, current source keys and the original application receipt. The default removal behavior retains the target row while recording its absence in the new complete edition; an explicit archive-column policy can change application state.

Complete membership comes from the original terminal-cursor dataset and its exact selected query. The original manifest includes `dataset.originalQueryHash`, `projectedFields`, `filters`, `ranges` and `order`. The query hash excludes changing snapshot/cursor/intent values. `originalQuerySignature` additionally binds the original dataset descriptor and total, so it is edition-specific. The stream also retains the original operation ID and concrete request origin/path, because two datasets in the same merchant contract can have identical projected fields and filters. Keep these original markers distinct when selecting a revision stream.

Application authorization, target schema and tenant/account identity come from the existing Rails application. The provided importer/job consumes a completed packet; the selected native operator session handles acquisition separately.

## Continue the existing native customer journey

The shipped lifecycle program attaches one actual already completed SF88 session. Supply the original seller package, request, settings, session file digest and stable key:

~~~sh
ruby /absolute/customer-package/examples/dataset_lifecycle.rb run \
  --package /absolute/customer-package \
  --settings /absolute/private/dataset-settings.json \
  --request /absolute/private/selected-dataset-request.json \
  --key retained-native-dataset-customer \
  --session /absolute/private/original-dataset-session \
  --session-sha256 ORIGINAL_SESSION_JSON_SHA256 \
  --out /absolute/private/original-dataset-customer-continuation

ruby /absolute/customer-package/examples/dataset_lifecycle.rb reopen \
  --out /absolute/private/original-dataset-customer-continuation
~~~

The run preserves its original input plan, prepares the matching source, recovers the original completed acquisition, receives and iterates every original JSONL row, copies the full customer packet, closes the Buyer and reopens both packet directories offline. It retains `dataset-lifecycle-result.json`, `offline-reopen-result.json` and the complete recipient packet. The Rails commissioning command then consumes that same completed packet in the actual application's existing database environment.

If a process stops, repeat the same command and input paths. Its retained plan and original receiving identities select the existing result. The offline `reopen` form needs only the output directory.

## Maintained implementation references

- [Original Node Dataset API](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/dataset.mjs)
- [Original SF88 Dataset session and recovery](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-session.mjs)
- [Original SF100 complete delivery and query contract](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs)
- [Ruby JSON parser options](https://docs.ruby-lang.org/en/3.1/JSON/Ext/Parser.html)
- [Ruby signal handling](https://docs.ruby-lang.org/en/master/language/signals_rdoc.html)
- [Full Rails mapping and commissioning guide](examples/rails_dataset/README.md)

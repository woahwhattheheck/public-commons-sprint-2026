# Managed dataset editions through the merchant MCP

Use the existing merchant operator to publish an original SF82 dataset package,
start its versioned seller, publish subsequent editions, and restore a retained
snapshot. Source preparation, merchant selection and data selection retain their
original stores and revision checks. The original seller's private dataset
controller owns live queries and changes.

For NDJSON, the [source workspace guide](SOURCE_WORKSPACES.md) covers raw file
intake, explicit mapping, exact numbers, native dataset queries and keyed edition
comparison. The [customer receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/consumer/README.md)
continues the managed release into the original SF88 acquisition, SF100 data room
and restored source workspace.

## Prepare and attach the original package

A source package contains the original SF82 dataset.csv, dataset.json,
seller.json, source.json and binding.json. Its binding selects the private
dataset version-store directory, native query contract and baseline snapshot.
The package can retain additional source files through the original sourceFiles
descriptors. Staging copies and verifies that complete source closure.

Prepare a completed NDJSON merchant for this lifecycle:

~~~sh
starforge dataset-ndjson-merchant release-package \
  --prepared /private/inventory/merchant-first \
  --dataset-directory /private/inventory/versions \
  --out /private/inventory/release-first

starforge merchant-mcp init \
  --dir /private/inventory/operator \
  --dataset-package /private/inventory/release-first \
  --name "Inventory editions" --seller-port 8423
~~~

Create the package's parent with private directory permissions. Preparation
verifies the original merchant, source, mapping and native build, copies the exact
raw source and lineage, and generates the original versioned OpenAPI and customer
SDK. It leaves initialization of the version store to the explicit lifecycle
operation below.

The host configuration registers the package under the source alias initial:

~~~json
{
  "label": "Inventory first edition",
  "datasetPackage": "/private/inventory/release-first",
  "runtime": { "port": 8423 }
}
~~~

Use datasetPackage as the complete source selection. Existing runtime port and
facilitator settings still apply. The original dataset package supplies its
native handler and query contract. Host paths remain in the private configuration;
agent-facing source and release results include the verified public contract,
terms, source identities and a controllerConfigured flag.

Attach later prepared packages as additional named sources and reopen the
merchant MCP configuration. A later edition of the same contract uses the same
original version-store directory. The original dataset controller checks columns,
filters, sort and page contracts before accepting a publication.

## First publication and seller startup

Connect the usual authenticated merchant MCP HTTP endpoint or its existing
stdio entrypoint. Use the original release tools and five dataset tools in this
order:

| Operation | Arguments and returned values |
| --- | --- |
| merchant_sources | Select source: initial. Review the native baseline, contract, retained inputs, routes and terms. |
| merchant_stage | Supply source, a new id, and optional label. Retain the returned release id and digest. |
| merchant_dataset_initialize | Supply releaseId and expectedDigest from that staged release. The original version store opens, validates its contract and closes its lease. |
| merchant_compare | Supply to with the staged release id. Read its generation and route, term and dataset changes. |
| merchant_activate | Supply id, expectedDigest, expectedGeneration from the comparison and a reason. |
| merchant_start | Supply the current selection expectedGeneration and the release expectedDigest. |
| merchant_dataset_status | Supply releaseId. Read the running original current snapshot, revision, retained versions and resources. |
| merchant_dataset_preview | Supply releaseId and a URL query string such as limit=20. Read the original native response. |

The dataset initialization tool can also reopen an existing stopped store and
preserves its selected edition. If that store already has a running original
controller, initialization uses it and returns its state. Normal status and
preview operations use that controller.

An example native preview call is:

~~~json
{
  "releaseId": "inventory-first",
  "query": "limit=20"
}
~~~

The returned response preserves the original status and body. A successful body
has dataset.snapshot, fields, rows and page.nextCursor. Pass the complete original
cursor as a URL-encoded query value on the next preview or seller request.
A snapshot query parameter can select an explicitly retained edition.

## Publish the next edition

Prepare and stage the next source package under another release id. Inspect its
digest and compare it with the currently selected merchant release. Dataset
changes appear in the original release comparison as well as source identities.

Read merchant_dataset_status immediately before changing the dataset. Then call
merchant_dataset_publish with:

~~~json
{
  "releaseId": "inventory-next",
  "expectedDigest": "THE_INSPECTED_NEXT_RELEASE_DIGEST",
  "expectedSnapshot": "THE_CURRENT_NATIVE_DATASET_SNAPSHOT",
  "expectedRevision": 1
}
~~~

Use the actual positive revision returned by the original status. The operation
refreshes from the immutable staged release's dataset configuration and returns
the original current snapshot, revision and retained version state. Publication
must select that release's baseline snapshot.

Existing requests and cursors retain their admitted original edition. New
queries use the newly selected current edition, and an explicit retained
snapshot remains queryable under the native retention policy.

Publishing data uses the running seller's existing route and payment terms.
Apply a changed merchant contract or terms through the original compare,
merchant_activate and merchant_restart operations with their exact release
digest, selection generation and owned instance. The original release lifecycle
retains merchant selection separately from the dataset's current snapshot.

## Restore a retained edition and continue after restart

Call merchant_dataset_activate with releaseId, expectedDigest, the current
expectedSnapshot and expectedRevision, plus snapshot set to a retained original
edition. The live controller applies the same native contract, retention and
reader checks as direct dataset operation.

If another operator has changed the selection, read merchant_dataset_status and
review its actual snapshot and revision before issuing another change. A stale
guard reports DATASET_CURRENT_CHANGED through the original controller.

The original merchant_restart drains the process-owned seller and restarts the
selected merchant release. Its dataset version store preserves the current data
edition and revision. Closing and reopening MCP also preserves that original
selection. Call merchant_dataset_initialize on an existing stopped store when
needed, then start the selected original release normally.

## Customer receiving

Retain the complete source release alongside the customer's original SF88
acquisition or finalized SF100 source data room. The receiving command pins the
reviewed source build and native snapshot, validates the original delivery, and
reconstructs the same source and mapping in the original NDJSON workspace.

~~~sh
starforge dataset-ndjson-customer receive-delivery \
  --delivery /private/customer/data-room \
  --delivery-sha256 REVIEWED_MANIFEST_SHA256 \
  --release /private/customer/release-first \
  --workspace /private/customer/source-workspace \
  --build REVIEWED_SOURCE_BUILD_SHA256 \
  --snapshot REVIEWED_NATIVE_SNAPSHOT_SHA256 \
  --project /private/customer/inventory-project.zip
~~~

Use receive for an existing original SF88 DatasetAcquisition session, or restore
for a source package already delivered to the operator. The full receiving guide
covers all three forms, native queries, the next edition's keyed comparison,
reusing a completed project archive and importing it into another original
workspace.

## Original implementations

- [Dataset MCP operations](dataset-lifecycle.mjs)
- [SF82 dataset packages and launch](../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-dataset.mjs)
- [SF82 managed releases](../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs)
- [SF30 version store](../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/versions.mjs)
- [SF30 private controller](../../stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/service.mjs)
- [NDJSON release preparation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/release.mjs)
- [Complete native operation](../../operations/scf-dataset-lifecycle-native-20261012/README.md)

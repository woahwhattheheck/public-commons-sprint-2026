# NDJSON release and original customer receiving

An NDJSON release carries the complete reviewed source edition through the original
SF82 managed seller lifecycle. Its customer receives the original SF88 dataset,
retains the SF100 data room, and restores the same source and mapping into the
original NDJSON workspace. The generated customer SDK describes the versioned
seller query, including the original optional snapshot selector.

## Prepare the original release package

Start from a completed merchant directory produced by the existing NDJSON
workspace or merchant MCP. Its merchant manifest already binds the raw source,
mapping, original CSV/configuration, lineage, seller and generated customer files.

Choose the private version-store directory that the original SF82 seller will
own. It is a stable host location across releases. Create an existing private
parent for the new package, then prepare it:

~~~sh
starforge dataset-ndjson-merchant release-package \
  --prepared /private/inventory/merchant-first \
  --dataset-directory /private/inventory/versions \
  --out /private/inventory/release-first

starforge dataset-ndjson-merchant release-status \
  --package /private/inventory/release-first
~~~

The preparation copies the reviewed original bytes, adds the original
DATASET_SNAPSHOT_PARAMETER to the existing seller definition, generates the
matching original OpenAPI and customer SDK, and calls prepareDatasetRelease.
An exact existing package is verified and reopened; a different package at the
same destination is reported as a conflict.

The package contains the five original SF82 inputs and ten additional source
members:

| Original location | Purpose |
| --- | --- |
| dataset.csv | Exact original projected CSV bytes. |
| dataset.json | Original dataset configuration with its file set to dataset.csv. |
| seller.json | Original merchant terms and route with the versioned query selector. |
| source.json | Original NDJSON source, mapping, build and snapshot association plus sourceFiles. |
| binding.json | Original version-store directory, dataset contract, baseline snapshot and provenance digest. |
| source/source.ndjson | Complete original raw JSON Lines bytes. |
| source/plan.json | Complete original reviewed mapping bytes. |
| source/ndjson-lineage.json | Complete original native build review. |
| openapi.json | Original generated OpenAPI for this versioned seller contract. |
| customer/ | Six files produced by the existing customer SDK exporter. |

The sourceFiles descriptors use the original SF82 path/bytes/SHA256 contract.
Stage, inspect, copy and reopen therefore preserve the source, mapping, lineage
and customer SDK along with the dataset. A source release is the consumed
artifact; the ordinary six-file source project archive remains available from
the restored workspace.

Preparation is a static operation. The original SF82 release and dataset
controller perform initialization, service startup, snapshot publication and
activation. Use the exact release ID and its current digest through the
maintained merchant operator. The dataset version owner keeps its existing
private process lease.

## Publish later source editions

Use the original retained mapping to build the next NDJSON edition. Review its
keyed comparison in the existing source workspace and prepare its merchant and
release directories. Bind each new package to the same original version-store
directory when the dataset query contract remains the same.

The original live controller publishes the new package using its expected
current snapshot and revision. Existing cursors keep the original retained
snapshot, while new queries can select the new current snapshot. The controller
also owns retention, historical activation, reader lifetime and restart
recovery. Its native contract comparison identifies a changed column, filter,
sort or page contract; such a change uses a separately selected seller contract.

The source build identity and native dataset snapshot identify different things:
the build binds exact raw source and mapping, while the snapshot binds the native
queryable dataset. Customer receiving pins both values.

## Receive an existing original acquisition

Use the existing SF88 acquisition flow with its reviewed seller configuration,
native page limit, snapshot and total atomic amount. For example, application
code initializes and runs the original Python API:

~~~python
from stellar_forge_buyer.datasets import DatasetAcquisition

acquisition = DatasetAcquisition.create(
    checkout=original_checkout,
    session=private_session,
    config=reviewed_buyer_configuration,
    snapshot=reviewed_native_snapshot,
    max_pages=reviewed_page_limit,
    max_total_atomic=reviewed_total_atomic_string,
    max_rows=reviewed_row_limit,
    max_page_bytes=1_048_576,
)
report = acquisition.run()
~~~

The received SF82 source package must be the package associated with the
reviewed source build and acquired dataset snapshot. Pass those two reviewed
identities to the receiving command:

~~~sh
starforge dataset-ndjson-customer receive \
  --checkout /path/to/original/source \
  --session /private/customer/acquisition \
  --delivery /private/customer/data-room \
  --release /private/customer/release-first \
  --workspace /private/customer/source-workspace \
  --build REVIEWED_SOURCE_BUILD_SHA256 \
  --snapshot REVIEWED_NATIVE_SNAPSHOT_SHA256 \
  --project /private/customer/inventory-project.zip \
  --query '{"limit":"20"}'
~~~

The command reopens the existing original DatasetAcquisition and calls its
deliver method. It reads the original data room through the original verified
file readers, checks its finalized snapshot and manifest, checks every delivered
file, and streams the delivered rows. The delivered projection can be a selected
subset; its fields must belong to the reviewed original dataset.

Then it opens or creates the original NDJSON workspace and calls add_source,
save_plan and build with the original lineage as the expected result. The
restored build must reproduce the exact source, mapping, CSV, native
configuration and snapshot. The source workspace retains the full source edition
that accompanied the acquired projection.

The result preserves the original nativeStatus, paymentStatus, session/data-room
association and output identities. Original acquisition recovery and accounting
remain available through that same DatasetAcquisition.

The direct source form is also available:

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/consumer/receive.py receive \
  --session /private/customer/acquisition \
  --delivery /private/customer/data-room \
  --release /private/customer/release-first \
  --workspace /private/customer/source-workspace \
  --build REVIEWED_SOURCE_BUILD_SHA256 \
  --snapshot REVIEWED_NATIVE_SNAPSHOT_SHA256
~~~

The installed launcher selects python3, or SF30_PYTHON. The native dataset
engine uses node, --node, or SF30_XML_NODE. The optional --checkout selects an
existing complete original SF88 source checkout; its Python module path is
checked before use.

## Reopen, compare and export the original project

Repeat the receiving command with the same acquisition, data-room and workspace.
The original delivery validates its retained files, and the workspace reuses its
completed build. A matching existing project archive is imported and checked
through the original project importer.

Receive the next acquisition into the same source workspace and add:

~~~sh
--compare PREVIOUS_SOURCE_BUILD_SHA256 \
--project /private/customer/inventory-next-project.zip
~~~

The original mapping's explicit unique keys define the comparison. The result
contains added, removed, changed and unchanged counts and the original retained
comparison identity. The existing source console provides paginated comparison
rows and the complete changes download.

The project option calls the original workspace exporter. It produces the same
six root files used by the original workspace import command: source.ndjson,
plan.json, data.csv, dataset.json, review.json and manifest.json. The archive can
restore the edition into another original workspace with its existing import
operation.

To reconstruct a source package already handed to an operator, use the restore
command with the same reviewed build and snapshot:

~~~sh
starforge dataset-ndjson-customer restore \
  --release /private/customer/release-first \
  --workspace /private/customer/source-workspace \
  --build REVIEWED_SOURCE_BUILD_SHA256 \
  --snapshot REVIEWED_NATIVE_SNAPSHOT_SHA256 \
  --project /private/customer/inventory-project.zip
~~~

## Use an already open application

An application that already owns the original source workspace can keep that
same process lease:

~~~python
from receive import restore_into

restored = restore_into(
    original_open_ndjson_workspace,
    original_release_directory,
    expected_build=reviewed_build,
    expected_snapshot=reviewed_snapshot,
    query={"limit": "20"},
)
~~~

For an already open original Python acquisition, receive_acquisition performs the
same delivery and source restoration:

~~~python
from receive import receive_acquisition

received = receive_acquisition(
    acquisition,
    data_room_directory,
    release_directory,
    source_workspace_directory,
    expected_build=reviewed_build,
    expected_snapshot=reviewed_snapshot,
    checkout=original_checkout,
    project=original_project_zip,
)
~~~

Keep the original data room, complete source release, restored workspace and
optional project archive together in the customer's private delivery location.
They preserve the original acquisition result and a usable, reproducible source
edition for subsequent queries and comparisons.

## Receive an original source data room

The original SF100 delivery can also retain pages obtained through the existing authenticated dataset controller preview. Select its completed data room and the reviewed SHA256 of its original manifest. The receive-delivery command opens the original SF100 archive, checks its complete native page chain and manifest, and reads the output files with the original SF88 verified file reader. It then restores the same reviewed source build:

~~~sh
starforge dataset-ndjson-customer receive-delivery \
  --delivery /private/customer/source-data-room \
  --delivery-sha256 REVIEWED_ORIGINAL_MANIFEST_SHA256 \
  --release /private/customer/release-first \
  --workspace /private/customer/source-workspace \
  --build REVIEWED_SOURCE_BUILD_SHA256 \
  --snapshot REVIEWED_NATIVE_SNAPSHOT_SHA256
~~~

The result retains the original source page identities and the original data room paymentStatus under sourceDelivery. The acquisition form retains its original SF88 result under acquisition. Both use the same source package, original workspace reconstruction, native query, keyed comparison and original project export.

# Receive an acquired Census release

This consumer completes the original Census publisher → SF88 acquisition →
SF100 delivery → application source workflow. It restores the complete captured
source files, including their public acquisition records, before handing them to
an application. A separate observations query provides typed analytical rows;
the source_files query supplies the lossless handover.

The original SF88 DatasetAcquisition owns requests, page cursors, limits,
interrupted attempts, receipt accounting and finalization. The receiver consumes
its DatasetDelivery.jsonl_rows(), which verifies the saved original export before
yielding typed rows. Receiving and reopening sources use those retained files.

The consumer also uses `sf30-seller-sdk/source_file_delivery.py` from the same checkout for the shared chunk, hash, complete-inventory and atomic-reopen operations. Keep that original helper with the consumer when packaging the SDK.

## Publish and acquire the source projection

Use the Census publisher's reviewed source_files plan and its original buyer
handoff configuration. Select every source_files column and the complete capture.
Retain the source ordering by path and then chunk index. Set the native query page
limit to at most 10: each 49,152-byte payload becomes 65,536 base64 characters, so
ten full chunks and their metadata fit the original 1 MiB page limit.

The capture ID is the SHA256 of the exact acquired
_census/capture-manifest.json bytes. Preserve the reviewed capture ID and native
dataset snapshot separately: the former names the source capture, while the
latter is the original seller dataset version.

Use the original Python acquisition API:

~~~python
from stellar_forge_buyer.datasets import DatasetAcquisition

# Create this session once from the publisher's reviewed original buyer config.
acquisition = DatasetAcquisition.create(
    checkout=source_checkout,
    session=private_session_directory,
    config=reviewed_buyer_config,
    snapshot=reviewed_dataset_snapshot,
    max_pages=reviewed_page_limit,
    max_total_atomic=reviewed_total_atomic_string,
    max_rows=reviewed_row_limit,
    max_page_bytes=1_048_576,
)
report = acquisition.run()

# Keep the returned native status and original per-page accounting.
for view in acquisition.finalize_all(workspace=original_operator_workspace):
    print(view.native)
~~~

The original command example is
sf88-operator-buyer-cli/python/examples/acquire_dataset.py. Its init, status, run,
recover, accounting, finalize, deliver and consume commands operate the same
session. After interruption, reopen DatasetAcquisition with its existing session,
inspect it and use its original recover operation. Native partial states retain
their existing meaning; the receiver never retries an attempted page.

## Restore the delivered source files

The receiver CLI opens an existing acquisition and asks its original deliver
operation to create or reopen the SF100 data room. It then reconstructs the exact
acquired source members. The output parent must be private, and the source
destination must be new or an identical earlier result.

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/census-acs/consumer/receive.py \
  --checkout /path/to/original-source \
  --session /private/acs-2024/acquisition \
  --delivery /private/acs-2024/data-room \
  --sources /private/acs-2024/received-sources \
  --capture-id REVIEWED_CAPTURE_SHA256 \
  --year 2024
~~~

For application code, add this consumer directory and the existing SF88 Python
package to the application's import path:

~~~python
from census_delivery import receive_acquisition

received = receive_acquisition(
    acquisition,
    delivery_directory,
    source_directory,
    expected_capture_id=reviewed_capture_id,
    expected_year=2024,
)
print(received.summary())
original_package = received.native_package_bytes()
~~~

The summary carries the original native dataset status and payment status. It
also names the restored manifest, source directory and original package digest.
Calling the same operation again verifies the retained outputs and returns
reopened=true. It does not acquire the dataset again.

## Lossless source_files contract

Every row contains these original typed fields:

| Fields | Meaning |
| --- | --- |
| release_year, period_start, period_end | Integer identity of this source release and estimate period. |
| capture_id | Lowercase SHA256 of the exact captured manifest bytes. |
| path | Exact relative POSIX member path, including the original archive prefix. |
| file_sha256, file_bytes | Digest and byte length of the complete decoded source file. |
| chunk_index, chunk_count | Zero-based position and total chunks for this file. |
| chunk_sha256, content_base64 | Digest and canonical base64 of the original chunk bytes. |

Chunks contain 49,152 bytes except the last chunk. An empty file has one empty
chunk. Chunks for each file arrive in ascending order; files may be interleaved.
The receiver streams decoded chunks into a private staging directory and verifies
the final size and digest before publishing the source directory.

The manifest uses schema stellar-forge.census-acs-capture.v1. It declares year,
period, tables, geography_ids, files, annotations and provenance. Its files list
contains every source member except the manifest itself. Every declared file
must be delivered, and undeclared files are rejected. This catches a completed
filtered query that omitted entire source files, as well as missing or duplicated
chunks. Unsafe paths, mixed captures, changed member metadata and changed
retained output are rejected with a specific CensusDeliveryError code.

Original public-source-index.json and README files retain their exact bytes.
Archive prefixes remain unchanged. When included, native-source-package.json
retains its original bytes too; its hash is distinct from the capture ID.
Method annotations may name an exact receipt_path in the same files inventory.
CensusSourceDelivery.method_sources() returns those verified original pairs.

The receiver retains no separate acquisition ledger. The final capture directory
contains the declared source members and their acquired manifest. Ordinary
failures remove only the receiver's newly created staging directory. The
original acquisition, pages and SF100 data room remain the reopening source.

## Original Peoria application handover

The optional peoria_assemble.py example calls the existing application's
acs.assemble_bundle. Supply the original private application source directory;
the public SDK carries no private application source or authored study material.

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/census-acs/consumer/peoria_assemble.py \
  --checkout /path/to/original-source \
  --session /private/acs-2024/acquisition \
  --delivery /private/acs-2024/data-room \
  --sources /private/acs-2024/received-sources \
  --capture-id REVIEWED_CAPTURE_SHA256 \
  --year 2024 \
  --peoria-source /path/to/original/peoria-housing \
  --output /private/acs-2024/application-source
~~~

For an existing edition, add --base-bundle and --base-source-directory together.
Each --supplement takes the existing bundle and its original source directory.
Declared original method/receipt pairs are passed automatically; --method-source
adds an explicit additional original pair.

The handover passes native-source-package.json bytes unchanged. The original
assembler validates the native package, retains source files, joins existing
base identities and supplements, interprets source status codes, and computes
the application's declared indicators. Its output remains the original
peoria.data-bundle.v1 plus every declared relative source_files member. Use the
application's existing preview_bundle/import_bundle workflow to review and
select that edition.

The supplied original source packages are:

| Release | Estimate period | Original package bytes | SHA256 |
| --- | --- | ---: | --- |
| 2023 | 2019–2023 | 814,755 | 23115cea68ed5d0e8250b717f8c9789713f9a8b39288b670451eb69fd1cb65e0 |
| 2024 | 2020–2024 | 807,544 | 0d06d7db2d45c0003424515f00e8017a54428194c29d95f41ef8d509b2cff054 |

Each package contains the original 26 tables and 17 selected geographies,
including ten whole Census places. Use separate acquisitions, capture IDs,
source destinations and application editions for the two releases. The native
application's period comparison retains both actual geography vintages and
accounts for the overlapping five-year periods.

Original estimate and margin strings remain in the captured table rows.
Controlled, suppressed and open-interval tokens remain source facts. The
release-specific Jam Values workbooks and their original HTTP records travel as
declared method sources. The application retains its existing interpretation of
those codes and its original statistical methods.

## Source contracts

The receiving API is the existing
sf88-operator-buyer-cli/python/stellar_forge_buyer/datasets.py:
DatasetAcquisition.create/inspect/run/recover/finalize_all/deliver and
DatasetDelivery.jsonl_rows. The seller uses the existing
openSourceDatasetPublisher lifecycle and its retained buyer handoff.

The application example uses the original Peoria acs.assemble_bundle signature:
(base_bundle, base_source_dir, capture_package, output_dir,
supplements=(), method_sources=()). The SDK's consumer only restores delivery
bytes and passes them to that original function.


# Receive BLS sources into the original application

The BLS consumer completes the original publisher, SF88 acquisition and SF100
delivery path by restoring the exact source-file capture. Its Vitality adapter
then uses the existing application's catalogue, normalization and workspace
import APIs.

The same `sf30-seller-sdk/source_file_delivery.py` helper serves Census and BLS.
It owns source-byte reconstruction, chunk digests, complete inventory checking
and atomic publication/reopening. Acquisition, payment, cursor and page recovery
remain in original `DatasetAcquisition` and `DatasetDelivery`.

## Acquire the complete source projection

Select the BLS publisher's complete `source_files` query. Keep all eight
columns and every file, including the captured manifest. Each payload contains
49,152 original bytes and at most 65,536 base64 characters. Use a native page
limit at most ten and the original one-MiB page bound. Source capture identity
and dataset snapshot identity remain separate.

Use the original SF88 API with the publisher's reviewed buyer configuration:

~~~python
from stellar_forge_buyer.datasets import DatasetAcquisition

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
~~~

Reopen this same session to inspect, recover, account for or finalize its
original attempts. `sf88-operator-buyer-cli/python/examples/acquire_dataset.py`
provides those native commands. A completed acquired export is the receiver's
input; its native status and payment status flow through the received summary.

The complete original Vermont LAUS source is 28,709,922 bytes before base64.
Choose the existing host's memory and disk admission for the complete source
capture and original exporter, including retained page files. This is larger
than a small analytical selection; the receiver itself streams source chunks.

## Restore an existing acquisition

The output parent is a private directory. A new destination is published
atomically; a matching earlier destination is verified and reopened.

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/consumer/receive.py \
  --checkout /path/to/original-source \
  --session /private/bls/acquisition \
  --delivery /private/bls/data-room \
  --sources /private/bls/received-sources \
  --capture-id REVIEWED_CAPTURE_SHA256
~~~

For application code, use the existing SF88 Python package and this consumer:

~~~python
from bls_delivery import receive_acquisition

received = receive_acquisition(
    acquisition, delivery_directory, source_directory,
    expected_capture_id=reviewed_capture_id,
)
print(received.summary())
original_source_path = received.source_path(
    received.manifest["source_prefix"] + "data/bls-la-vermont.tsv"
)
~~~

Reopening calls the original delivery and verifies the restored bytes. It keeps
the same original acquisition and dataset pages.

## Captured source-file contract

| Field | Meaning |
| --- | --- |
| `capture_id` | SHA256 of the exact acquired captured-manifest bytes. |
| `path` | Original relative POSIX member path. |
| `file_sha256`, `file_bytes` | Digest and byte length of the complete decoded original file. |
| `chunk_index`, `chunk_count` | Zero-based chunk index and total chunks for that file. |
| `chunk_sha256`, `content_base64` | Digest and canonical base64 of that original byte chunk. |

The reserved manifest is `_bls/capture-manifest.json`, schema
`stellar-forge.bls-labor-capture.v1`. Its `files` list enumerates every member
except itself, with exact path, byte length and SHA256. The projection delivers
the manifest too. This prevents a filtered query from silently omitting a whole
source file.

The manifest preserves `source_prefix`, `selection`, `sources` and
`provenance`. A source record names its role, exact path, receipt path, URL,
retrieval time and available release metadata. Optional `catalog_keys` may name
an explicitly selected set of original receiving entries.

Files may interleave, while each file's chunks must arrive in ascending index
order. A zero-byte file has one empty chunk. Incomplete, duplicated, mixed or
changed chunks fail with a specific `BlsDeliveryError`. Reopening checks the
existing output against the same acquired manifest and every declared file.

## Import into the existing Vitality workspace

Keep the original application and its mapping files in their established
private location. `vitality_import.py` imports that exact local source and calls
its unchanged `source_catalog.load_entry` and `Workspace.import_source`.

For a new workspace, use the existing application's native command:

~~~sh
python /path/to/original-vitality/cli.py \
  --workspace /private/vitality \
  --operator 'Regional analyst' \
  init --name 'Original BLS source editions'
~~~

Then receive and import the explicitly selected original catalogue entries:

~~~sh
python stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/consumer/vitality_import.py \
  --checkout /path/to/original-source \
  --session /private/bls/acquisition \
  --delivery /private/bls/data-room \
  --sources /private/bls/received-sources \
  --capture-id REVIEWED_CAPTURE_SHA256 \
  --vitality-source /path/to/original-vitality \
  --workspace /private/vitality \
  --operator 'Regional analyst' \
  --only laus \
  --only qcew-50005 \
  --only qcew-50009 \
  --only qcew-50019
~~~

The selected original catalogue supplies the mappings and all LAUS area,
series, measure and footnote definitions. Before a workspace import, the
adapter verifies that each selected source, definition and adjacent HTTP
receipt is included in the acquired inventory.

The native loader produces its original envelope, preserving exact decimal
text, raw observations, periods, definitions, flags, attachments and scope.
The native workspace copies and hash-checks source/definition bytes and
computes its own source-edition identity. The wrapper passes that envelope
through unchanged, so the same source and mapping use the existing native
deduplication behavior.

For integration with an already open workspace:

~~~python
from vitality_import import load_original_vitality, import_received

original = load_original_vitality(original_application_directory)
with original.workspace_type(original_workspace_directory) as workspace:
    result = import_received(
        received, original, workspace, actual_operator,
        only=["laus", "qcew-50005", "qcew-50009", "qcew-50019"],
    )
~~~

Call `reopen_received` with the same received capture and workspace path to
open the original database and import the same entries again. The native
result's `reused` flag identifies retained editions. If a later entry fails,
the error retains completed import results and the original failure details;
those successful imports remain in the original workspace.

The full restored capture retains exact receipt bytes and complete source
provenance. The original workspace retains its ordinary source files,
definitions and source metadata. Keep both as the receiving result.

## Source meaning stays with the original adapters

The catalogue's LAUS adapter preserves resident employment, unemployment,
labor force and unemployment-rate definitions; monthly observations and
`M13` annual averages retain separate series identities. The captured
`data/bls-la-footnote.tsv` defines the original coverage flags, including
2025's `G` eleven-month average.

The QCEW adapters preserve workplace-based measures, original monthly and
quarterly periods, and disclosure fields. Their complete original rows remain
available for the original application to interpret. The public source
publisher also exposes separate typed analytical projections; the lossless
receiving path hands the original files to the application's existing
normalization code.


# Matomo authoring workspace receiving

The Matomo product includes the original report source, typed editions, comparison
and review tools, SQLite merchant workbench, SF82 releases, dataset publication,
SF100/source-file customer, Apps and merchant MCP interfaces. The **matomo-product**
command adds complete authoring-workspace archives and independently editable
receiving. The existing **matomo-customer** command continues to receive the
original dataset/source-file handover.

## Export and receive

Close the original Matomo model/browser and any separately opened child publisher
or release console. Export takes the same Linux publisher.lock leases as those
original owners. An open workspace returns MATOMO_PRODUCT_WORKSPACE_OPEN. Export
does not stop another operator or infer that an unknown effect failed.

Use private canonical directories on Linux, the original Node runtime, util-linux
flock, and Python 3.11 or later. The transfer helper uses only the standard library
and the maintained source_bundle_archive.py. Create the private handover parent
before exporting.

    starforge matomo-product export \
      --workspace /private/matomo-original \
      --archive /private/handover/matomo-original.zip \
      --operation-id matomo-original-export-01

    starforge matomo-product inspect \
      --archive /private/handover/matomo-original.zip

    starforge matomo-product receive \
      --archive /private/handover/matomo-original.zip \
      --directory /private/matomo-received \
      --operation-id matomo-receiving-01

    starforge matomo-product serve \
      --workspace /private/matomo-received/workspace

The export destination is outside the original workspace. An existing export name
is reused only for the exact operation and unchanged inventory. Retain the ZIP and
its adjacent export metadata. Use a new operation and archive name after changing
the original workspace.

Receiving returns directory (CONTAINER/workspace), a new workspaceId,
originalWorkspaceId, exact archive SHA/bytes, sourceSha256, sourceCounts and
revision/currentRevision. Reuse the same archive, container and operation ID after
interruption. The request binds them before import. Original table import is one
SQLite transaction with a retained native marker. A partially received workspace
cannot be opened normally until its original receiving command completes.

For a permitted original loopback source, select --allow-loopback explicitly.
Authentication remains environment references in the saved source. The receiving
host supplies permitted values through original host configuration when a future
source read is deliberately requested. Export, inspect and receiving make no
provider request.

## Exact custody and editable state

The full original ZIP is retained inside the new workspace at
received/ARCHIVE_SHA/source.zip. Verified original files, including the original
settings, committed SQLite database, responses, drafts/packages, release history
and delivery records, are extracted under the adjacent original directory.
The existing streaming archive engine checks member CRC, byte count and SHA-256.
Private source file modes are retained. Symlinks, special files, hardlinks, active
SQLite sidecars and incomplete file stages are not silently archived.

The new native store receives exact source tables for requests/attempts, catalogs,
captures, report tables/rows, editions, comparisons and their reviews. Source IDs,
numeric JSON lexemes, null versus absence, hierarchy, selectors, page provenance
and immutable edition databases remain unchanged. The full selected source
population is copied; rows are neither generated nor silently discarded.

The receiving workspace starts its own action and merchant history. Original
actions, packages, releases, payments, handovers and receiving records remain
byte-exact in the original archive. They are inspectable in **Workspace receiving**
and the paged original-record interfaces. Old absolute paths are not rewritten to
disguise their provenance or activated on the receiving host.

### Adopt an original saved merchant draft

In **Workspace receiving**, choose original records **merchants**, inspect the
configuration and complete draft, then choose **Adopt this draft into a new local
merchant**. The same original SQLite compiler validates its exact merchant,
queries, inputs, columns and payment terms against the local edition database.
The new merchant retains a source link to the original workspace, merchant ID,
archive hash and draft-file hash, and has a new native operation/merchant identity.

The existing merchant screen then supports editing, preview, package export,
release review and delivery preparation. Those remain explicit operations.
An incompatible original draft remains inspectable; use the normal merchant
authoring workflow for a deliberate correction. Receiving does not change its fee,
recipient or terms.

The native adopt-original-merchant input is expectedRevision, a stable new
operationId and originalMerchantId. Inspect the original action after a lost
response. Merchant initialization retains the exact initial draft, so recovery
preserves its custom query edits.

## Read, reopen and export original records

    starforge matomo-product state \
      --workspace /private/matomo-received/workspace

    starforge matomo-product origin \
      --workspace /private/matomo-received/workspace \
      --table history --offset 0 --limit 25

The original browser adds **Workspace receiving** in the same application. It
shows both workspace identities, archive and manifest hashes, original revision,
source counts, paged history and original files. Downloads stream the exact ZIP,
manifest or selected member. All retained source data remains private.

| Authenticated route | Native result |
|---|---|
| GET /api/state | Existing state plus receivedSource summary or null |
| GET /api/original?table=history&offset=0&limit=25 | Exact original records, total and offset |
| GET /api/original/files?offset=0&limit=25 | Manifest entries and opaque file IDs |
| GET /api/original/merchant?id=ID | Saved configuration/draft and provenance |
| POST /api/operation/adopt-original-merchant | Existing native action/result protocol |
| GET /files/workspace-archive?id=original | Exact original ZIP |
| GET /files/workspace-origin?id=original | Exact original manifest |
| GET /files/workspace-original?id=OPAQUE_FILE_ID | Exact inventory-selected file |

The source-owned MCP declaration adds merchant_matomo_original_records,
merchant_matomo_original_files, merchant_matomo_original_merchant and
merchant_matomo_merchant_adopt_original. Existing status and artifact-read tools
use the same model and retained file reader. The typed client obtains metadata
from that declaration; no shared registry or payment controller is added.

For original member downloads use artifact workspace-original and the returned
opaque ID. The original remote immutable-file reader retains its 8 GiB ceiling.
Larger whole-workspace archives use the browser/local streaming route. Runtime
Apps can select the actual received directory as **Matomo reports and delivery**.
The merchant MCP connection uses that same new path and native launch identity.

## Limits and disk use

Each original file is at most 8 GiB. The full expanded archive, including manifest,
is at most 16 GiB and 20,000 ZIP members. The original archive engine permits
16 MiB of ZIP overhead beyond the expanded ceiling. Sources are streamed, without
whole-file JSON, base64 or browser ArrayBuffer allocation.

Receiving retains the original ZIP, verified original workspace and editable
copies of source files. Provision their combined actual sizes and the native
SQLite import. Matching retained files are reverified and reused on continuation.
No automatic cleanup deletes the operator's archive or original records.

The snapshot is retained application state, not a grant of data rights or proof
of payment. Original native statuses and selected Matomo archive limitations
remain visible. Receiving cannot create raw-event detail that Matomo does not
retain.

## Native source API

The maintained workspace-transfer.mjs module and its paired declaration export
exportMatomoProduct, inspectMatomoProduct and receiveMatomoProduct. Installed
subpaths are ./seller/matomo/product and ./customer/matomo/product.

    import {receiveMatomoProduct} from './workspace-transfer.mjs';

    const receipt = await receiveMatomoProduct({
      archive: '/private/handover/matomo-original.zip',
      directory: '/private/matomo-received',
      operationId: 'matomo-receiving-01',
      python: '/path/to/original/python'
    });
    console.log(receipt.directory, receipt.workspaceId, receipt.originalWorkspaceId);

Byte counts are exact decimal strings. An AbortSignal stops and drains the owned
native helper while preserving same-operation receiving state. Reopen uses
original workspace leases and receiving markers; no prior provider, seller or
payment operation is replayed.

### Complete receiving and later export budget

`inspect` reports `receivingBudget` before receiving creates a directory. The calculation includes the retained original ZIP, all extracted original files, the original manifest and the independent source copies needed for editing. It reports exact decimal byte strings and the minimum member count. A retained ZIP is itself one file in the next full workspace export.

Receiving rejects an archive before creating a workspace if this minimum already exceeds the 16 GiB expanded or 20,000-member export policy, or if the retained ZIP exceeds the 8 GiB per-file export limit. The input archive remains available for inspection and its original customer/source-file receiving path. This means the maximum acceptable editable intake depends on its actual complete custody footprint; an archive being valid alone does not establish that an additional complete editable copy fits.

The reported remaining bytes exclude the new workspace database, recovery metadata, archive-engine files and later edits. Final export measures every actual file again. Keep enough space and export budget for those additions. The same checks apply when passing an edited workspace to another operator, including all earlier retained history.

## Reopening a receiving created by the earlier directory layout

The receiver creates every new intermediate source/archive directory as private (mode `0700`). It also reconciles selected directories beneath the original owned extraction root after validating the same archive, manifest and receiving request. It does not change ancestors outside that root.

If an earlier completed receiving opens but reports `PRIVATE_DIRECTORY_REQUIRED` when reading archived files, repeat its exact `matomo-product receive` command with the same archive, destination and operation ID. The original receiver verifies and reuses the existing bytes, corrects only its owned directory layout, and returns the same workspace ID. Source rows, captured responses, the first receiving receipt, and original commercial history remain unchanged. Then continue original-file review or full re-export in that same workspace.

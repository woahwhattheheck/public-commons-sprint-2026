# Complete IATI publisher receiving and customer delivery

The complete entrypoint runs the IATI product from a committed source selection
through an installed runtime, actual publisher data, native editions, named
operator review, customer receiving and a portable customer archive.

Run the same input file under the existing admitted native foreground:

~~~sh
/absolute/existing/node \
  /absolute/bootstrap/stellar/scf-starforge-20261009/sf30-seller-sdk/iati/receiving/complete.mjs \
  /absolute/iati-input.json
~~~

The foreground owns process lifetime and resource admission. The entrypoint
uses the original source builder, runtime installer, Applications controller,
IATI workspace, Dataset engine and source MCP adapter. The code can also be
called as runCompleteIatiReceiving(input, { onProgress }).

## Select the original input

This is a configuration template. Replace every selected path, commit and
publisher identity with the actual source and existing runtime on the worker.

~~~json
{
  "schema": "stellar-forge.iati-complete-receiving.v1",
  "operationId": "IATI-PUBLISHER-7108-20261012",
  "sourceRoot": "/work/iati/bootstrap",
  "repository": "/work/iati/source-cache/repository.git",
  "sourceCommit": "FULL_40_CHARACTER_COMMITTED_SOURCE",
  "directory": "/work/iati/workspace",
  "outputDirectory": "/work/iati/receiving",
  "publisher": {
    "path": "/work/iati/publisher/publisher.xml",
    "bytes": 1,
    "sha256": "FULL_SHA256_OF_THE_ACTUAL_ORIGINAL_FILE",
    "url": "https://publisher.example/actual-original.xml",
    "fetchedAt": "ACTUAL_TIME_WITH_TIMEZONE",
    "label": "Original publisher and edition"
  },
  "publisherNotice": "Complete source citation, license link and retained notices.",
  "actor": {
    "id": "original-operator-id",
    "label": "Named receiving operator"
  },
  "pythonExecutable": "/absolute/existing/python3",
  "npmExecutable": "/absolute/existing/npm",
  "chromiumExecutable": "/absolute/existing/chromium",
  "playwrightModule": "/absolute/existing/playwright/index.mjs",
  "sourceOffline": true,
  "dependencyOffline": true
}
~~~

Use Node 22.16 or newer, Python 3.11 or newer and the existing Chromium/Playwright
installation. Resolve the executable and Playwright module paths on that worker.
Put the selected Node directory first in the original foreground's PATH so the
original npm subprocess uses the same Node. The operator profile has zero npm
dependencies.

The bootstrap directory contains the complete receiving source and the original
distribution bootstrap described in [RUNTIME.md](RUNTIME.md). Its Git cache must
contain the selected committed source. The optional sourceReceiving object
uses the same [original source-object receiving contract](RUNTIME.md#receive-existing-git-source-or-archive-donors).
Existing donor repositories, unpacked original sources and archives remain
selected inputs. sourceOffline:false permits the original Git reader to obtain
missing objects from its existing promisor remote.

The source workspace, bootstrap, source cache and receiving output are separate
real directories. Keep the acquired publisher file outside the workspace and
receiving output. The workflow retains its input and checks the exact bytes,
SHA256, original URL and acquisition time. The publication date belongs in the
source label and notice; it is separate from the time the original file was
acquired.

## Retain original publisher metadata

The optional `publisherFiles` array selects complete public metadata, attribution
and source-provenance files to travel with the publisher. Each entry has the
exact fields `path`, `name`, `bytes` and `sha256`. Paths are absolute original
sources outside the workspace and output; names are distinct plain filenames
ending in `.json`, `.md` or `.txt`. Each file is read against its selected byte
identity before installation and again before customer packaging. The complete
input freezes the selection, and the final result retains every file identity.

The customer ZIP places these files under `publisher/metadata/` and links them
from its entry guide. Use the actual complete official metadata, together with
the XML citation and acquisition provenance. Keep local connection and operation
state in the owning receiving output.

~~~json
{
  "publisherFiles": [
    {
      "path": "/absolute/original/metadata.json",
      "name": "metadata.json",
      "bytes": 1,
      "sha256": "FULL_SHA256_OF_THE_ACTUAL_ORIGINAL_METADATA"
    }
  ]
}
~~~

The example shows the optional field's shape; replace it with the actual
complete source selection. Up to 32 metadata documents, each up to 64 MiB, are
accepted. Previously saved inputs without this field retain their original
input and recovery behavior.

## Included actual public publishers

### Transparency International

The source contains the complete original public XML and official metadata in
`iati/examples/transparency-international-2026/`. The XML is 131,359 bytes with
SHA256 `5b31447719873d89c511a11b8da645d398b5ab7fb3c471d35c359f30118a429d`.
It was acquired at `2026-10-12T09:48:08Z` and declares generation time
`2026-04-02T00:25:53+00:00`. The unchanged 337-byte official metadata identifies
`cc-by`. The adjacent README and source provenance preserve the complete
attribution, original URLs, acquisition and exact file identities.

Select all three metadata documents—original metadata JSON, README.md and
source-provenance.json—through `publisherFiles`. Use the full README as
`publisherNotice`. The actual native parser supplies the budget, activity and
review results used by the full operator workflow.

### AidData Nigeria AIMS

The complete selected source contains the unchanged AidData IATI 2.03 XML at
`iati/examples/aiddata-nigeria-2016/iati_2.03_NigeriaAIMS_GeocodedResearchRelease.xml`.
Its adjacent source notice and metadata retain the exact original byte identity,
2016 XML generation date, release citation and ODC-By license. See
[AIDDATA_NIGERIA.md](AIDDATA_NIGERIA.md). Use the actual acquisition time for the
copy present on the worker and the original immutable publisher URL.

This full publisher is 309,331 bytes with SHA256
`4eddc914f4e5a60ca869f3d52046cb55fc7bb44cabb829d78b2f510fbff4ca9e`.
The runtime source selection includes the full original file, so a worker can
run the complete operation from its selected source without another publisher
download. The IATI parser supplies actual activity, financial and review counts.
The customer selection carries both complete attribution files whenever this
exact original publisher identity is selected.

## What the whole run completes

1. **Original installation.** Build the committed iati-operator distribution,
   retain the full source manifest and archive, prepare or recover its original
   runtime installation, and require both original installation inspections to
   report READY. Verify that the installed complete receiving modules match the
   selected bootstrap.
2. **Full publisher work.** Retain the actual original XML, profile its complete
   contents, build native activity, transaction and budget editions, and query
   every row through the original native cursor. Reconcile exact reported
   financial groups and associations against the saved portfolio report.
3. **Retained analyst decisions.** Save four revisions: the original complete
   cohort, a named review, a selection from actual activity IDs, and the restored
   full cohort. Keep all native comparisons. Replay the first save to its
   original revision while later history remains current. Export the complete
   report, complete portable portfolio and all three original merchant datasets.
4. **Installed operator.** Close the core workspace and open that same source
   through a saved, adopted Applications entry. Use its verified Open link in
   the actual browser, save the next named review, reopen it, query native data,
   inspect comparisons and download the complete report and portfolio.
5. **MCP and independent receiving.** Operate the original authenticated source
   MCP interface, close a retained full-file read after a saved range and resume
   the same archive. Stop the original source Application. Repeat original CLI
   export/review, reconstruct the complete portable history in one separate
   recipient workspace, repeat receiving through MCP/browser/CLI, and Stop and
   reopen the received Application. Both Applications finish Stop.
6. **Customer delivery.** Package the original runtime archive, the final reviewed
   portable portfolio and report, complete merchant CSV/configuration/lineage
   files, the original publisher and its notice, and the full relevant guides.
   The customer ZIP is verified before its final name is published.

The declared currencies, values, reporting organisations, hierarchy, transaction
types, budget types/status/periods and value dates retain their separate
financial dimensions. Money remains decimal text. Invalid financial records
retain their source findings and remain outside eligible totals. A data review
and an operator receiving review are separate retained revisions.

## Recovery uses the same operation

Run the same entrypoint with the same original input to continue an interrupted
operation. Each stage uses its original private records and APIs.

- Source acquisition continues the original Git cache and missing-object list.
- Runtime preparation continues the original build and installation attempts.
- The publisher's original request IDs replay their original revisions.
  Incomplete dataset outputs remain private until a full native export verifies;
  report files are published from fully synced staged bytes.
- A completed publisher checkpoint is reused before operator continuation.
  An operator's later named revision therefore remains intact.
- Applications are reconciled through their original controller. Complete file
  reads resume their saved range against the retained archive identity.
- Customer packaging reuses the same completed destination after full content
  verification. The final result is written after operator cleanup and customer
  archive completion.

Retain the existing output and original native foreground record when handling
an interruption. A changed source commit, publisher, directory or named actor
is a changed input and belongs to an explicitly selected separate operation.

For the two included publishers, call the same complete entrypoint sequentially
with two explicit original inputs in the existing admitted foreground. Each has
its own operation ID, workspace, output and customer archive. Reuse the exact
committed bootstrap and original source cache. The first call completes its
installed Applications, customer handover and result before the second call
starts. Both outputs retain their full review histories and original source
metadata. This uses the existing foreground's process and resource ownership.

## Complete outputs

The top-level result.json contains the complete source selection, runtime,
publisher, operator, customer archive and per-file identities. The primary
customer file is:

~~~text
receiving/handover/IATI_Customer_Handover.zip
~~~

[HANDOVER.md](HANDOVER.md) describes its full contents and the independent
customer opening workflow. The final portfolio/report comes from the installed
operator's named review. The publisher stage also retains the earlier complete
revision, all exact native financial reconciliation and all original merchant
dataset directories.

Private live connection files, process records and browser screenshots stay in
the owning receiving output. The customer archive contains its curated public
source, data, runtime and guides. Full desktop/mobile views remain available to
the operator for visual review of the actual source and received Applications.

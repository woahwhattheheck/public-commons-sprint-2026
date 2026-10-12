# Receive the original approved Central periods into PostgreSQL

This programme carries a completed Central commissioning delivery through the
installed PostgreSQL receiver and into a separately restored Central workspace.
It preserves the same Store, approved exports, saved mapping reviews and
PostgreSQL request IDs.

Start with the original completed delivery and the receiving host's existing
PostgreSQL profile. The programme opens one authenticated Central listener,
receives every selected dataset and complete period report, closes it, restores
the full original archive, and opens that restored workspace against the same
warehouse. Its result retains the source identities, immutable editions,
complete downloads and actual listener closure.

Implementation: [receiving.mjs](receiving.mjs).
Product and browser controls: [README.md](README.md).

## Existing host and installation

Run on the host already carrying the Central operation. Preserve its provider
project, original captures, approved reviews, saved commission and delivery.

The released-source commissioner emits:

~~~text
<work-directory>/receiving/commissioning/warehouse-selections.json
~~~

Its schema is **stellar-forge.central-native-warehouse-selection.v1**. It
contains the exact source workspace, commission and delivery IDs, both accepted
captures/reviews, complete dataset files and receipts, period labels and the
original 32-character approval, review, import and report request IDs.

Install the complete original Python package on that same host:

~~~sh
python -m pip install './stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[postgres]'
~~~

The maintained extra supplies psycopg[binary]==3.3.6. The original installed
command is stellar-forge-postgres; the bridge invokes the selected Python
executable through -m stellar_forge_buyer.postgres_cli. The source installation
must include the Central intake, stable review recovery and period report
implementation from merge f3e06fde911ca7351a2f81d0218d9bc59559920b or a complete
successor.

The receiving host supplies its PostgreSQL server and normal connection
environment. Reopen the existing operator directory, schema and warehouse UUID.
The maintained runtime guide describes both the native server and original
development runtime:

[PostgreSQL runtimes](../../../sf88-operator-buyer-cli/runtime/postgres/README.md)

### Private host profile

Use the existing private profile file selected by the managed Central app.
Its schema is **stellar-forge.central-warehouse-profiles.v1**, with an array
named profiles. A direct profile array is also accepted.

| Field | Original host value |
| --- | --- |
| id | Stable local profile ID |
| name | Operator-facing name |
| workspace | Canonical private PostgreSQL operator directory |
| connectionEnv | Name of the existing connection environment variable |
| schema | Original PostgreSQL receiving schema |
| expectedWarehouse | Actual existing warehouse UUID |
| python | Existing installed Python executable |
| timeoutSeconds | Original per-command limit |

Use [profiles.example.json](profiles.example.json) for the complete declaration.
Replace its placeholders with the host's observed configuration. Keep the
profile file owner-readable/writable only; the connection value stays in the
existing host environment.

The connect action calls the original Python status command. Its actual
warehouse UUID and schema must match the selected profile and Store binding
on every reopen.

## Continue the emitted native selection

Provide the existing profile and agreed reviewer/mapping note. The original
workspace, receiving output and independently restored workspace must use
three distinct canonical private directories, without symlinked parents.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/warehouse/receiving.mjs \
  --request /srv/central-cb57/receiving/commissioning/warehouse-selections.json \
  --profiles /srv/private/central/warehouse-profiles.json \
  --profile approved-periods \
  --reviewer "Original receiving operator" \
  --note "Receive the complete approved native columns with their original row keys." \
  --output /srv/central-cb57/warehouse-receiving \
  --restore-directory /srv/central-cb57/warehouse-reopened
~~~

These paths illustrate the command structure. Use the actual host directories.
For a native selection, the original directory comes from its sourceWorkspace.
An explicit --directory must name that exact canonical path.

The current released selection contains one simple-form dataset in each
period. The commissioner derived both scopes from actual retained
__system.submissionDate values. The original counts are two rows and one row;
the approved fields are __id, name, age and __system/submissionDate. Their
native CSV includes each field's explicit value/null/missing state. The
commissioner retains its original source reports: first-cohort mean age 32 and
sum 64, second-cohort mean 38 and sum 38. The original full five-root capture
remains with that same source operation.

The programme compares the complete emitted dataset/receipt arrays to the
same Store delivery, the exact accepted capture/review selections, original
period labels and complete commissioning definition. It uses the supplied
approval, review, import and report IDs in their original dataset order.
Connection and inspection IDs are stable derivatives of that same operation.

The provider fixture and commissioning actions remain with their original
host programme. This receiver starts from its complete approved delivery.

## Another complete commissioning delivery

For a delivery containing multiple approved root or repeat tables, use the
general receiving request. Every selected table needs an original dataset in
period 0 and period 1. The programme receives all datasets listed by the
delivery and produces a complete comparison per original project/form/table.

~~~json
{
  "schema": "stellar-forge.central-approved-period-receiving.v1",
  "operationId": "ORIGINAL-CUSTOMER-PERIOD-RECEIVING",
  "workspaceId": "ORIGINAL-WORKSPACE-ID",
  "deliveryId": "ORIGINAL-COMPLETE-DELIVERY-ID",
  "profileId": "approved-periods",
  "reviewer": "Original receiving operator",
  "note": "Receive all approved value/state columns with their original row keys.",
  "mappingPolicy": "native-inspected-scalars-with-original-keys",
  "commissioningDefinitionSha256": "ORIGINAL-64-CHARACTER-DEFINITION-SHA256",
  "expectedTables": [
    {
      "projectId": "ORIGINAL-PROJECT-ID",
      "formId": "ORIGINAL-FORM-ID",
      "table": "ORIGINAL-TABLE-NAME",
      "previousRows": 2,
      "currentRows": 1
    }
  ]
}
~~~

Use actual native identities and the complete definition digest.
The optional expectedTables list must cover every selected table when present,
with its exact full row counts. Repeat tables use their actual table names.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/warehouse/receiving.mjs \
  --request /srv/private/customer/approved-period-receiving.json \
  --directory /srv/private/customer/original-central \
  --profiles /srv/private/customer/warehouse-profiles.json \
  --output /srv/private/customer/warehouse-receiving \
  --restore-directory /srv/private/customer/warehouse-reopened
~~~

This general request contains its profile, reviewer and note. Its command uses
--directory and does not add the native-selection --profile, --reviewer or
--note arguments.

### Mapping policy

The native-inspected-scalars-with-original-keys policy accepts the existing
Python inspector's complete suggested mapping. That inspection reads every
approved CSV row. The receiver requires a SQL mapping for every declared value
and state column and preserves the original source keys in exact order.

Use this policy for the original native receiving or a customer-approved
initial mapping. For different SQL column names/types, use the original
mapping review controls and saved action IDs in [README.md](README.md).
A different mapping is a separately reviewed intent.

Every repeat retains its own keys and the approved parent field, with the
original relationship metadata. Complete source pages, XML, media and
rows.jsonl remain with the private capture. PostgreSQL receives the approved
dataset.csv projection and its original field dictionary.

## Complete operation

The full request is retained before the first action. For each original
dataset, the receiver:

1. Prepares its accepted-export approval through the same Store and verifies
   the exact commissioning definition.
2. Inspects the full approved CSV through the original Python Central intake.
3. Saves the full mapping review, reviewer, note and stable request ID.
4. Imports that review through the original operation journal and retains the
   committed immutable edition ID.
5. Receives the full approval JSON, CSV, source descriptor, semantics and table
   schema through the authenticated application's download-ticket API.

For each matching table, it creates the complete period report. Original
version IDs and previous/current row counts must match. The added, removed,
changed and unchanged totals must account for every row in both periods.

The report ZIP is the original Python artifact: complete original and typed
data for both editions, all changed rows, dictionaries, manifests, mappings,
comparison SQL, machine-readable report, HTML, guide and manifest. The
application retains and serves that complete artifact through its Store.

Next, the programme uses workspace.backup to create the original Central
archive, receives all its bytes and SHA-256, closes the original listener,
then uses restoreCentralArchive to restore it to the separate recipient
directory.

On the restored workspace it:

1. Reopens the same PostgreSQL profile, warehouse UUID and schema.
2. Verifies every original approval and saved operation from the archive,
   preserving later native receiving records alongside them.
3. Reinspects each full CSV from the restored source directory and requires the
   original row count and full mapping.
4. Reopens every import request and its original immutable edition.
5. Receives each complete period report again with the original bytes/hash.
6. Closes the restored listener and saves the complete result.

The restored inspection explicitly resolves the new Central source directory.
It preserves the original acquisition, review and approved source identities.

## Full outputs

All output paths are inside the selected private receiving directory.

| Path | Complete retained content |
| --- | --- |
| operation.json | Original request, profile references, definition, current action, completed calls and stages |
| requests/ | Exact action bodies retained before dispatch |
| responses/ | Complete approval and warehouse-operation records |
| downloads/dataset-<approval-id>/ | Approval, full CSV, source, semantics and table schema |
| downloads/reports/<request-id>.zip | Original full period report |
| central-workspace.tar.gz | Full private Central archive received through the app |
| original-warehouse-state.json | Original approvals and operations before backup |
| received-reports/<request-id>.zip | Full report received again after restore |
| received-warehouse-state.json | Saved state after relocation and warehouse reopen |
| result.json | Dataset/edition/report identities, archive, receiving observations and full file hashes |

Every file receipt is checked against its full byte count and SHA-256.
Downloads stream to a private temporary file, sync the bytes and publish the
final path without replacing an existing file. Active cleanup removes an
incomplete temporary file. A completed file is reused only after its full
bytes match the original native receipt.

The final result records listenersClosed:true after both listeners close.
A repeated completed invocation verifies all recorded files before returning
that original result.

## Resume the same operation

Repeat the exact command after response, process or storage interruption.
Preserve operation.json, the native selection, original directories, profile
and request IDs.

Each immutable action body is retained before HTTP dispatch. The product saves
its matching action before launching Python. Repeating an interrupted action
uses the original ID and intent; the product then recovers its retained output
or resumes that same Python review/import/report request.

Completed files are verified and reused. Saved snapshots preserve their
original approval and operation rows while later receiving records can
advance the workspace revision.

The original archive restorer retains receivedArchive in the workspace's own
SQLite metadata. Restoring that same archive again reopens the original
receiving and preserves subsequent native work. The original interface rejects
a different archive identity for that recipient.

SIGTERM, SIGINT and SIGHUP stop the command at its next retained stage. It
closes the actual listener, native queue and Store. A running native action
reaches normal completion or its configured deadline first; the existing host
owner keeps its original whole-process timeout.

After output-space recovery, repeat the same command. Its exact action
records, complete output receipts and original archive marker determine the
continuation.

## Compose into the existing host programme

~~~js
import {
  receiveApprovedCentralPeriods,
  nativeReceivingSelection
} from './warehouse/receiving.mjs';

const specification = nativeReceivingSelection(originalNativeSelection, {
  profileId: existingProfile.id,
  reviewer: agreedReviewer,
  note: agreedMappingNote
});

const result = await receiveApprovedCentralPeriods({
  specification,
  directory: originalNativeSelection.sourceWorkspace,
  profiles: existingPrivateProfiles,
  outputDirectory: originalReceivingDirectory,
  restoreDirectory: originalReopenedDirectory,
  onStage: async observation => retainOriginalHostStage(observation)
});
~~~

The function owns its original listener and workspace queue. Its profile uses
the existing Python command runner and database.

A managed Central process can compose the already-merged createCentralWarehouse
and createWarehouseExtension on its held Store. Finish that managed owner's
source-directory lifetime before opening this standalone receiver against
the same workspace. The managed-product owner maintains the complete shared
installation and source selection.

Deliver the complete native result, original selection, full report ZIPs and
restored-workspace instructions with the existing commissioning handover so
its operator can continue the same accepted work.

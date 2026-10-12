# GridFabric populated-workspace managed receiving

Run the complete native application lifecycle against an already-populated GridFabric workspace. This entry uses the actual installed Starforge Applications model, original managed worker, original GridFabric HTTP/SQLite owner, complete SDK/MCP callback and original native CLI.

The original operation is GRIDFABRIC-MANAGED-APPLICATION-RECEIVING-20261012-1FB3. Retain one input and output directory for its continuation.

## Inputs and runtime

The receiving host needs:

- Node 22.16 or later with node:sqlite.
- The original Linux flock utility.
- GNU tar for the outer customer archive.
- A complete READY selected Starforge runtime that declares both original GridFabric and managed commands, the application provider, SDK/MCP, all native modules and this receiving entry.
- An existing original Runtime Applications workspace.
- The existing populated native GridFabric workspace, with its original owner already stopped before managed Start.
- Private output space for the portable archive, full source downloads, all pages, lifecycle records and outer package.

No npm install, separate runtime build, physical device action or provider mock is part of this receiving entry. It does not establish a READY package from source files. Use the original source selector, builder and installer for that prerequisite.

The normal source root is the actual sourceRoot returned by inspectMerchantRuntime. The complete original merchant package manifest is its sibling ../manifest.json. Both installed and adopted source are verified through that declaration.

## Prepare one private configuration

Write a private JSON file using schema commons.gridfabric-managed-receiving-input.v1. The example below is a template. Replace the paths and logical workspace ID with the actual saved values. Choose and retain distinct original export and restore UUIDs once for this receiving.

~~~json
{
  "schema": "commons.gridfabric-managed-receiving-input.v1",
  "operation_id": "GRIDFABRIC-MANAGED-APPLICATION-RECEIVING-20261012-1FB3",
  "runtimeDirectory": "/absolute/ready/starforge-runtime",
  "runtimeWorkspaceDirectory": "/absolute/private/runtime-applications",
  "workspaceDirectory": "/absolute/private/original-gridfabric",
  "workspaceId": "ORIGINAL_NATIVE_WORKSPACE_UUID",
  "connectionFile": "/absolute/private/original-gridfabric/gridfabric-connection.txt",
  "readyFile": "/absolute/private/original-gridfabric/gridfabric-application-ready.json",
  "outputDirectory": "/absolute/private/gridfabric-managed-receiving",
  "exportRequestId": "ORIGINAL_EXPORT_REQUEST_UUID",
  "restoreRequestId": "ORIGINAL_RESTORE_REQUEST_UUID",
  "restoredName": "gridfabric-received-snapshot",
  "classification": "Native receiving of the retained populated GridFabric customer workspace.",
  "label": "GridFabric customer receiving",
  "minimumCollections": {
    "instances": 1,
    "sources": 1,
    "source_rows": 1,
    "mappings": 1,
    "reports": 1,
    "report_rows": 1
  }
}
~~~

workspaceId is read from the original native workspace. A native status call opens/closes that same original lease; use it after the existing owner has drained. The managed binding command can inspect the original metadata read-only.

runtimeWorkspaceDirectory selects the existing Applications workspace and its actual request journal. The receiver verifies its workspace identity and attaches the READY runtime there if that exact installation is not already registered. Any managed adoption uses the original model's own stable request.

outputDirectory must be outside the native original/restored workspace, runtime and Applications control workspace. Its parent must exist. It is created privately when absent. Reusing it with changed input is rejected before the original journal is writable.

connectionFile and readyFile are optional; the managed defaults in the original workspace apply. If present, their parents must already be private directories. The restored sibling always gets its own default connection and ready paths.

environmentFile is an optional absolute private Applications environment-file path. The existing framework validates and passes it. The source and all reports retain references and hashes; this programme does not create another credential store.

minimumCollections is optional. Each key must be an original public native collection and each value a nonnegative integer. Use actual retained portfolio expectations. These minimums complement the complete exact row/file comparison; they do not stand in for it.

The application label is optional and limited to 90 characters so the original/restored suffixes remain inside the Applications label limit.

## Run

Use the receiving entry from the exact selected source:

~~~sh
node "$SOURCE/operations/scf-gridfabric-plaid-managed-receiving-20261012/run-receiving.mjs" \
  --configuration "$PRIVATE_GRIDFABRIC_RECEIVING_JSON"
~~~

The original native/source declaration is checked before any Applications action. The receiver's own bytes must also appear in that full package manifest. The programme uses the current installed model directly; it does not start another Applications web server.

Stdout contains compact phase observations and one final result. Full pages, files, original lifecycle records and native stderr/stdout are retained in output files. A nonzero exit or error envelope is an actual incomplete outcome; keep the existing output and original request IDs.

## Complete workflow

### Original managed application

The receiver saves a GridFabric application with the current original native directory, connection/ready paths and port zero. Its saved request UUID, full review, source and revision are retained before Start.

The original Applications adoption and worker own startup. Readiness is accepted only after the source-owned observer validates the complete private record, native source and workspace-bound HTTP response.

### Original SDK, MCP and portable receiving

The programme invokes runGridFabricSdkReceiving from the same selected sdk/index.mjs. Its exact private SDK configuration is saved as sdk-receiving-input.json before invocation.

That original callback receives a native atomic export using the retained export UUID, transfers every portable byte, and restores it through the original sibling receiving operation using the retained restore UUID. It opens the original cold workspace, compares complete SDK and MCP pages, receives original full file ranges, preserves a native error, exercises original same-file upload and same-restore receiving, and reopens both interfaces.

The callback must return COMPLETE with cold_operator_closed: true. Its actual restored directory, UUID, revision, complete portable SHA/length and original files become the managed continuation's input. No managed owner opens that sibling before the callback has closed it.

### Full baseline and Stop

Against the original live workspace, the receiver saves every page from the 18 public native collections plus host_files and host_dispatches. It receives every original file named by the complete SDK callback, preserving its full bytes through the maintained retained-download writer.

State before and after this complete read must agree. Each collection gets its complete count and row-content SHA; files retain their original full lengths and hashes.

Stop goes through the original saved application/run. The receiver waits for the actual worker to become terminal and inactive, then invokes the unchanged native CLI status. That exact command opens and closes the original SQLite lease and returns the same workspace/revision.

The full retained request, command result, source-provider sidecar, launch/process/ready records, Stop record and worker log are copied when present. They remain exact original records. The additional receiving disposition identifies how closure was established.

### Same application restart

The same saved application is started again using a distinct retained lifecycle request. The programme reads every original table and every file range again. Complete contents must equal the baseline, including rows and file hashes.

The new listener token and port may differ. Original workspace UUID, directory, selected source and all business records remain bound. It then Stops and proves native lease closure again.

### Restored managed application

The completely restored sibling receives a separate saved application. Its logical workspace UUID and snapshot revision match the original, while its directory and connection/ready paths are distinct.

The receiver starts it through the original Applications worker, repeats the complete table/file comparisons, Stops it and proves native CLI lease closure.

### Freeze and package

Only after all original managed owners are closed does the programme freeze Operation.json and Original_Requests.json. It records the full intended customer member roster before the first manifest write, then verifies every retained member.

GNU tar produces the outer archive. Its complete member listing, gzip/tar read, source-file identities before/after packaging, complete archive byte count and SHA-256 are verified. A completed package is received through that exact saved identity on continuation.

## Interruption and exact continuation

Invoke the same command with the same configuration and output directory. The journal rejects another operation, changed source/runtime/Node binding or altered input.

Every application save, Start, SDK export and restore keeps its original request identity. An interrupted Start is reconciled through the existing Applications operation. A launched original command is never replayed by the managed receiver. If an earlier lifecycle attempt is conclusively terminal and the original native CLI proves closure, a later receiving invocation can prepare a new explicit lifecycle attempt for the still-incomplete phase. It preserves the earlier outcome.

A fresh failed Start is returned as an error, with its actual original outcome. The programme does not loop through new request IDs in response to that failure.

Stop failures and active ownership remain pending. The receiver attempts to close only its own retained managed runs and borrowers; it never kills an unrelated native process from a stale PID.

Completed table/file phases retain their exact artifacts. Completed SDK receiving reopens its saved record and verifies the whole portable file. A completed product resumes package finalization before any source model, listener, SDK mutation or owner is opened.

The deterministic manifest staging file is reconciled only against the exact frozen manifest bytes. Unknown customer files remain explicit and stop finalization. Interrupted outer archive attempts are retained under their unique names; an incomplete archive is not mistaken for a completed package.

## Output

The outer result is:

~~~text
GridFabric_Managed_Customer_Result.tar.gz
~~~

Its complete customer tree contains:

| Path | Meaning |
| --- | --- |
| Operation.json | Complete source, original/restored workspace, lifecycle, SDK/MCP and comparison outcome. |
| Original_Requests.json | Original input, saved reviews/request IDs, actual retained lifecycle outcomes and receiving history. |
| manifest.json | Every intended customer member's complete byte count and SHA-256. |
| Source_Identity.json | Complete original selected package declaration and receiving entry identity. |
| SDK_Receiving_Result.json | The actual complete original SDK callback result. |
| sdk-receiving/ | Original native portable, SDK/MCP receiving record, full original-file MCP download and callback evidence. |
| snapshots/original/ | Every complete original table page and all original full file downloads. |
| snapshots/restarted/ | Every reopened table page and full-file receiving identities. |
| snapshots/restored/ | Every restored table page and full-file receiving identities. |
| lifecycle/ | Complete available original run records, worker logs and native CLI lease-open/close outputs. |

The outer private output directory also keeps receiving.json, the exact SDK input and original packaging attempts. Preserve that directory for interrupted continuation. The customer archive contains original account/workspace identifiers and historical private connection records; keep it in the same authorized customer custody.

The final compact result names the report, manifest, complete archive SHA/length and all_managed_owners_closed. File preservation or delivery must use those actual completed paths. A prepared source capsule is not a native receiving result.

This programme does not operate a browser or issue management/device dispatch. Existing browser or provider outcomes remain separate actual evidence. It does not rerun or reclassify the earlier GridFabric functional portfolio.

## Source ownership

The six source-owned managed leaves are the three application modules, MANAGED_APPLICATION.md, this guide and run-receiving.mjs. The cumulative original GridFabric contribution declares their paths; the normal selected builder creates the complete source manifest.

See [managed application](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/MANAGED_APPLICATION.md), [SDK and MCP](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/SDK_MCP.md) and [native domain operations](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/DOMAIN_OPERATIONS.md).

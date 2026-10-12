# Complete Utility → Leap customer receiving

This operation uses one selected Starforge runtime and two original customer workflows, in sequence. The original Utility receiver finishes and drains before the Leap owner opens. Leap receives the complete reviewed files through its real browser, retains native batch and provider outcomes, exports through the original CLI, restores the full workspace and inspects that restored workspace through the same browser application.

The stable operations are:

- `UTILITY-DATA-ENERGYTOOLBASE-20261012-1FB3`
- `LEAP-DEVICE-INTERVAL-DELIVERY-20261012`

Keep the same operation directories, request UUIDs, immutable input identities and prepared upload targets when continuing. The programs do not acquire accounts, change provider credentials, invent DEVICE identifiers or create a parallel payment, interval or publication engine.

## 1. Use the complete committed product

The `leap-intervals` source selection includes the whole original Utility selection and the Leap application. It preserves every member in the original 63-file Utility declaration and retains the source components needed by its native dataset, publisher, managed Applications and merchant MCP workflow.

Use a complete repository-shaped checkout at the selected immutable commit. Its tracked source must match that commit. The original builder reads Git objects at that ref; an old installed keeper plus a handful of changed files is not a replacement for this input.

The host needs the original supported Linux runtime:

| Input | Requirement |
| --- | --- |
| Node | The selected original Starforge Node runtime, 22.16 or later |
| Python | Python 3.11 or later, with Expat 2.6 or later for the included Utility XML reader |
| Native tools | The original runtime profile's npm, compiler/native preparation requirements and Linux `flock` |
| Browser | An existing Playwright module and its compatible Chromium executable, supplied as absolute paths |
| Leap credentials | The selected `token_env` inherited by the owner process when explicit provider actions are intended |
| Storage | A private directory that can retain the source archive, original runtime, both customer workspaces, complete response files and delivery ZIPs |

Leap's source uses the Python standard library and the original adjacent Utility time/shared helpers. This does not install another Python dependency graph. The existing Starforge installer selects the complete native, schema, OpenAPI, MCP and operator profile for the combined runtime.

## 2. Review the Leap input

The receiver takes complete original files and their actual SHA-256 values. Device mapping uses explicit Leap DEVICE UUIDs, the selected partner account/environment, an identified reviewer and retained evidence for both the permitted creation channel and account custody.

Evidence must cover creation through the **Create Meters API or Portal CSV**, historical custody for the source intervals, and current custody at submission. API visibility and `audit.created_by` alone do not prove those facts.

This is the structure of `input` in the private receiver configuration. Every uppercase string below is a placeholder to replace with the actual reviewed value; it is not a runnable provider request.

```json
{
  "configuration": {
    "environment": "staging",
    "partner_account_id": "ACTUAL_PARTNER_ACCOUNT",
    "token_env": "LEAP_API_TOKEN"
  },
  "sources": [
    {
      "path": "/retained/original-load.csv",
      "name": "original-load.csv",
      "format": "leap-load",
      "bytes": 12345,
      "sha256": "ACTUAL_FULL_FILE_SHA256",
      "purpose": "original customer source"
    },
    {
      "path": "/retained/device-custody.json",
      "name": "device-custody.json",
      "format": "evidence",
      "sha256": "ACTUAL_CUSTODY_FILE_SHA256"
    }
  ],
  "mappings": [
    {
      "key": "direct-load",
      "value": {
        "schema": "stellar-forge.leap-interval-mapping.v1",
        "name": "Reviewed original DEVICE load",
        "environment": "staging",
        "partner_account_id": "ACTUAL_PARTNER_ACCOUNT",
        "reviewer": "ACTUAL_REVIEWER",
        "ownership_evidence_source_id": "ACTUAL_CUSTODY_FILE_SHA256",
        "ownership": [
          {
            "meter_id": "ACTUAL_LEAP_DEVICE_UUID",
            "start_utc": "ACTUAL_OWNERSHIP_START_UTC",
            "end_utc": "ACTUAL_OWNERSHIP_END_UTC"
          }
        ],
        "entries": []
      }
    }
  ],
  "batches": [
    {
      "key": "original-load",
      "mappingKey": "direct-load",
      "prepare": {
        "name": "Reviewed original load",
        "source_ids": ["ACTUAL_FULL_FILE_SHA256"]
      },
      "expected": {
        "status": "PREPARED",
        "row_count": 100,
        "meter_count": 1
      },
      "providerActions": []
    }
  ],
  "deliveryBatchKey": "original-load"
}
```


For a `utility-profile` source, supply the original retained profile and the explicit mapping entries for its source meter, series and channel. Each entry selects one Leap UUID and one native kWh target column. The receiver never guesses those assignments.

The expected row count and status are optional assertions against the actual native result. For an intentionally retained invalid or expired original source, use its actual expected `VALIDATION_FAILED` result. Keep an authored functional example under a separate file hash, source name, purpose and batch key. An expired 2024 provider example cannot be presented as a currently eligible customer upload.

### Optional reviewed provider actions

Only the explicit `providerActions` array dispatches original upload, refresh or reconciliation actions. An empty array performs complete local preparation, review and receiving without claiming a provider ingestion.

```json
{
  "providerActions": [
    {"action": "batch.submit"},
    {"action": "batch.refresh"},
    {"action": "batch.reconcile", "payload": {"job_id": "ACTUAL_OBSERVED_JOB_UUID"}}
  ]
}
```


Select only the actions and observed job ID appropriate to the original operation. A fixed sequence does not poll a provider until a desired result appears. Provider deferral, authentication, eligibility, failed validation and unknown submission outcomes remain the original retained statuses.

For an uncertain upload, use the same batch and reconcile its original complete job file. The receiver does not retry a submission merely because it lost an HTTP response. A local action can be completed while the retained batch is `UNKNOWN`.

### Missing windows and corrections

Optional `missingScopes` entries have `{key,payload}`, where payload is the original documented missing-window query. Its original complete pagination remains in the workspace.

A batch may select `missingScopeKey` for a preceding retained scope. The receiver inserts that scope's returned original snapshot ID. It may use `correctionOfKey` for an earlier batch; the receiver inserts that original batch ID. Other prepare fields remain unchanged. Keys must refer to earlier completed steps, and original eligibility/status/deadline checks remain authoritative.

## 3. One build and sequential invocation

Create one private configuration with the actual paths and reviewed Leap input:

```json
{
  "repository": "/complete/source",
  "sourceCommit": "FULL_JOINED_COMMIT",
  "nodeExecutable": "/host/node",
  "pythonExecutable": "/host/python3",
  "playwright": "/host/node_modules/playwright/index.mjs",
  "chromium": "/host/chrome-headless-shell",
  "outputDirectory": "/retained/utility-leap-operation",
  "buildDirectory": "/retained/utility-leap-operation/release",
  "runtimeDirectory": "/retained/utility-leap-operation/runtime",
  "installOptions": {},
  "utility": {
    "originalReport": "/retained/Utility_Original_Customer_Operation_20261012.json",
    "reconstructOriginal": true
  },
  "leap": {
    "input": {"REPLACE": "THE_COMPLETE_REVIEWED_INPUT_FROM_SECTION_2"}
  }
}
```


The nested `input` placeholder must be replaced in full. Configure private output paths large enough for the intended portfolio. Do not place the output, runtime or receiving workspaces inside the source checkout.

Run the selected Python once:

```sh
/host/python3 /complete/source/operations/scf-leap-interval-receiving-20261012/run-sequence.py /private/utility-leap-sequence.json
```


The sequence:

1. Reads the exact Git checkout and validates the complete declared implementation bytes.
2. Calls the original distribution builder with `--selection leap-intervals`, retaining its original build journal and full archive.
3. Saves the complete build receipt and optionally transfers the archive/receipt to already prepared targets before installation begins.
4. Calls original `prepareRuntimeInstall`, `installRuntime` and `inspectRuntimeInstall` with the selected native/schema/OpenAPI/MCP/operator profile. It checks the READY runtime and full source verification.
5. Runs the unchanged complete Utility receiver, including the original report comparison, browser/client, 22-name MCP catalog and original receiving calls, CLI cold restore, managed start/stop and reopen.
6. After Utility exits, runs the Leap browser/action/file workflow through one original owner.
7. Closes that owner, exports through the original CLI and restores into a separate private workspace.
8. Opens the restored Leap workspace for read-only desktop/mobile receiving, then drains its browser and owner.
9. Saves both complete customer results and a compact `completed-sequence.json`.

The original Utility operation report must be exactly **56,586 bytes**, SHA-256:

```text
08ae13edf0ce8c7f5e23ae3c214cc00be104486ec41982dd60ccd9ba5eb9b966
```


It records the completed 20-import, 1,340-row, 14-page core, two reviews, two builds, one comparison and two reconciliations. The original snapshot is `62266c0da32ddf56f862c7e3467a45a89278d59795238c12512bfbcaded5f8cf`. Explicit reconstruction uses its same retained public source bytes and compares the native result. It is not a claim that a lost old workspace ZIP was recovered.

The selected runtime lives at `runtimeDirectory`. Its repository-shaped source is `runtimeDirectory/package/source`; its dependencies belong to the original runtime directory. Supply an existing complete dependency graph only through the maintained installer options and original lock validation. A partial preparation remains with that installer's recover/inspect workflow.

The source declaration binds files by byte length, SHA-256 and Git blob. It names the reviewed root backend cut separately from the actual selected release commit, which the original package manifest and runtime record retain. The source declaration excludes itself to avoid a recursive hash.

## 4. Leap-only receiving on an existing READY runtime

The original Leap receiver can also run independently against an already completed compatible runtime:

```json
{
  "operationId": "LEAP-DEVICE-INTERVAL-DELIVERY-20261012",
  "sourceRoot": "/retained/runtime/package/source",
  "runtimeDirectory": "/retained/runtime",
  "nodeExecutable": "/host/node",
  "pythonExecutable": "/host/python3",
  "playwright": "/host/node_modules/playwright/index.mjs",
  "chromium": "/host/chrome-headless-shell",
  "outputDirectory": "/retained/leap-receiving",
  "artifactDirectory": "/retained/leap-delivery",
  "input": {"REPLACE": "THE_COMPLETE_REVIEWED_INPUT"}
}
```

```sh
/host/python3 /retained/runtime/package/source/operations/scf-leap-interval-receiving-20261012/run-receiving.py /private/leap-receiving.json
```


The driver obtains the installed global command from original `runtimeCommand`. It starts the Python owner through that original command and borrows its private authenticated loopback connection. It checks the original workspace ID and READY launch descriptor. Each owner closes its own connection file and drains on SIGTERM before another phase opens it.

The browser is the real application. It reviews source files, saves the supplied mappings, prepares the original batches, submits only selected provider actions, exports one selected customer batch, downloads original files and examines complete native row/issue/missing pages. It takes desktop and mobile screenshots. Cold receiving uses the same application without mutation and compares the original logical workspace, batch, mapping and upload identities.

## 5. What is retained

| File | Complete contents |
| --- | --- |
| `Leap_Interval_Operation.json` | Source/runtime identities, original input digest, browser and CLI phases, owners, actual batch/provider states and complete file results |
| `Leap_Interval_Workspace.zip` | The original CLI's complete native portable workspace |
| `Leap_Interval_Delivery.zip` | Native portable workspace, frozen operation report, reviewed input, source declaration, guides, complete browser/read records, original files, verified downloads and desktop/mobile screenshots |
| `receiving-journal.json` | Phase continuation and original upload-target receipts |
| `browser/browser-journal.json` | Exact original request UUID, reviewed revision and payload or raw-file identity saved before each POST |
| `browser/records/*.ndjson` | Complete row, issue and missing-window pages written as a stream |
| `finalization.json` | Frozen successful result and exact customer-file roster before packaging |
| `completed-delivery.json` | Exact final artifact hashes saved before optional transfers |

The report distinguishes `productPassed` from `providerIngestionCompleted`. The latter is null when no provider actions were requested; it is true only when all reported original batches have a retained completed provider job. A successful browser/portable workflow does not imply a settled provider upload.

The combined delivery contains declared customer files. Private connection capabilities, process configuration, environment secrets and live SQLite files are excluded. The native portable package contains the original complete data through its original exporter.

## 6. Continue the exact retained operation

Use the same configuration and directories. A request is saved before it is allowed onto the original connection. If a response is lost, the driver reads that exact request UUID:

- `COMPLETED`: reuse the original result.
- `FAILED`: retain the original failure.
- `RUNNING`: retain it and reconcile the original owner before a new phase.
- `INTERRUPTED` with `recoverable: true`: resume that exact original UUID and input.
- Not found: only the same reviewed revision and original body/file may be continued.

An interrupted remote submission derives the original batch's unknown outcome. It does not receive a new request UUID to bypass recovery. The separate batch reconciliation action inspects full original job files.

The original CLI preserves export identity and restore receipt across process interruption. The receiving driver freezes the successful report before assembling its ZIP. Once `completed-delivery.json` exists, it verifies and transfers those exact files; it does not rerun the browser, reopen the workspace or invoke earlier actions.

A timed-out sequential child remains recorded with its actual PID, phase and log paths. Reconcile that original child before another sequence invocation. The original workspace and installer leases remain the final authority. A new invocation is not evidence that an earlier child closed.

## 7. Preserve output before a temporary host exits

Use durable host directories or original prepared upload targets. An invocation-local `/dev` path can disappear when its execution environment closes.

The sequence's `buildUploadTargets` accepts original prepared target objects:

```json
[
  {"artifact": "archive", "target": {"file_id": "ORIGINAL_ID", "upload_url": "ORIGINAL_SIGNED_HTTPS_URL", "method": "PUT", "required_headers": {}}},
  {"artifact": "receipt", "target": {"file_id": "ORIGINAL_ID", "upload_url": "ORIGINAL_SIGNED_HTTPS_URL", "method": "PUT", "required_headers": {}}}
]
```


Leap's nested `uploadTargets` uses the same original target shape and selects `report`, `workspace` or `delivery`. Utility keeps its unchanged `uploads` contract documented in its own receiving guide. These private target values are not source files and must not be pasted into public reports.

The programs stream exact completed files, retain target ID/hash/size/HTTP/ETag receipts, and keep unconfirmed transfers distinct from completed products. Reconcile an uncertain target using its original provider result before another transfer. Finalize and independently read back each saved artifact through the existing file service.

## Original source guides

- [Leap complete operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/README.md)
- [Combined selected-runtime guide](../../stellar/scf-starforge-20261009/distribution/selections/LEAP_INTERVALS.md)
- [Original Utility receiving and transfer format](../scf-utility-energy-receiving-20261012/README.md)
- [Leap retained primary contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/leap-intervals/contracts/SOURCES.md)

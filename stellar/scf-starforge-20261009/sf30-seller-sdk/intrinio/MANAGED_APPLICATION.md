# Intrinio saved application

The Intrinio application opens an existing fundamentals and statement-review workspace in the original runtime operator's **Applications** page. It preserves the saved editions, fact decisions, comparison bindings, selections, preview outputs and original Python release store. The same authenticated listener serves both the statement-review browser and the Python source/release console.

The application uses the existing `intrinio` command and `IntrinioWorkspace`. Its source-owned provider lives beside that product; the shared Applications loader discovers it through the existing Intrinio contribution.

## Open a customer's workspace

Use a Linux host with the original runtime operator, Node 22.16 or later with `node:sqlite`, and the local Python interpreter selected by the saved merchant declaration. Managed process ownership uses the existing Linux kernel lease helper and `flock`.

If you have a complete portable export, restore it into a new private directory:

```sh
starforge intrinio import-workspace \
  --workspace /absolute/private/intrinio-customer \
  --bundle /absolute/private/customer.python-workspace.json
```

The original importer validates every retained blob, revision, preview result, immutable release and customer export. The recovered workspace keeps its original ID, revision history and active release selection. Its imported source remains retained in that workspace.

In the original runtime operator:

1. Select the existing READY runtime that contains this Intrinio source and its Applications provider.
2. Open **Applications**, choose **Intrinio statement review**, and select the saved private workspace.
3. Choose a local port. `0` selects an available port; an explicit port remains part of the reviewed command. A private environment file can provide the existing application's environment values.
4. **Review** and **Save/adopt** the application. Review reads the original SQLite database and selected content blobs in read-only mode. Saving retains the original workspace and installed-source selection.
5. **Review Start**, then **Start**. The original managed operation opens the existing workspace and verifies the authenticated listener before **Open** becomes available.
6. Use **Statement review** for editions, fact review, saved selections and JSON/CSV/HTML customer output. Use **Python source and release** to inspect the same retained source, original previews and release operations.
7. **Stop** waits for the original preview jobs and owned seller process to close. Reopen the same application and review its next Start to continue with the saved workspace.

The saved declaration controls the Python interpreter used for a new native preview. Existing completed customer outputs reopen from their original retained preview IDs. Source acquisition continues through the original Intrinio acquisition workflow and its configured provider account.

## What Review and Start bind

The managed preparation retains the workspace's original ID and creation time, the reviewed revision ID and digest, and 24 selected native source files. These include the Intrinio engine, browser and launch source, the original Python workspace, and its release and private-storage primitives. Each retained input records its full byte length and SHA-256 digest. The selected installed runtime additionally remains bound by the original runtime manifest and profile.

Managed adoption copies source into the original release home. The launch accepts that different execution directory only when the selected source files have identical bytes. Its authenticated binding preserves both the selected runtime source root and the actual release source root, together with the process ID and a new listener instance ID.

Start reads the reviewed workspace revision again before opening it. If that revision or selected source changed, review Start again using the same saved application. Normal browser edits can create later revisions while the listener runs; the original reviewed revision remains part of the retained history.

The original source console copies an optional caller binding into its authenticated state response. The Intrinio observer authenticates that response, checks workspace/process/source identity, and reopens the original reviewed revision before retaining the two private links. The token stays in the local browser fragment and the existing private operation records.

Default HTTP port 80 uses canonical loopback URLs. The original Python listener accepts both canonical browser hosts and explicit local host/port aliases.

## Receive the complete native customer

The reusable native receiver imports the complete original archive into a new private workspace, opens the original managed listener, downloads every completed selection output and the full recovery archive, stops it, and reopens that same workspace. The second listener has a new instance identity and retains the same customer source.

```sh
starforge intrinio-receive \
  /absolute/private/original.python-workspace.json \
  /absolute/private/intrinio-received \
  /absolute/private/intrinio-delivery \
  0
```

The output directory contains each original selection output under its retained preview ID, a full `intrinio.python-workspace.json` archive, and the native receiving result. JSON, CSV and HTML bytes are downloaded from the original authenticated preview-output endpoint and matched to the archive's retained result hashes.

All original revisions, blobs, completed preview outputs, immutable releases and customer-export members are checked in the downloaded full archive. Later local revisions can remain present when continuing the same imported customer. Existing output files are create-only and reused only when they retain the expected original bytes.

The native receiver's source entrypoint is:

```text
stellar/scf-starforge-20261009/sf30-seller-sdk/intrinio/receiving/native.mjs
```

## Receive through the existing Applications operator

Use the already installed runtime and its existing runtime workspace. The Applications receiver creates its saved application through the original Review and Save/adopt methods, then uses the original Start/Open/Stop methods for two complete cycles. The shared registry and managed operation remain the lifecycle owners.

```sh
starforge intrinio-application-receive \
  /absolute/private/runtime-workspace \
  EXISTING_24_HEX_RUNTIME_ID \
  /absolute/private/original.python-workspace.json \
  /absolute/private/intrinio-received \
  /absolute/private/intrinio-delivery \
  0
```

The input runtime ID is the existing ID shown by that runtime workspace. Its selected runtime must contain the merged Intrinio source and source-owned Applications registration. The receiver retains its original save request, Start reviews and operation IDs before dispatch. Re-running the same command rejoins that same receiving record and the original queued/running operations.

Its complete continuation is `applications-receiving.json` in the private output directory. The record includes the saved application ID, adopted release/source identity, both original managed operation IDs, the customer downloads and Stop/reopen results. The original runtime workspace retains the child logs and operation status.

A failed native operation stays available through the original Applications recovery controls and its retained ID. Repair the exact source or host condition there, then continue the same receiving input.

The Applications receiver's source entrypoint is:

```text
stellar/scf-starforge-20261009/sf30-seller-sdk/intrinio/receiving/applications.mjs
```

## Native API

The original workspace module additionally exports `inspectIntrinioWorkspace(directory)`. It uses a read-only SQLite connection and the original revision, declaration and content-blob readers; it performs no recovery writes or previews.

The managed module exports:

| API | Result |
| --- | --- |
| `prepareIntrinioManagedSelection(directory, {sourceRoot})` | Original workspace/revision and exact native source selection |
| `intrinioManagedSource(sourceRoot)` | Complete selected source file records and their combined digest |
| `startManagedIntrinioWorkspace(directory, {selection, port})` | Original listener, authenticated startup, close method and drained completion |
| `verifyIntrinioManagedStartup(startup, {selection, sourceRoot, port, pid})` | Original private links and verified startup identity |

The source-owned provider delegates catalog and preparation to `managed-application.mjs`, then defers its original startup verification through the common serialized observer. The common resource key uses the original Python workspace directory. A managed Intrinio listener also retains the original kernel lease for that directory until its native close completes.

The complete native and Applications receivers are exported alongside the existing workspace API in the Intrinio contribution. The financial engine, acquisition, previews, release creation and customer formats remain their original APIs.

# Complete STAC operation in one equipped allocation

This source continues operation `SCF-STAC-MANAGED-APPLICATION-RECEIVING-B710-20261012` from the already-received Austin imagery and Cirrus processing workspaces. Product source stays at `7169c10e37a1800d22133efaf37cfaac5d96e343`. The original source receiver, builder, installer, managed-application receiver and predecessor installation remain selected.

## Why this continuation exists

The shared scratch filesystem reached zero available bytes. The original foreground could not create its retained records there. The equipped process has a separate private `/dev` filesystem, but its lifetime ends independently of shared scratch. This continuation receives the complete source, runs the original operation, captures its full outputs, packages them, and performs the selected artifact transfer before that same allocation ends.

The existing 3BDA one-allocation carrier is the execution dependency. Its original Commons blob is `0b1f4b156c01f0b05182d9ace93cba0c351e2b17`. For this operation the saved `operationId` reads `OPENFEMA_OPERATION_ID`, retaining the carrier's original default. The carrier supports the original put/run/read/pack/upload commands. It remains available after the child operation returns.

## Source and runtime inputs

`complete-source-input.json` carries all twelve original input/source members needed before execution: the selected private input, its original shared predecessor, both complete original native callers, and all eight selected product source bodies. Each member has its exact SHA-256. `one-allocation.py` is supplied beside them.

The following existing equipped source locations are read by the original caller:

- Complete six-file operation source and fixed Git metadata: `/workspace/scratch/b71092915960/stac-managed-applications-native/operation-code`.
- All eight pinned original builder files: `/workspace/scratch/b71092915960/stac-applications-source-7169/builder`.
- Original predecessor installation: `/workspace/scratch/d1ccf784531e/scf-dataset-applications-native/runtime-recovered-eea35`.
- Received imagery and processing: `/dev/shm/b710-cirrus-native-20261012/operation/received-scenes` and `received-processing`.

The complete metadata remains Git blob `56da861934c0a161c8ab76b64a17c2a9b421d557`. The selected input differs from the preceding shared input only in the private copy used for `builderDirectory`. All project, cache, runtime, source, predecessor and closed data selections remain the original selections.

The private root is `/dev/b710-stac-applications-7169`. Existing Node and Python are used. The process environment retains `PYTHONDONTWRITEBYTECODE=1`, `NODE_OPTIONS=--max-old-space-size=160`, and an owned temporary directory inside that root.

## Complete dispatch

Reconcile the original operation and any returned native handle before dispatching. Use one receiving owner for the same operation.

Prepare the actual artifact upload through the existing file provider. Keep its returned opaque object private. Place it at `private-uploads/original-01.json` through the carrier's normal exact-byte put operation. This upload file is supplied only to the equipped process.

Start the existing carrier with `OPENFEMA_RECEIVING_ROOT` and `OPENFEMA_OPERATION_ID` set to the root and operation above. Use a live TTY. Once it prints `OPENFEMA_PERSISTENT_READY`, deliver the whole put frame and the run command immediately in the same tool call. Include the twelve bundle members, this complete wrapper, and the returned private upload object. The carrier verifies every supplied member's SHA-256.

The original run command is:

```json
{"command":"run","label":"original-stac-native-01","argv":["python3","-B","@root/one-allocation.py","@root/private-uploads/original-01.json","native-01"]}
```

The wrapper copies and verifies the original builder/source into the private root, locks this operation, and invokes unchanged `receive-and-continue.py`. That caller receives original Git objects, expands any missing source closure using the fixed original tree, then runs the maintained whole STAC application continuation.

The original continuation performs the source build, predecessor install/upgrade, installed-source verification, managed application receiving and original lifecycle checks. Its own complete outputs determine the operation result.

## Result and continuation

The wrapper saves full stdout and stderr, source and runtime outputs, selected input, both original callers, all operation/builder files, and its own code in `delivery`. It creates and CRC-checks `SCF_STAC_Managed_Applications_Native_20261012.zip`, then records its exact byte count, SHA-256 and transfer state. It attempts the selected PUT once and records the actual HTTP result in `transfer-native-01.json`. Private upload credentials stay outside the archive.

Pass the original opaque provider object unchanged to finalization only after its actual completed transfer. Apply the returned file attributes to the exact original archive while the allocation is still available.

If original Git objects are missing, read `source-cache/missing-objects.json` through the still-live carrier. Receive the exact missing blobs into the existing incoming directory and continue the same operation. Retain the original source/result and transfer record when continuing; use a new attempt label so full logs remain available.

The actual runtime completion is the original continuation result, with successful exit and complete managed application receiving. This source delivery also supports preserving the full outcome of a failed run before continuing it.

## Current execution state

The complete source frame was prepared and verified in the coordinator. Two following native launch attempts ended before process creation with `409 environment_offline`; neither returned a native session or began source intake. The original managed application run remains the operation to execute. The prior imagery/processing receiving and client lifecycle results stay in their original delivery.

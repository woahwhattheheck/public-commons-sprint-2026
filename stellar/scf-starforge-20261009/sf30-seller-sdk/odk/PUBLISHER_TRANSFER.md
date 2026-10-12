# Publisher carryover in a Central workspace

A Central workspace archive now carries the original dataset publisher alongside its captured forms, rows, reports and exports. The publisher's files use the existing content-addressed source graph, and its receiving procedure uses the original dataset version store and SF82 release APIs.

## What travels

Each completed publisher snapshot retains every selected regular file below the original `publisher/` directory. Its resource scope is `publisher:<snapshot-id>`, resource kind is `publisher-source`, and the `publisher-snapshot` record lists original relative paths, byte counts and SHA-256 identities.

The snapshot contains the original:

- Prepared dataset packages and complete retained source-file closures.
- Stored dataset generations, current snapshot, retention settings, activation times and expiry times.
- Compiled releases, native release metadata, selected release generation and complete selection history.
- Observed process-owner and run files as historical source bytes.

The existing archive implementation already includes every resource body by hash. These files therefore travel in the same original SQLite/source archive. A received host does not install the historical owner or run files into its live ownership directories.

An absent publisher is recorded as an empty completed snapshot. Replaying that archive operation preserves its original selection.

## Capture and archive integration

`capturePublisherSnapshot(store, {id, expectedGeneration?})` retains a publisher snapshot on the original open Central store. The fixed snapshot ID binds the exact source directory and optional expected release generation. It records the original selection before retaining the file bodies, checks the selected dataset states and release history again afterward, and binds every compiled release file to its original native metadata.

A complete replay returns the same snapshot. An interrupted capture resumes its original resource scope and selected file inventory. If the source publisher has changed, the retained operation identifies that concrete difference so the new publisher selection can receive a separate snapshot ID.

The archive creation path calls this function with the archive's fixed ID **before** its first `store.snapshot(id)`. Keep the existing completed-archive return and previous-host archive behavior. Serialize this call with the workspace's existing publisher preparation, activation and receiving actions; its original SF82 leases remain authoritative.

The archive's source selection remains the existing `resources` table. The snapshot's metadata and original release history remain ordinary records in the same database.

## Receive on the destination

`receivePublisherSnapshot(store, {id, snapshotId})` receives a completed snapshot on the current open Central store. Its receiving ID binds the snapshot manifest, destination directory and original received-archive identity. A saved `publisher-receiving` record retains progress and the original-to-local mapping after each native stage.

The operation:

1. Verifies that the snapshot's complete file manifest matches its original source resource graph.
2. Creates private destination directories under `publisher/received/<receiving-id>/`.
3. Copies the exact native version-store `state.json` and every referenced generation's `dataset.json`, `data.csv` and `manifest.json`. It opens each store through `openDatasetVersions({directory, collectOnOpen:false})`, which validates the original generations without collecting stored expired generations during receiving. The native writer lease is created for the destination. The original version metadata and hashes remain in the receiving result.
4. Recreates the prepared packages from their retained original bytes. Only `binding.json.datasetDirectory` changes to the received native store. All other source, configuration, payment terms and publisher fields retain their source bytes. Each package passes `prepareDatasetRelease`.
5. Stages each original dataset release through the existing `stageRelease` into the maintained destination publisher release store. The receiving ID and original release ID determine the local release ID. A crash after native staging is reconciled by inspecting that same ID and matching the received dataset, label and normalized native runtime.
6. Saves the full original/local release ID and digest mapping, original selection history, package bindings and the current local release generation.

The historical dataset state remains preserved in the source graph even when the original native loader performs its supported v1-to-v2 state upgrade. The receiving procedure handles that completed upgrade on replay.

## Activation and later operation

Receiving stages the packages through the maintained release store. It returns:

~~~json
{
  "activation": {
    "releaseRoot": "/current/workspace/publisher/releases",
    "expectedGeneration": 0,
    "originalActive": "original-release-id",
    "localActive": "central-<derived-id>",
    "originalPrevious": null,
    "localPrevious": null
  }
}
~~~

Use the existing workspace `activateRelease({id: localActive, expectedGeneration, reason})` action for destination activation. The original SF82 compare-and-swap checks concurrent selection changes. Its existing run, stop and rollback paths continue to own the native seller lifecycle.

The new local digest is expected: the dataset's private directory binding participates in the original package and execution hashes. The receiving record keeps that new identity together with the exact original digest and package metadata. Historical selection events remain available in `originalSelection`.

A later archive captures the received publisher through the same source graph, including its native dataset generations and local staged releases. A subsequent host repeats the same original receiving APIs against that retained source.

## Workspace API hooks

The additive module exports:

~~~js
capturePublisherSnapshot(store, { id, expectedGeneration })
receivePublisherSnapshot(store, { id, snapshotId })
publisherTransferState(store)
~~~

The original workspace exposes:

~~~js
capturePublisher: input => capturePublisherSnapshot(store, input),
receivePublisher: input => receivePublisherSnapshot(store, input),
publisherTransfers: () => publisherTransferState(store)
~~~

Include these methods in the existing operation tracking and publisher serialization. Expose their records through the existing operator, CLI, SDK and typed MCP surfaces. Keep `activateRelease` as the original native action using the mapped local release ID.

A snapshot or receiving record contains source paths and complete publisher history. It belongs with the private full workspace, alongside the existing connection references, source bodies and original operation records.

## Existing archive operations and preparation recovery

A retry retains the original SQLite snapshot and its publisher selection. If that snapshot was made by an earlier product edition before publisher carryover existed, its completed archive reports `publisherSnapshotId: null`; the original source selection remains intact. Create a new archive to include the current complete publisher.

The workspace serializes native publisher preparation, selection, capture, receiving and archive creation. Release preparation retains its original input/result in `publisher-preparation`. A repeated completed request returns that original result. If native staging completed before its response was retained, the receiver inspects the same native release ID and matches the original prepared dataset, label and runtime before completing the same record.

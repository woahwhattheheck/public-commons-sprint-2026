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

The archive creation path calls this function with the archive's fixed ID **before** its first `store.snapshot(id)`. It keeps the existing completed-archive return and previous-host archive behavior. The workspace serializes this call with its original publisher preparation, activation and receiving actions; the original SF82 leases remain authoritative.

The archive's source selection remains the existing `resources` table. The snapshot's metadata and original release history remain ordinary records in the same database.

## Receive on the destination

`receivePublisherSnapshot(store, {id, snapshotId, maxResidentRows?})` receives a completed snapshot on the current open Central store. Its receiving ID binds the snapshot manifest, destination directory and original received-archive identity. A saved `publisher-receiving` record retains progress and the original-to-local mapping after each native stage.

The operation:

1. Verifies that the snapshot's complete file manifest matches its original source resource graph.
2. Creates private destination directories under `publisher/received/<receiving-id>/`.
3. Copies the exact native version-store `state.json` and every referenced generation's `dataset.json`, `data.csv` and `manifest.json`. It opens each store through `openDatasetVersions({directory, collectOnOpen:false})`, which validates the original generations without collecting stored expired generations during receiving. The native writer lease is created for the destination. The original version metadata and hashes remain in the receiving result.
4. Recreates the prepared packages from their retained original bytes. Only `binding.json.datasetDirectory` changes to the received native store. All other source, configuration, payment terms and publisher fields retain their source bytes. Each package passes `prepareDatasetRelease`.
5. Stages each original dataset release through the existing `stageRelease` into the maintained destination publisher release store. The receiving ID and original release ID determine the local release ID. A crash after native staging is reconciled by inspecting that same ID and matching the received dataset, label and normalized native runtime.
6. Saves the full original/local release ID and digest mapping, original selection history, package bindings and the current local release generation.

The historical dataset state remains preserved in the source graph even when the original native loader performs its supported v1-to-v2 state upgrade. The receiving procedure handles that completed upgrade on replay.

## Interrupted native preparation

A backup also retains unfinished native publisher source. For example, the original OData preparation writes its package and binding before creating the version-store state. A stopped preparation can therefore leave a complete package input beside a missing dataset state. The native release initializer can similarly leave its private directory before publishing its state.

These conditions do not discard publisher files or prevent the rest of the Central workspace from being archived. The snapshot keeps every original regular file in the same source graph, and adds explicit component diagnostics in `selection.pending`. Each diagnostic identifies its component kind, original relative path, status, code and concrete missing source or native validation result. Complete stores, packages and releases are selected separately. A published release that cannot be verified remains visible with its original ID, digest and selection history; it is not replaced by a newly invented completed release.

The snapshot also retains the original `publisher-preparation` records. A preparation record has its own producer identity and directory, and contains the native request `{exportId, releaseId, label, runtime}`. The destination uses the request's `releaseId` through the original `prepareRelease` API. The imported producer record ID remains history; the original workspace creates its correctly scoped destination record.

Receiving validates each selected version store with the original loader and each package with the original package preparer. Incomplete source, or source that the original native validator rejects, stays explicitly pending. Capacity errors, ownership conflicts and I/O failures preserve the same receiving operation for ordinary recovery. The native parsed-data budget defaults to 1,000,000 rows with one cached version. A host with the required capacity can resume the same receiving ID with `maxResidentRows` up to the original loader's 16,000,000-row limit. This execution budget is recorded separately from the immutable source and receiving identity; a budget failure is never saved as invalid source.

The receiving result is `COMPLETE` when all selected source components were received, or `COMPLETE_WITH_PENDING` when the receiving pass has closed with retained unfinished components. Both states are stable results of the same request. The latter includes:

- `pending`: original component diagnostics, plus any concrete native receiving validation result.
- `historicalSource`: exact pending files materialized under `publisher/received/<id>/historical-source/`, with the original relative paths, SHA-256 values, byte counts and complete manifest digest. Their original content-addressed source bodies remain in the archive.
- `resumePreparations`: the original producer record ID, native request, producer status and action `prepareRelease`.
- `activation.unavailableActive`: true when the producer selected an active release whose native source could not be received. `localActive` stays null for that selection.
- `activation.originalStateAvailable`: whether the original release store had readable native state. A publisher that had not created any directory can return null activation and its retained preparation requests.

Historical owner, run and staging files are never installed as live ownership. The receiver excludes its own `historical-source` subtree from future active component discovery, while later archives continue retaining those bytes.

To resume an interrupted preparation, first receive the complete original workspace so its export and preparation request remain available. Then submit the retained native request through the same workspace `prepareRelease` operation. The original preparer reconstructs destination bindings from that saved export and uses its original dataset initialization, staging reconciliation and immutable-source checks. The copied historical partial files remain available for inspection. Preparation and activation remain separate original actions.

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

Recommended original workspace joins:

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

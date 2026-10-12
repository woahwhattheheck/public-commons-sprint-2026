# Protected native storage and explicit runtime adoption

The native buyer can reserve backing storage on the exact response, output and metadata file descriptors before an approved operation starts. This is intended for a shared Linux host where another worker can consume free space between a capacity check and the later write.

The normal buyer review, approval, signer, payment transport and original operator ledger continue to own the operation. Storage configuration is an execution option and does not change the economic request.

## Choose the actual allocator

The Node package exports a descriptor inspector and provider:

```js
import {
  Buyer,
  inspectNativeFileReservation,
  createNativeFileReservation,
} from '@stellar-forge/native-buyer';

const nativeFileReservation = await inspectNativeFileReservation({
  executable: '/usr/bin/fallocate',
  timeoutMs: 10000,
});

const buyer = new Buyer({
  runtimeDirectory: '/srv/starforge/sf88-operator-buyer-cli',
  stateDirectory: '/srv/buyer-state',
  operatorProfile: '/srv/operator-profile.json',
  nativeFileReservation,
});
```

The inspector resolves the selected executable to its canonical path and records its SHA-256. The Linux provider opens and hashes that same executable before each allocation, executes its held descriptor, and gives it the caller's already-open output descriptor. It uses `--keep-size`, so allocation does not add zero padding to the logical product. A replacement executable fails the saved hash check.

The serialized descriptor has exactly this shape:

```json
{
  "schema": "stellar-forge.sf88.file-reservation.v1",
  "executable": "/usr/bin/fallocate",
  "executableSha256": "THE_INSPECTED_64_CHARACTER_LOWERCASE_SHA256",
  "timeoutMs": 10000
}
```

Use the value returned by the inspector. This descriptor selects a local executable; it does not contain a wallet key or operator credential. The native bootstrap receives it through a private, hash-bound request file.

For an existing same-process allocator, `reserveFile` is also supported:

```js
const reserveFile = await createNativeFileReservation(nativeFileReservation);
const buyer = new Buyer({ ...buyerOptions, reserveFile, nativeFileReservation });
```

The callback receives `{fileHandle, path, kind, bytes, signal}`. It must complete all helper I/O before resolving and preserve the live descriptor's inode, logical length and ownership. The caller retains and writes that same descriptor. The callback cannot replace the named file, close the handle, append a sentinel, or release its allocation before the actual write. Both response and native-output callers check the resulting identity and allocated block count.

A function cannot cross a subprocess boundary. `reserveFile` protects parent operations; `nativeFileReservation` supplies the equivalent selected provider inside the original native child.

## What is allocated, and when

| Writer | Protected destination | Completion |
| --- | --- | --- |
| NativeRuntime | The actual private stdout and stderr descriptors, each up to the configured output limit | Both allocate before spawn; every exit truncates unused allocation, syncs and closes |
| SF31 response capture | The actual private response partial, up to its declared maximum, and its local reservation record | Allocation completes before the buyer call; the original stream is written once and published without padding |
| Node metadata | Original temporary file descriptors used by the selected Store scope | Original atomic publication and directory sync retain the chosen bytes |
| Attempt recorder | The selected request source and future checkpoint slots | The held checkpoint pool is established before authorization can enter the transport |
| Parent attempt/result | Selected output metadata slots around native execution | The parent can publish the original attempt and final result using retained backing |

Ordinary execution and a selected preapproval recovery reserve four 65,536-byte attempt checkpoints before native execution: the initial attempt, the actual command before spawn, the child process identity, and the terminal state. Both paths use the same saved-result bound, `min(2147483647, 2 * outputLimit + 16384)`, when reserving and reopening the result wrapper. A pre-spawn allocation failure retains its definite unstarted command receipt through the held metadata pool. The original process identity and the actual bootstrap command remain attached to that attempt.

Declaring a larger limit reserves more space. Use a genuine product limit that can contain the expected result. Insufficient backing must be resolved before starting the financial child. Linux may also reject allocation on an unsupported filesystem.

Held blocks address disk-space contention. They do not prevent process termination, a full memory cgroup, device errors or an unsupported publication operation. The original attempt/result recovery remains useful after those failures: it reads the same retained stdout, response and checkpoint records.

The low-level allocation behavior is described by the [Linux fallocate manual](https://man.archlinux.org/man/fallocate.2.en): successful allocation covers the selected file range, while `FALLOC_FL_KEEP_SIZE` preserves logical EOF.

## Keep historical source at its original path

An old attempt may bind its original execution, checkpoint reader, signer and Store source by exact hashes. Updating those files in place can prevent the old attempt from being interpreted. Place a complete reviewed replacement source tree at a distinct canonical path, retain the old tree, and select the replacement explicitly for its successor.

The source manifest contains the complete selected native source closure:

```json
{
  "schema": "stellar-forge.node-successor-runtime-source.v1",
  "sourceDirectory": "/srv/starforge-storage-v2",
  "runtimeDirectory": "/srv/starforge-storage-v2/sf88-operator-buyer-cli",
  "files": [
    {
      "path": "sf88-operator-buyer-cli/cli.mjs",
      "bytes": 1234,
      "sha256": "THE_ACTUAL_FILE_SHA256"
    }
  ]
}
```

The one entry illustrates the shape. A usable manifest includes every selected source file and the required buyer, transport, response, checkpoint, provider and bootstrap modules. The manifest is stored separately from its own file list. Paths are relative to the source root, canonical and unique. The reader checks every listed file's exact length and digest, and rejects a changed manifest, substituted path or incomplete required closure.

Select the manifest using `{directory, sourceManifestFile, sourceManifestSha256}`:

```js
const successorRuntime = {
  directory: '/srv/starforge-storage-v2/sf88-operator-buyer-cli',
  sourceManifestFile: '/srv/manifests/starforge-storage-v2.json',
  sourceManifestSha256: actualManifestSha256,
};
```

`readSuccessorRuntimeSource` reads this descriptor without running the selected code. `verifySuccessorRuntimeSource` rechecks the resulting full binding. A selected NativeRuntime receives that binding as `nativeRuntimeSource` and verifies it again before every native invocation.

## Continue the exact undispatched parent

The existing undispatched continuation operation accepts the additional source selection:

```js
const parent = buyer.operation(originalIntentId);
const child = await parent.prepareUndispatchedContinuation({
  intentId: chosenSuccessorId,
  expectedRequestSha256,
  expectedAttemptId,
  expectedConfigSha256,
  workspace: originalOperatorWorkspace,
  approvedRequestFile: originalApprovedRequestFile,
  reason: 'Use the reviewed runtime with held response and checkpoint storage.',
  successorRuntime,
});

const review = await child.review();
const result = await child.execute({ review });
```

The original authorization reader first binds the parent request, private wire, signer source and never-dispatched state. The original accounting worker then verifies the existing reserved row. One immutable choice binds the original evidence and replacement source to one successor. The parent reservation, original result files and canonical state directory remain in place.

Preparation and execution use the selected source's own Buyer and Store implementation. Repeating preparation with the same selected child reopens it; attempting to substitute another child, manifest or remediation reason conflicts with the saved choice. A native-workspace import has its own pinned command contract and cannot be moved through this direct-Node path.

Choose a compact successor ID within the original 128-character limit. An interrupted creation retains the original choice and resumes its same child. Normal review and approval are still part of executing that child.

A receiver that already has the child's exact ID can reopen it without following a later descendant:

```js
const recorded = await buyer.openOperation(savedNativeIntentId);
const result = await recorded.recover();
```

`operation(id)` remains synchronous. `openOperation(id)` is the read-only asynchronous opener that verifies an explicitly recorded runtime choice. `followContinuation()` continues to follow an already-prepared lineage when that is the caller's intent.

## Continue the same research edition

The research receiver keeps the original saved profile, operator, generated client, query, logical page IDs and edition cursor. It can separately select the protected runtime for future page intents:

```js
const retrieval = await openResearchRetrieval({
  buyerProfile: originalBuyerProfile,
  clientFile: originalGeneratedClient,
  productId: 'works',
  nativeRuntimeSource: successorRuntime,
  nativeFileReservation,
});
try {
  await workspace.gatherEdition({
    editionId: originalEditionId,
    fetchPage: retrieval.fetchPage,
  });
} finally {
  await retrieval.close();
}
```

The receiver records one immutable runtime selection under the existing buyer state. Original page intents reopen through their recorded source. An already-prepared original intent retains its original native execution and approval behavior; the selected bootstrap descriptor is attached to the selected runtime. An already-selected recovery child is followed through its original choice. A saved preapproval recovery plan is executed only with its recorded plan hash and matching review; gathering does not prepare a new recovery plan. Only absent page intents are prepared through the selected replacement Buyer. Each new native invocation rechecks the selected source manifest. A native downstream finalizer can use `await retrieval.openOperation(savedNativeIntentId)` to reopen an exact recorded page across the original and selected runtimes.

The CLI accepts the two descriptor files:

```text
research gather --workspace ORIGINAL_WORKSPACE --edition-id ORIGINAL_EDITION \
  --product ORIGINAL_PRODUCT --buyer-profile ORIGINAL_PROFILE --client ORIGINAL_CLIENT \
  --runtime-source RUNTIME_DESCRIPTOR.json --file-reservation FILE_RESERVATION.json
```

The descriptor files do not replace the original profile. Later calls can omit them: the same saved runtime selection is reopened and checked. Supplying a different selection fails before a new page operation is created. The original retrieval binding and returned provider bytes remain compatible with the same edition, exports and receiving workflow.

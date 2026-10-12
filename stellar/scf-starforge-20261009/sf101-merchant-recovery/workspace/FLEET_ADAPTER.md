# Fleet receiving workspace adapter

The workspace adapter in `fleet.mjs` connects the existing SF101 recovery workspace to the original deployed-fleet receiving engine. It exports `inspectLocalFleetRestore(options)` and `runLocalFleetPreparation({ options, state, save, cancelled })`. Authentication, original-tree verification, target ownership, file placement, native leases, generated deployment files, and the durable receiving operation remain in `merchant-fleet-gateway/recovery.mjs`.

This adapter was composed against public source `3ad908efda901b6e3bc93bb386b11f5d47dc5044`: engine blob `287d4d3da4cb339768c77182cb30e97222ee9d91`, existing workspace/local wrapper `7e24b7a2d1f2adbd0bac43c8e70b5ace2175b205`, and the original publisher file/identity helper `c59a09f58ed98997b6cb8ede44b7c0ef4db356be`. It introduces no alternate fleet engine or recovery directory.

## Review the original completed restore

The model resolves the selected existing restore and fleet-target records before calling the adapter. A public `fleetRestoreId` becomes `sourceFleetRestoreId`; a public generic `restoreId` becomes `sourceRestoreId`. Exactly one is retained in the preparation selection. The model must continue to bind that record to its original profile, snapshot, bundle and completed cold-restore destination. `fleetTargetId` retains the model's registered target declaration identity.

The inspector consumes these local selections:

| Workspace option | Original engine input |
| --- | --- |
| `bundle` | `bundleDirectory`, the existing encrypted SF101 bundle |
| `out` | `restoreDirectory`, the completed original cold restore |
| `passEnv` | `passphraseEnv`, the existing environment variable name |
| `snapshotId` | `expectedManifestSha256` |
| `targetFile` | The existing private target declaration |
| `operationDirectory` | The original native receiving operation directory |

All selected paths are normalized absolute paths. The passphrase value stays in the process environment; the adapter retains only its variable name.

`inspectLocalFleetRestore` calls the native `inspectRestoredFleet` once. The engine authenticates the bundle and checks the complete restored trees and target declaration. The adapter verifies the returned bindings and keeps the native `status`, `review`, `reviewSha256`, `summary`, `availability`, and `operation` unchanged. It adds a top-level `operationId`.

The exact identity is produced by the same imported canonical helper used by the engine:

```js
identity({ purpose: 'receive-original-fleet', reviewSha256: inspected.reviewSha256 })
```

When a native operation is already present, its actual `operation.operationId` must equal that identity and is returned directly. The complete review's canonical identity must equal `reviewSha256`. This is distinct from the workspace model's outer `expectedReviewHash`.

The native review retains the authenticated snapshot, original plan and fleet-profile hashes; target path and exact target-file hash; bundle, restore, operation and installed-source paths; declared private destination parents; new deployment-bundle path; captured numeric service UID/GID; and every root's name, original path, restored member, kind and source-tree identity.

Each root's receiving destination remains its captured `root.path`. The target file selects private parent custody and the new deployment bundle. It does not remap fleet data roots.

## Prepare through the original operation

A saved preparation selection contains:

```js
const options = {
  command: 'fleet-prepare',
  id: 'receive-original-fleet-01',
  bundle: '/private/recovery/original-bundle',
  out: '/private/recovery/original-cold-restore',
  passEnv: 'FLEET_RECOVERY_PASSPHRASE',
  snapshotId: originalSnapshotId,
  targetFile: '/private/recovery/receiving-targets.json',
  operationDirectory: '/private/recovery/fleet-receiving',
  sourceFleetRestoreId: 'original-fleet-restore', // Or sourceRestoreId; exactly one.
  fleetTargetId: 'original-target-declaration',
  expectedReviewSha256: inspected.reviewSha256,
  fleetOperationId: inspected.operationId,
  quiesced: true,
};

const result = await runLocalFleetPreparation({
  options,
  state: originalOperationState,
  save: saveOriginalOperationAtomically,
  cancelled: originalCancellationRequested,
});
```

These paths are illustrative; the model supplies the selected original records' real paths. `save` is the existing outer operation's awaited atomic save callback. The running workspace retains its existing operation serialization and host admission. The adapter neither registers a worker nor starts a merchant.

Before any asynchronous inspection or save, the adapter captures the complete relevant option selection. It stores a canonical selection identity in `state.fleetPreparation`. A resumed outer operation must use that exact source, target, environment-variable name, review, native operation ID and quiescence selection.

The adapter saves these outer progress phases:

| Progress | Retained meaning |
| --- | --- |
| `VERIFYING_RESTORED_FLEET` | The original selection is saved before native inspection. |
| Reviewed native phase | The complete native review, summary, availability and actual operation observation are retained. |
| `PREPARING_RESTORED_FLEET` | The reviewed selection and actual service identity are saved before invoking native preparation. |
| `FLEET_PREPARED` | The original native completed result has passed every review/result binding and is saved in the outer operation. |

`fleetPreparation.nativeOperation` is the actual native operation observed at `inspectedAt`; `fleetPreparation.result` is the subsequently returned or reopened completed native result. Both remain available with their original meanings.

For an unfinished native operation, the adapter requires `quiesced:true` and checks the running process's actual Linux UID/GID against the captured positive service UID/GID. It accepts no UID/GID override. The native engine independently enforces the same account before writing.

Cancellation is checked before inspection and before native preparation, including again after the final awaited outer save. A cancellation at those boundaries returns `INTERRUPTED` without calling preparation. Once native preparation is invoked, the adapter awaits its actual result or error. It does not delete an in-progress native operation or relabel a returned completion as an unstarted cancellation.

The native call receives only the original inspected inputs, `expectedReviewSha256`, and the captured true quiescence selection. The engine reauthenticates the sources, rechecks the target review and acquires its original receiving lock. Its `receiving.json` and original per-root/generation phases remain the authority for native recovery.

## Reopen an exact completed result

When native inspection reports `FLEET_RECEIVING_COMPLETE`, the adapter validates and returns the exact existing `operation.result`. It does not call `prepareRestoredFleet` again. This also recovers a native completion whose outer save or response was lost.

The completed result must match the inspected operation and review hashes; snapshot, source-plan and fleet-profile hashes; native operation and deployment-bundle paths; captured service identity; complete ordered original roots and their source-tree identities; fleet/plan summary; and installed source/runtime bindings. A previously retained outer completed result must be canonically identical. The native result object and its original `completedAt` are preserved.

The outer return follows the existing local publisher wrapper's shape:

```js
{
  status: 'COMPLETE',
  command: 'fleet-prepare',
  snapshotId, bundle, destination,
  sourceFleetRestoreId, // Or sourceRestoreId.
  fleetTargetId, fleetOperationId, reviewSha256, operationDirectory,
  prepared,            // The unchanged completed native result.
}
```

`INTERRUPTED` returns the same original selection identifiers without a fabricated `prepared` result.

Native errors propagate to the existing outer worker. An error or a failed outer save does not authorize a different target, a fresh native operation directory, or removal of retained files. Resume the same original workspace operation; its next inspection will expose the native phase, error or completed result. A changed selection/review is rejected with the corresponding `WORKSPACE_FLEET_*_CHANGED` error and needs the model's ordinary fresh review flow.

A completed return describes the original receiving outcome. Starting the prepared fleet remains the existing native deployment operator's next action. The original 7A2F receiving run and all existing source, runtime and caller ownership remain intact.

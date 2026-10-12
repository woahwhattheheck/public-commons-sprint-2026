# Recovery workspace through merchant MCP

The `recovery-workspaces` provider operates the same SF101 recovery workspace
that Applications and the browser use. An agent can inspect host-declared plans,
capture and verify an encrypted bundle, use the original off-host store, follow
a retained transfer, cold restore the original files, and prepare a restored
typed dataset publisher or managed merchant fleet. Each change uses the native selection, review hash and
operation ID.

The original listener owns its workspace lease, current execution, passphrase
environment and transfer journals. The provider attaches to that listener through
its private native launch. The package registers its metadata, configuration
reader and lazy runtime through the maintained `merchantProviders` contribution.

## 1. Start the original recovery workspace

Use the complete existing setup in [GUIDE.md](GUIDE.md). The host configuration
names its bundle parents, original operation directories, capture plans and
receiving parents. A profile can be local-only or include its existing S3
configuration. Typed publisher and fleet restores can be selected from a completed original
remote restore or declared by the host. Fleet receiving additionally selects a
host-declared target file and its original receiving operation directory.

Start that original workspace through Applications, or use its existing command:

```sh
starforge merchant-recovery-remote workspace serve \
  --config /private/recovery/host.json \
  --directory /private/recovery/workspace \
  --port 8481
```

The server prints its browser URL and a JSON ready record. It also atomically
publishes `recovery-workspace-launch.json` inside the same private workspace.
The native record binds this listener instance to the existing workspace ID,
host-configuration SHA256 and selected original source directory. It contains
the current browser session and is read only on the owning host.

On a normal server restart, the original workspace ID remains stable and the
listener publishes its new instance and session. MCP reads that current launch
when a tool is used. The native server removes its own launch while it still owns
the workspace lease during shutdown.

For an installed deployment, invoke the original runtime with the features the
host already uses. A remote S3 profile uses the existing `s3` dependency closure.
The environment and supported Node version for `proxyEnvironment` remain those
documented in [REMOTE.md](../REMOTE.md#deployments-that-use-an-outbound-proxy).
Local-only profiles use their original local capture and verification behavior.

## 2. Declare the host connection

Create an owned private JSON file, for example
`/private/recovery/merchant-connection.json`:

```json
{
  "schema": "stellar-forge.recovery-workspace-connection.v1",
  "workspaces": {
    "merchant": {
      "label": "Merchant recovery",
      "directory": "/private/recovery/workspace",
      "configFile": "/private/recovery/host.json"
    }
  }
}
```

The connection file is a regular single-link file with mode 0600; the original
workspace is an owned canonical private directory with mode 0700. It declares
one to thirty-two aliases. Each original workspace has one alias. Paths in this
connection resolve against the connection file's parent.

If Applications runs another complete installed copy of the original recovery
source, set that alias's optional `sourceDirectory` to its
`sf101-merchant-recovery/workspace` directory. Otherwise the provider uses its
own installed original workspace source. The source must include the maintained
`connection.mjs`; its reader verifies the retained launch against the actual
authenticated native listener.

Configuration reads bind the existing workspace ID and host-file digest without
opening a second writer. Tool calls re-read the actual source and current native
launch. Changing the host file requires reopening the native workspace and
reloading the MCP connection so both use the same selected configuration.

The agent supplies aliases and IDs. Filesystem roots, S3 endpoint configuration,
source module paths and passphrase environment-variable names stay in the
original host selection. The session token is sent only to that selected local
listener. Tool results expose the listener instance and workspace/configuration
identities; they retain the original reviewed source and destination paths.

## 3. Add the provider to a merchant

For an existing merchant MCP configuration, add its original
`recoveryWorkspaceConnection` field and reopen that same merchant:

```json
{
  "recoveryWorkspaceConnection": "/private/recovery/merchant-connection.json"
}
```

Keep the merchant's existing schema, name, releases, sources, exports and other
provider selections. The maintained reader discovers the new input from the
source-owned provider registry.

For a new merchant host, create a private setup file:

```json
{
  "directory": "/private/recovery-agent",
  "connection": "/private/recovery/merchant-connection.json",
  "name": "Merchant recovery"
}
```

Then use the installed provider setup command:

```sh
starforge merchant-providers inspect recovery-workspaces
starforge merchant-providers init recovery-workspaces \
  --options /private/recovery/merchant-setup.json
```

This creates the original merchant MCP configuration and its standard private
release/export directories. The returned `configuration` path is the input to
the existing merchant HTTP or stdio launch. For example, from the selected
complete source:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/recovery-agent/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
```

Use that merchant's existing MCP authentication and client connection procedure.
The initialized configured provider advertises the following tools.

| Tool | Original operation |
| --- | --- |
| `merchant_recovery_status` | Existing workspace, profiles, plans, restored publishers/fleets, receiving targets and active execution. |
| `merchant_recovery_bundles` | Local encrypted bundle candidates under the selected profile's declared parents. |
| `merchant_recovery_inventory` | Paginated completed snapshots in the original remote store. |
| `merchant_recovery_requests` | Paginated retained workspace requests, including local operations. |
| `merchant_recovery_request` | One exact profile/operation request with attempts, progress, native result and error. |
| `merchant_recovery_operations` | Paginated original off-host transfer journals. |
| `merchant_recovery_operation` | One original remote push, pull or restore journal. |
| `merchant_recovery_review` | The exact native source/destination selection and review hash. |
| `merchant_recovery_start` | Start that unchanged selection at its reviewed hash. |
| `merchant_recovery_resume` | Continue the same retained workspace request. |
| `merchant_recovery_cancel` | Request a native stop and retain the original journal. |

## 4. Inspect the actual host and source

A status call uses only the declared alias:

```json
{
  "name": "merchant_recovery_status",
  "arguments": { "workspace": "merchant" }
}
```

The result is the original workspace state plus a `workspace` alias and
`connection` identity. Inspect its actual profile IDs, capture plan IDs, bundle
roots, `remoteConfigured`, declared `publisherRestores`, `fleetRestores`,
`fleetTargets` and current execution.
It reports passphrase availability in the native server environment without
returning the passphrase.

For an existing bundle:

```json
{
  "name": "merchant_recovery_bundles",
  "arguments": { "workspace": "merchant", "profileId": "primary" }
}
```

Keep the returned `bundleId` and exact `snapshotId`. The list identifies
candidates; authenticated verification is performed by the original engine when
the bundle is selected. A malformed candidate is returned in the native
`errors` collection with its identity so the remaining list remains usable.

For remote inventory:

```json
{
  "name": "merchant_recovery_inventory",
  "arguments": {
    "workspace": "merchant",
    "profileId": "primary",
    "limit": 20
  }
}
```

Follow the original `nextCursor` unchanged, with the same workspace and profile.
The three paginated collections accept limits from 1 through 100. Requests use
the native workspace cursor; operations use the original journal cursor;
inventory preserves the original provider/facade cursor. Each page retains its
native completeness marker and per-item errors.

## 5. Capture and verify using the original plan

Pause source producers through their actual owning controls, inspect the
declared plan, and explicitly acknowledge quiescence for the fresh capture.
The original paid-job integration also retains its component leases across
capture and verification. The producer acknowledgment and selected source
roots remain part of the native review.

A complete capture review is:

```json
{
  "name": "merchant_recovery_review",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "snapshot",
      "id": "month-end-capture",
      "capturePlanId": "merchant-state",
      "destinationName": "month-end",
      "quiesced": true
    }
  }
}
```

Review its exact plan, roots, file/byte counts and destination. Retain the
returned `reviewHash` and the entire original selection. Start it with those
same values:

```json
{
  "name": "merchant_recovery_start",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "snapshot",
      "id": "month-end-capture",
      "capturePlanId": "merchant-state",
      "destinationName": "month-end",
      "quiesced": true
    },
    "expectedReviewHash": "THE_64_HEX_NATIVE_REVIEW_HASH"
  }
}
```

Replace the descriptive hash placeholder with the actual review value. The
native engine rechecks it, retains the request and starts its original capture.
A `RUNNING` or `PREPARED` response means the operation has been accepted.
Use the same profile and ID for progress:

```json
{
  "name": "merchant_recovery_request",
  "arguments": {
    "workspace": "merchant",
    "profileId": "primary",
    "id": "month-end-capture"
  }
}
```

The returned `phase`, `running`, `attempts`, `local`, `operation` and
`error` are the original native values. A completed local result appears in
`operation`; the separate `local` member carries retained local execution
details. Read the final original `COMPLETE` outcome before selecting the bundle
for its following transfer.

List bundles again and use the actual captured `bundleId`. A separate local
verification is reviewed with
`{profileId, action: "verify", id, bundleId}`, then started with its exact
review hash. Both actions work for a local-only profile.

## 6. Upload, select, download and cold restore

All transfer selections go through the same review/start pair:

| Action | Complete native selection |
| --- | --- |
| `push` | `profileId`, `action`, stable `id`, returned `bundleId`. |
| `pull` | `profileId`, `action`, stable `id`, exact remote `snapshotId`; optional `destinationName`. |
| `restore` | The pull fields, with optional existing `bundleId` matching that same snapshot. |
| `resume` in a review | `profileId`, `action: "resume"`, original remote journal `id`. |

For example, review an upload using the returned local bundle:

```json
{
  "name": "merchant_recovery_review",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "push",
      "id": "month-end-upload",
      "bundleId": "snapshots/month-end"
    }
  }
}
```

The review shows the actual store identity, original bundle, manifest snapshot
SHA and file/byte counts. Start only that unchanged selection at its native
hash. The original remote engine verifies the encrypted bundle and publishes
its immutable objects and completion descriptor. Follow
`merchant_recovery_request` or the original `merchant_recovery_operation`
journal until its recorded result is complete.

A receiving selection uses the exact remote `snapshotId` from that completed
descriptor:

```json
{
  "name": "merchant_recovery_review",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "restore",
      "id": "month-end-receive",
      "snapshotId": "THE_64_HEX_ORIGINAL_SNAPSHOT_ID",
      "destinationName": "month-end-received"
    }
  }
}
```

Review and start it with the actual snapshot ID and returned hash. The native
profile derives the encrypted download and clear restored destination under
its declared parents. The original engine checks every retained encrypted
object, authenticates the bundle and restores the original file layout.

A `pull` selection stops at an authenticated local encrypted bundle. A
`restore` selection carries that same original bundle through cold restoration.
If an existing local bundle is supplied for restore, its manifest must identify
the selected remote snapshot.

## 7. Prepare a restored typed dataset publisher

After an original remote `restore` is `COMPLETE`, review the following separate
workspace operation:

```json
{
  "name": "merchant_recovery_review",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "publisher-prepare",
      "id": "month-end-publisher",
      "restoreId": "month-end-receive"
    }
  }
}
```

For a host-declared restored publisher, use the exact
`publisherRestoreId` from status instead of `restoreId`. This mode works for a
local-only profile. Supply exactly one of those source selectors.

Inspect the actual original bundle, restored roots, snapshot, native preparation
review and resulting source/publisher paths before starting. The workspace
binds the existing typed recovery operation and its review SHA. Read the same
request for `RESTORED_PUBLISHER_PREPARED` in its retained completed native result,
then reopen through those prepared original application paths and instructions.

The original typed adapter preserves publication history, workbook and mapping
editions, merchant/source bindings and retained recovery progress. Its detailed
receiving contract is in
[DATASET_PUBLISHER.md](../DATASET_PUBLISHER.md). The browser and the MCP result
refer to that same saved preparation.

## 8. Prepare a restored managed merchant fleet

Fleet preparation uses the original managed-fleet receiver. It authenticates the
selected encrypted bundle and restored files, binds the saved fleet plan and
service identity, and prepares the original receiving roots and deployment
bundle. Its journal and completed result remain under the host's selected
operation directory.

The host adds these members to the existing recovery profile, using the actual
retained paths on that machine:

```json
{
  "fleetRestores": [
    {
      "id": "fleet-october",
      "label": "Original October fleet restore",
      "bundleDirectory": "/private/recovery/bundles/fleet-october",
      "restoreDirectory": "/private/recovery/restored/fleet-october"
    }
  ],
  "fleetTargets": [
    {
      "id": "original-fleet-host",
      "label": "Original fleet service paths",
      "targetFile": "/private/recovery/fleet-targets.json",
      "operationDirectory": "/private/recovery/fleet-operations/october-receive"
    }
  ]
}
```

The encrypted bundle and restored folder must lie within the profile's declared
source parents. The target file uses the original
`stellar-forge.fleet-recovery-targets.v1` contract: the captured
`sourcePlanSha256`, approved absolute `destinationParents`, and a new
`deploymentBundle` destination. Obtain those values from the retained
original fleet plan and the receiving host. The complete target contract and
source ownership rules are in
[managed fleet recovery](../../merchant-fleet-gateway/RECOVERY.md).

The receiver retains the original absolute root paths and captured service
UID/GID. Use the actual matching nonroot Linux service account. Before a first
preparation, the selected original receiving paths must be available and the
source producers must be stopped. The native review reports each path's actual
availability; an existing unrelated target is an error. Keep the original
stopped source and its recovery artifacts under their existing custody.

Read `merchant_recovery_status` and choose its actual `fleetRestoreId` and
`fleetTargetId`. A local restored-source selection is:

```json
{
  "name": "merchant_recovery_review",
  "arguments": {
    "workspace": "merchant",
    "selection": {
      "profileId": "primary",
      "action": "fleet-prepare",
      "id": "october-fleet-receive",
      "fleetRestoreId": "fleet-october",
      "fleetTargetId": "original-fleet-host",
      "quiesced": true
    }
  }
}
```

For an original completed remote restore, replace `fleetRestoreId` with that
request's `restoreId`. Supply exactly one source selector. The target selector
and explicit `quiesced: true` remain required in both modes. Filesystem paths,
environment-variable names and a caller-supplied native operation ID are not
part of this public selection.

Inspect the complete workspace review. It includes the original snapshot and
plan identity, target declaration, source and destination roots, captured
service account, native receiving review and its deterministic operation ID.
Retain the two distinct review identities:

| Review identity | Use |
| --- | --- |
| Workspace `reviewHash` | Send as `expectedReviewHash` to the existing workspace start call. |
| Native receiving `reviewSha256` | The workspace retains and binds this value when invoking the original fleet engine. |

Start with the exact selection above and the returned outer
`expectedReviewHash`, using `merchant_recovery_start`. Read
`merchant_recovery_request` with the same alias, profile and
`october-fleet-receive` ID until its original native result is complete.
A completed receiver reports `FLEET_RECEIVING_COMPLETE` and retains
`operationId`, `snapshotId`, `sourcePlanSha256`, `profileSha256`,
`reviewSha256`, service UID/GID, original and prepared deployment bundles,
root records, runtime instructions and `completedAt`.

If a response is lost, read the same workspace request first. Continue it
through `merchant_recovery_resume` when the original source and target remain
selected. The original receiving journal preserves prepared roots and its
write progress. Reopening completed preparation returns the original result.
Do not create another request or target directory to resolve an uncertain
response.

Preparation ends with the retained receiving result. Start the prepared fleet
through its original managed deployment controls, then inspect native health,
release state and customer export provenance. Rollback and later reopen use
those original fleet operations. The separate fleet Applications product can
attach through its own configured original deployment.

## 9. Continue an interruption or stop the current execution

After a lost `start`, `resume` or `cancel` response, read
`merchant_recovery_request` for the same alias, profile and ID. Keep the original
selection and review. For a remote operation that has a journal but has not yet
been adopted into this workspace, inspect `merchant_recovery_operation`, then
review `action: "resume"` and start that reviewed adoption.

A retained workspace request is continued with:

```json
{
  "name": "merchant_recovery_resume",
  "arguments": {
    "workspace": "merchant",
    "profileId": "primary",
    "id": "month-end-receive"
  }
}
```

The original model rechecks its saved host/path/snapshot binding. Completed work
is returned from its retained result. An incomplete fresh capture can require a
new native review and fresh quiescence acknowledgment; its existing output and
original capture ownership remain part of that review.

To request a stop, use `merchant_recovery_cancel` with the same three arguments.
The native model records the request and closes the active original transfer
handle. Local verification, restore or fleet preparation can complete after a stop request.
Continue reading the same operation until its actual completion or interrupted
state is visible.

The adapter does not retry a mutation after a transport failure. The original
MCP transport retains errors as `code` and `reason`; for a native HTTP failure,
`reason` is a JSON object containing the sanitized original error, HTTP status,
profile/operation scope and exact readback tool. Provider request IDs,
`retryAfter`, retryability, reconciliation fields and an uncertain-commit flag
remain in that envelope. `mutationRequestAttempted` identifies a mutation
request attempt; `OUTCOME_UNKNOWN` directs the same-ID native readback.

Direct JavaScript callers receive that object on `error.details` as well.
Authentication, source identity and configuration errors raised before a native
operation keep their original code and message. A response-size error directs
the caller to an exact retained request or a smaller page. The native HTTP body
limit is 64 KiB and this adapter accepts replies up to 32 MiB.

Closing the MCP server drains its accepted adapter HTTP calls. The original
recovery workspace continues to own any accepted operation. Use its native
cancel, status and normal Applications/browser lifecycle for that execution.

## 10. Use the complete workflow from the CLI

The workspace CLI exposes the same original listener and merchant client. Keep
the selected complete installed source, private host configuration and workspace
directory unchanged. Start the listener with the existing `serve` command, or
open it through Applications. Then inspect it:

```sh
starforge merchant-recovery-remote workspace status \
  --config /private/recovery/host.json \
  --directory /private/recovery/workspace
```

All commands in the table take those same `--config` and `--directory`
arguments. They borrow the listener; they do not acquire a second workspace
writer or start a new server.

| Command | Additional arguments | Native result |
| --- | --- | --- |
| `status` | None | Current workspace and configured selectors. |
| `bundles` | `--profile ID` | Original encrypted bundle candidates. |
| `inventory` | `--profile ID [--cursor CURSOR] [--limit N]` | Original remote snapshot page. |
| `requests` | `[--cursor CURSOR] [--limit N]` | Retained local and transfer requests. |
| `request` | `--profile ID --id ID` | One exact workspace request. |
| `operations` | `--profile ID [--cursor CURSOR] [--limit N]` | Original remote journal page. |
| `operation` | `--profile ID --id ID` | One original remote journal. |
| `review` | `--selection ABS_SELECTION_JSON` | Full review and outer review hash. |
| `start` | `--selection ABS_SELECTION_JSON --expected-review-hash HASH` | Original accepted or completed request. |
| `resume` | `--profile ID --id ID` | Continuation of the same saved request. |
| `cancel` | `--profile ID --id ID` | Native stop request and retained state. |

Use `request` and `requests` for fleet preparation. The `operation` and
`operations` commands inspect original remote transfer journals. Page sizes
are 1–100; continue an opaque cursor with its unchanged workspace/profile/query.

For fleet receiving, save the complete selection object from section 8, without
the MCP name/arguments wrapper, in an owned mode-0600 regular file at an
absolute canonical path. The CLI reads at most 64 KiB and checks that its bytes
remain unchanged during the read.

```sh
starforge merchant-recovery-remote workspace review \
  --config /private/recovery/host.json \
  --directory /private/recovery/workspace \
  --selection /private/recovery/fleet-selection.json

starforge merchant-recovery-remote workspace start \
  --config /private/recovery/host.json \
  --directory /private/recovery/workspace \
  --selection /private/recovery/fleet-selection.json \
  --expected-review-hash THE_ACTUAL_64_HEX_WORKSPACE_REVIEW_HASH

starforge merchant-recovery-remote workspace request \
  --config /private/recovery/host.json \
  --directory /private/recovery/workspace \
  --profile primary \
  --id october-fleet-receive
```

Replace the descriptive hash placeholder with the actual returned
`reviewHash`. Every caller returns the same native fields and connection
identity as MCP. A failed mutation response includes the original structured
readback details; use its profile and ID before resuming. Stopping a CLI process
only ends that caller. Observe the original request through the still-running
workspace to determine whether its native work completed.

The existing `show` command remains an offline/read-only view of saved state and
can run beside the server without its controller lease. `status` reads the
actual running native listener. `serve` continues to own the original normal
shutdown and retained-operation lifecycle.

## 11. Source and installed API

The contribution is
`distribution/contributions/merchant-provider-recovery-workspaces.json`.
The provider declares its own catalog, host input, reader, lazy constructor,
concurrency, instructions and setup hook. The original shared registry composes
it with the selected distribution and verifies installed source files.

Installed exports:

| Export | API |
| --- | --- |
| `./merchant/mcp/recovery` | `MerchantRecoveryWorkspaces`, `readRecoveryWorkspaceConfiguration`, tool metadata and typed selection/input declarations. |
| `./merchant/mcp/recovery/setup` | `initializeRecoveryWorkspaceMerchant` using the original merchant configuration. |
| `./merchant/recovery/workspace/connection` | Native selection and current private launch readers with identity types. |

Programmatic attachment follows the same source:

```js
const recoveryWorkspaces =
  await readRecoveryWorkspaceConfiguration('/private/recovery/merchant-connection.json');
const recovery = new MerchantRecoveryWorkspaces({ recoveryWorkspaces });
try {
  const state = await recovery.call('merchant_recovery_status', { workspace: 'merchant' });
  // Select IDs from this native state; retain each full native review before start.
} finally {
  await recovery.close();
}
```

The browser, direct CLI, installed Applications provider and merchant MCP use the
same original SF101 workspace and underlying recovery engines. A receiving host
selects its own declared paths and operation IDs while retaining the source
host's snapshot and original journal in the handoff.

## 12. Receive an existing workspace through merchant MCP

The installed `merchant-recovery-mcp-receive` command carries an existing
recovery workspace through the actual registered merchant transport. Select
the retained original encrypted bundle and the completed upload, download, or
restore journal IDs from that workspace's declared profile. This operation
uses the installed source, original verifier, actual configured remote
inventory, and original local HTTP services.

Finish the current native workspace operation and close its listener before
this receiving command takes that same workspace's existing lease. Keep the
original passphrase and storage credential environment available to this
process. Use the supported Node version and existing S3 runtime profile
described in the remote guide.

Create a private input file:

```json
{
  "schema": "stellar-forge.recovery-merchant-receiving.v1",
  "directory": "/private/recovery/mcp-receiving",
  "workspaceDirectory": "/private/recovery/operator",
  "hostConfig": "/private/recovery/host.json",
  "profileId": "merchant",
  "bundleId": "snapshots/month-end",
  "snapshotId": "THE_64_HEX_ORIGINAL_SNAPSHOT_ID",
  "operationId": "merchant-mcp-receiving-20261012",
  "workspace": "merchant",
  "completedOperations": [
    { "id": "month-end-upload", "command": "push" },
    { "id": "receiving-download", "command": "pull" },
    { "id": "receiving-restore", "command": "restore" }
  ]
}
```

Replace the example profile, bundle, exact snapshot and operation IDs with
their retained native values. Select each relevant completed journal once.
The receiving operation ID is distinct from those transfer IDs and stays
unchanged on continuation. Its verification request uses the same ID with
`-verify` appended. The output directory is private, has an existing parent,
and sits beside the original workspace.

```sh
starforge merchant-recovery-mcp-receive \
  --input /private/recovery/merchant-receiving.json
```

From a complete original source tree, the same entry is:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/native-receiving.mjs \
  --input /private/recovery/merchant-receiving.json
```

The command performs the following whole receiving operation:

1. Retain the exact selected input under the original Linux delivery lease,
   inspect the registered provider, and initialize its original private merchant
   configuration.
2. Open the selected native workspace and merchant MCP on loopback, initialize
   the actual protocol, and read the original state and encrypted bundle.
3. Review and verify that bundle through MCP. Continuation reads the same native
   verification request before starting or resuming it.
4. Read the selected completed original transfers and adopt their completion
   into the workspace. Their original command, snapshot, destination and
   provider receipts remain the source of the completed result.
5. Read the actual configured storage inventory and complete native journal
   pages, following each original cursor.
6. Read back the completed verification through continuation and idle
   cancellation, retaining its existing attempt count.
7. Close the merchant host, read the still-running original native listener,
   then close and reopen that native workspace and merchant host. Read back the
   same complete request under the new listener instance and original workspace
   identity.
8. Close both owned services and save the complete receiving result.

The private output contains `selection.json`, the original reviewed selection,
the merchant configuration and connection, and `result.json` after completion.
A stopped attempt retains its actual phases and error in an `attempt-*.json`
file; the error names that file and the original receiving ID. The original
workspace and transfer journals retain accepted work. Continue with the same
input command. A previously complete receiving result returns directly from
its original file.

Keep these receiving files with the private host handoff. The full result
contains native workspace paths, IDs, provider receipts, and source metadata;
the console prints the operation, snapshot, final status and result path.
Passphrases and listener tokens remain in the original private environment and
native launch.

The programmatic export `./merchant/mcp/recovery/receive` provides
`receiveRecoveryWorkspaceMerchant(input, { onProgress })` and its input/result
declarations. It uses the same original entry and saved native request.

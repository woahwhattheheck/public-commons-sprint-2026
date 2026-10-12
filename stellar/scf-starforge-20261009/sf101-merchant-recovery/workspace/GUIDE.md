# SF101 recovery workspace operating guide

Use this workspace to publish an existing original encrypted merchant snapshot,
find a completed recovery point on the selected storage service, download and
authenticate it, and restore its original named roots on a receiving host.

The workspace operates the maintained `runRemote` facade and `recover.mjs`.
Its original transfer journal remains the saved record of the upload, download,
or restore. The browser adds profile selection, a review of the exact operation,
progress, and reopening that retained work.

## Prepare the recovery host

Use the release that contains `merchant-recovery-remote workspace`. Prepare
the host with the existing storage access and the original recovery passphrase.
The [remote recovery guide](../REMOTE.md#operator-setup) defines the private S3
configuration, existing credential providers, optional proxy transport, and
supported Node versions.

The host administrator chooses these separate locations:

| Location | Purpose |
| --- | --- |
| Workspace host configuration | Names the available profiles and their permitted storage and local parents. |
| Workspace state directory | Retains this operator workspace's local work. Reopen this same directory when continuing it. |
| A profile's `storeConfig` | The existing private S3 configuration used by the original adapter. |
| A profile's `operations` | The original transfer journals and provider acknowledgements for that merchant. |
| A profile's `bundleRoots` | Named collections containing existing original encrypted snapshots. |
| A profile's `downloadRoot` | The parent for encrypted bundles received from the selected storage service. |
| A profile's `restoreRoot` | The parent for new plaintext cold-restore destinations. |

Use normalized absolute paths and private directories owned by the operating
account. Keep the operations directory separate from the selected encrypted
bundle and restore destinations. Each original restore creates a new plaintext
directory under the declared restore parent.

For the example paths in this guide, prepare the parent directories:

```sh
install -d -m 700 /private/merchant-recovery /private/merchant-recovery/operations /private/backups /private/downloads /private/restored
```

Retain the existing S3 configuration at
`/private/merchant-recovery/remote.json`. Save the following host configuration
as `/private/merchant-recovery/workspace.json`, replacing the profile labels and
paths with the actual merchant's selections:

```json
{
  "schema": "stellar-forge.recovery-workspace.v1",
  "title": "Merchant recovery",
  "profiles": [
    {
      "id": "merchant-a",
      "label": "Merchant A",
      "storeConfig": "/private/merchant-recovery/remote.json",
      "operations": "/private/merchant-recovery/operations",
      "passEnv": "SF101_RECOVERY_PASSPHRASE",
      "bundleRoots": [
        {
          "id": "accepted-backups",
          "label": "Accepted merchant backups",
          "directory": "/private/backups"
        }
      ],
      "downloadRoot": "/private/downloads",
      "restoreRoot": "/private/restored"
    }
  ]
}
```

```sh
chmod 600 /private/merchant-recovery/workspace.json /private/merchant-recovery/remote.json
```

`storeConfig` references the original
`stellar-forge.merchant-recovery-s3.v1` configuration. `passEnv` references an
existing environment variable by name. Provision its value through
the merchant's existing secret-management procedure before starting the
workspace. The browser uses the configured profile; it does not need a
passphrase entry form or an AWS credential field.

For multiple merchants, use clear profile labels and the actual original
operations directory for each merchant. The original transfer facade serializes
writers within an operations directory. Preserve that directory when moving
between the browser and headless commands.

## Start the installed operator

Start the workspace on the recovery host:

```sh
starforge merchant-recovery-remote workspace serve \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator \
  --port 8481
```

The server binds only to `127.0.0.1` and prints its capability URL. Open the
complete printed URL through the host's existing browser access. Its random
access token is in the URL fragment; the browser supplies that token in the
`X-Recovery-Token` header. The token stays out of the request path and query
string. The page retains it in session storage for reload and clears the
fragment from the displayed address. Treat the printed URL as the current
session's access credential.

Reuse the same host configuration and workspace directory when reopening the
operator. A restarted server prints its current capability URL.

For a customer runtime created by the original runtime installer:

```sh
starforge runtime-install run --dir /private/starforge-runtime -- \
  merchant-recovery-remote workspace serve \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator \
  --port 8481
```

The runtime profile must include the original `s3` feature, selected with
`--feature s3` during preparation. The distribution derives that feature from
the retained `sf30-seller-sdk/s3/package.json`; its selected SDK is installed
beside the original package. The runtime launcher checks the saved installation
and forwards the same command arguments to the original remote CLI.

The launcher also retains its calling Node executable. Start it with the Node
version required by the selected transport. In particular, the configured
proxy path needs Node 22.21.0 or later within 22.x, Node 24.5.0 or later within
24.x, or a supported later major.

The source entry is available directly when operating an existing source
deployment:

```sh
node /path/to/release/stellar/scf-starforge-20261009/sf101-merchant-recovery/remote-cli.mjs workspace serve \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator \
  --port 8481
```

### Inspect saved workspace state

The read-only command can run beside the server:

```sh
starforge merchant-recovery-remote workspace show \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator
```

It reads this workspace's saved state. Use **Refresh inventory** in the browser
for a current provider inventory and **Refresh progress** for the original
selected operation's latest saved phase.

## Open through Applications

The installed runtime workspace offers **Merchant recovery** as an application.
Choose a runtime containing this workspace and its `s3` feature. Select the
original private host configuration and the same private recovery workspace
directory. For a new workspace directory, its private parent must already exist.
Use the optional private environment JSON for the original AWS, proxy and
passphrase environment values.

The Applications review retains the exact host configuration digest, its
referenced S3 configurations, bundle roots, original journal directory, and
download and restore parents. Saving and starting use the maintained
Applications path review and resource lock. Reopen the saved application with
those original paths to keep its recovery work available.

After the server opens, its startup output includes one JSON line with status
`MERCHANT_RECOVERY_WORKSPACE_READY`, the original `configFile`, `directory`
and private `url`. The launcher checks both selected paths before presenting
that URL. The existing human-readable URL remains available to direct CLI
operators.

Applications **Stop** sends the original graceful shutdown to this server.
The server stops accepting new changes, requests cancellation of its owned
transfer, reads back the original result, and releases its workspace lease.
An original local verification or restore may finish during this shutdown.
Open the same saved application again, inspect that retained result, and use
**Continue operation** for unfinished transfers.

## Embed the maintained workspace

The installed package exposes the original model and loopback server through
`@tokenjunkielabs/starforge-merchant/merchant/remote-recovery/workspace` and
`@tokenjunkielabs/starforge-merchant/merchant/remote-recovery/workspace/server`.

`readRecoveryConfiguration(configFile)` reads and validates the exact private
host configuration and returns `{configFile, sha256, host}`. It opens neither
a provider connection nor a workspace lease. Launchers can use the returned
path selection to retain original file and directory bindings.

`openRecoveryWorkspace({configFile, directory, readOnly})` owns the original
workspace controller. Call `close({cancelActive: true})` when shutting down a
writable instance. The HTTP entry
`serveRecoveryWorkspace({configFile, directory, port})` returns its original
`url`, `close` method and `closed` promise. Its adjacent
`browser-assets.json` supplies the same three route and MIME declarations to
the maintained HTTP handler and distribution collector.

## Publish an existing merchant backup

Begin with a completed original snapshot. For a running SF99 merchant, use its
original maintenance backup so the service group and delivery outbox are
quiesced together. Use the `snapshot.bundle` location returned by that completed
maintenance operation. The [snapshot procedure](../REMOTE.md#1-obtain-the-original-consistent-snapshot)
also covers an existing accepted snapshot and an already stopped native source.

1. Choose the intended merchant profile.
2. Open its local bundle collection and select the existing encrypted snapshot.
   Review its exact manifest identity, recorded creation time, original file
   count, and named roots.
3. Choose **Review transfer** and inspect the upload's configured store,
   snapshot, original bundle location, and operation identity.
4. Choose **Start transfer** for that reviewed operation and keep its operation
   ID available for reopening.

The server binds the selected store and local paths at review and checks the
same selection again before start. If a host configuration or selected source
changes, reopen the selection and review the resulting current operation.

The original transfer authenticates the snapshot before publishing it. It sends
the existing `objects/*.gcm` content and original `manifest.json`, retaining
provider acknowledgements. The completion descriptor is the final publication.
The completed result identifies the exact `snapshotId`, `completionKey`,
original file and byte counts, configured store, verification, and provider
receipt.

An interrupted upload keeps its selected snapshot and operation ID. Reopening
that operation reuses matching immutable remote objects through the original
transfer logic. The existing merchant backup remains the source of that
continuation.

## Find and download a recovery point

Choose the intended profile and select **Refresh inventory**. Inventory is read
from the actual configured bucket, endpoint, and prefix. Follow its pages to
locate the desired snapshot. The original remote inventory accepts an opaque
page cursor; its default page size is 20, with a maximum of 100 per request.

A recovery point is selected by its complete 64-character `snapshotId`.
Creation time, file and byte counts, root count, completion key, and any returned
provider version identify its saved descriptor. The original engine
authenticates the selected bundle during retrieval.

For an encrypted download:

1. Select the exact remote snapshot.
2. Choose **Review transfer** and inspect the destination proposed under the
   configured encrypted-download parent, along with the store and snapshot.
3. Choose **Start transfer** for that reviewed download. **Refresh progress**
   reads its saved phase and object progress.
4. Retain the completed bundle location and verification result.

The download rebuilds the original `manifest.json` and `objects/*.gcm` layout.
It verifies ciphertext against the selected manifest and then invokes the
original full snapshot authentication.

To resume a partial download, reopen its retained operation. Its original
snapshot, destination, and store remain the transfer selection. Completed files
are rehashed and reused; the interrupted object is retrieved as needed.

## Perform a cold restore

Provision the original snapshot passphrase and existing store access on the
receiving host. Choose the receiving host's profile and select the exact remote
snapshot.

Review both destinations before starting:

| Destination | Meaning |
| --- | --- |
| Encrypted bundle | The original downloaded manifest and encrypted objects. |
| New plaintext restore directory | The separate destination for the snapshot's original named roots and files. |

The original restore verifies the complete selected snapshot before creating
its new plaintext destination. It preserves the original logical root layout
and the SF101 private file and directory modes.

Follow the operation through download, verification, and restore. A completed
restore retains `originalRestore.status: RESTORED_TO_NEW_DIR`, its destination,
and the original file and byte totals. Preserve that result with the operation
ID and snapshot ID.

If the original restore finished immediately before its final transfer-journal
write was interrupted, retry the same operation. The facade authenticates the
encrypted bundle, checks the expected restored directories and file hashes,
and retains the matching outcome with `originalRestore.reconciled: true`.
An incomplete or changed destination remains available for inspection; a fresh
cold restore uses a new destination and operation.

Use the completed restored roots in the original merchant's receiving-host
procedure. The SF99 restored-host preparation maps original paths and preserves
configuration filenames when composing the restored host. Start the original
components against that selected state, reconcile the original catalog and
event identities, and complete the deployment's existing transition procedure.

## Follow progress, cancel, and continue

The original journal's `status` is the last saved transfer phase.
`progress.nextObject`, `written`, `reused`, and `bytesWritten` describe
encrypted-file progress. The manifest and completion descriptor are separate
metadata objects. Use the retained status and error together:

| Saved phase | What the operator is following |
| --- | --- |
| `PREPARED` / `VERIFIED` | The operation is bound; an upload records successful original snapshot authentication. |
| `UPLOADING` / `COMPLETING` | Original encrypted objects are being acknowledged, followed by manifest and completion publication. |
| `DOWNLOADING` / `DOWNLOADED` | The encrypted bundle is being assembled or is available for final authentication and restore. |
| `RESTORING` | The original cold restore is writing the selected new destination. |
| `COMPLETE` | The operation retains its completed original verification or restore result. |

An error is retained as `lastError` with the current phase. Provider identifiers,
retry timing, and any uncertain-write information accompany the original
failure when available. Correct the reported input, host, or provider cause,
then continue the retained operation.

**Stop transfer** closes only the S3 client owned by the selected workspace
execution and retains its original journal. An in-progress local verification
or cold restore may finish after that request. Use **Refresh progress** to read
the resulting saved phase. When the original journal records `COMPLETE`, that
completed result is the operation's outcome.

A completed provider write can already exist when its response is interrupted.
The original continuation logic reads back the same immutable selection. Use
**Continue operation** with the same operation ID; an already completed
operation returns its retained result. A change of snapshot, store, or
destination is a separate reviewed operation.

The headless status command reads the same original local journal:

```sh
starforge merchant-recovery-remote status \
  --operations /private/merchant-recovery/operations \
  --id ACTUAL_OPERATION_ID
```

It needs the operations directory and ID. It can read saved progress while the
transfer is active and while storage access is being restored.

## Reopen and hand over the operating workspace

Reopen with the same workspace directory and host configuration. Select the
merchant profile and its retained operation. Use the original journal and
completed result to recover the current operation state after a browser or
process interruption.

A retained operation keeps its original store, command, and absolute paths.
For a receiving host with different local parent directories, create that
host's configuration and workspace, then select the same completed remote
snapshot in a new operation. Retain the source host's journal with the handoff
so the receiving operator can follow both original operation identities.

Retain these items for the receiving operator:

| Retained item | Use at handoff |
| --- | --- |
| Source release and installed runtime identity | Launch the same maintained commands with their selected dependency closure. |
| Workspace host configuration and workspace state | Reopen the permitted profiles and retained operator work. |
| Original S3 configuration | Identify the existing bucket, prefix, endpoint, and credential provider. |
| Original operations directory | Reopen exact transfer bindings, progress, completion, and provider acknowledgements. |
| Snapshot ID and completion key | Select the same completed recovery point. |
| Original encrypted bundle and download location | Authenticate and reuse the retained snapshot. |
| Completed restore destination and result | Continue the original merchant's receiving-host procedure. |

The original credential and passphrase facilities remain with the host's
existing secret-management process. The operator handoff identifies their
configured provider and variable name.

The [headless remote commands](../REMOTE.md) remain available for the same
operations. The [original SF101 production runbook](../README.md#production-runbook)
covers the source snapshot and restore procedures. Both interfaces continue
through the same original journals and recovery engine.

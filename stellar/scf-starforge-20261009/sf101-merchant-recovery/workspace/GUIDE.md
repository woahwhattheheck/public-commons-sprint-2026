# SF101 recovery workspace operating guide

Use this workspace to capture declared merchant sources after their writers are
stopped, authenticate an original encrypted bundle, publish that snapshot, find
a completed recovery point on the selected storage service, and restore its
original named roots on a receiving host.

The workspace operates the maintained `runRemote` facade and `recover.mjs`.
Its original transfer journal remains the saved record of the upload, download,
or restore. Local capture and verification retain their original engine results
and capture attempts in the same workspace. The browser adds profile selection,
a review of the exact operation, progress, and reopening that retained work.

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
| A profile's `bundleRoots` | Named collections containing original encrypted snapshots and configured parents for new captures. |
| A profile's optional `capturePlans` | Named original recovery plan files, each bound to one declared encrypted-bundle parent. |
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

## Enable capture from declared sources

An existing host profile can continue with its original encrypted bundles.
To add source capture, prepare the original SF101 plan on the host and declare
it in that profile's optional `capturePlans` list.

For example, save a private original plan at
`/private/merchant-recovery/capture-plan.json`:

```json
{
  "schema": "stellar-forge.merchant-recovery-plan.v1",
  "roots": [
    { "name": "merchant-state", "path": "/srv/merchant/state" },
    { "name": "merchant-config", "path": "/srv/merchant/config" }
  ]
}
```

Replace these roots with the actual original paths required by the merchant's
recovery procedure. Each logical root name identifies that root again in the
restored layout. Keep the capture plan, recovery workspace, transfer journals,
and encrypted output outside the source roots. The source path and its
declared root must resolve to the original real location.

Add this field to the intended profile in `workspace.json`:

```json
"capturePlans": [
  {
    "id": "stopped-merchant",
    "label": "Stopped merchant state and configuration",
    "planFile": "/private/merchant-recovery/capture-plan.json",
    "bundleRootId": "accepted-backups"
  }
]
```

The `bundleRootId` refers to that same profile's existing `bundleRoots` entry.
In the configuration above, new encrypted captures are created under
`/private/backups`. The browser chooses a plan and one new directory name under
that parent. The host configuration supplies the source paths and output
parent.

Keep the plan private:

```sh
chmod 600 /private/merchant-recovery/capture-plan.json
```

Open the workspace with the revised configuration and the same state directory.
The selected profile now offers its declared plans under **Create encrypted
snapshot**. The profile's passphrase environment variable serves the original
capture and verification engine as well as its remote transfers.

A capture plan identifies what to read. Quiescence comes from the merchant's
actual service or application procedure. For a running SF99 merchant, use its
original maintenance backup to quiesce the service group and delivery outbox
together, or stop the complete source group through that maintained procedure
before using a declared source capture.

### Paid-job recovery plans

A plan whose `paidJobs.schema` is
`stellar-forge.paid-job-recovery-profile.v1` uses the original paid-job
integration. It holds the merchant, delivery outbox, and result-delivery
leases across fresh capture and verification of the new encrypted bundle.
The original workspace request retains the exact reviewed plan bytes privately.
A complete retained bundle is authenticated and compared with that original
typed plan during adoption; later changes to the live source do not change
the selected capture. The original host declaration remains in place. A fresh capture review
requires the live plan again.

Review the displayed plan and source roots, pause other writers to those
roots, and explicitly check the quiescence acknowledgment before starting a
fresh capture. The application leases coordinate components that use those
same leases. The reviewed selection and operator acknowledgment remain part
of the capture.

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

## Capture a stopped merchant source

Choose the intended profile and **Create encrypted snapshot**. Select its
original capture plan. The form shows the plan file and the configured parent
for the new encrypted bundle.

1. Stop every writer to the declared roots through the merchant's existing
   maintenance or shutdown procedure. Keep that source group stopped during
   capture.
2. Choose an operation ID and one new destination name. An empty destination
   name uses the operation ID under the plan's configured bundle root.
3. Explicitly check **I have stopped every writer to the declared sources and
   will keep them quiesced through this capture**. The checkbox starts unchecked,
   including when reopening an interrupted capture for a new review.
4. Select **Review capture**. Inspect each original root's logical name, kind,
   and actual path, the complete plan SHA-256, destination, directory count,
   file count, and plaintext byte total.
5. Select **Start capture** for that exact reviewed selection. The server reads
   the original plan again and uses the maintained `recover.mjs` snapshot
   operation, followed by original full verification.
6. Follow the saved operation until its original result is `COMPLETE` with
   `verified: true`. The completed result identifies the encrypted bundle,
   snapshot ID, files, plaintext bytes, native capture identity, plan digest,
   and original capture and verification results.
7. Continue the source application's existing restart procedure. The completed
   encrypted bundle remains available for verification and upload.

The reviewed plan is read from the actual host sources. Reviewing it leaves
the service's start and stop decisions with its original operating procedure.
If the sources or selected plan change, review the resulting current selection
after the source group is stopped.

The original manifest binds the generated capture identity and the exact plan
digest. This lets the same workspace operation recognize its completed native
bundle after an interrupted response. The snapshot ID is assigned from the
completed original manifest; the review displays that it will be available
after creation.

A completed capture appears in **Available bundles**. Select **Verify** to
review another explicit local authentication, or **Upload** to review
publication through the profile's original remote store. Each selected upload
has its own retained operation ID, while its snapshot ID continues to identify
the same encrypted bundle.

## Verify an original local bundle

Choose **Verify local encrypted bundle**, or use **Verify** beside a bundle in
the selected profile's local collection. Inspect its exact original manifest
identity and bundle location, then select **Review verification** and
**Start verification**.

The original `recover.mjs verify` operation authenticates the manifest and
encrypted objects with the passphrase supplied by the host environment.
Its completed result retains `command: local-verify`, `verified: true`,
`snapshotId`, bundle location, original file count, plaintext byte count, and
the original verification result.

This local result is available under **Workspace operations** and through
`workspace show`. The **Original remote operations** table continues to read
the original remote transfer journal. Use **Upload** beside the verified bundle
to review its exact selected store and publication operation.

## Continue an interrupted local operation

**Stop transfer** requests a stop for the selected workspace execution. An
already running original capture or verification phase finishes before the
controller reads back its result. Follow the saved phase and original result
under **Workspace operations**.

| Retained local state | Continue the original work |
| --- | --- |
| Capture is complete and its encrypted bundle exists | **Continue operation** authenticates that original bundle. Source writers may have legitimately resumed after capture. |
| Original capture stopped before producing its complete bundle | The interface reopens the saved plan, ID, and destination with quiescence unchecked. Stop the current source writers, confirm their state, and select **Review capture** again. |
| Local verification is interrupted | **Continue operation** verifies the same original manifest and bundle. |
| Original operation is complete | Inspect its retained completed result and choose the resulting bundle for the following upload or restore work. |

`WORKSPACE_CAPTURE_REVIEW_REQUIRED` identifies the fresh-source review path.
The interface restores the original saved intent, clears the quiescence
confirmation, and asks for that explicit new review. An unavailable original
plan or bundle remains identified in the form so the operator can resolve
that exact selection.

A partially generated directory is retained under the same configured bundle
parent when the original operation needs another capture attempt. Its
`.sf101-interrupted-capture-…` directory, capture identity, plan digest, and
attempt transition remain in the saved request's `retainedCaptures`. Inspect
**retained capture attempts** or **View selection** to follow those paths.
Preserve them with the original operation while resolving the interruption.

An existing directory without the exact native capture marker is retained as
`WORKSPACE_CAPTURE_OWNER_MISSING`, even when it is empty. Choose **New capture
selection** to prepare a new operation ID and destination while preserving that
original directory. Confirm current source quiescence and review the new
capture. A marker or completed bundle that belongs to another capture likewise
stays with its original identity.

The original local phases include `CAPTURING`, `CAPTURED`, `VERIFYING`,
`VERIFIED`, and `INTERRUPTED_CAPTURE_RETAINED`. They describe the actual saved
capture and verification stages. **Refresh progress** reads that saved work,
and **Reopen saved selection** returns its plan or original bundle to the form.

If a start response is lost, refresh the retained workspace operations and
inspect the same operation ID before continuing. A changed source plan,
snapshot, or output destination is a new reviewed selection; **New selection**
creates a new operation ID.

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

For remote transfers, the original journal's `status` is the last saved transfer phase.
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

For a remote transfer, **Stop transfer** closes the S3 client owned by the
selected workspace execution and retains its original journal. An in-progress
local verification or cold restore may finish after that request. Use **Refresh progress** to read
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
transfer is active and while storage access is being restored. Read local capture
and verification results with the existing `workspace show` command and the
same workspace state directory.

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
| Declared capture plans and original stop/restart procedure | Review the exact roots and plan digest before a subsequent source capture. |
| Captured bundle and retained capture-attempt paths | Continue original verification and preserve interrupted generated outputs with their capture identities. |
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

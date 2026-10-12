# SF101 recovery workspace operating guide

Use this workspace to capture declared merchant sources after their writers are
stopped, authenticate an original encrypted bundle, publish that snapshot, find
a completed recovery point on the selected storage service, and restore its
original named roots on a receiving host. It also authenticates and adopts an
existing local dataset-publisher restore through the publisher's maintained
receiving operation.

The workspace operates the maintained `runRemote` facade and `recover.mjs`.
Its original transfer journal remains the saved record of the upload, download,
or restore. Local capture and verification retain their original engine results
and capture attempts in the same workspace. The browser adds profile selection,
a review of the exact operation, progress, and reopening that retained work.

## Prepare the recovery host

Use the release that contains `merchant-recovery-remote workspace`. Prepare
the host with the original recovery passphrase. A profile that uses remote
transfer also needs its existing storage access.
The [remote recovery guide](../REMOTE.md#operator-setup) defines the private S3
configuration, existing credential providers, optional proxy transport, and
supported Node versions.

The host administrator chooses these separate locations:

| Location | Purpose |
| --- | --- |
| Workspace host configuration | Names the available profiles and their permitted storage and local parents. |
| Workspace state directory | Retains this operator workspace's local work. Reopen this same directory when continuing it. |
| A profile's optional `storeConfig` | The existing private S3 configuration used for remote transfers. Omit it or use `null` for local recovery. |
| A profile's `operations` | The original transfer journals and provider acknowledgements for that merchant. |
| A profile's `bundleRoots` | Named collections containing original encrypted snapshots and configured parents for new captures. |
| A profile's optional `capturePlans` | Named original recovery plan files, each bound to one declared encrypted-bundle parent. |
| A profile's optional `publisherRestores` | Host-declared original encrypted bundles and existing plaintext publisher restores to inspect and adopt. |
| A profile's `downloadRoot` | The parent for encrypted bundles received from the selected storage service. |
| A profile's `restoreRoot` | The parent for new plaintext cold-restore destinations. |

Use normalized absolute paths and private directories owned by the operating
account. Keep the workspace and operations directories outside the captured
source roots, encrypted bundles, and plaintext restore destinations. Each new
original cold restore creates a new plaintext directory under the declared
restore parent. A declared existing publisher restore names the completed
bundle and receiving directory already present within the profile's roots.

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

`storeConfig`, when selected, references the original
`stellar-forge.merchant-recovery-s3.v1` configuration. `passEnv` references an
existing environment variable by name. Provision its value through
the merchant's existing secret-management procedure before starting the
workspace. The browser uses the configured profile; it does not need a
passphrase entry form or an AWS credential field.

For multiple merchants, use clear profile labels and the actual original
operations directory for each merchant. The original transfer facade serializes
writers within an operations directory. Preserve that directory when moving
between the browser and headless commands.

## Configure a local recovery profile

Use a local profile when the encrypted bundle and completed cold restore already
exist on this host, or when capturing and verifying a stopped source locally.
The same profile keeps original local capture results, publisher preparation,
and operation history.

The following example uses an existing dataset-publisher recovery such as a
completed Census publisher cold restore. Replace every example path with the
actual retained locations. The encrypted bundle and plaintext restore below
must already exist; preserve the original completed recovery and its returned
paths.

Save this host configuration as
`/private/publisher-recovery/workspace.json`:

```json
{
  "schema": "stellar-forge.recovery-workspace.v1",
  "title": "Dataset publisher recovery",
  "profiles": [
    {
      "id": "publisher-local",
      "label": "Local publisher recovery",
      "operations": "/private/publisher-recovery/operations",
      "passEnv": "SF101_RECOVERY_PASSPHRASE",
      "bundleRoots": [
        {
          "id": "publisher-backups",
          "label": "Original publisher snapshots",
          "directory": "/private/publisher-backups"
        }
      ],
      "downloadRoot": "/private/publisher-downloads",
      "restoreRoot": "/private/publisher-restored",
      "publisherRestores": [
        {
          "id": "existing-cold-restore",
          "label": "Accepted publisher cold restore",
          "bundleDirectory": "/private/publisher-backups/accepted-snapshot",
          "restoreDirectory": "/private/publisher-restored/completed-recovery"
        }
      ]
    }
  ]
}
```

This profile omits `storeConfig`; an explicit `"storeConfig": null` selects the
same local mode. Keep the declared parent directories present and private.
The profile still declares `operations`, `passEnv`, `bundleRoots`,
`downloadRoot`, and `restoreRoot`. Original local journal reads and publisher
preparation from a completed journal remain available.

A `publisherRestores` entry contains one stable ID, a readable label, the exact
original encrypted bundle directory, and the existing plaintext restore
directory. Keep the bundle within the profile's declared encrypted-bundle roots
and the completed restore within its `restoreRoot`. The browser chooses the
declared entry by ID. The server rereads its permitted paths and the native
publisher inspector authenticates the selected recovery before preparation.

Retain the host configuration and operator state separately from those source,
bundle, and restored directories. Keep the configuration private, provision the
named passphrase through the existing host secret facility, and start the same
installed command:

```sh
chmod 600 /private/publisher-recovery/workspace.json
starforge merchant-recovery-remote workspace serve \
  --config /private/publisher-recovery/workspace.json \
  --directory /private/publisher-recovery/operator \
  --port 8481
```

Open its printed capability URL. The host summary reads **Local recovery**.
The operation selector begins with **Create encrypted snapshot** when capture
plans are declared, otherwise **Prepare restored dataset publisher** when
existing restores are declared, otherwise **Verify local encrypted bundle**.
Remote inventory and upload, download, and remote cold-restore controls remain
disabled for this profile.

The **Declared restored publishers** section lists the configured original
bundle and completed restore paths. Choose **Review publisher recovery** to open
that entry in the operation form. Review then uses the original authenticated
publisher inspection; **Prepare restored publisher** runs or adopts the
original native receiving preparation. A native preparation that already
completed retains its result and actual reopening paths.

Local capture is also available by adding the same optional `capturePlans`
declaration described below, with `bundleRootId: "publisher-backups"` for this
example. The original plan and all output, journal, and operator state remain
outside the source roots. Each fresh capture requires a current, explicit
quiescence acknowledgment.

For later remote transfer, the host administrator can add the original private
`storeConfig` and its credential provider to the same profile and restart the
operator with the same state directory. Local work retains its original IDs.
The configured remote profile then offers its normal inventory and transfer
workflow.

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

The runtime profile for remote transfer must include the original `s3` feature,
selected with `--feature s3` during preparation. A local-only profile uses the
original capture, verification, and publisher recovery modules without opening
a storage client. The distribution derives that feature from
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
Choose a runtime containing this workspace and the original recovery modules;
include its `s3` feature for profiles that use remote transfer. Select the
original private host configuration and the same private recovery workspace
directory. For a new workspace directory, its private parent must already exist.
Use the optional private environment JSON for the original AWS, proxy and
passphrase environment values.

The Applications review retains the exact host configuration digest, any
referenced S3 configurations, bundle roots, original journal directory, and
download and restore parents. For local publisher adoption, it also retains
each declared original encrypted bundle and existing restored directory. Saving and starting use the maintained
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

**Stop execution** requests a stop for the selected workspace execution. An
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

## Prepare a restored dataset publisher

An existing local cold restore or a completed remote restore can continue into
the original dataset publisher's receiving-host preparation from this same
workspace. The preparation uses the
restored publisher's own configuration, recovery bindings and application
leases.

Choose an existing host-declared publisher restore or the original completed
remote restore journal. A host declaration names the original encrypted bundle
and its existing plaintext restore. A completed remote journal supplies those
paths from its original result. Both selections remain within the profile's
host roots and use the publisher's original authenticated inspection.

### Capture the original publisher

Declare the publisher's original typed recovery plan in the profile's existing
`capturePlans` list. The typed selector is
`datasetPublisher.schema: stellar-forge.dataset-publisher-recovery-profile.v1`
inside that original plan. Use the plan produced by the maintained
dataset-publisher recovery integration and retain its exact private plan file.
The host declaration continues to choose the plan file and encrypted-bundle
parent.

For a fresh capture, stop the declared source writers through their existing
operating procedure, choose the typed plan, and explicitly acknowledge source
quiescence in **Review capture**. Inspect the actual named roots and plan digest
before starting.

The typed integration holds the publisher's original application leases around
the capture and full authentication of its new bundle. The workspace retains
the reviewed typed plan privately with the request. When an original completed
capture is adopted, the authenticated manifest is compared with that retained
plan; the original live source can already have been moved or released.

After capture and verification, use the original local cold-restore procedure
or the configured remote upload, inventory and cold-restore workflow. Preserve
the completed original restore, each operation ID, and the full snapshot ID.
For a local restore, declare its existing encrypted bundle and actual plaintext
destination under `publisherRestores` before opening its publisher preparation.

### Select the completed restore

Choose **Prepare restored dataset publisher** in the operation selector and
select the **Restored publisher source**:

| Source mode | Selection retained by the operation |
| --- | --- |
| **Host-declared restored publisher** | Select a configured `publisherRestores` entry. The operation retains its `publisherRestoreId`, exact encrypted bundle, and existing plaintext destination. |
| **Original remote restore journal** | Select an original `COMPLETE` restore ID. The operation retains its `restoreId` and derives the snapshot, encrypted bundle, and destination from that original journal. |

The form keeps the two mode selections separately as you switch between them.
Only the selected source ID is submitted in a review. Profiles with declared
existing restores initially select the host-declared mode. The **Declared
restored publishers** list opens that exact entry through **Review publisher
recovery**. Completed remote journals offer the same action beside their
original restore.

Choose a fresh workspace operation ID for this preparation. It identifies the
workspace request while the source restore ID or declared restore ID continues
to identify the existing recovery. Select **Review restored publisher** to read
the exact proposed preparation.

For a completed local publisher recovery such as an existing Census case, choose
its host-declared entry and review the actual recovered generations, workbooks,
mappings, candidates, buyers, and publication decisions. The native inspector
checks the authenticated bundle and restored application bindings before a
preparation can start. The same receiving operation can adopt a native
preparation that has already completed and return its retained reopening paths.

The review reads the restored publisher through its original inspection
function. Check the complete receiving selection:

| Review detail | Operating decision |
| --- | --- |
| Source mode, selected restore ID and snapshot | Confirm the host-declared recovery or original completed journal being continued. |
| Encrypted bundle and plaintext destination | Identify the authenticated backup and the actual restored named roots. |
| Original publisher binding | Read the source dataset, publisher and seller configuration relationships. |
| Receiving publisher binding | Review how those original roots will be bound on this host. |
| Dataset generations and expiry | Identify the restored dataset generations and their retained validity information. |
| Workbooks, mappings and candidates | Review the original preparation state that will become available after receiving. |
| Buyers and pending publications | Inspect the restored publisher's retained delivery and publication work. |
| Native review SHA and native operation ID | Retain the exact original inspection selected for this preparation. |

Keep the displayed review with the same profile, selected source mode and ID,
and workspace operation ID. If the selected restored inputs or bindings change, refresh their
original state and review the resulting selection again.

### Prepare the original restored application

Choose **Prepare restored publisher** for the reviewed selection.

The workspace calls the original `prepareRestoredPublisher` operation. That
operation owns the publisher leases, its required native version upgrade,
restored-root renames and binding adoption. The recovery workspace retains its
native result with the selected request.

Follow **Workspace operations** and **Refresh progress** until the original
preparation result has been read back. Use **Continue operation** to follow the
same retained request after an interruption.

**Stop execution** requests a stop before preparation starts. If the original
native preparation is already running, follow its current phase to the native
readback. Inspect the saved request before deciding how to continue it.

If a response is lost, reopen the same workspace directory and operation ID,
refresh its saved progress, and inspect the original result. A completed native
preparation remains the selected operation's completed outcome.

The workspace completion has `status: COMPLETE` and
`command: publisher-prepare`. A host-declared selection retains
`sourcePublisherRestoreId`; a remote-journal selection retains `sourceRestoreId`.
Both keep `snapshotId`, `bundle`, `destination`, `publisherOperationId`, and the
unchanged original `prepared` result. Keep the workspace operation ID, selected
source ID, and native publisher operation ID with the existing recovery.

### Open the prepared publisher

The original `prepared` result has status
`RESTORED_PUBLISHER_PREPARED`. It supplies the actual locations and limits for
the original application:

| Result field | Use when reopening |
| --- | --- |
| `prepared.datasetDirectory` | Open the restored dataset state, shown as **Dataset state**. |
| `prepared.publisherDirectory` | Open the restored publisher state and retained work, shown as **Publisher workspace**. |
| `prepared.sellerConfigFile` | Use the selected receiving seller configuration, shown as **Seller configuration**. |
| `prepared.limits` | Apply the original publisher's returned operating limits. |
| `prepared.reviewSha256`, `manifestSha256` and `planSha256` | Identify the selected native review, original manifest and recovery plan. |
| `prepared.relocation`, `nativeValidation` and `nativeSchema` | Read the native receiving preparation and application schema results. |

Use these returned paths and the original `prepared.instructions` with the
maintained launch procedure in
[Dataset publisher recovery](../DATASET_PUBLISHER.md). Preserve the prepared
binding, declared restore ID or original restore journal ID, snapshot ID, and
native preparation result with the receiving-host handoff.

Reopen the original publisher against that selected state. Inspect the retained
dataset generations, workbooks, mappings, candidates, buyers and pending
publications through its existing operator before continuing the corresponding
publication work. The original publisher remains responsible for its normal
job, delivery and publication transitions.

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

For a remote transfer, **Stop execution** closes the S3 client owned by the
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
| Original S3 configuration, when selected | Identify the existing bucket, prefix, endpoint, and credential provider for remote work. |
| Original operations directory | Reopen exact transfer bindings, progress, completion, and provider acknowledgements. |
| Snapshot ID and completion key | Select the same completed recovery point. |
| Original encrypted bundle and download location | Authenticate and reuse the retained snapshot. |
| Completed restore destination and result | Continue the original merchant's receiving-host procedure. |
| Declared publisher restore IDs and their exact bundle/restore paths | Reopen existing local publisher recovery through its original authenticated inspection and native preparation. |
| Dataset-publisher preparation review and completed native result | Reopen the exact prepared dataset, publisher and seller configuration with the selected source and native operation identities. |

The original credential and passphrase facilities remain with the host's
existing secret-management process. The operator handoff identifies their
configured provider and variable name.

The [headless remote commands](../REMOTE.md) remain available for the same
operations. The [original SF101 production runbook](../README.md#production-runbook)
covers the source snapshot and restore procedures. Both interfaces continue
through the same original journals and recovery engine.

# S3 merchant in Applications

Use **S3 object merchant** to author and operate an original S3-backed merchant
from the same Applications list as the other Starforge tools. The selected
runtime supplies the original SF30 S3 workspace and SF82 release console.
Applications retains the runtime, workspace, launch review and managed operation.

The merchant lifecycle is: select the runtime and workspace, save the application,
open source and product authoring, save and review an object revision, prepare its
package, stage and activate the release, run the merchant, and deliver its exact
customer files. Stop drains the release console and the seller it started.
Starting again opens the same saved workspace and release store.

## Select the source and runtime

Open the [customer runtime workspace](README.md) and attach a completed original
runtime or receive the current cumulative Starforge release through its existing
installer. Select the original **S3** dependency feature and the native payment
feature used by the intended merchant. Review and finish that original
installation before configuring the application.

The selected source must include this S3 Applications integration. Older
installations retain their original behavior; use the existing **Upgrade selected
runtime** workflow to prepare the newer source at a new final directory. The
application's review verifies its selected source and exact dependency profile,
including the original `@aws-sdk/client-s3` dependency.

The Applications operator uses Node 22.16 or later, Python and `flock` as described
in the runtime workspace guide. Use any higher minimum reported by the selected
runtime's actual profile.

## Configure the merchant

In **Applications**, choose **S3 object merchant**, choose the READY runtime and
give the application a useful name.

| Field | Selection |
| --- | --- |
| Private S3 merchant workspace | The original private directory, or a new directory inside an existing private parent |
| Original release store | Leave empty to use the workspace's saved store or its default `releases` directory; otherwise select the original store or a new directory in an existing private parent |
| Initial S3 source JSON | Optional first-revision source from the original S3 configuration workflow |
| Initial Stellar payment JSON | Select with the initial source and origin; the original compiler validates its terms |
| Initial public HTTPS origin | The public merchant origin for the first revision |
| Local port | Authoring browser port; `0` chooses an available port once and then reuses that workspace's saved port |
| Local release console port | Original SF82 console port; `0` chooses an available port |
| Private environment JSON | Original AWS/profile environment and other required runtime environment, kept on the operator host |

Use different ports when choosing two fixed nonzero ports. Private workspace and
environment paths must belong to the current operator. Configure AWS through the
original provider's environment or profile mechanism. Environment JSON contains
environment names and string values; keep it private.

A new workspace may open empty. Author its source, object keys, version
selection, product paths, descriptions, whole-object or chunk offers, payment
terms and public origin in the existing S3 browser. To import the first revision
at launch, select **all three** initial source, payment and origin fields. Review
checks the original configuration and payment compiler, without selecting object
snapshots from the provider. Actual object selection happens through **Review**
inside the merchant workspace.

Once the workspace has a saved revision, later Applications starts use that
revision. They no longer read the initial source or payment files, even when
their original paths remain in the saved application settings. Those import files
can then be archived without breaking a normal restart.

Choose **Review**, inspect the selected paths and original arguments, and
**Save**. If this runtime has not yet been adopted, the existing managed-home
operation connects its verified source and exact dependency tree. Reopen its
retained operation until the application is ready.

## Start and author

Choose **Review start** and **Start**. The launch review binds the selected
runtime, managed release, original workspace identity, original release-store
directory, local ports and any first-revision import bytes.

Use **Open** to enter the original S3 authoring browser. Its operations retain
the same source, price and object model as the native S3 workspace:

1. Save a complete source, product and payment revision. Concurrent edits use the
   original revision compare-and-swap, so a stale browser reconciles against the
   newly saved revision.
2. Review that saved revision. The original S3 provider selects the actual object
   snapshots and retains the exact review under its operation ID.
3. Prepare the reviewed package. The operation keeps its review, selected source,
   native service and complete customer object description together. Reopening an
   interrupted preparation resumes its existing operation.
4. Stage a named release with the original supported seller runtime settings.
   The package and review remain immutable when a later draft changes.
5. Open **merchant releases**, also available as the application's secondary
   **Open merchant releases** link. This is the original SF82 console on the same
   process, pointing at the workspace's original release store.

The Applications **Open** links come from the maintained command's structured
startup announcement. The observer verifies the actual workspace ID, retained
release-store binding, initial import hashes and loopback capability URLs.

## Operate the release and deliver customer files

In the original release console, inspect and compare the staged candidate with
the active release. Review and activate the selected candidate, then start its
merchant using the original native runtime and facilitator selection. The
original release console retains activation, rollback, runtime and operation
status.

Return to the S3 workspace's customer handoff for that release. Download both
`objects.json` and `offers.json`. Their displayed byte counts and SHA-256
descriptors name the exact files retained by the staged release. Supply both to
the original SF88 object buyer workflow with the buyer's existing configuration
and approval process. Later draft changes do not alter a released customer
description.

Keep the merchant's public origin and runtime settings consistent with the
intended deployment. A local authoring or release-console URL is the private
operator interface; the release's seller listener is shown by its original
runtime status.

## Stop, resume and recover

Choose **Stop** in Applications for the current managed operation. The same
original workspace closes its release console, drains in-flight native work,
and closes the seller that console started. Wait for the retained operation to
finish. The source revisions, reviews, packages, released files and release
history stay in their original private directories.

Start the saved application again with a new start request. It reopens those
same identities and prints new private capability URLs. Port `0` reuses the
workspace's saved authoring port, so the same browser tab retains its unsaved
source/payment draft and pending operation IDs. If that port is occupied, release
the conflicting listener or explicitly choose another port; the original draft
remains in the old browser origin. An explicit port change selects a different
origin. The application does
not need the first-revision input files after a draft has been saved. The S3
browser's existing token recovery also handles opening the new private URL in
a tab that previously held the same origin.

Closing the Applications browser or its HTTP server is different from choosing
Stop: the original managed worker continues. Reopen the same runtime workspace
to inspect or stop that exact retained operation. After an uncertain Start
response, reopen its saved request rather than submitting a different request.

If another application already owns the same S3 workspace directory,
Applications directs the operator to the existing retained operation. A
workspace replaced after review is rejected by the native workspace-ID guard
before it imports or selects provider data. Review the intended original
directory again. A workspace's release-store binding is immutable; use its
recorded store when reopening it.

Rotate the private environment file through the existing Applications settings
and start review. Stop the current managed application, inspect the new
environment hash in the review and start the same workspace. No provider
credentials are copied into the workspace identity or startup summary.

## Use the native command

The same installed command can be operated directly:

```sh
starforge s3 workspace \
  --state /srv/starforge/merchants/object-store \
  --port 0 \
  --release-console-port 0
```

For the first revision only:

```sh
starforge s3 workspace \
  --state /srv/starforge/merchants/object-store \
  --source /srv/starforge/imports/source.json \
  --payment /srv/starforge/imports/payment.json \
  --origin https://objects.example.com \
  --release-console-port 0
```

The original `workspace` and `releaseStore` announcement fields remain available.
The structured announcement additionally names its schema, workspace directory
and ID, optional initial import descriptors, and the original release console.
Keep the complete printed private URLs on the operator host.

Native scripts may select `--expected-workspace-id new` when opening a new
workspace or the original UUID when reopening one. Optional
`--expected-authoring-port` binds the workspace's previously selected authoring
port (`0` before its first listener). Optional `--expected-source-sha256` and
`--expected-payment-sha256` bind first-revision
input bytes. The managed Applications caller always supplies those identity
guards for its reviewed selection.

For a read-only SDK inspection, use the existing public workspace export:

```js
import { inspectS3WorkspaceStore }
  from '@tokenjunkielabs/starforge-merchant/seller/s3/workspace';

const selected = await inspectS3WorkspaceStore(
  '/srv/starforge/merchants/object-store',
  { allowMissing: true },
);
console.log({
  state: selected.state,
  workspaceId: selected.workspaceId,
  releaseStore: selected.releaseStore,
  revision: selected.revision,
});
```

The inspection reports the original stable workspace ID, saved release-store
path, current revision and summary hashes. It opens the original SQLite database
read-only and does not acquire its authoring writer lease, create a workspace,
read provider objects or expose its complete saved source/payment payload.

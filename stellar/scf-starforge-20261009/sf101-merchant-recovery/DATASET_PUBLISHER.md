# Recover the dataset publisher and its saved work

Capture a complete SF30 dataset publisher with the existing SF101 encrypted
recovery engine, restore it to a receiving host, and explicitly attach the saved
publisher to its restored dataset. The publisher opens with its original CSV
candidates, workbook originals and mappings, review notes, selected query,
publication attempts and prepared buyer configurations.

The implementation is [dataset-publisher.mjs](dataset-publisher.mjs).
Encryption, authenticated verification and cold restore remain the original
[recover.mjs](recover.mjs). The receiving operation uses the original
[dataset version store](../sf30-seller-sdk/dataset-refresh/versions.mjs),
[CSV loader](../sf30-seller-sdk/dataset-handler.mjs) and
[publisher workspace](../sf30-seller-sdk/dataset-refresh/workspace-state.mjs).

## Before capture

Use Node 22+ on Linux with util-linux `flock`. Use a complete matching release
on both hosts. The same release contains the native dataset writer lease and the
publisher's trusted binding-adoption method. Original XLSX inspection after
reopening uses the existing Python 3.10+ standard-library reader.

Select the actual dataset state directory and its publisher directory. Stop the
original seller and publisher through their normal graceful shutdown, or use
their existing host maintenance operation. Wait for accepted writes and requests
to drain. Keep both sources quiesced until the original snapshot completes.

This preserves each stored snapshot and its actual expiry. An already expired
snapshot is captured as expired. A saved buyer configuration or cursor does not
extend its lifetime; normal live reopening applies the original collection and
admission rules.

Choose the actual runtime capacity settings when preparing the profile. The
default is 32 retained candidates, 256 MiB retained draft source, two parsed
versions and 1,000,000 resident rows. These are the original runtime defaults;
per-process cache and draft limits are not inferred from an offline index.
Use the corresponding options when your original service ran with different
limits. Dataset retention duration, version count and retained published-byte
budget come from the original saved index.

Create a private plan directory outside the selected source roots:

```sh
install -d -m 700 /srv/merchant-recovery/plans
node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs inspect \
  --state /srv/merchant/dataset-state \
  --workspace /srv/merchant/publisher \
  --seller /srv/merchant/seller.json
```

Inspect the returned current snapshot, dataset and publisher revisions, retained
versions, workbook/mapping counts and pending publication decisions. Optional
`--seller` retains the existing dataset seller JSON byte for byte. Its dataset
handlers and inline response routes are supported. Seller configurations that
depend on other response files/assets or application handlers require their
existing whole-host recovery selection; this profile does not silently omit
those dependencies.

## Prepare and capture the original roots

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs plan \
  --state /srv/merchant/dataset-state \
  --workspace /srv/merchant/publisher \
  --seller /srv/merchant/seller.json \
  --out /srv/merchant-recovery/plans/publisher-point-001.json

node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs check \
  --plan /srv/merchant-recovery/plans/publisher-point-001.json
```

The plan is create-only. A later source update needs a new plan name. The check
rejects source changes after the plan was prepared. It does not start a writer,
collect expired versions or reconcile pending publication attempts.

The plan uses the ordinary `stellar-forge.merchant-recovery-plan.v1` schema.
It adds a typed `datasetPublisher` profile and these original named roots:

| Named root | Captured source | Purpose |
| --- | --- | --- |
| `datasetIndex` | Original `state.json` | Current snapshot, revision, retention settings and retained generations |
| `datasetVersions` | Original `versions` directory | Exact generation configs, CSV bytes and manifests, including retained staging evidence |
| `publisherWorkspace` | Original publisher directory | Original workbooks, mappings and editions, candidates, source-row maps, reader bytes, reviews, buyer files and publication state |
| `sellerConfig` | Selected original seller JSON, when supplied | Original route, origin and payment configuration |
| `publisherRecoveryPlan` | This exact plan file | Authenticated source-to-receiving mapping and capacity selection |

The dataset roots deliberately select its index and generations separately.
Process-owned dataset control descriptors, socket paths and writer lock/lease
files are outside the capture. A retained publisher lock file contains no
portable kernel ownership; the original publisher reacquires its own lock on
the receiving host.

The profile binds each selected content tree using ordered paths, file lengths
and SHA-256 hashes. The exact plan is itself encrypted in the snapshot, so the
typed mapping remains authenticated through the existing remote recovery path.
It fits the original plan limit without duplicating the full archive manifest.

Supply the existing recovery passphrase through the original private environment
variable. Do not put the passphrase value in an argument, plan or saved command.
Use the exact plan SHA-256 returned by `check`. The typed capture holds the
original dataset and publisher leases while calling the original snapshot and
verification commands:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs capture \
  --plan /srv/merchant-recovery/plans/publisher-point-001.json \
  --out /srv/merchant-recovery/publisher-point-001.bundle \
  --pass-env SF101_RECOVERY_PASSPHRASE \
  --expect-plan SHA256_FROM_THE_PRECEDING_CHECK

node stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs verify \
  --bundle /srv/merchant-recovery/publisher-point-001.bundle \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

The native capture binds its stable capture ID and exact plan SHA inside the
original authenticated manifest. The typed operation also compares every
captured tree against the approved source profile. It returns
`DATASET_PUBLISHER_CAPTURED` with the original snapshot and verification result.
An existing bundle is never replaced. After an interrupted workspace operation,
use that workspace's existing same-ID continuation; a found completed bundle
is verified against its retained capture identity without requiring the live
merchant to remain at its old source state.

Retain the completed encrypted bundle using the existing
[remote recovery procedure](REMOTE.md) or
[recovery workspace](workspace/GUIDE.md). Their upload, completion marker,
download verification, operation identity and restart behavior remain the
same. The typed profile needs no separate transport or archive format.

## Restore, review and prepare

On the receiving host, download and authenticate the original complete bundle
through that same recovery workflow. Choose a new restore destination:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs restore \
  --bundle /srv/merchant-recovery/publisher-point-001.bundle \
  --out /srv/merchant-recovery/restored/publisher-point-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE

node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs review \
  --bundle /srv/merchant-recovery/publisher-point-001.bundle \
  --restored /srv/merchant-recovery/restored/publisher-point-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

The original restore authenticates the archive before creating the new
plaintext destination. Typed review authenticates through that original engine
and checks the restored plan and selected source trees against their original
identities. Review reports the old binding, proposed native paths, retained
version/workbook/buyer counts, capacity and pending publication decisions.

Copy the exact `reviewSha256` from this review into the explicit preparation:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/dataset-publisher-cli.mjs prepare \
  --bundle /srv/merchant-recovery/publisher-point-001.bundle \
  --restored /srv/merchant-recovery/restored/publisher-point-001 \
  --pass-env SF101_RECOVERY_PASSPHRASE \
  --expect REVIEW_SHA256_FROM_THE_PRECEDING_REVIEW
```

Both commands optionally accept `--manifest-sha SHA256` to bind a manifest
identity already selected in the recovery workspace.

Preparation takes an original kernel-owned workspace lease on its receiving
operation, then composes the native handles:

1. Retain the captured publisher and dataset index bytes in the receiving
   operation directory. Each index remains linked to the authenticated bundle.
2. Open the original publisher against its saved binding. Its normal recovery
   can adopt a completely saved but unindexed upload, retain damaged-upload
   warnings, and remove its own staging/tombstones. Existing saved candidates,
   notes, selections, mappings and publication records must still match.
3. Validate the retained candidates with the original dataset loader, workbook
   and mapping identities with the original workbook store, and buyer files
   with the original saved-buyer reader. Source payloads absent from the
   authenticated archive cannot be introduced during preparation.
4. Move the restored index and generation roots into one new
   `native-dataset` directory. These are guarded renames on the same receiving
   filesystem, without another whole plaintext dataset copy.
5. Open the original version store with `collectOnOpen:false`. Its native
   writer owns validation and any legacy v1-to-v2 schema upgrade. Current
   snapshot, revision, settings, generation identities and expiry stay exact.
   The only permitted index transformation is that original schema-only
   upgrade.
6. Under the original publisher handle's lock, adopt the reviewed dataset
   directory using the exact old publisher revision, dataset snapshot/revision
   and authenticated plan/manifest identities. Save the original relocation
   record and the completed receiving receipt, then close both native handles.

The operation starts no seller or publisher HTTP server. It does not purchase
data or publish a candidate. The result names the prepared paths and original
revisions, records any native schema upgrade, and identifies the exact
relocation operation.

## Reopen the original seller and staff workspace

Use the `datasetDirectory`, `publisherDirectory`, `sellerConfigFile` and
`limits` returned by preparation. For the paths above, the ordinary commands
are:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /srv/merchant-recovery/restored/publisher-point-001/native-dataset \
  --seller /srv/merchant-recovery/restored/publisher-point-001/sellerConfig \
  --port 8430 \
  --max-cached-versions 2 \
  --max-resident-rows 1000000

node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workspace.mjs \
  --state /srv/merchant-recovery/restored/publisher-point-001/native-dataset \
  --workspace /srv/merchant-recovery/restored/publisher-point-001/publisherWorkspace \
  --seller http://127.0.0.1:8430 \
  --resource https://your-api.example/data \
  --port 8431 \
  --max-drafts 32 \
  --max-draft-bytes 268435456
```

Replace the capacity flags with the profile's actual selected values. If no
seller JSON was captured, supply the matching original configuration already
retained through your normal deployment. Preserve its original facilitator,
environment and public route/origin settings; append the existing deployment's
facilitator flags as applicable. The source profile does not rewrite payment
terms, public URLs, saved buyer files or routing. The normal host deployment
handles any deliberate receiving-host or DNS change.

When the original environment needs private loopback control, use the existing
seller option `--control-transport loopback`. The publisher consumes the same
native control descriptor.

Open the printed private publisher session URL. Inspect the original retained
versions and saved work. A normal live open may now collect already expired
generations; usable retained cursors still follow the original admission and
snapshot contract. Saved buyer configurations keep the exact snapshots and
queries they originally selected.

For an interrupted publication, use the original workspace's **Check
publication** and **Review on latest revision** controls as appropriate.
Preparation preserves `PENDING` and `NEEDS_REVIEW`; it does not infer a
successful payment or publish again. See the original
[publisher operating guide](../sf30-seller-sdk/dataset-refresh/WORKSPACE.md).

## Interruption and retained state

Use the same bundle, restored destination and preceding review identity after
an interrupted preparation. `review` reports the durable phase and original
error. `prepare` resumes that same operation. Do not move its raw roots back,
edit an index to force a binding, discard the preparation journal or substitute
a different source bundle.

The operation recognizes each already completed root rename and original
binding adoption. An accepted adoption followed by a lost response is reused
through its original operation ID and exact revisions. Original cleanup is
permitted only after that native reopening phase has started, and all remaining
captured payloads stay authenticated.

A `COMPLETE` operation returns its saved preparation receipt. That receipt
describes the prepared state at `preparedAt`; later live publications, expiry
collection and operator edits belong to the ordinary native workspace. Repeating
preparation does not revert them. Inspect current state through that workspace
when the merchant has subsequently been running.

Failures preserve the encrypted bundle, original source host and owned
receiving directory. Follow the reported original native error and continue the
same receiving operation after the concrete issue is corrected. The module
never removes an active writer or uses a process number to infer that ownership
has expired.

## Interface for the original recovery workspace

The typed module exports these functions for the existing SF101 operator. There
is no separate server or unauthenticated rebinding route.

| Function | Input and result |
| --- | --- |
| `inspectPublisherRecovery(input)` | `datasetDirectory`, optional `publisherDirectory`, `sellerConfigFile`, `limits`; returns typed source identity and summary |
| `preparePublisherRecoveryPlan(input)` | Same selection plus create-only `planFile`; returns original plan, plan SHA and source summary |
| `inspectPublisherRecoveryPlan(planFile)` | Rechecks the selected plan against the current quiesced source before existing capture |
| `withPublisherRecoveryCapture({planFile, expectedPlanSha256}, callback)` | Holds the original dataset and publisher leases across fresh source matching, the consumer's existing capture/verification block, and a final match; returns the callback result unchanged |
| `capturePublisherRecovery(input)` | `planFile`, `bundleDirectory`, `passphraseEnv`, optional `expectedPlanSha256` and `captureId`; calls original snapshot/verify while both source leases are held and returns the exact capture/manifest/plan identities |
| `inspectRestoredPublisher(input)` | `bundleDirectory`, `restoreDirectory`, `passphraseEnv`, optional `expectedManifestSha256`; returns `reviewSha256`, `operationId`, `paths`, `summary` and retained preparation status |
| `prepareRestoredPublisher(input)` | Same receiving selection plus `expectedReviewSha256`; returns `RESTORED_PUBLISHER_PREPARED` and the native paths/relocation receipt |

Within the existing recovery workspace, keep selected source paths in its
private host configuration and resolve them through its original allowed-root
validation. Use the original plan review and quiesced capture action, then its
normal encrypted publication/download/restore. Wrap only the block that creates a
**new** typed capture in `withPublisherRecoveryCapture()`. Keep the existing
consumer's journal, cancellation checks, progress and `COMPLETE` / `INTERRUPTED`
result. A bundle already completed under that operation must remain on the
consumer's original verify/adopt path; do not require its live source to match
again. This distinction preserves lost-response recovery after the merchant
continues working.

The standalone `capture` command is create-only and uses the same original
engine. Shared workspaces use the callback instead of adding a second capture
state machine. Neither form opens native stores or changes their revisions.
A version 1 source with an existing original writer lock requires its normal
writer shutdown or native upgrade before capture; source inspection never
removes that lock.

After a completed typed cold
restore, show the returned summary and exact old/new binding before exposing
the explicit **Prepare restored publisher** action. Pass the preceding review
hash, selected manifest and original private passphrase environment name.

The programmatic publisher `adoptDatasetDirectory()` method is exclusively
for this trusted receiving composition. It is guarded by the original publisher
kernel lease, source manifest/plan identity, prior publisher revision and exact
dataset snapshot/revision; the public and private HTTP publisher APIs do not
accept an arbitrary filesystem path replacement.

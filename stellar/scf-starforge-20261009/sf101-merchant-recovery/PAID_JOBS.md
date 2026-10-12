# Paid-job recovery

Recover the original paid-job merchant, its complete application files, saved jobs, native settlement journals, completed result bytes and frozen result-delivery records through SF101’s encrypted snapshot engine. Receiving publishes a physical source binding for the restored application. The original merchant then opens the restored state with its original logical source identity.

The command is available through the maintained installed CLI:

~~~sh
starforge jobs recovery --help
~~~

From a source edition, the same entry point is:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-recovery/paid-jobs-cli.mjs --help
~~~

## What the recovery carries

| Selection | Retained content | Receiving behavior |
| --- | --- | --- |
| Merchant configuration | Exact original configuration bytes and their SHA-256 | Opens the restored configuration path through the original compiler |
| Application directory | Complete selected directory layout, including the original module basename and relative dependency files | Selects the restored canonical application path through the original source binding |
| Merchant state | Saved jobs, claim-token hashes, job attempts, settlement identities, original source copies and result files | Opens the same logical merchant; original state transitions remain owned by its ordinary model |
| Native settlement outbox | Original event and delivery journals | Uses the original SF98 writer and delivery rules |
| Result-delivery stores | Complete frozen manifests, attempt counts, retry deadlines, revisions and exact receiver acknowledgments | Resumes the selected original queues; delivered files retain their existing receipts |
| Destinations file | The original destination selection, routing settings and secret environment-variable names | Reopens delivery with that exact retained configuration |
| Extra roots | Explicitly selected configuration, application dependency or operational files | Restores their named roots and reports their resulting paths |

The plan also carries its own typed mapping as the encrypted named root **paidJobRecoveryPlan**. That mapping contains the original source identity, selected paths, logical roles, state digest, prior binding digest, source-tree digests and a summary of jobs and deliveries.

The ordinary SF101 manifest authenticates the plan, files and capture identity. The paid-job profile reconstructs the reviewed tree digests from the authenticated manifest’s plaintext file digests and compares the actual restored files before receiving.

## Select the complete application layout

Set **application-directory** to the complete real directory containing the application and its relative imports or data files. The application keeps its basename and extension inside that root after restoration. For example, an original application at:

~~~
/srv/reporting/application/main.mjs
~~~

with helpers under **/srv/reporting/application/lib/** should select **/srv/reporting/application**. If the application imports a sibling directory outside that path, select their common application ancestor so their relative layout travels together.

The original SF101 engine captures regular files and directories. Materialize any application dependencies that normally come through symlinks or hard links into the application’s portable directory layout before selecting that layout. Runtime dependencies provided by the chosen Starforge installation continue to use that installation’s supported runtime. Explicit extra roots carry additional files; they do not rewrite absolute paths embedded in application code or configuration.

The profile combines overlapping selections into one ancestor root. A configuration file already inside the application directory, for example, is represented by a logical path inside that root. A merchant state directory inside that same explicitly selected application tree is captured once. Custom result-delivery directories outside the merchant state remain separately named roots.

Save the recovery plan, encrypted output and restored destination outside every selected source root. SF101 permits at most 20 roots, 10,000 entries, 4 GiB total plaintext, 2 GiB per file and directory depth 16. The typed plan uses one of those roots and must fit within 256 KiB. File permissions and root selection are checked before capture.

## 1. Inspect the original saved merchant

Stop the original paid-job service and its result-delivery and settlement-delivery workers. Their shared writer leases are acquired during inspection and throughout capture and verification. The original model is not opened for inspection, so review does not reconcile job state or start execution.

Prepare a private directory for recovery output:

~~~sh
umask 077
install -d -m 700 /srv/recovery/plans
install -d -m 700 /srv/recovery/bundles
~~~

Inspect the complete selection:

~~~sh
starforge jobs recovery inspect \
  --config /srv/reporting/merchant.json \
  --state /srv/reporting/merchant-state \
  --application-directory /srv/reporting/application \
  --destinations /srv/reporting/result-destinations.json
~~~

The default **merchant-state/result-delivery** store is included when it exists. For an original sender using a custom directory, add its actual directory:

~~~sh
starforge jobs recovery inspect \
  --config /srv/reporting/merchant.json \
  --state /srv/reporting/merchant-state \
  --application-directory /srv/reporting/application \
  --delivery-state /srv/customer-delivery/reporting \
  --destinations /srv/reporting/result-destinations.json
~~~

Repeat **--delivery-state** for other original queues attached to this merchant. Repeat **--root NAME=PATH** for explicitly selected additional roots. The inspection reports saved job states, settlement counts, result-file counts and bytes, original outbox journal counts, delivery states, retained attempts and selected source digests.

A running writer produces a lease conflict. Stop that owning process and repeat the same complete selection. An application or state change after a plan was prepared requires a new plan for the current saved state.

## 2. Prepare the typed plan and capture it

Create the plan with the same inspected selection:

~~~sh
starforge jobs recovery plan \
  --plan /srv/recovery/plans/reporting-2026-10-12.json \
  --config /srv/reporting/merchant.json \
  --state /srv/reporting/merchant-state \
  --application-directory /srv/reporting/application \
  --delivery-state /srv/customer-delivery/reporting \
  --destinations /srv/reporting/result-destinations.json
~~~

The result contains **sha256**, the exact plan digest. Keep that value with the operation and use it for the capture:

~~~sh
starforge jobs recovery capture \
  --plan /srv/recovery/plans/reporting-2026-10-12.json \
  --plan-sha256 PLAN_SHA256 \
  --bundle /srv/recovery/bundles/reporting-2026-10-12 \
  --pass-env STARFORGE_RECOVERY_PASSPHRASE
~~~

Supply the passphrase through the named private environment variable before this command. The original engine requires at least 16 UTF-8 bytes. The plan and output retain the variable’s name, while the passphrase stays outside them.

Capture acquires the original merchant lease, the SF98 outbox delivery lease and every selected result-delivery store’s original lease. It re-reads the complete typed selection, runs the original encrypted snapshot and full verification, and rechecks the original selection before releasing those leases.

The result includes the exact **manifestSha256**, **planSha256**, **captureId** and original engine snapshot and verification results. Repeating capture for an already complete bundle verifies its existing capture identity and returns that same bundle. An interrupted partial directory stays retained; the original recovery workspace manages its own capture resumption, or the CLI can use a new output directory.

### Existing recovery workspace

The original recovery workspace can register this plan in the host’s **capturePlans** selection and use its existing Review, Start and Resume controls. Its maintained local runner recognizes:

~~~js
plan.paidJobs.schema === 'stellar-forge.paid-job-recovery-profile.v1'
~~~

For a new capture, that runner wraps its original snapshot, progress and verification block with **withPaidJobRecoveryCapture**. A completed bundle continues through the existing verification and completion-resume path, independently of later changes to the live merchant.

The encrypted bundle may be transferred using the existing SF101 remote recovery workflow. Transfer the complete bundle, including the manifest and encrypted objects, while retaining its manifest digest.

## 3. Restore into a new private destination

On the receiving installation, make a private parent and invoke the original restore through the same command family:

~~~sh
install -d -m 700 /srv/restored
starforge jobs recovery restore \
  --bundle /srv/recovery/bundles/reporting-2026-10-12 \
  --out /srv/restored/reporting-2026-10-12 \
  --manifest-sha256 MANIFEST_SHA256 \
  --pass-env STARFORGE_RECOVERY_PASSPHRASE
~~~

The original engine authenticates the encrypted objects before creating its output. The destination must be new. It contains the named original roots and the exact typed plan. The returned paths are authoritative; a standalone configuration root may use its logical root name, while the application remains inside its preserved directory layout.

## 4. Review and receive the original state

Inspect the complete restored selection:

~~~sh
starforge jobs recovery inspect-restored \
  --bundle /srv/recovery/bundles/reporting-2026-10-12 \
  --restore /srv/restored/reporting-2026-10-12 \
  --manifest-sha256 MANIFEST_SHA256 \
  --pass-env STARFORGE_RECOVERY_PASSPHRASE
~~~

The result shows the restored canonical paths, original merchant identity, retained job and delivery summary, prior source binding and **reviewSha256**. Apply that exact review:

~~~sh
starforge jobs recovery receive \
  --bundle /srv/recovery/bundles/reporting-2026-10-12 \
  --restore /srv/restored/reporting-2026-10-12 \
  --manifest-sha256 MANIFEST_SHA256 \
  --review-sha256 REVIEW_SHA256 \
  --pass-env STARFORGE_RECOVERY_PASSPHRASE
~~~

Receiving verifies the encrypted bundle and actual restored roots, records its preparation intent outside the original merchant rows, and calls **adoptRestoredJobSource**. The original adapter reacquires the actual writer leases and rechecks the reviewed state and previous binding before publishing the physical source selection.

The historical **source.identity.application**, configuration digest, application digest, public origin, job identities, settlement records and frozen result-delivery manifests remain the original merchant’s logical identity. Its physical **applicationPath** is the verified restored module. A prior source binding is preserved in immutable binding history before a replacement marker is published.

The receiving result contains **PAID_JOB_RECOVERY_READY**, its operation and review digests, exact original-source adoption receipt, canonical paths, retained summary and usable launch arguments.

## 5. Open the restored merchant and selected sender

Use the exact paths in **launch.merchant.args** from the receiving result. A merchant with one selected custom result-delivery store and a captured destinations file opens with:

~~~sh
starforge jobs serve \
  --config RESTORED_CONFIG_PATH \
  --state RESTORED_MERCHANT_STATE \
  --delivery-config RESTORED_DESTINATIONS_FILE \
  --delivery-state RESTORED_RESULT_DELIVERY_DIRECTORY
~~~

The delivery desk is available from the original jobs workspace. Add **--start-delivery** when starting the dispatcher is intended. The original destination’s secret must be present in its configured environment variable.

After stopping that service, its saved queue can be inspected directly:

~~~sh
starforge jobs delivery status \
  --config RESTORED_CONFIG_PATH \
  --state RESTORED_MERCHANT_STATE \
  --destinations RESTORED_DESTINATIONS_FILE \
  --delivery-state RESTORED_RESULT_DELIVERY_DIRECTORY
~~~

The ordinary merchant and result dispatcher own one state lease each. Use the private workspace while the service owns them. For multiple selected queues, **paths.deliveryDirectories** and **launch.resultDelivery** retain every explicit selection for the original programmatic dispatcher API:

~~~js
import { openJobMerchant } from '@tokenjunkielabs/starforge-merchant/seller/jobs';
import { openResultDelivery } from '@tokenjunkielabs/starforge-merchant/seller/jobs/result-delivery';
import { readDeliveryConfig } from '@tokenjunkielabs/starforge-merchant/seller/jobs/result-delivery/config';

const model = await openJobMerchant({
  configPath: received.paths.configPath,
  directory: received.paths.directory,
});
const config = await readDeliveryConfig(received.paths.destinationsFile);
const senders = [];
try {
  for (const directory of received.paths.deliveryDirectories)
    senders.push(await openResultDelivery({ model, directory, config }));
  // The original application chooses when to start execution and each sender.
  console.log(await model.snapshot());
  console.log(senders.map(sender => sender.snapshot()));
} finally {
  for (const sender of senders.reverse()) await sender.close();
  await model.close();
}
~~~

An interrupted **SENDING** delivery is recovered by the original delivery store into its existing retry lifecycle. A completed **DELIVERED** row retains its exact receipt. The receiver’s existing duplicate handling continues to acknowledge the same frozen delivery identity and bytes.

## Receiving resumption and later work

Preparation is recorded in **paid-job-recovery/operation.json**, beside the restored named roots. Before the original adapter writes the binding, the operation is **ADOPTING**. The binding’s provenance identifies the encrypted manifest, typed profile, receiving review and original state digest. Once the adapter returns, the operation stores its complete result.

If the process stops after the binding committed but before the operation completed, repeating the same receive recognizes the original binding and finishes that retained operation. If a completed merchant has since processed legitimate work, repeating receive returns the same completed result while checking its selected source binding. It preserves those later job rows and delivery attempts.

A new receiving review for a different snapshot uses a new restored destination. A current state or binding mismatch during the first adoption causes the original adapter to reject that changed selection before publishing another binding.

## Programmatic interfaces

All profile functions are exported by **sf101-merchant-recovery/paid-jobs.mjs** and the installed **@tokenjunkielabs/starforge-merchant/seller/jobs/recovery** package import. The matching CLI is exported as **seller/jobs/recovery/cli**. Original source-binding and inventory APIs are exported as **seller/jobs/source-binding** and **seller/jobs/recovery-state**.

| Export | Purpose |
| --- | --- |
| inspectPaidJobRecovery(selection) | Review original saved state under all original writer leases |
| preparePaidJobRecoveryPlan({planFile, ...selection}) | Create the ordinary SF101 plan with its encrypted typed mapping |
| inspectPaidJobRecoveryPlan(planFile) | Match current original saved state against the exact typed plan |
| withPaidJobRecoveryCapture({planFile, expectedPlanSha256}, operation) | Wrap the maintained local runner’s new capture and verification block |
| inspectCapturedPaidJobManifest({planBytes, manifest}) | Match an authenticated completed capture against retained reviewed plan bytes without reading current source |
| capturePaidJobRecovery({planFile, bundleDirectory, passphraseEnv, expectedPlanSha256?, captureId?}) | Run original snapshot and verification with exact typed capture binding |
| inspectRestoredPaidJobs({bundleDirectory, restoreDirectory, passphraseEnv, expectedManifestSha256?}) | Review the original completed restore or a retained receiving operation |
| prepareRestoredPaidJobs({...receivingSelection, expectedReviewSha256}) | Publish the original merchant’s verified physical binding and retain its receiving result |

A maintained capture runner retains the exact reviewed plan bytes in its private request before starting capture. After the original SF101 runner authenticates every encrypted object and manifest, it calls **inspectCapturedPaidJobManifest({planBytes, manifest})** before adopting a completed bundle. The function accepts a **Buffer** or **Uint8Array**, checks the encrypted plan entry and capture identity against those bytes, and matches every selected plaintext tree against the typed review. It returns **PAID_JOB_RECOVERY_CAPTURE_MATCHED**, **planSha256**, **profileSha256** and **captureId**. This same check applies when a process stopped after snapshot creation but before the typed callback returned; it uses the retained plan even after the live merchant changes or the original plan path moves. The original verification still owns ciphertext and HMAC authentication.

A selection contains **configPath**, **directory** and **applicationDirectory**, with optional **deliveryDirectories**, **destinationsFile** and **roots: [{name, path}]**. The original **readJobMerchantSource** and **adoptRestoredJobSource** exports own source binding. Shared **inspectJobRecoveryState** and **acquireJobRecoveryLeases** exports own the portable state inventory and the actual merchant, outbox and result-delivery leases.

Original format and operator documentation: [SF101 recovery](README.md), [paid jobs](../sf30-seller-sdk/jobs/README.md), [completed result delivery](../sf30-seller-sdk/jobs/result-delivery/README.md), and [installed customer receiving](../distribution/runtime-workspace/JOB_RESULT_RECEIVER.md).

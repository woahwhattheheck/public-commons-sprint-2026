# Managed merchant fleet recovery and receiving

This command captures a stopped deployed fleet through the original SF101 encrypted recovery engine and receives that same fleet on its original absolute paths. It carries the fleet manager, gateway, all SF82 slot stores, delivery and discovery state, original plans and declarations, host bundle, additional read-only inputs and explicitly declared recovery assets. The encrypted snapshot includes its own complete typed recovery plan, so the receiving machine can recover the original mapping and review without an external copy of that plan.

The same retained operation resumes partial file transfers and native host-bundle generation. Receiving checks the original native release plan, source hashes, numeric service identity and generated host artifacts before returning its completed receipt.

## Original engines and entry points

Use the installed command:

    starforge merchant-fleet-recovery --help

The source entry is:

    node stellar/scf-starforge-20261009/merchant-fleet-gateway/recovery-cli.mjs --help

Applications may import the complete API from `@tokenjunkielabs/starforge-merchant/merchant/fleet-recovery`. The APIs expose the same plan, capture, restore, review and receiving operations as the CLI. The existing SF101 local recovery workspace recognizes `merchantFleet` plans and uses these same source leases and authenticated capture checks.

| Stage | Original implementation |
| --- | --- |
| Read deployed host and plan | `checkFleetBundle` and `readFleetReleasePlan` |
| Capture ownership | Original fleet/gateway `acquireStateLease` and SF82 `acquireReleaseLease` |
| Encryption, authentication and restore | SF101 `recover.mjs` |
| Interrupted capture and completed capture reuse | SF101 workspace `runLocalCapture` |
| Receiving operation and partial placement | `recovery.mjs` using the original private-file/workspace-lock primitives |
| New host artifact rendering and final validation | Original `prepareFleetDeployment`, `fleetDeploymentFiles` and `checkFleetBundle` |
| Starting, readiness, release controls and shutdown | Original `merchant-fleet-host` runtime and workspace |

The native service remains the owner of payments, releases, request draining, clients and settlement. This recovery command records and transfers their original state.

## Prepare the source host

Start with its current, valid generated host bundle. Run `merchant-fleet-host check --bundle ORIGINAL_HOST_BUNDLE` to inspect the original deployment. Keep the installed source release at its existing immutable path; the bundle records its original source files and hashes.

Run capture as the declaration's original positive numeric `serviceUid` and `serviceGid`, on Linux with the existing util-linux `flock` command. The caller needs read access to all captured inputs and write access to its private recovery directory. The generated bundle may retain its original group-readable files; the newly created plans, operation records, plaintext restore and receiving files are private.

Stop the existing managed fleet through its established service manager. Let the original runtime finish draining and close the managed SF82 children. Finish any external producer that writes one of the selected read-only input or recovery roots. Keep those producers stopped through plan preparation and capture.

The command acquires the same manager, gateway and every slot's run/state leases. An existing logical SF82 owner directory is left to its original runtime's shutdown/recovery. The command does not remove another process's owner record. Source hashes are taken with these leases held and checked again around the original SF101 capture.

For example, use a private service-owned recovery directory prepared at an actual path such as `/srv/stellar-recovery/atlas-20261012`. Keep it outside every selected source root. Values in these examples are placeholders for the operator's original declaration.

    starforge merchant-fleet-recovery inspect-source \
      --bundle /srv/stellar-hosts/atlas-original

    starforge merchant-fleet-recovery prepare-plan \
      --bundle /srv/stellar-hosts/atlas-original \
      --plan /srv/stellar-recovery/atlas-20261012/fleet-plan.json \
      --quiesced

Save the returned `sha256`, summary and exact plan. The plan is created once and is private. If the source legitimately changes, prepare another plan at a new path from the current original host instead of editing an earlier plan.

### What the selection contains

The typed selection begins with the original deployment's `recoveryRoots`, including the complete fleet state and any external declaration or plan. It adds the original host bundle and every additional `readOnlyRoots` input. Nested selections are coalesced into the complete containing root; each file retains its original absolute receiving path. Additional runtime assets belong in the deployment's existing recovery-root declaration.

The snapshot includes the complete typed plan as an encrypted logical file named `fleetRecoveryPlan`. That file binds the original deployment manifest, source hashes, root tree identities, native plan digest, merchant/slot IDs, active and previous SF82 selections, and retained fleet revision mappings.

The installed source release, Node/runtime dependencies, existing immutable container image, host account and environment file are provisioned through their original installation and secret mechanisms. Their recorded source, paths, identities and environment-file metadata are checked during receiving. Environment values are never read by this wrapper. Keep the configured environment file separate from all captured input roots.

SF101's existing limits apply to the whole snapshot: twenty logical roots, ten thousand files/directories, depth sixteen, two GiB per file and four GiB total plaintext. The typed plan takes one root and at most 256 KiB. Files must be regular single-link files; directory walks refuse symbolic links, devices and sockets. A source exceeding these limits needs a selected original deployment/input arrangement that the maintained SF101 engine supports.

## Capture and retain the encrypted snapshot

Provide the existing passphrase through its private environment mechanism. Put only the variable's name on the command line. Keep that passphrase available through the original receiving secret channel.

    starforge merchant-fleet-recovery inspect-plan \
      --plan /srv/stellar-recovery/atlas-20261012/fleet-plan.json

    starforge merchant-fleet-recovery capture \
      --plan /srv/stellar-recovery/atlas-20261012/fleet-plan.json \
      --bundle /srv/stellar-recovery/atlas-20261012/encrypted \
      --operation /srv/stellar-recovery/atlas-20261012/capture-operation \
      --pass-env FLEET_RECOVERY_PASSPHRASE \
      --expected-plan-sha EXACT_PREPARED_SHA256 \
      --quiesced

The complete result is `FLEET_CAPTURED`. Retain its `snapshotId` (the exact original manifest SHA256), capture ID, plan SHA256, profile SHA256 and native verification result. The encrypted bundle is the complete original SF101 directory, including its manifest and ciphertext objects.

To resume an interrupted capture, repeat that same command with the same plan, bundle, operation, environment-variable name and expected plan hash. The original local-capture implementation retains its owned incomplete attempt before continuing a reviewed stopped-source capture. It adopts a completed capture by its original marker and verifies it even after the source has legitimately resumed; `--quiesced` can then be omitted when merely reopening that completed capture. The command never replaces a foreign bundle.

Keep the operation directory alongside the source-side recovery records. The complete encrypted bundle and original SF101 transfer mechanism are the portable receiving input. The capture journal is useful for source-side continuation; receiving authenticates its own full bundle and encrypted self-plan.

Resume normal source service operation through the existing host runbook after the completed capture has been retained.

## Restore into a separate private receiving directory

Provision the receiving machine's original service account and numeric UID/GID, supported Linux/Node/runtime tools and the recorded immutable source release. Restore the environment file through its existing secret mechanism at its original path, with the original private owner and mode. For a container deployment, retain its exact selected image and existing rootful Linux Docker Engine namespace profile.

Obtain the complete encrypted SF101 directory and the exact expected manifest SHA256. Authenticate and restore it into a new, separate private directory:

    starforge merchant-fleet-recovery restore \
      --bundle /srv/stellar-recovery/received/encrypted \
      --out /srv/stellar-recovery/received/plaintext \
      --pass-env FLEET_RECOVERY_PASSPHRASE \
      --expected-manifest-sha EXACT_SNAPSHOT_ID

`FLEET_RESTORED` means the native encrypted manifest and every ciphertext object verified, the original engine restored the logical trees, and those trees plus the encrypted typed plan match their original identities. Repeating this command reuses an already complete matching restore. An existing foreign or incomplete plaintext destination is preserved; keep it and select a new restore directory for the original native restore.

Inspect the complete restored mapping:

    starforge merchant-fleet-recovery inspect-restore \
      --bundle /srv/stellar-recovery/received/encrypted \
      --restore /srv/stellar-recovery/received/plaintext \
      --pass-env FLEET_RECOVERY_PASSPHRASE \
      --expected-manifest-sha EXACT_SNAPSHOT_ID

This returns the exact original deployment, plan digest, merchants, slot selections and required target paths. It opens no merchant process.

## Select the original target parents

Receiving preserves absolute paths because original fleet plan digests, release descriptors and retained customer/delivery references bind those paths. Prepare private existing parent directories owned by the original service UID/GID. Every root destination and the new host bundle must be a strict child of one explicitly selected parent. All selected original targets must initially be absent. Existing roots are preserved.

Create a private target declaration outside the capture, plaintext restore, target trees and receiving operation:

```json
{
  "schema": "stellar-forge.fleet-recovery-targets.v1",
  "sourcePlanSha256": "EXACT_ORIGINAL_PLAN_SHA256",
  "destinationParents": [
    "/srv/stellar-state",
    "/srv/stellar-hosts",
    "/srv/stellar-inputs",
    "/srv/stellar-declarations"
  ],
  "deploymentBundle": "/srv/stellar-hosts/atlas-received"
}
```

Select only the parents actually needed by the inspected original paths. Parents are private real directories with the original numeric service owner. Keep the source installation, environment file, original encrypted bundle, plaintext restore and operation records separate from the destination trees.

The original host bundle is one of the restored targets. Choose a different new path for `deploymentBundle`; its generated runbook and service unit refer to that receiving bundle. Preserve the earlier generated bundle as original receiving source.

    starforge merchant-fleet-recovery inspect-restore \
      --bundle /srv/stellar-recovery/received/encrypted \
      --restore /srv/stellar-recovery/received/plaintext \
      --targets /srv/stellar-recovery/received/targets.json \
      --operation /srv/stellar-recovery/received/receiving-operation \
      --pass-env FLEET_RECOVERY_PASSPHRASE \
      --expected-manifest-sha EXACT_SNAPSHOT_ID

Review the complete `review` and its `reviewSha256`. The review binds the exact manifest, encrypted plan/profile, receiving declaration bytes, original paths, new bundle, source release, service identity and operation directory. Availability and saved progress are reported separately so a continued operation keeps its original review hash.

## Receive, regenerate and reopen the fleet

Keep the receiving fleet and its selected writers stopped. Run as the original service UID/GID:

    starforge merchant-fleet-recovery receive \
      --bundle /srv/stellar-recovery/received/encrypted \
      --restore /srv/stellar-recovery/received/plaintext \
      --targets /srv/stellar-recovery/received/targets.json \
      --operation /srv/stellar-recovery/received/receiving-operation \
      --pass-env FLEET_RECOVERY_PASSPHRASE \
      --expected-manifest-sha EXACT_SNAPSHOT_ID \
      --expected-review-sha EXACT_RECEIVING_REVIEW_SHA256 \
      --quiesced

Before any target write, receiving validates the complete original snapshot and checks that every selected destination is absent. The saved operation then creates the original roots. Each partial transfer remains private; a continuation compares every retained byte with the original before appending. Completed files are published through a create-only link. Different existing files and unrelated populated roots are preserved.

After all source trees match, receiving acquires the original fleet/gateway/SF82 leases, reads the native plan and checks the restored original host bundle. It renders the new bundle through the original deployment functions and writes those exact artifacts through the same resumable placement. The final original `checkFleetBundle` must pass.

The completed `FLEET_RECEIVING_COMPLETE` receipt retains original snapshot, review, plan and profile hashes, fleet/service identities, root tree hashes, original and new host bundles, merchant/slot summary and completion time. Reopening the same completed operation returns that original receipt; it does not require a subsequently operating merchant to remain byte-identical to its earlier snapshot.

Use the new bundle's original `RUNBOOK.md` to install the generated service/Caddy or selected Compose configuration under the existing host's change authority. Start the original fleet runtime. Read its original health result, confirm the same native plan digest and merchant set, and open the existing workspace. Inspect retained active/previous slot selections and fleet revisions, delivery/discovery state and the original receiving/customer records. Carry out the established native merchant/customer operation selected for this recovery.

    starforge merchant-fleet-host check \
      --bundle /srv/stellar-hosts/atlas-received

    starforge merchant-fleet-host health \
      --bundle /srv/stellar-hosts/atlas-received

The original runtime and workspace continue to own stage, activate, drain, rollback, customer work and graceful shutdown. Retain their actual outcomes alongside the recovery receipt. Prepare the following backup from this now-current received deployment bundle after its next clean shutdown.

## Continue an interrupted operation

| Observation | Continuation |
| --- | --- |
| Source changed after plan preparation | Keep the earlier plan/capture. Stop and inspect the current original source, then prepare a new plan at a new path. |
| Another fleet or SF82 owner holds its original lease | Finish that original owner's shutdown or recovery, then continue the same reviewed operation. |
| Incomplete owned encrypted capture | Repeat the same capture with current stopped-source confirmation; native SF101 retains its owned attempt and continues. |
| Complete encrypted capture after source resumed | Repeat its original capture identity; verification uses the retained plan and complete bundle. |
| Incomplete plaintext native restore | Preserve that directory and choose a new native restore destination from the same encrypted bundle. |
| Receiving stopped during a partial file | Repeat the exact receive command and review. The retained prefix is checked before further bytes are written. |
| File publication succeeded before its temporary name was removed | The same operation verifies the linked inode's original bytes, removes only its owned temporary name and continues. |
| A receiving root or file was replaced or differs | Preserve the root, operation and returned conflict. Restore the original operation's files through its actual owner before continuing; the command never overwrites them. |
| Native bundle generation was interrupted | Repeat the original receive operation. It reuses the original rendered artifact selection and continues its private partial files. |
| Complete receiving receipt is reopened after merchant use | The original receipt is returned without replaying placement or resetting the live merchant. |
| Original source installation or environment metadata is missing | Install the recorded original source and provision the existing private environment through their original routes, then continue the same receiving operation. |

Keep receiving records and generated input artifacts until the completed package and native reopen outcome have been retained through the original delivery surface. Source snapshots, original payments, current merchant state and earlier receiving operations retain separate identities.

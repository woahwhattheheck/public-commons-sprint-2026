# Recovery workspace host handoff

The handoff command captures a complete original recovery application and its saved host state into the existing SF101 encrypted snapshot format. On a cold host, it authenticates and restores the handoff into a new private staging directory, reviews every receiving path, places the original bytes, and reopens the same workspace for reading.

This is a local custody operation. It does not upload snapshots, replay completed transfers, start a workspace listener, build an application package, install dependencies, create credentials or change original request IDs.

## What is preserved

| Item | Binding |
| --- | --- |
| Application | Original distribution manifest bytes; package name/version; Git commit; complete source-selection record; package metadata hashes; every declared source file's size, SHA-256 and Git blob identity. |
| Source modules and browser files | Complete original file inventory plus maintained distribution command, export, application/provider, runtime-declaration and browser-route registrations. |
| Workspace | Original workspace ID, creation time, host-configuration bytes and workspace.json bytes. |
| Saved requests | Original request files, IDs, reviews, attempts, results and retained local state. |
| Native transfers | Original operation directories, operation.json files, receipts, progress, IDs and absolute path bindings. |
| Encrypted snapshots | Original manifest and ciphertext files, including completed bundles and retained downloads selected by the host roots. |
| Private external inputs | Paths, purposes and byte fingerprints; their contents remain outside the handoff. |
| Receiving paths | An explicit mapping for every captured root, reviewed before placement. |

The outer handoff uses [recover.mjs](../recover.mjs) for snapshot encryption, authentication and cold restore. Capture continuation uses [local.mjs](local.mjs) and its existing interrupted-capture retention. The command uses [model.mjs](model.mjs) to read original identity and reopen the received workspace. No alternative encryption, archive format, transfer journal or distribution builder is introduced.

The source check preserves the whole original distribution manifest inventory. It reuses [readDistributionSpecification](../../distribution/specification.mjs), [productPackageMetadata](../../distribution/product-package.mjs) and [createBrowserAssetIndex](../../distribution/browser-assets.mjs) to verify the original edition, launcher, README, and declared entry/provider/browser files. The additive read-only [inspectDistributionSourceImports](../../distribution/build.mjs) API uses the maintained builder's VM module parser and physical/browser import resolution to check every static ESM import and re-export in captured .mjs and .js files. It parses without linking or evaluating the application and does not run the builder. Missing relative modules, unserved browser modules, and absolute local or file: imports fail with the importing file, specifier and missing target. The result records importCoverage with counts and external specifiers. Original bin, command, provider, native application and non-browser export entrypoints establish the Node import graph. Modules reached by those entrypoints must retain their physical relative dependencies even when they also have browser routes.

The command captures the full original inventory; it does not infer a smaller application from imports. Dynamic import(), CommonJS require(), private plugin inputs, installed third-party modules and native dependencies still belong to their original declared runtime/dependency workflow. The import result explicitly reports the unscanned module kinds. A source match is not a native-readiness or provider-connectivity result.

## Complete current and retained host paths

Applications reads the normalized host through the selected installed runtime's original model and its adjacent `workspace/host-profile-paths.mjs`. Its saved command review includes every current profile path, its role and its observed presence or absence. This includes Object state roots, session directories, explicit includes, encrypted bundles and archive files; both Support case stores; fleet receiving journals and private targets; and publisher/fleet restores. An absent nested source is bound to its nearest existing canonical ancestor. Review does not create that source or an empty case store. A changed path observation requires a fresh original Applications review.

Choose an updated complete Runtime when its original source lacks the shared helper. The provider does not substitute a helper from another installed edition. The maintained distribution follows the helper imports and retains their exact source with the original model, provider and handoff modules.

A new handoff plan records `pathInventory` in the original v1 plan. Current declarations and complete saved workspace requests both contribute paths. Historical rows come from the original request's hash-bound review, including frozen Object selections, comparison pairs, encrypted bundle selections and prepared fleet roots. Removing a declaration from the current profile does not remove a retained request's path from the handoff review. An original generic capture plan contributes historical roots only when its live bytes still match the original reviewed digest. Missing or changed original plans are listed in `unavailablePlans`; their old roots are not inferred from replacement contents. Typed captures retain their exact embedded plan roots in the original request.

Present captured paths must be covered by the chosen roots. A pending or historical input may be absent where its original workflow permits this; that absence is retained explicitly. A completed output required by an original request cannot be treated as an optional future path. Provider configuration and fleet target files from retained requests remain external private custody, including files no longer named by today's profile.

Keep the **whole workspace root**. It contains requests, saved Object reviews and evidence, comparison JSON/HTML/Markdown artifacts and ordered history, frozen encrypted-transfer preparations and native reports, and Support transfer selections, original case revision bindings and exported packages. Include the complete configured `casesDirectory` and `caseSourceDirectory` when present. A small selection of visible JSON summaries cannot replace those stores.

### Original Object state

Include each complete selected `stateRoot`, including its `.sf88-object-restorations` history. This retains session definitions, every configuration, original inbox attempts and outcomes, all native lease history, policy/signer/evidence dependencies and recorded assemblies. Explicit external credential files remain excluded; a root overlapping such a file is rejected.

For a prepared standalone source, the original SF88 read-only recovery inspector validates its zero-cap history, configured dependencies, recorded assemblies, absent ledger and native lock status. Any unreleased native lock, including a stale or other-host lock, must be reconciled by its original owner before handoff. The handoff does not acquire a native BACKUP lease or manufacture a sealed native backup claim. Keep all selected writers stopped for the complete operation.

The plan binds the complete Object state-root tree. Capture must match that tree, including native lease and restoration records. Cold receiving uses `readObjectRecoveryPlan(originalDirectory, { storageDirectory: stagedDirectory })` to validate the original definition/configurations/assemblies without rewriting canonical paths or inspecting an unrelated live session. The outer handoff remains the existing SF101 encrypted snapshot; it is not labelled as a separately produced Object-native snapshot.

A declared source or backup may not exist yet. Such declarations are preserved without creating them. Receiving review and adoption check each original absent path on the receiving host, including absence outside all captured roots. Unrelated pre-existing state at an originally absent path prevents adoption.

### Older handoffs and durable adoption

Existing completed handoffs remain authenticatable and restorable into staging. A legacy plan without the complete path inventory cannot adopt a newer Object or Support configuration whose whole source selection it did not review. Preserve that original archive and prepare a new complete handoff from its original host. Ordinary older host configurations keep their original canonical-path workflow.

New directory roots are still created exclusively; partial or unrelated receiving trees are preserved and rejected. Before reporting adoption, the receiver synchronizes copied file contents, each new nested directory from children to parent, receiving root parents and restored application file modes. Reopening remains read-only and starts no listener, acquisition, payment, comparison or restore request.

These source changes have source-level and reference-filesystem validation. Installed native execution and actual viewed browser output remain separate observations owned by the original receiving programme.

## Original path rule

Version 1 cold adoption uses the captured absolute paths. Each target mapping must explicitly repeat its original path.

This rule preserves the original recovery engine's operation binding: its command, remote store fingerprint, snapshot ID and local bundle/restore paths remain the same. Workspace requests also retain their original configuration and path selection. A changed destination fails with HOST_HANDOFF_ORIGINAL_PATH_REQUIRED. The command does not edit a journal to make a different host path appear original.

A different storage layout needs an explicit receiving binding supported by the corresponding original engine. Keep such migrations separate from this version. Merely editing host.json, workspace.json or operation.json would break the original identity proof.

The encrypted bundle and its staging restore may live at different paths on each host. They are receiving control inputs, and they must be outside all application/state destinations.

## Before export

Use the complete original distribution manifest and its source directory. Do not replace a missing application with another commit, the current main branch, an approximate file count or reconstructed files. If the original identity or source is missing, preserve that as missing.

Stop the original workspace listener and selected source writers. A normal listener close retires recovery-workspace-launch.json. If a stale launch remains, its original owner must reconcile it; the handoff command will not capture that session credential or remove it. Existing workspace and transfer leases must be available. Keep other producers that write selected roots stopped until export finishes.

Choose non-overlapping file or directory roots. They must cover:

- The complete original package directory, including its adjacent manifest.json, source directory, package.json, README.md and LICENSE.
- The complete workspace directory, including original requests and workspace.json.
- Every configured operations, bundle, download and restore directory.
- Original capture plans that are still present.
- Original fleet receiving operation directories that are still present.
- Existing bundle/output paths referenced by retained native transfer journals.

The native snapshot format accepts at most 20 roots; one is reserved for the encrypted handoff plan, so the selection accepts up to 19. It retains the existing 10,000-entry, nesting, file-size and aggregate snapshot limits. Application source files additionally retain the original source-reader bounds of 4 MiB per file and 128 MiB in total.

The configured operations, bundle, download and restore roots must exist. An absent pending journal output is recorded as absent. A missing completed journal-bound bundle or output stops export; a completed historical journal is not proof that its bytes are still available. Absent historical capture plans are reported without being recreated.

### Keep private inputs outside captured roots

Passphrase values, credentials and private provider/target files stay in authorized private custody. The host configuration contains environment variable names and path references. It is captured as original workspace state.

Provider configuration files and private fleet target files are automatically classified as external. Add other credential or private identity files to externalFiles. The command rejects any selected root containing or overlapping an external file. Select narrower roots when credentials share a parent with state; do not copy a whole private home or runtime directory.

The receiving host must supply each external file at its declared original path. Its exact receiving SHA-256 is part of the target review. A deliberately changed external file is labelled EXPLICIT_RECEIVING_BYTES, while original bytes are labelled ORIGINAL_BYTES. This is an explicit private-file selection, not proof that a rotated configuration identifies the same remote store. The original remote engine checks store and operation identity when later used.

The handoff does not read passphrase environment values into its plan or outputs. The outer handoff passphrase environment is separate from each original profile's passphrase environment.

## Export selection

Store the selection privately. This example assumes a maintained package whose source directory has no installed node_modules or unrelated files, and a private /srv/merchant parent.

~~~json
{
  "schema": "stellar-forge.recovery-workspace-handoff-selection.v1",
  "operationId": "merchant-host-handoff-001",
  "configFile": "/srv/merchant/host.json",
  "workspaceDirectory": "/srv/merchant/workspace",
  "application": {
    "sourceDirectory": "/srv/merchant/app/source",
    "manifestFile": "/srv/merchant/app/manifest.json"
  },
  "roots": [
    { "name": "application", "path": "/srv/merchant/app" },
    { "name": "hostConfig", "path": "/srv/merchant/host.json" },
    { "name": "workspace", "path": "/srv/merchant/workspace" },
    { "name": "journals", "path": "/srv/merchant/journals" },
    { "name": "bundles", "path": "/srv/merchant/bundles" },
    { "name": "downloads", "path": "/srv/merchant/downloads" },
    { "name": "restores", "path": "/srv/merchant/restores" },
    { "name": "plans", "path": "/srv/merchant/plans" }
  ],
  "externalFiles": [
    {
      "path": "/run/merchant-private/original-snapshot-identity.json",
      "purpose": "Original snapshot private identity; retained through existing private custody"
    }
  ]
}
~~~

The operationId identifies this handoff capture. Original workspace and transfer IDs remain inside their original files. Reuse this handoff ID, capture operation directory, plan and encrypted bundle when continuing the same export.

All command paths are normalized absolute paths. Input JSON files and receiving files must be private regular files. Create the receiving/control parents privately before invoking the commands.

### 1. Prepare the original plan

~~~sh
starforge merchant-recovery-remote workspace handoff plan \
  --selection /srv/handoff-control/selection.json \
  --plan /srv/handoff-control/original-plan.json \
  --quiesced
~~~

The result is HOST_HANDOFF_PLAN_READY. Retain planSha256 and the full original result. The plan records source edition, identity, root coverage, original record hashes, external bindings and absent original inputs. The plan itself is an encrypted logical root of the eventual snapshot, so receiving authenticates the metadata as well as the payload.

Planning creates a new plan file only. It does not replace an existing plan. If sources change before export, review the changed original selection and create a new plan/capture operation deliberately; do not edit an existing plan or preserve an old review hash.

### 2. Capture and authenticate

Supply the private outer passphrase through the existing process environment. Pass only its variable name to the command.

~~~sh
starforge merchant-recovery-remote workspace handoff export \
  --plan /srv/handoff-control/original-plan.json \
  --bundle /srv/handoff-export/original-bundle \
  --operation /srv/handoff-control/original-capture \
  --pass-env HOST_HANDOFF_PASSPHRASE \
  --expected-plan-sha256 ORIGINAL_PLAN_SHA256 \
  --quiesced
~~~

The result is HOST_HANDOFF_EXPORTED. Retain its manifestSha256, planSha256, originalCapture, operationDirectory and source edition.

The command uses the original local capture state at operationDirectory/capture.json. It can verify and adopt an already completed capture after later source removal. The original plan bytes are retained with the capture state. Reusing a complete capture authenticates it; it does not take a new snapshot. Omitting --quiesced is allowed only when the retained bundle is already complete and can be authenticated.

Interrupted capture outputs stay under the existing local engine's retention rules. Keep their original capture state and plan. Do not delete a pending output to make an uncertain write appear absent.

Transfer the complete encrypted bundle directory through the existing authorized custody route. Keep manifest.json and every objects/*.gcm file together. Retain the emitted exact manifestSha256 independently. The separate original bundle passphrases and provider credentials continue through their existing private custody.

## Receive on a cold host

The cold host needs the maintained handoff command and its existing Node/Linux runtime available, writable canonical parents at the captured destination paths, and private external files supplied at their original paths. The original native lease engine requires Linux flock (util-linux); the handoff does not install it. It does not need to start the captured application to authenticate the handoff.

Parents of every receiving root must already be canonical real directories without symlink components. New receiving roots are created privately and exclusively; an ordinary /srv or /mnt parent can be used when the receiving account can write there. The command does not create or change broad host directory trees. For the example, create the private /srv/merchant parent before review, and keep the child destinations absent. Use the existing receiving/service account and host provisioning route.

Do not start source or receiving writers until adoption and readback finish. The command checks existing native workspace/operations leases during review and requires --quiesced for adoption.

### 3. Authenticate and cold restore

~~~sh
starforge merchant-recovery-remote workspace handoff restore \
  --bundle /srv/handoff-incoming/original-bundle \
  --restore /srv/handoff-review/original-restore \
  --pass-env HOST_HANDOFF_PASSPHRASE \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

The original recovery engine authenticates the complete encrypted bundle before creating output. The result is HOST_HANDOFF_RESTORED. No original destination is touched. Repeating this command with an existing complete staging restore checks every file and directory against the authenticated inventory; it does not overwrite it.

The original application manifest is checked again against the restored source. Staging must contain precisely the native snapshot's roots, including its encrypted handoff plan. Extra files, missing files, modified content, links and private-mode violations stop review.

### 4. Review every receiving binding

Write a private target file using the exact workspaceId and manifestSha256 from the handoff. Include every emitted external file, including automatically classified provider configurations.

~~~json
{
  "schema": "stellar-forge.recovery-workspace-handoff-target.v1",
  "workspaceId": "ORIGINAL_WORKSPACE_UUID",
  "manifestSha256": "ORIGINAL_MANIFEST_SHA256",
  "mappings": [
    { "name": "application", "path": "/srv/merchant/app" },
    { "name": "hostConfig", "path": "/srv/merchant/host.json" },
    { "name": "workspace", "path": "/srv/merchant/workspace" },
    { "name": "journals", "path": "/srv/merchant/journals" },
    { "name": "bundles", "path": "/srv/merchant/bundles" },
    { "name": "downloads", "path": "/srv/merchant/downloads" },
    { "name": "restores", "path": "/srv/merchant/restores" },
    { "name": "plans", "path": "/srv/merchant/plans" }
  ],
  "externalFiles": [
    {
      "path": "/run/merchant-private/recovery-s3.json",
      "expectedSha256": "RECEIVING_PROVIDER_CONFIG_SHA256"
    },
    {
      "path": "/run/merchant-private/original-snapshot-identity.json",
      "expectedSha256": "RECEIVING_PRIVATE_IDENTITY_SHA256"
    }
  ]
}
~~~

~~~sh
starforge merchant-recovery-remote workspace handoff review \
  --bundle /srv/handoff-incoming/original-bundle \
  --restore /srv/handoff-review/original-restore \
  --pass-env HOST_HANDOFF_PASSPHRASE \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --target /srv/handoff-control/receiving.json
~~~

The result is HOST_HANDOFF_REVIEW. Review its roots, original identity, exact source edition, retained operation IDs, external file fingerprints and absentOriginalInputs. Each destination is either NEW_CREATE_ONLY_ROOT or EXACT_ORIGINAL_ALREADY_PRESENT. The latter requires an exact complete byte/inventory match.

Retain the returned reviewSha256. Availability is shown separately from the hash so the same selected operation can reconcile a root that completed placement before its caller received the result. The hashed review includes the complete original mapping, bundle and staging paths, target file bytes, original record hashes and receiving external-file hashes.

### 5. Adopt and read back the same workspace

~~~sh
starforge merchant-recovery-remote workspace handoff adopt \
  --bundle /srv/handoff-incoming/original-bundle \
  --restore /srv/handoff-review/original-restore \
  --pass-env HOST_HANDOFF_PASSPHRASE \
  --expected-manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --target /srv/handoff-control/receiving.json \
  --expected-review-sha256 ORIGINAL_REVIEW_SHA256 \
  --quiesced
~~~

Adoption reauthenticates the bundle, staging trees and target selection before placement. Missing roots are copied with exclusive creation. Exact existing roots are reused. Original files are not rewritten. Original package files regain their declared 0644/0755 file modes behind private 0700 receiving directories, preserving compatibility with the original package verifier. Workspace and journal files remain private. The original recovery format is not a general permission-preserving system backup.

After placement, the command checks the entire received inventory, original workspace.json bytes, workspace ID, configuration hash and creation time. It opens the same workspace through openRecoveryWorkspace({readOnly:true}) and reads its state without acquiring a workspace writer or launching a provider operation.

Only then does it return HOST_HANDOFF_ADOPTED, including originalState and runtimeStatus ADOPTED_READ_ONLY_NO_SERVICE_OR_REMOTE_OPERATION_STARTED. This status confirms source/state adoption and actual read-only reopening. It does not claim remote connectivity, installed SDK readiness, a running listener or a completed transfer beyond the retained original journal state.

Retain the result in the original receiving record. Start the captured workspace through its existing application or workspace serve command when its original runtime is ready:

~~~sh
node /srv/merchant/app/source/stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/cli.mjs \
  serve --config /srv/merchant/host.json --directory /srv/merchant/workspace
~~~

Use the original request/operation IDs to read and resume through the existing workspace. Inspect the original request after an uncertain result; completed native operations remain complete and are not replayed by handoff adoption.

## Interruption and conflict behavior

Capture continuation belongs to the existing local engine. Cold staging restore belongs to the existing recovery engine. Neither step changes the original operation IDs.

Receiving placement uses exclusive filesystem copies and derives completion from the authenticated inventory. It has no second transfer journal. A root copied completely before a lost result can be verified and reused on the next identical review/adoption. A root interrupted partway remains preserved and fails the exact-tree check. The command does not fill an unowned partial tree, overwrite it, delete it or call it adopted. Preserve the partial root and resolve its custody through the original receiving owner before reusing that exact destination.

This limitation is deliberate: no checkpoint claims ownership of arbitrary pre-existing bytes. The original encrypted bundle and complete staging restore remain available as the recovery authority.

A hash, ID, external binding or path mismatch requires a fresh read of the exact selected input. Do not reset IDs or switch credentials/remote stores to make a retained operation appear compatible.

## Programmatic API

Import host-handoff.mjs from the existing recovery workspace source:

~~~js
await prepareHostHandoffPlan({ selection, planFile, quiesced: true });
await exportHostHandoff({
  planFile, bundleDirectory, operationDirectory,
  passphraseEnv, expectedPlanSha256, quiesced: true
});
await restoreHostHandoff({
  bundleDirectory, restoreDirectory, passphraseEnv, expectedManifestSha256
});
const inspected = await inspectRestoredHostHandoff({
  bundleDirectory, restoreDirectory, passphraseEnv, expectedManifestSha256, targetFile
});
const adopted = await adoptRestoredHostHandoff({
  bundleDirectory, restoreDirectory, passphraseEnv, expectedManifestSha256, targetFile,
  expectedReviewSha256: inspected.reviewSha256, quiesced: true
});
~~~

The type declarations are in host-handoff.d.mts. inspectHostHandoffApplication({sourceDirectory, manifestFile}) also exposes a read-only original source check; its returned manifest is the original full distribution manifest.

All result envelopes use stellar-forge.recovery-workspace-handoff-result.v1. Inputs and results contain no passphrase values. Keep private selections, plans, state, outputs and results under the original authorized custody; only reusable implementation source and this guide belong in a public repository.

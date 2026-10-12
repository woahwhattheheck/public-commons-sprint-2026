# Receive the complete Groundwater installation

This workflow builds the existing **groundwater-reports** product from one committed Merchant repository, installs its reviewed runtime profile, and receives that exact source and dependency lock into a second installation. It uses the maintained Runtime Workspace, source builder, runtime installer and offline-transfer engine. The separate **groundwater-report** selection remains available for the Report Desk alone.

The scientific source contract is [groundwater-sources.json](groundwater-sources.json). It pins all 64 source files from the original application at 96a1d66ad032cbbb2640252fedd3f4048a6c8dd6, carried by capsule ec6a1d1faa4d641835d2853715887ad5481be800. It includes the publisher's complete Python and TeX examples, package metadata, licenses, native readers, operator UI and Tethys adapter. Installation does not reinterpret those sources.

## What the operator receives

The original managed review records the Git commit, selected product, complete distribution inputs, command/export registrations, package metadata and exact source-review hash. Its own UUID is the only source-build request used by the caller. Build continuation uses that UUID and the original output directory.

The full runtime profile selects the native payment runtime, schema, OpenAPI, MCP and Linux operator tools from the actual packaged declarations. Those packages are installed by the existing installer. The separate scientific Python dependencies and solver binaries stay with the original scientific operation. The receiving programme invokes only source/registration inspection and the Groundwater CLI's help command.

The completed result contains:

- The original package filename, byte count and SHA-256, the saved build review and original request ID.
- Exact installed readbacks of all 64 scientific files, including the original .tex source, in both installations.
- The selected runtime profile, installation identity and dependency-lock hash.
- A complete original runtime-transfer manifest and every checked part. Each part carries the source archive, profile, lock and required public npm package bytes.
- An independent receiving directory and offline installation with the same source, profile, installation identity and lock.
- The original Runtime Workspace's HTTP readback and complete source-package download, with an optional visible browser reopen.
- Original deployment handoffs for both installations and the complete list of deliverable files with hashes.

The product source now retains the corrected BAS6 legacy-namefile grammar and attributed current reference inspection. Historical imports, run IDs and existing source findings stay in their scientific workspace. Building this installation does not create a scientific workspace or run a solver, portal, seller, buyer or payment.

## Prepare the existing host

Use Linux with the Node and Python versions required by the packaged profile, Git, flock, npm and sufficient private storage for the selected source, both installations and transfer parts. Python must be at least 3.11 for the original operator tools. Use a current Git that supports the original reader's --no-lazy-fetch option.

Check out the exact intended Merchant commit in its own directory. Run the caller from that checkout, with every tracked distribution file matching the chosen commit. The caller verifies those bytes against the original Git object reader before creating a build. Its output directory must be separate from the repository and npm cache.

Select an existing npm cache directory. Initial installation may fetch the reviewed public dependencies when offlineInstall is false. The transfer then carries the actual lock-bound package bytes; the independent installation always uses its received cache with offline installation enabled. An offline native build also needs matching local Node headers when the selected profile requires them. Pass the actual header prefix in nodeHeaders.

Use the existing configured browser only if visible receiving is required. The optional browser fields name an installed Playwright package and an actual Chromium executable; the caller does not install or download a browser. Browser credentials or scientific workspace files are not inputs.

## Run or continue the same receiving operation

Copy [groundwater-receiving.example.json](groundwater-receiving.example.json), set its exact paths and commit, and retain that file.

    node stellar/scf-starforge-20261009/distribution/receiving/groundwater-reports.mjs /absolute/receiving-input.json

The input schema is stellar-forge.groundwater-distribution-receiving.v1. The operationId is an operator-selected stable identifier; the saved source review provides the native source-build UUID. The directory contains this operation's request and all subsequent receipts. Reuse the same file and output directory after a lost response.

The two network choices are explicit. offlineSource allows only already present Git objects when true. When false, the original Git reader may acquire missing immutable objects from the repository's configured remote. offlineInstall controls the first selected npm install and creation of its lock-bound transfer; it never makes the second installation online.

The caller keeps the source build in the original Runtime Workspace. Review it at any time with the installed original command:

    starforge runtime-workspace serve --workspace /absolute/receiving/workspace --port 0

Open the private URL printed by that command, choose **Build a product**, and reopen the saved review. The same page exposes its original worker log, Continue original build, the verified package download, and Choose adapters and install. Both completed runtimes appear in the existing runtime list. The original Source & profile, Deployment and Offline transfers controls remain available.

A completed rerun verifies the original artifacts and returns the existing result. Missing or changed completed files return an explicit error; the caller does not make a current snapshot to replace a frozen output. If browser receiving was selected, it reopens the saved review and retained package in the same Runtime Workspace, then closes its owned browser and server. No browser screenshot is included in the deliverable.

## Original recovery boundaries

A queued or interrupted source build continues through sourceBuilds/recover with its existing request ID. A known source-build failure is reported with the original worker log; the next explicit invocation may continue that same saved build. A different ref or product cannot be substituted into that review.

The original runtime preparation is retained before dispatch. If a later invocation finds that preparation failed or stopped, the caller uses the existing recover operation into its named groundwater-original-recovered directory, preserving the previous target and source identity. That one recovery request is retained before dispatch. If recovery itself stops, use the original runtime operator's recovery controls; do not delete its directory or manufacture a successful preparation record.

The native installer owns install-state.json, its lock, npm log and completed dependency graph. The caller reuses that original installer on the same selected runtime. It does not create a parallel npm journal.

Offline-transfer partials remain with the transfer engine. It validates the original manifest, part hashes, reconstructed files, package integrity and dependency lock before installing. If its preparation was interrupted before a plan was published, use its documented recovery:

    starforge runtime-transfer recover --directory RECEIVER --from RETAINED_TARGET --runtime NEW_TARGET

Preserve both targets and their original receipts. A receiving call never initializes another scientific database to replace a missing model.

An interrupted creation of the Runtime Workspace remains at its original path and is reported explicitly. Do not remove it to turn a continued request into a new workspace. The underlying workspace initialization must be completed by its maintained owner before using that path again.

## Transfer to another operator

Copy the complete transfer directory, including manifest.json and every original parts/ file. Verify the manifest hash from result.json before importing it. The source archive can also be independently inspected through the original source installer.

At the receiving host, the maintained commands are:

    starforge runtime-transfer receive --directory RECEIVER --manifest TRANSFER/manifest.json --sha256 ORIGINAL_MANIFEST_SHA --parts TRANSFER/parts
    starforge runtime-transfer complete --directory RECEIVER
    starforge runtime-transfer install --directory RECEIVER --runtime NEW_RUNTIME
    starforge runtime-install inspect --dir NEW_RUNTIME --load --source
    starforge runtime-install run --dir NEW_RUNTIME -- source
    starforge runtime-install run --dir NEW_RUNTIME -- groundwater --python /absolute/python3 --help

Keep the original transfer manifest and lock. Native architecture and Node-header requirements still apply. Paths at the recipient are recorded by the original receiver and installer; changing a host path does not change the original package's source identity.

The caller's result.json identifies both actual installed runtime directories and their deployment handoffs. Start or reconnect an existing Report Desk through the managed Applications controls using its actual desk, scientific workspace and Operations selections. The original scientific programme and Tethys receiving continue from their actual saved model backup under their existing owner; this installation receipt is not a scientific-run result.

## Source-selection behavior

Explicit supportFiles are individual validated source paths. They bypass the automatic extension heuristic, so an original .tex, .rst, .conf or another explicitly declared format remains in its product. This does not broaden automatic directory discovery. Hidden/excluded directories, the limited fixture-data exception, exact excludeFiles, Git regular-file requirements, object hashes and byte limits still apply.

The original contribution names all 64 scientific files. This caller checks that each is present in the native package manifest and that its installed bytes reproduce the exact Git object and size. It also requires both groundwater and groundwater-report commands and the managed groundwater-reports Application provider in the original source review.

The installed product preserves the code/prose recharge discrepancy, solver-declared unit and time differences, steady-state semantics, mapped aquifers, masks, native budget record precision and separate package-rate/volume evidence. Those scientific distinctions are interpreted by the maintained application; this packaging workflow only preserves their exact source.

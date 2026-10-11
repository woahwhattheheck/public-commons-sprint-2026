# Runtime workspace image operations

Open the existing runtime workspace with the current Starforge installation:

    starforge runtime-workspace serve --workspace /absolute/private/runtime-workspace

Use the private URL printed by that command and open **Images**. This workflow calls the original SF99 image and container engines from the same runtime workspace. Its source profiles, native commands, source identities, image receipts and transfer format remain authoritative.

## Prepare from the selected original release

1. Open an existing runtime in the workspace, or use its original source/profile preparation flow. The profile must select the operator tools required by a merchant host.
2. In Images, choose **Prepare an image from a selected runtime**. Select that original runtime, a stable image name, the exact base image repository with its SHA-256 digest and its Linux platform.
3. Enter the paths supplied by that base image for Node, Python and npm, the image source root, the unprivileged UID/GID and any required Python modules. A base image is an explicit operator selection. Preparation does not pull or build it.
4. A native profile may need Node headers already present in the selected base. Its optional `nodeHeaders` value is an absolute path inside that base. The original image installer returns the native installation's source and dependency roots; use those returned roots in the merchant container selection. Earlier contexts keep their original layout and artifact identity.
5. Review the exact source commit, archive digest, profile identity, base, paths and dependency versions. The immutable review is retained in the workspace. Choose **Prepare reviewed context**.

A reviewed plan refers to the original archive, source and runtime profile. The worker rechecks those identities before preparing the context. Source or profile changes require a current review. The original runtime directory remains intact.

To reopen a context prepared through the original CLI, enter its original private directory under **Open an existing context**. The original context verifier checks all retained artifacts. Reopening does not build an image.

## Lock, build, inspect and recover

Use **Retain dependency lock** with an existing exact `package-lock.json`, or let the original engine resolve the selected profile once. The retained lock remains part of the image identity. Optional package installation and native preparation are owned by the original image runtime and installer.

Choose **Check context** to verify the original context and lock. Choose **Build / reconcile image** to call the original Docker build against the selected local daemon. The base must already be present at the declared digest and platform. The generated Dockerfile retains the selected archive and profile, and its original runtime check runs with the unprivileged final UID/GID.

The original worker log appears in the Images view and the common Operations view. A build, export or import continues when the browser or its server closes. Each command has the workspace's original UUID, canonical request hash, worker lease, state and log. Repeating delivery of a request UUID reopens the same retained request, including its original input identities. The image extension also uses the original lease facility to serialize operations on a context or receiving transfer.

After an interrupted build worker, inspect its actual retained context, original image-build journal and worker log. **Build / reconcile image** invokes the original same-context reconciliation: it checks the immutable local image identity and existing build record before choosing the original build action. The original engine rejects a still-active build. Existing completed receipts are verified against the selected Docker daemon.

Other interrupted operations retain their own output paths in both Images and Operations. Open a prepared context with **Check context**; an incomplete preparation can be repeated from the same saved review into a new directory. Open an export's original transfer: a complete manifest and archive remain usable, while an incomplete export can be repeated with **Export image** into a new transfer directory. Inspect a container output with the original container check before using its `RUNBOOK.md`; incomplete generation can be repeated from the same merchant review into a new output directory. These actions preserve the previous output. Import and inspection continue against the same selected transfer or context.

Refreshing this page reads retained files and worker state. Docker inspection, build, import and export happen only when their operation is selected.

## Export and receive the exact image

**Export image** calls the original Docker save operation by immutable image ID. The resulting directory retains:

- `image-bundle.json`, the original portable image manifest and complete image receipt.
- `image.tar`, the exact native Docker image archive and its SHA-256 identity.

The original source release, profile, lock, platform, executable paths, UID/GID and image ID travel together in that manifest. The workspace retains the export directory and operation.

Use the two download buttons to transfer these files. Downloads stream through the browser's download manager. The private workspace issues a short-lived, single-use URL for the one selected file; the workspace capability is not placed in that URL. Restarting the server invalidates unused download URLs. Reopen the retained transfer and request another download when needed.

At the receiving workspace, choose the original manifest and archive. Uploads stream in 4 MiB chunks with a 16 GiB archive limit. Every acknowledged chunk is fsynced. **Pause upload** stops the current connection; reopening the transfer reports the retained byte offset. Select the same two original files and choose **Receive / resume upload** to continue. The complete archive must match the original byte count and SHA-256 before it becomes available for import. An incorrect complete archive stays incomplete and is never handed to Docker. Its expected and received byte counts and hashes, verification time and error are retained and shown after reopening. Select the correct original files and choose **Start a new receiving transfer**. This explicit action starts from byte zero in a new directory and preserves the failed transfer. **Receive / resume upload** continues an ordinary partial transfer or recovers the same pending transfer-creation UUID after a lost response; it does not silently replace a failed archive.

An image already copied to the operator machine can be opened with **Open an existing image transfer**. This attaches the original directory without copying the archive.

**Import exact image** calls the original image engine. It checks the complete archive, loads the immutable image if needed, and verifies the observed image ID, source commit, archive digest, context and platform against the original receipt. If the exact image is already present, the original engine reports that state. A conflicting generated tag is retained and reported by the engine rather than overwritten.

## Put the selected image in the merchant's original container plan

Choose **Use the image in an existing merchant container plan**:

1. Select the built image or complete portable transfer.
2. Select the merchant's original runtime with the same source release and profile.
3. Select its existing SF99 merchant host plan or container plan. These use `stellar-forge.merchant-host.v1` or `stellar-forge.merchant-container.v1`. The image build plan is a different input. A host-plan selection creates the original container declaration in the reviewed source mode.
4. Review the new plan with the exact immutable image ID and the receipt's UID/GID. It retains the original host plan, source mode and operational settings. Bind mode includes the selected ready runtime's dependency root when needed. The original host's Node/Python paths must match the selected image. The visible **Use this image’s Node/Python paths** option creates a retained host-plan copy with those exact paths; the original host file stays intact and its identity is checked again before generation.
5. For image source mode, the selected source must be at the image's declared source root and that mode must be supported by the image's source release.
6. Choose **Prepare original container bundle**. The worker rechecks the reviewed original plan and host inputs, verifies the native image through the original engine, then calls the original container generator and bundle check.

The resulting operation contains the concrete container bundle, retained new plan, Compose file and original host bundle. The source plan and active merchant state remain at their original paths. Use the generated `RUNBOOK.md` and existing SF99 container controls for that merchant's deployment, ingress, shutdown, maintenance and rollback.

## Retained state and composition API

The extension stores its own records below `WORKSPACE/images`. Original runtime entries remain in their existing workspace locations. Original operation requests, state and logs remain below `WORKSPACE/operations/UUID`.

The existing `openRuntimeWorkspace()` model adds:

| API | Original workflow |
| --- | --- |
| `imagesState()` | Read retained contexts, reviews, transfers and results |
| `imagesReview(input)` | Review an attached runtime's original source/profile as an image |
| `imagesAttach({directory, label})` | Open an existing verified context |
| `imagesTransferAttach({directory, label})` | Open an original portable transfer |
| `imagesTransfer({manifest, requestId, label})` | Retain a receiving manifest and stable transfer |
| `imagesUpload({transferId, offset, body})` | Append the next exact streamed chunk |
| `imagesContainerReview(input)` | Review the immutable image in the original merchant plan |
| `begin({requestId, operation, ...fields})` | Execute through the original durable worker |

Image operations are `image_prepare`, `image_lock`, `image_check`, `image_build`, `image_status`, `image_export`, `image_import` and `image_container`. Their request IDs use the same UUID contract as the other runtime operations. Context and transfer IDs are separate from runtime target IDs.

Browser routes use the original loopback origin and private capability. Image and container plan data are reviewed in that operator context. The extension does not add credentials to image artifacts or portable manifests, and does not require hosted build infrastructure.

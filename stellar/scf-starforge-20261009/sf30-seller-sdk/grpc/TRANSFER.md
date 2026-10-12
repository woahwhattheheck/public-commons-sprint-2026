# Complete gRPC workspace migration

The workspace migration panel moves an entire saved gRPC project to a new working directory. The received project opens in the original native editor with its source revisions, calls, reviews and merchant preparations available together. A capture is immutable; the source workspace can continue changing after the capture commits.

## What moves

| Saved material | Received behavior |
| --- | --- |
| Protobuf files or reflected descriptor bytes, their imports and all source revisions | Original compiler and revision readers reopen the exact saved sources. Current selection and generation are retained. |
| Reflection inventory and capture records | Original endpoint/profile references, selected services and descriptor identities remain available. |
| Unary and streaming attempts, exact inputs, complete results and partial terminal streams | Original operation IDs and durable outputs remain available through the native call reader. |
| Contract upgrade reviews, comparison reports, selected candidate and adoption records | Existing review and revision history reopen through the original upgrade workspace. |
| Check, List and Watch observations | Each selected health journal retains an exact committed event prefix and its chain identity. The new owner recovers its saved phase using the original health engine. |
| Operations captures, incident revisions, reviewed actions and outcome comparisons | Original immutable captures and every saved incident version remain available. |
| Merchant preparations, generated customers and gRPC release source | The original preparation and release readers resolve the complete relative source closure under the new directory. |
| Earlier workspace transfer and release receiving records | Historical observations retain their original source and receiving identity. The new workspace receives a fresh explicit location binding. |

A capture records credential environment **names** from the saved source configuration. Supply their values in the receiving operator's environment when an operation needs them. Launch capabilities, old process authority and runtime directories are retained as historical observations where applicable; a received editor creates its own current launch.

## Browser workflow

1. Open the existing native gRPC editor and select **Workspace migration**. Save pending source, plan or route edits before capturing.
2. Review the current workspace binding, choose the capture byte budget and create the capture. The editor retains the operation UUID and complete input before the request. The progress panel follows the same operation through snapshot and archive publication.
3. Select the completed capture. Review its counts, environment names and complete file inventory. Search by original path or filter workspace records, health prefixes and observations. Continue pages using the displayed immutable snapshot.
4. Download the archive and source manifest. A source manifest belongs to one capture; its canonical `sha256` identifies the selected native state.
5. On the receiving operator, choose the archive file, supply its full SHA-256 and byte length, and upload. The retained intake shows its accepted offset. An interrupted upload continues the same UUID and exact file.
6. Inspect the complete archive. Choose a distinct receiving directory whose parent already exists as a private real directory. The target must be new, or must contain the receipt from this exact receiving operation.
7. Receive the project. The archive receiver validates the complete file closure, then the original native engine reopens the saved records and reports the new binding.
8. Select **Open received editor** using that current binding. Continue original source editing, review, customer preparation or release operations in the received project. **Close received editor** settles the child editor's owned resources and preserves its files.

The capture, intake and receiving UUIDs identify different operations. Keep each displayed UUID when continuing that operation. The browser retains pending operation inputs for reload recovery; download locations and receiving targets remain explicit operator selections.

## Capture and receiving identity

The source binding includes the canonical directory, its device/inode identity, and its current revision/generation. A new online capture should use the binding returned by the current transfer list. Once the snapshot manifest has committed, the same capture request returns or completes that original snapshot even if the live workspace subsequently changes.

Receiving binds an operation UUID to the archive SHA-256 and exact byte length, the native manifest's canonical SHA-256 and the destination. The receiver publishes the private staged directory without replacing an existing target. Repeating a completed operation checks its original receipt and preserves valid later edits. A different archive, destination or operation identity requires a distinct receiving selection.

A live health Watch can append after the capture selects its committed prefix. The manifest retains the prefix's final sequence, native chain hash and byte length. The receiving engine verifies that original prefix; later received health events can extend it. A new Watch or explicit resume remains an ordinary native operation using the original health controls and deadline.

## Release continuity

The saved gRPC merchant package and release manifest use relative paths and reopen under the new release root. Earlier release receiving bindings include their former store location, so those bindings remain in the historical observations. Use the original release console's attach/review flow when binding a received release to a new receiving store. Endpoint, port, terms and facilitator settings keep their saved values until the operator edits them.

## Interfaces and complete files

- Native editor and HTTP: the original workspace server owns capture, intake, receiving, audit and child-editor lifecycle.
- Node client: `transfer/client.mjs` with `client.d.mts` provides typed requests, streaming file upload and resumable download.
- CLI: `transfer/cli.mjs`, distributed as `grpc-transfer`.
- Merchant agent: the thirteen `merchant_grpc_transfer_*` tools use the existing merchant workspace and retained-file transport.
- Installed product: `grpc-merchant transfer`, its typed client and `receive-workspace` join the same source.

A direct archive consists of `grpc-workspace.tar.gz` plus the exact `grpc-workspace-transfer.json` source manifest. Merchant delivery adds its existing outer export manifest, which binds those two files. The outer export-manifest SHA-256 and the inner native manifest's canonical SHA-256 are distinct values. Both are retained in the installed receiving command.

See [Native receiving and command reference](transfer/RECEIVING.md), the merchant operator's `GRPC_TRANSFER.md`, and the installed product's `TRANSFER.md` for complete commands and recovery inputs.

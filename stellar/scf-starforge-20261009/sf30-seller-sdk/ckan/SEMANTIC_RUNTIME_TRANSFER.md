# Portable original semantic runtime inputs

This procedure carries a completed semantic runtime's original source, complete resolved wheel set, exact dependency lock and original custody receipts to another host. The recipient installs those selected wheels into a new private environment at its final path, then uses the existing runtime inspection and Applications selection.

The sender's installed environment stays on the sender. The portable package contains the inputs needed to prepare a recipient environment. It does not contain an interpreter, virtual environment, host operating system or catalogue project.

Use this procedure when the customer must receive the same selected dependency resolution and original semantic source. The existing [semantic runtime procedure](SEMANTIC_RUNTIME.md) remains the source for first preparation, ordinary inspection and private environment selection. The [managed DCAT receiving procedure](../../distribution/runtime-workspace/DCAT_RECEIVING.md) remains responsible for the catalogue archive, original Application setup and saved recipient launch.

## What is preserved

The export starts from a `READY` runtime. It verifies the original installed source, complete retained wheels, exact lock, recorded environment inventory, actual selected interpreter and the original preparation receipts before producing a portable file.

The ZIP contains one `transfer-manifest.json` and the complete declared files:

| Area | Contents and meaning |
| --- | --- |
| `source/` | Exact selected original semantic engine/worker source, requirements, licence, source manifest and selected-runtime manifest. |
| `wheels/` | Every original wheel in the completed dependency resolution, with its original bytes. |
| `records/requirements.lock` | The exact completed name/version/hash lock. |
| `records/wheel-selection.json` | The original wheel inventory, package metadata and selected resolution. |
| `records/runtime.json` | The complete sender runtime receipt, including its original environment inventory and host selection as provenance. |
| Other declared `records/` files | The original selection, Python/import reports, commands, exit receipts and private logs listed by the sender runtime receipt. |

The transfer manifest binds every member by path, byte count and SHA-256. It also binds the original source, lock and full sender receipt. The package is a private operating handover: original receipts can contain sender paths, interpreter details and installer logs. Review the full package before giving it to a recipient. It contains no private environment file selected by the Applications console.

The recipient retains the original sender receipts unchanged. Its own received-input receipt and later installed-runtime receipt have distinct identities and local directories. The recipient's runtime records the bundle hash, received-input receipt hash, sender runtime receipt hash and exact lock hash.

## Host and source prerequisites

Use the installed product containing this complete source module and the unchanged selected semantic vendor files. Export uses the sender's verified prepared interpreter. Inspection and receiving require an explicitly selected absolute Python executable on Linux, version 3.11 or later. Receiving and inspection use the standard library; they do not install packages or invoke the RDF engine.

The selected recipient Python must have the standard `venv` and `ensurepip` support required by the original preparation procedure. Its host operating system and base standard library remain host prerequisites. The original semantic requirements remain the selected RDFLib, pySHACL, cryptography and PyLD versions documented by the product.

A retained wheel set is platform and interpreter specific. The recipient must use a compatible Python version, implementation, architecture and platform for those wheels. The actual offline pip installation decides compatibility. If the selected wheels are incompatible, preparation stops and preserves its log and failure receipt. It does not contact an index, choose a different wheel, weaken the lock or modify the sender result.

For a genuinely different platform, make a separately selected original first preparation on that platform through `semantic-runtime-prepare`, then deliver and identify that new resolution as its own runtime. Keep both original receipts. That is a new selection rather than a replay of the transferred one.

## 1. Export the sender's completed runtime

Select an existing `READY` runtime and a new output file in an owner-only directory outside the runtime and every catalogue project.

~~~sh
starforge dcat semantic-runtime-export \
  --directory /absolute/private/sender-semantic-runtime \
  --out /absolute/private/delivery/semantic-runtime.zip
~~~

The command prints a complete export result with:

- `schema: stellar-forge.dcat-semantic-runtime-transfer.v1`
- `status: EXPORTED`
- `file`, complete `bytes` and complete-file `sha256`
- `manifestSha256`
- the complete `manifest`, including original source, sender receipt, packages and member descriptors

Retain the actual returned hash and byte count beside the exact ZIP. Use the destination's normal binary transfer method. Do not paste a ZIP listing or substitute the manifest for the complete package. If transport requires parts, preserve every accepted part and verify the joined complete file against the returned hash before continuing.

Export creates a private temporary ZIP, finishes and verifies all bytes, and then publishes to a new destination without replacing an existing file. Repeating export to an existing complete file is allowed only when its complete manifest and source selection match. A different existing output remains intact. An interrupted unpublished temporary file remains private evidence; it is not a completed transfer.

The sender's runtime remains usable after export. The transfer creates no new catalogue review, semantic run or acceptance decision.

## 2. Inspect the complete transferred bytes

On the receiving host, select the actual absolute base Python path and the original sender's complete-file hash:

~~~sh
starforge dcat semantic-runtime-inspect-transfer \
  --file /absolute/private/incoming/semantic-runtime.zip \
  --sha256 ACTUAL_SENDER_BUNDLE_SHA256 \
  --python /absolute/python
~~~

The uppercase hash is a placeholder for the actual 64-character SHA-256 returned by export.

Inspection streams the complete ZIP and each member. It checks the expected whole-file hash, manifest inventory, every declared member hash and byte count, and the path/link/encryption/compression limits. It returns `status: VERIFIED_BYTES` and the full manifest. This is complete byte inspection. The receiving operation additionally checks the original source selection, wheel metadata and exact canonical lock before declaring usable inputs.

The package uses stored ZIP members. Each member is limited to 512 MiB; the complete declared payload is limited to 2 GiB and 20,000 members. The archive permits bounded ZIP overhead, and its manifest is limited to 16 MiB. Directory entries, traversal, links, encryption, duplicate names, extra members and compressed representations are rejected. These are actual format limits, not a claim that every allowed input will fit the recipient host.

The helper verifies bytes through the original opened file and checks its identity again before completing. Changed files remain failures.

## 3. Receive into a new private input directory

Choose a new absolute directory outside every catalogue project and outside the incoming ZIP's location.

~~~sh
starforge dcat semantic-runtime-receive \
  --file /absolute/private/incoming/semantic-runtime.zip \
  --sha256 ACTUAL_SENDER_BUNDLE_SHA256 \
  --directory /absolute/private/received-semantic-inputs \
  --python /absolute/python
~~~

The receiver owns a lock for this directory. It first binds the destination to the exact complete bundle and manifest identities, then copies complete source, wheels and receipts beneath `payload/`.

Before finishing, it verifies:

1. Every payload file, with no extra or missing member.
2. The original selected source against the product's pinned source and runtime manifests.
3. The full sender receipt and every custody file it names.
4. The exact requirements and original resolved wheel selection.
5. Every wheel's declared package name/version against its own metadata and exact bytes.
6. The complete canonical name/version/hash lock, including all original pinned dependencies.

The completed result has:

~~~json
{
  "schema": "stellar-forge.dcat-semantic-runtime-transfer-received.v1",
  "status": "READY_INPUTS",
  "directory": "/absolute/private/received-semantic-inputs",
  "receivedAt": "actual completion time",
  "bundle": {
    "bytes": 0,
    "sha256": "actual complete ZIP hash",
    "manifestSha256": "actual manifest hash"
  },
  "sourceRuntimeReceiptSha256": "actual original sender runtime receipt hash",
  "source": {
    "manifestSha256": "original source manifest hash",
    "runtimeManifestSha256": "original selected-runtime manifest hash",
    "requirementsSha256": "original requirements hash",
    "repository": "original repository",
    "commit": "original selected source commit",
    "files": []
  },
  "lockSha256": "actual exact dependency lock hash",
  "files": [],
  "receiptSha256": "actual received-transfer.json hash",
  "receiptBytes": 0
}
~~~

This is an explanatory field map. Actual output contains every complete descriptor and actual count; the zero values and descriptive strings above are not an executable receipt.

`READY_INPUTS` means the original complete source and wheel inputs are received. It does not mean an environment is installed, the Python wheels are compatible, a semantic engine has run or a customer has accepted a catalogue.

The private directory contains `transfer-selection.json`, `transfer-manifest.json`, `payload/`, `received-transfer.json` and its original lock. The final receipt is atomically published only after complete validation. The complete original ZIP may be retained alongside the selected input directory.

## Interrupted receiving and exact replay

Rerun the same receive command with the same destination and original bundle hash. The original directory selection must match. A retained partial member can resume only when every existing byte is an exact prefix of that same declared member. The receiver never truncates or replaces different retained bytes.

A complete received directory is fully reverified before reuse. An extra member, changed original, different bundle selection or conflicting prefix stops the operation with the original files preserved. Select a new private destination for a deliberately different transfer.

The helper binds its lifetime to the invoking process using the original Linux parent-death mechanism. Explicit cancellation waits for the owned helper to exit. A stopped copy can leave an owned prefix or an unpublished receipt temporary; neither is reported as complete.

Do not resolve an uncertain completion by inventing a receipt or renaming an unrelated directory into place. Inspect the actual completed receipt or continue the same selected transfer.

## 4. Inspect received inputs independently

~~~sh
starforge dcat semantic-runtime-inspect-inputs \
  --directory /absolute/private/received-semantic-inputs \
  --transfer-sha256 ACTUAL_RECEIVED_INPUT_RECEIPT_SHA256 \
  --python /absolute/python
~~~

This hash is the `receiptSha256` from receiving. It is different from the ZIP's `sha256`. The command validates the complete received inventory, original source, wheel metadata, sender receipts and lock again. It does not install or resolve anything.

The optional `--transfer-sha256` can be omitted when inspecting a deliberately selected local receipt for the first time. Preparation always requires the exact expected received-input receipt hash.

## 5. Prepare the recipient's final environment from the exact lock

Choose a separate new private directory for the installed recipient runtime. Neither directory may contain the other.

~~~sh
starforge dcat semantic-runtime-prepare-received \
  --transfer-directory /absolute/private/received-semantic-inputs \
  --transfer-sha256 ACTUAL_RECEIVED_INPUT_RECEIPT_SHA256 \
  --directory /absolute/private/recipient-semantic-runtime \
  --python /absolute/python
~~~

This is the existing original preparation workflow with a received exact selection:

1. Reverify the input receipt and all selected original bytes.
2. Bind the new runtime selection to the actual recipient Python and received input identities.
3. Create the virtual environment directly at its final stable private path.
4. Copy the exact original wheels, `requirements.lock` and `wheel-selection.json` into the recipient runtime.
5. Run the original isolated offline hash-required installation from that retained wheel set.
6. Run the original dependency check and import the unchanged original engine.
7. Retain the actual command exit/log receipts, package versions, interpreter binding and complete installed-file inventory.
8. Publish the original `READY` runtime receipt.

No dependency resolution command runs on this path. Pip receives `--no-index`, retained wheel paths and `--require-hashes`; the owned environment also disables ambient pip configuration with `PIP_CONFIG_FILE` set to the platform null device. The original pinned source, requirements and full exact lock remain the authority.

An interrupted preparation keeps its final environment directory and original attempt records. Continue the same command and exact selection through the original preparation logic. Received wheel, lock and wheel-selection copies resume only an identical prefix under the original preparation lock; conflicting retained bytes remain an explicit failure. The original preparation's other source and command controls still apply. A completed runtime can be inspected or reused without a new resolver, installer or network request.

The original `READY` receipt includes an additional `transfer` provenance object:

~~~json
{
  "directory": "/absolute/private/received-semantic-inputs",
  "receiptSha256": "original received-input receipt hash",
  "bundleSha256": "original complete ZIP hash",
  "sourceRuntimeReceiptSha256": "original sender runtime receipt hash",
  "lockSha256": "same exact dependency lock hash"
}
~~~

Those values are bound into the recipient's original selection and receipt. The recipient interpreter and installed environment retain their own actual identities. The sender's interpreter path is provenance, not a destination instruction.

## 6. Select the completed runtime for the existing application

Inspect the actual recipient runtime:

~~~sh
starforge dcat semantic-runtime-inspect \
  --directory /absolute/private/recipient-semantic-runtime
~~~

Then produce a new private environment file through the existing command:

~~~sh
starforge dcat semantic-runtime-environment \
  --directory /absolute/private/recipient-semantic-runtime \
  --out /absolute/private/settings/dcat-environment.json
~~~

If the receiving host already has a private environment file for its catalogue source or migration interpreter, use the original `--input` option to preserve those selected values in a new output file. The command adds the exact semantic interpreter, runtime directory and receipt hash. Do not put that private file inside the portable catalogue project.

Continue the original [managed DCAT receiving procedure](../../distribution/runtime-workspace/DCAT_RECEIVING.md). Its owner receives the complete catalogue archive, selects the actual recipient source/runtime, calls the existing environment writer, and prepares/saves the original Application setup. This transfer module does not rewrite application request history or replace the generic Runtime installer.

Opening received profiles, reports, comparison artifacts and review history still requires no prepared semantic Python. A new native run deliberately selects the actual completed runtime. The native bridge verifies that binding again before each real worker phase.

Once the recipient runtime is complete, its normal inspection verifies its own source, retained wheels, exact lock, receipts and environment. It does not depend on the received-input directory still being present. Keep the portable ZIP and original transfer receipt according to the customer's custody requirements; removing them does not rewrite the provenance retained in the runtime receipt.

## Original module API

The installed source export is `./seller/dcat/semantic/runtime-transfer`. The source module is `ckan/dcat-semantic-runtime-transfer.mjs`.

| Function | Input and result |
| --- | --- |
| `exportDcatSemanticRuntimeTransfer({directory,out}, context)` | Verify a sender `READY` runtime and export a new complete ZIP. Returns manifest, complete-file hashes/counts and `EXPORTED`. |
| `inspectDcatSemanticRuntimeTransfer({file,expectedSha256,python}, context)` | Verify the whole ZIP and every member. Returns full manifest and `VERIFIED_BYTES`. |
| `receiveDcatSemanticRuntimeTransfer({file,expectedSha256,directory,python}, context)` | Receive exact source, wheels, lock and sender receipts. Returns complete `READY_INPUTS` receipt plus its hash/count. |
| `inspectDcatSemanticRuntimeTransferInputs({directory,expectedTransferSha256?,python}, context)` | Reverify the complete received-input directory and optional expected receipt hash. |
| `prepareDcatSemanticRuntimeFromTransfer({transferDirectory,expectedTransferSha256,directory,python}, context)` | Reverify received inputs and invoke the original offline exact-lock preparation. Returns the existing full `READY` runtime receipt with transfer provenance. |

`context` accepts `signal` and `onUpdate`. Cancellation drains only this call's original helper; callbacks report actual transfer/preparation phases. Every path is absolute and selected explicitly. The expected bundle hash and expected received-input receipt hash are separate required bindings for their respective operations.

Applications integrations should retain the exact `READY_INPUTS` receipt while preparing, then pass only the completed runtime directory into the existing `writeDcatSemanticRuntimeEnvironment`. They should not fabricate a runtime selection from a wheel manifest.

## Actual customer receiving

A source publication establishes that this complete operating capability is available. It does not establish that a sender runtime was prepared, that a transfer occurred or that a recipient's wheels installed successfully.

Use the existing equipped customer operation to perform one actual sender export, complete-byte transfer, recipient input receiving, original offline preparation and private Application selection. Retain the actual selected hosts, interpreter identities, package/lock receipts, original logs, transfer hashes and resulting runtime bindings in that operation. Continue the already-selected semantic catalogue course; do not rerun completed GSA migration merely to obtain another input archive.

Before a client or prospect-ready presentation, the producing operator must run and open the exact installed version and actually look at the product. Use the important controls and relevant desktop/narrow layouts, open all recipient attachments and original downloads, and verify independent reopening through the selected Application. Source review, syntax checks, HTTP responses and peer approval do not substitute for actual product use. Fix visible defects directly and retain the actual result with its source edition.

The customer can then receive both kinds of deliverable: the complete editable catalogue project with original semantic evidence, and the exact original runtime inputs needed to prepare a deliberately selected compatible host for following work.

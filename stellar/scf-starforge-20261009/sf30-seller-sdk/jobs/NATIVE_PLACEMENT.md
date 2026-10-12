# Receive the completed paid-job core on writable storage

The original paid-job merchant already separates its historical source identity
from its physical executable through `readJobMerchantSource()` and
`adoptRestoredJobSource()`. The native worker now uses those same APIs when its
completed input has to move to a writable filesystem.

This is the existing native operation's input receive. Its original baseline
result, two settlements, job IDs, claim material, inputs and result bytes remain
the received originals. The original merchant store and worker continue to own
execution. The controller still owns process custody, memory, disk and output
transport.

## Select the physical directory before dispatch

Use the complete published source containing `native-placement.mjs`,
`native_capsule.py` and `cloud-native.py`. Add `--retained-directory` to the
existing completed-core command:

```sh
python3 /absolute/payload/cloud-native.py \
  --workspace /absolute/native-project \
  --out /absolute/native-project/results \
  --source-commit EXACT_COMPLETE_SOURCE_COMMIT \
  --capsule /absolute/input/completed-core.tar.gz \
  --sha256 EXACT_ORIGINAL_CAPSULE_SHA256 \
  --input-mode completed-core \
  --retained-directory /absolute/native-project/retained/sf30-paid-jobs-CKQrif \
  --approval browser --input-files --applications \
  --validation-operation SCF-RELEASE-RECEIVING-0B8D-20261012-32F59 \
  --node /absolute/node --node-version ACTUAL_SELECTED_24_VERSION \
  --npm /absolute/npm
```

The selected directory must be a private, real absolute path inside the native
project, retain the original directory's final name, and be separate from the
original location, output directory, installed source, dependencies and
Applications runtime. A symlink is not a placement. The default remains receiving
at the original physical directory when this option is omitted.

For an already queued operation, use the maintained native handoff's reviewed
placement and disk amendment. Keep the original operation, record directory,
artifact names and capacity ledgers. The amended command must contain this exact
directory, and the disk declaration must cover the filesystem that actually
receives the state and runtime. The original handoff reconciles and drains the
prior supervisor before replacing its request. Editing an immutable request file
or changing only its declared disk path would leave a different actual write
location.

This completed-core placement precedes the new customer, browser checkout and
installed Applications phases. Once those phases create their private operation
directories, resume at the same selected directory and with the same input and
source. Their original records are retained by that continued worker.

## What the receiver checks and commits

The Python capsule reader checks the entire transferred archive, its member
inventory and every member's SHA-256. It also checks the two completed original
job rows against their original source, result bytes and native settlement IDs,
and checks the actual earlier native result. The new physical receive retains all
these files. Its application alias is received as the same verified application
bytes in a regular private file.

Before copying, the receiver saves `input-placement.json` in the original native
project. It binds the archive and manifest hashes, old and new physical roots,
original source, jobs and exact received file descriptors. Only that matching
receive can finish a partially created destination. An unrelated existing
directory is preserved. A completed receive has an immutable
`input-capsule.json`; reopening it verifies the original configuration and
application and retains subsequent legitimate customer and job changes.

After the original runtime profile is installed, the Node adapter:

1. Checks the private received configuration, application and complete file
   inventory against that placement.
2. Acquires the original merchant, SF98 delivery and result-delivery leases and
   obtains the original `inspectJobRecoveryState()` result.
3. Saves a private review containing the actual state hash and any previous
   source-binding hash.
4. Calls `adoptRestoredJobSource()` with the actual capsule-manifest, placement
   and review hashes. That original adapter reacquires the same writer leases,
   rechecks the source and reviewed state, preserves binding history, and
   atomically publishes the new physical binding.
5. Reopens through `readJobMerchantSource()` and checks both the retained
   historical identity and the selected physical application path.

The lease files themselves are the existing writers' mutable lease metadata.
Their contents are excluded from the recovered application-state identity by
the original recovery engine. All retained application data remains covered.

The stored configuration can retain its original application reference.
`source-binding.json` selects the physical executable for the original merchant;
`source.json`, configuration snapshots and paid job rows keep their original
bytes. The original worker's `applicationPath` support performs the execution.
The checkout continuation's original Python reader also selects this same physical
binding when it reads the retained application, and still checks the original
configuration and application hashes before creating its fixture. This supports
an original configuration that contains an absolute application reference.
No second payment verifier, lease protocol or merchant store is introduced.

## Resume the same receive after interruption

A partial file copy resumes only with the same archive and placement profile.
Owned temporary files are recovered by the original capsule's atomic immutable
writer. A committed receive reopens its current state instead of copying older
rows over it.

The adapter saves its review before source adoption. If its response is lost
after the original adapter commits the binding, running it again with the same
profile and review recovers that exact committed binding. The original adapter
permits this outcome even when legitimate work subsequently advanced, and checks
the retained provenance before returning it.

The low-level adapter is also callable explicitly on the same private receive:

```sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/native-placement.mjs \
  --profile /absolute/native-project/input-placement.json \
  --review /absolute/native-project/results/native-placement/review.json \
  --out /absolute/native-project/results/native-placement/adoption.json
```

Its exported API is
`adoptNativeJobPlacement({profileFile, reviewFile, resultFile})`.
The first two paths are required; the result path is optional. Its result contains
the physical directories, profile and review hashes, and the original
`stellar-forge.job-source-adoption.v1` outcome. These are operator receiving
files and include private state provenance.

If the current physical directory was lost after a phase started, restore its
returned private state and matching review at that same directory before
resuming. The original run-result and native phase results decide what has
already completed. Preserve an interrupted native buyer's original operation;
do not turn a missing directory into permission to create another purchase.

## Results retain both identities

`baseline.json` remains the exact earlier core result. Its
`retainedWorkDirectory` reports where that core actually completed. The worker
checks it against the retained original core directory and keeps its two
settlements unchanged.

New customer, checkout and Applications results report the physical directory
they actually use. `run-result.json` records `storagePlacement`,
`storageAdoption` and `completedCore.originalCoreDirectory`, so the physical
move and prior execution are explicit. All phases still use their original
drivers, ledger, browser approval, retained download, library and Applications
engines.

The private output includes:

- The original completed input capsule and manifest.
- The complete placement profile, saved original-state review and adoption result.
- Original command logs and unchanged native phase results.
- A returned completed-core capsule with the current physical source binding,
  original core result and current retained state.
- The original artifact manifest and `native-return.tar.gz` for the existing
  worker's result transport.

If installation or adoption fails before the binding is available, the worker
still returns the received private state with the original capsule and placement
files. It records that adoption is pending and keeps the actual failure. The
returned completed capsule records an existing binding when physical source
paths differ, while keeping the raw original core result's path and bytes.

For process-scoped storage such as an isolated `/dev` mount, keep the native
supervisor, payload and output transfer inside one retained caller. Complete the
existing durable output transfer before that caller's storage disappears.

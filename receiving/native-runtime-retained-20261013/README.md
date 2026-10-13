# Complete retained native runtime

This directory publishes the full Python runtime for the original foreground/native command owner. Its maintained modules retain command records, actual exits, resource declarations, supervisor ownership, source selection, output copies and independent receiving. Operators can receive one complete source edition through the existing runtime_source APIs and continue their original operation.

## What changed

A supervisor can finish its own lifecycle successfully after its child command failed. The old exec handoff returned that supervisor success to the shell. The corrected native_foreground.py preserves a nonzero supervisor/finalizer exit and, after supervisor success, returns the existing retained command result through swarm_cloud_job.exit_status. It also maps an already terminal resume result and returns retryable status 75 for a retained finalization_pending result. Queued and running acknowledgements keep their existing zero status. The original supervisor, inherited lock descriptor, foreground lifetime and finalizer stay in place.

The source integrates 84DF's complete foreground postimage (21,762 bytes; SHA-256 b5689866d8665a0a80caadcacbe1ae8748f46bc763d0bad729f3e665829420d6) against preimage a62c465f2a6a023bc3d8bc01768ef0f7f0ca235e. The rest of the runtime was refreshed from source commit decd4ca02864ba0ee54715e4129c5d450f04e9b9. It includes the current PID-namespace child observation and explicit closed-copy recovery changes, including their complete cache_closed_release.py dependency. The full retention guide is extended with exact shell-status and receiving behavior.

All 52 Python modules, the complete retention guide and the owner instructions are ordinary editable files in host/. SOURCE_EDITION.json binds all 54 original member bodies and records their source Git identities. This public source edition is separate from private command records, customer payloads, credentials and active workspace selection.

## Receive the complete source

Use the existing accepting Linux or WSL Linux host and an ordinary checkout of this public repository at the selected publication commit. Select a new private source directory beside the original operation's retained records. Keep an active supervisor on its current source and its original record until its lifecycle completes.

The original runtime_source.py uses Python's standard library. From this directory, choose your own private paths. Create the owner-private archive parent first; the existing pack implementation writes its temporary archive in that parent. Then run its original commands:

~~~sh
mkdir -p -m 700 /absolute/private/receiving
python3 -B host/runtime_source.py pack \
  --root host \
  --out /absolute/private/receiving/native-runtime-source.zip \
  --entrypoint native_foreground.py \
  --entrypoint swarm_cloud_job.py \
  --entrypoint swarm_cloud_worker.py \
  --entrypoint runtime_source.py \
  --asset NATIVE_ARTIFACT_RETENTION.md \
  --asset AGENTS.md
~~~

The pack response contains the exact archive file, bytes and sha256. Preserve that response with the existing operation. Pass its returned hash to the same inspector and receiver:

~~~sh
python3 -B host/runtime_source.py inspect \
  --archive /absolute/private/receiving/native-runtime-source.zip \
  --sha256 RETURNED_ARCHIVE_SHA256

python3 -B host/runtime_source.py receive \
  --archive /absolute/private/receiving/native-runtime-source.zip \
  --sha256 RETURNED_ARCHIVE_SHA256 \
  --out /absolute/private/received-native-runtime
~~~

These are the maintained source pack, inspection and receipt implementations. The pack follows original ordinary and lazy local imports and carries the selected whole assets. The receiver checks every archive member, retains its complete original source manifest and reopens the same selected destination idempotently. Use the actual returned destination for later source selection.

## Continue the original operation

Read the received AGENTS.md and NATIVE_ARTIFACT_RETENTION.md, then load that exact received host root using native_foreground.load_native. Preserve the original project directory, argv, operation ID, record root, queue identity, runtime declaration, resource declarations and selected output paths. The corrected foreground entry accepts the original native Namespace and finalizer contract.

For a new command already authorized in that original operation, its existing start path uses:

~~~python
import sys

# Set this to the exact private directory returned by runtime_source receive.
sys.path.insert(0, str(selected_received_host_root))
from native_foreground import load_native, start_foreground

native = load_native(selected_received_host_root)
# original_args is the complete existing reviewed Namespace, including
# the original operation ID, project, argv, records and resource selection.
original_args.retain_artifacts = True
start_foreground(native, original_args, report_format="summary")
~~~

This runs in the original dedicated foreground process. Its source-owned callback acquires and retains the original supervisor; after acknowledgement, handoff remains in that process. The selected runtime must expose its existing retained-artifact capability, and the saved request retains the selected true retention intent before supervisor acquisition.

For an undispatched existing queue, use its maintained native_runtime_handoff review/prepare and original foreground resume with the same record and queue. Read its current retained runtime selection before explicitly adopting this edition. For an already completed command, read its original result and use the original finalize path for retained outputs that still exist. A shell-status repair does not create a new customer command or another worker.

## Outcome behavior

| Original state | Foreground result |
| --- | --- |
| Supervisor or finalizer returns nonzero | Preserve that exact failure code |
| Supervisor succeeds; retained child succeeds | Zero |
| Supervisor succeeds; retained child fails | Original command exit code |
| Supervisor succeeds; retained child was signaled | Original mapper: 128 minus the negative recorded code |
| Result is absent or finalization remains pending | 75 |
| Resume opens an already terminal original record | Existing native result-to-exit mapping |

Full status, result.json, output.log, completion record and artifact history retain their existing meanings. The supervisor's completion success and the child's actual exit remain separately visible.

## Actual receiving and product observation

The complete source was compared against its pinned original Git blobs; the guarded foreground correction and whole local import membership were reviewed. The original attempted native execution ended before process creation with environment_offline409. The existing accepting runtime owner continues the original source receiving and command operation, and returns its actual shell status together with its retained result and outputs. No broad repository suite or hosted Actions run is needed to adopt these sources.

The received AGENTS.md carries Bryce's complete rendered-product instruction. Before presenting an application or attachment produced by a native run, its producing owner opens the exact resulting product, operates its critical controls, views the actual desktop and relevant narrow outputs, and opens the delivered attachments in their ordinary viewer. The native runtime preserves the exact output bytes for that normal product work.

## Source custody

Maintained public path: woahwhattheheck/public-commons-sprint-2026/receiving/native-runtime-retained-20261013. Original runtime modules retain their names and APIs inside host/. Existing repository host/ modules and active deployed workers are preserved. The source selection manifest records the historical donor commit and exact changes so the current source owner can incorporate the correction in its maintained public distribution. Private runtime history and original customer source continue in their existing destinations.

## Complete selected-source metadata receiving

The existing `host/connected_github_source_reuse.py` now also accepts the original `commons.github-source-selection.v1` with a `tree_responses` array of complete captured direct Git trees. It reproduces every captured Git object, binds the exact commit root and proves all selected parent/subtree contents before the unchanged `select`, `plan`, `copy`, `inspect` and `export` operations. The original single complete `tree_response` input is unchanged.

Use repository-root `host/connected_github_source_tree.cjs` and `host/connected_github_tree_source_cli.cjs` for the same caller-owned acquisition/offline selection. The full receiving course, paused/failed request semantics and actual provider result are in `host/CONNECTED_GITHUB_TREE_SOURCE_RECEIVING.md`. No provider retry, account switch, new supervisor or source execution is implied. Preserve the complete captured responses and original source request with the current operation. Metadata acquisition has been exercised through actual connected Git reads; CPython/filesystem receiving of this edition remains with the original accepting owner.

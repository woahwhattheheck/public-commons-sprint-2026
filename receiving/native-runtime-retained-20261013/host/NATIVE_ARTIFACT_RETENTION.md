# Native output retention

The native supervisor can retain the selected output bytes beside its original
command record. The existing operator, CLI, finalizer and offload delivery
continue to use that record, its actual exit and its artifact-selection revision.

Use this when the project or build scratch directory has a shorter lifetime
than the result. In particular, some cloud executors create a private /dev
mount for each invocation. Place the original records root on a filesystem
that survives that invocation, and use private /dev paths for temporary work.
The project and its selected outputs must remain readable until native
finalization finishes.

## Launch and read the original command

Add --retain-artifacts to the existing worker launch. Select output paths
relative to the original project, and keep the same operation ID on reconnect.

~~~sh
swarm-worker run sdk-owner \
  --operation-id SDK-IMPORT-AND-XDR \
  --project /workspace/sdk-project \
  --records-root /workspace/shared/swarm/jobs/native \
  --artifact-on-success sdk-runtime.json \
  --retain-artifacts --report-format summary \
  -- node sdk-operation.mjs

swarm-worker status SDK-IMPORT-AND-XDR \
  --records-root /workspace/shared/swarm/jobs/native \
  --report-format summary
~~~

Retained copies consume additional bytes on the records filesystem. Include
the selected output size, native metadata and temporary copy allocation in the
command's original disk declaration. Count memory-backed copies in the declared
whole-operation memory peak, or use the maintained explicit additional-storage
contract. The supervisor copies before releasing its original reservations.

The run command defaults to the bounded summary. Add --report-format full for
the existing complete JSON status. Other original status and mutation commands
keep their full format by default and accept --report-format summary. The
original foreground resume CLI defaults to a summary acknowledgement and
retains its supervisor diagnostics in the original record.

The summary includes the actual exit code, native failure stage, canonical
record and log paths, the last 4 KiB of command output, and artifact delivery
counts. The full result remains in result.json; the complete command output
remains in output.log. A failed command's selected failure artifacts use the
same retention path as successful artifacts.

## Complete or recover retention

For a completed command created before this option, explicitly retain its
already recorded outputs:

~~~sh
swarm-worker finalize EXISTING-OPERATION \
  --records-root /workspace/shared/swarm/jobs/native \
  --retain-artifacts --report-format summary
~~~

This action uses the original finalizer and original run lock. It requires the
actual child exit and stopped native owners. It retains the existing manifest
hashes; source files changed after that manifest are reported as changed.
Provision the copy bytes on the same records filesystem before this explicit
completed-command action.

If copying or metadata publication is interrupted, repeat the same finalize
command. The preallocated command-completion.dat preserves the actual exit.
The saved artifact inventory identifies every expected byte count and hash.
Complete copied files and complete staged files are reused, including after
the private project has disappeared. Incomplete files continue from the
original selected project.

A copy failure leaves finalization_pending with the original exit code and
file-specific errors. CLI finalization returns 75 while delivery is pending.
Correcting the output selection uses the existing explicit artifact amendment,
its revision and its retained history.

## Original operator and delivery

In Prepare a job, select **Retain output copies with the original record**.
The saved command review shows the choice before launch. For an existing
completed job, **Retain original output copies** invokes the same finalizer.

The Native artifacts table shows each file's location and the retained copy
count. Downloads from retained files keep the existing range handling,
selection-revision guard and exact byte/hash verification. The original
offload ZIP builder reads the retained copy when present and preserves the
captured executable mode. Both remain usable after the project is removed.

Under the original record, artifacts.json records:

- The original path, byte count, SHA-256 and captured mode.
- The relative retained_path and whether that file's copy completed.
- The snapshot identity, original command/exit binding and current retention
  state, copied file count and copied bytes.

Files live under retained-artifacts/SNAPSHOT/files/. Complete staged files
live under that snapshot's pending/ directory until their final link is
published. Selection amendments keep earlier snapshot directories alongside
the existing artifact-history entries. The original request, source,
completion and earlier artifact revisions remain readable through their
existing interfaces.

## Source-bound Python foreground launch

When calling a selected installed runtime from Python, use the maintained
`native_foreground.start_foreground(native, args, ...)` entry. It accepts the
same original argparse namespace as `swarm_cloud_job.start`; keep the actual
project, argv, operation ID, output paths, worker directories and resource
declarations in that namespace.

```python
from native_foreground import load_native, start_foreground

native = load_native(selected_host_root)
# args is the complete reviewed Namespace for the existing native start API.
args.retain_artifacts = True
start_foreground(native, args, report_format="summary")
```

The helper checks `NATIVE_ARTIFACT_RETENTION_SCHEMA` on the **selected native
module before creating a command record**. A legacy runtime that merely accepts
an extra Namespace field is rejected. Before acquiring its original supervisor,
the launch callback also checks that the saved native intent contains
`retain_artifacts: true`. These checks prevent a metadata-only manifest from
being presented as retained output bytes.

This entry runs in a dedicated foreground process. It uses the original
`native.start`, kernel lifetime lock and supervisor handoff; it does not start
a second worker or retry a command. The bounded acknowledgement is emitted
before handoff, and a failed acknowledgement still hands off the acquired
owner. An existing operation reopens through the unchanged native start API.
Optional `on_finalized` and `temporary_placement` have the same source-owned
finalizer and private-placement contracts as `ForegroundLaunch`.

A caller that already owns its launch flow can set
`ForegroundLaunch(native, required_artifact_retention=True)` and pass that
callback to the existing `native.start`. The constructor rejects unsupported
retention before start; the callback verifies the persisted choice. Keep that
caller's existing acknowledgement and `finally: launch.handoff()` behavior.

### Receive a complete runtime without replacing an active worker

Use the existing `runtime_source.py` package/inspect/receive APIs to retain the
complete current Python import closure, including lazy imports, rather than
copying only `swarm_cloud_job.py`. Receive it into a new private directory.
Keep an existing running supervisor on its original source and record.

For a completed operation whose original output bytes remain present, load the
complete selected runtime and use its original
`finalize(root, retain_artifacts=True)`. Do not replay the command. If a
private project has already disappeared and no retained copy exists, its
path/hash inventory does not recover those bytes; preserve the original
outcome and any independently delivered artifacts.

For an undispatched capacity queue, inspect and prepare its existing
`native_runtime_handoff` transition against the complete selected runtime,
then resume through its original foreground owner. Preserve the same native
record, ledgers, operation ID and selected source identity. Do not edit live
worker source in place.


## Foreground command completion and shell status

The maintained foreground entry returns the original command's result after its synchronous supervisor completes. Supervisor or finalizer failures retain their nonzero exit. After supervisor success, the original saved result is mapped by `swarm_cloud_job.exit_status`: successful commands return zero, failed commands return their command code, and a signal result uses the existing `128 - exit_code` mapping. An absent retained result or pending finalization returns 75 so the original continuation remains visible.

The exec handoff re-enters this same `native_foreground.py` at its internal `_supervise` entry and passes the inherited original supervisor lock descriptor. This keeps the dedicated foreground process, lock lifetime, original resource reservations and original finalizer. The public `resume-memory` and `resume-capacity` commands also return the existing terminal command result when reopening a completed operation. Read the original result and repair the recorded failure or pending finalization; do not replay a completed customer command because its supervising shell used to report success.

Receive the complete source edition with the original `runtime_source` API. Its current public source and receiving instructions are in `receiving/native-runtime-retained-20261013/README.md` in `woahwhattheheck/public-commons-sprint-2026`. The exact selected source directory remains separate from already active supervisors.

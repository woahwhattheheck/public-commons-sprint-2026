# Native job process ownership and retirement

This companion carries the merchant's published native-process owner through explicit cancellation and abrupt merchant termination. It runs in the original file-job operation, beside the source-bound SCVO, completed ZIP and customer receiving phases.

## Invoke from the original receiving driver

```js
import { runLifecycle } from './process-lifecycle.mjs';

const lifecycle = await runLifecycle({
  sourceRoot,
  outputDirectory: absolutePrivateOutput,
  pythonExecutable,
  sourceCommit, // optional immutable caller pin; exact module bytes are always retained
}, {
  onProgress: event => process.stdout.write(JSON.stringify(event) + '\n'),
});
```

The receiving parent must exist. Select a new private output subdirectory in the same retained operation. Keep previous outcomes when continuing a repaired source edition. The companion launches no scheduler or cloud controller; the enclosing native owner supplies its admission and retains this output directory.

Requirements are Linux, the caller's Node executable and Python 3 with the standard library. The actual product source is imported from the selected complete source root:

- `jobs/processes-host.mjs` creates the original private job directory, starts its persistent supervisor and runs native commands.
- `jobs/process-supervisor.mjs` owns the detached process group and retires its native descendants and directory.

Both exact source byte identities are written into the operation selection and outcome.

## Complete operating cases

| Case | Actual operation | Required receiving state |
| --- | --- | --- |
| `host-close` | The merchant owner starts a real child and grandchild in the original detached process group. Both retain SIGTERM handlers so cancellation reaches the original owner's escalation path. The caller invokes `host.close()`. | The pending native call reports `JOB_NATIVE_PROCESS_INTERRUPTED`; the owner exits successfully; the supervisor, child, grandchild, process group and private directory are gone. |
| `merchant-kill-active` | The same kind of active native tree is retained under a fresh original host. The observer kills that exact merchant PID with SIGKILL. | The persistent supervisor receives the original IPC disconnect and retires the owned process group and private directory. |
| `merchant-kill-idle` | A real native child starts its grandchild and exits successfully. The original supervisor retires the descendant group and returns the completed native result while keeping custody of the private directory. The observer then kills the merchant owner. | The completed result is retained, the idle supervisor still owns the existing directory, and merchant death retires that supervisor and directory. |

The observer records Linux process start ticks, parent/group/session identity and the selected private directory. It enables Linux child adoption so exited descendants are reaped and the kernel process group can be checked directly. The original published supervisor performs native termination and directory retirement. An incomplete case is saved before any emergency cleanup of this companion's own fixture.

## Returned customer operation

`native-outcome.json` has schema `stellar-forge.ndjson-process-lifecycle.v1`, state `COMPLETE` and three completed cases. Each case retains its original owner/supervisor/child/grandchild identities, exact source selection and the observed final process-group/directory state.

The same output directory contains each owner's full event stream, stdout/stderr, readiness record, exited-descendant receiving and final case outcome. A failed case retains the first actual failure and the state observed before emergency cleanup, then ends the companion so the original owner can repair that source.

The original SCVO file-job and customer receiving driver can include the returned object directly in its complete native outcome. Keep this directory with the original source inputs, execution result and received ZIP.

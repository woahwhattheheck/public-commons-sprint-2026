# Native runs through the original local operator

This receiving continuation executes existing prepared runs through the application's ordinary HTTP task queue. It closes only its own operator process while the first native child is alive, reopens the same operator-state and scientific Workspace, and resumes the same original task. The receiving record retains the actual execution and worker identities on both sides of that close.

Use the accepted native interpreter and already-admitted case. The client does not create a grid, profile, scenario or model implementation. Existing native worker custody, scientific identity, result reuse, failure handling and team access remain in the maintained operator.

## Existing simulated headwaters course

The single sprint demonstration uses explicit **SIMULATED DEMONSTRATION INPUTS** and the original input recipe. Its deadline is **2026-10-13 14:00:00 UTC / 10:00 EDT**. The current native owner controls execution. Keep the application, scientific Workspace, ordinary demo output and operator-receiving output as separate sibling directories.

1. Run the current original generator with its normal arguments and --prepare-only. Its demo-receiving.json records the original baseline and alternative run IDs after actual source import, profile/scenario/grid preparation and footprint checks.
2. Run this continuation once with those retained IDs. It uses the accepted interpreter to launch the existing operator/server.py.
3. Continue the same generator without --prepare-only. Its original Workspace.run calls verify and reuse the completed results before comparison, mapped delivery, reports, archive and independent reopen. Current matched-control, parameter-course and field/laboratory additions stay with that same maintained driver.

Substitute the actual accepted paths:

~~~sh
ACTUAL_PYTHON -B ACTUAL_APPLICATION/source_tools/receive_operator_native.py \
  --application ACTUAL_APPLICATION \
  --python ACTUAL_PYTHON \
  --workspace ACTUAL_WORKSPACE \
  --prepared-receipt ACTUAL_DEMO_OUTPUT/demo-receiving.json \
  --output ACTUAL_OPERATOR_RECEIVING \
  --deadline 2026-10-13T14:00:00Z
~~~

The placeholder names must resolve to real paths. --python should be the absolute native interpreter, preserving its original environment prefix. Optional --operator-state selects an existing state directory owned by this course; otherwise it is ACTUAL_OPERATOR_RECEIVING/operator-state. It stays outside the application and scientific Workspace. The original operator's exclusive state lock prevents a second owner.

For other original prepared cases, supply one or more --run-id ACTUAL_RUN_ID flags instead of a demo receipt. Run order is preserved and repeated IDs are removed once. If both forms are supplied, the original baseline and alternatives precede explicitly appended IDs.

## Actual execution and recovery

The receiving directory has its own exclusive lock and a saved selection identity consisting of application path, interpreter path, Workspace, operator-state and ordered run IDs. Rerun the same command to continue that selection.

Before submission, the client saves a deterministic original operation ID for each run. The operator owns actual request deduplication. If a submit response is lost, repeating that request returns the same retained task; if an identical active task already exists, its actual task/operation IDs are recorded. Once known, the client reads that exact task and checks its original workspace, action and payload before resuming it.

Only the first selected run is eligible for the normal-close exercise. The client records its live native snapshot before closing the operator with SIGTERM. It never sends that close signal to the native child or its process group. After the current server drains, it starts again with the exact same state and Workspace, checks the original execution ID and complete recorded worker identity, then resumes the same original task through /api/task/resume.

If the child completes during that interval, the same execution and completed native result are retained. If the first run finishes before any live-child observation, the receipt states completed_before_live_close; the result is reused and no replacement case is created. If a child fails while the server reopens, its retained native failure is returned before another attempt.

The closing, closed and reopened phases are saved before subsequent actions. A client interruption in one of those phases continues the same retained close/reconnect sequence. An existing live operator is reused only when its recorded PID, Linux start ticks, boot ID and command digest match. The original private startup record supplies the current local capability. A mismatched, incomplete or still-draining operator remains available for its owner to inspect.

Interrupted tasks resume through the normal API. Failed or cancelled tasks stop with their actual error. After investigating and correcting that failure, an explicit --resume-failed resumes the same retained task once at entry; the client never loops through failed attempts. No timer or automation starts a later attempt.

An ordinary interruption of this client closes its owned operator normally, allowing a live native child to remain attached to its durable original task for a later explicit continuation. At the selected deadline, the client requests Stop through the original task API, then keeps the original operator alive until that same task is terminal and its native worker is dead. The maintained supervisor owns SIGINT/TERM/KILL escalation. A reopened interrupted task with a live, stop-marked child resumes only to attach that same monitor. The default stop observation interval is 90 seconds; --stop-timeout accepts at least 35 seconds. A still-stopping worker or refused stop leaves that original operator running for inspection instead of detaching its monitor. A completed stop saves the checkpoint and exits with status 75. Failure to write the cutoff receipt never prevents the original Stop request. No new signal path or untracked process kill is introduced.

## Retained outputs

operator-native-receiving.json is the public local receipt. It includes:

- exact application/interpreter/Workspace/operator-state paths and ordered run IDs;
- actual project/workspace identity and each original operation/task ID;
- original attempts, requested actor, native execution and worker identity;
- normal-close, reopen and same-task resume times and before/after native snapshots;
- completed original run results or the concrete task/native error;
- cutoff and stop-request state when applicable.

private/operator.json and per-start private/operator-*.log retain local server startup and error output. These files use restrictive modes and contain local access capability data. They stay outside the scientific Workspace and application so ordinary whole-project exports do not include them. Share the public receipt and normal scientific export; keep private logs with the native operator owner.

The client prints a compact result with receipt path, selected runs, project ID and observed normal-close disposition. It never prints the local startup capability. Failed receiving returns status 1. Completed runs return status 0.

## Native receiving scope

This contribution uses Python standard-library process and HTTP operations. Its model prerequisites are the same dependencies required by the selected application and run profiles. It inherits the accepted native environment and defaults GDAL cache/thread settings to 16 MiB and one thread only when those environment settings were not already selected.

Current original APIs are POST/api/actions, GET/api/task, GET/api/native-job, POST/api/task/resume and the existing Stop route. Source inspection checked the complete current server, named-team authentication, worker snapshot and generator preparation boundary. Final AST and actual task/close/reconnect receiving belong to the accepted native host, followed by the same existing report/export/reopen course.

The owned component fragment retains this complete client and guide and depends on the maintained original operator/native run desk.

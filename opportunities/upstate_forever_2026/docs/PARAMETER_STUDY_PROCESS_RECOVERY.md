# Continue an interrupted native parameter study

Open the saved **Parameter studies** item. **Run all cases** or **Resume remaining cases** uses the existing native calculation supervisor, with one fresh worker for each unfinished native run. Open that task's **Open calculation console** to read the original process log, resources and current native stage, request a stop, or reconnect after reopening the operator.

Completed native cases keep their original run IDs and verified outputs. Native stages already finished inside an incomplete run remain available to the original stage-reuse path. Changing execution isolation does not change a scientific selection, model parameter, grid, source body, comparison support or model version.

## A worker stopped unexpectedly

A directly observed negative child exit code is retained with its exact signal number/name. A reconnected worker that has disappeared without a completed result is retained as an interruption with an unavailable exit code. The coordinator stops this attempt before starting another case; it does not cascade through the remaining study or programme.

The saved study shows the original failure and recovery text. Its technical interruption details retain the request digest, native run, process ID, original process directory and available resource observations. A completed run remains complete even if its child receives a signal while exiting.

When both snapshots identify the same visible cgroup, the record contains measured differences in `memory.events` and `memory.events.local`. A rising `oom_kill` or `oom_group_kill` counter establishes an OOM-kill event in that shared group during the attempt. The counter does not identify which process was killed. A signal exit alone is not classified as an OOM kill.

Use the existing host's process and memory observations to reconcile capacity or the original external stop. Then choose **Resume remaining cases** on that saved study. No manual status editing or new scientific selection is required. **Refresh completed results** remains available for the retained completed cases.

## Reopen while the old worker is still running

The worker retains the original native batch lease after its operator process closes. Reopening the saved study reconnects that worker before acquiring the lease for the coordinator. The same request and original case binding are checked in both supervisor and worker. A different native batch cannot take that lease while the existing case continues.

Stop requests and operator shutdown pass through the maintained supervisor. A requested stop reaches that calculation's original process group. Closing the operator lets the native worker continue; reopening its task reconnects it. The original study coordinator retains its partial progress at that boundary.

## Existing Gura course

Continue the original GURA-NATIVE-01 Workspace and source edition. The maintained `source_tools/receive_gura_studies.py --isolate-native-cases` entrypoint keeps its existing suite and child lock inheritance. An observed child signal now leaves the suite partial, with exact process and interruption receipts under `gura-receiving/native-case-processes/<run-id>/<attempt>/`.

The suite's saved `state.json` contains `continue_argv`: the actual interpreter, application, Workspace, original input directory, baseline run, scopes, design, resolved evaluation-run IDs and original output options. Run that argument array through the equipped owner's existing operation after reconciling capacity. It resolves the earlier planning selection to its original evaluation IDs, so later edits to planning state cannot silently choose another suite.

A retained complete original baseline, completed NDR cases, SDR stages and existing reports all remain in place. Interruption handling performs no additional native calculation or source transformation. Existing study, programme and supervisor records remain part of the original portable Workspace.

## Source and installation

Receive the complete current application containing `model/native_execution.py`, `model/parameter_studies.py`, `model/native_worker.py`, `operator/native_jobs.py`, `operator/parameter_study_jobs.py`, the parameter-study API and original worker console. The new adapter uses only the existing standard-library/native application dependencies.

For the existing equipped course, first compile the changed Python modules in memory from their actual files. Reopen an already completed saved study and confirm its original case/run selections and current report. Continue the existing unfinished course through the same task or saved CLI argument array, retaining its actual command, process receipt and first result. The completed-course and original case identity are the receiving basis.

**For Tim:** Reopen the saved study, read the interruption if present, and choose Resume remaining cases after the current host is ready; completed native results stay available.

# Resume a saved native ensemble

ECO-ENSEMBLE-RECOVERY-WO39-20261013 extends the existing Ensemble operation, NativeJobs supervisor and calculation console. Use the same scientific Workspace, original ensemble design, model inputs, run records and reports.

## Normal scientist workflow

Open **Ensembles**, select the saved design and choose **Run saved design** or **Continue saved design**. Open its operation and **Open calculation console**. The console identifies the ensemble, original member labels and current original run number; it shows the actual worker, retained native stages, model output and existing scientific result links.

**Stop saved ensemble** stops the selected owned calculation and ends this ensemble attempt before another native case starts. Completed stages and cases remain in the original Workspace. Use **Resume original selection** on the same task to continue. When the operator closes, its active native worker continues independently; reopening and resuming reconnects that same execution. A completed worker result is received before the next case begins.

The run number identifies position in the saved design, not an estimated percentage or remaining time. Existing ensemble results continue to show complete, failed, prepared and running cases. Native fresh/reused stage accounting stays in the original run execution record; no new scientific output or timing claim is inferred.

## Preserved scientific and operational identity

The original ensemble plan is immutable. Each worker request contains the complete plan digest, ensemble identity, original run identity and every member binding that shares that run. The worker recomputes its complete grid/profile/scenario/model selection before execution. Changed plan, member or native selections reject.

A completed original run uses Workspace.run's existing verification/reuse path. It is not launched as another worker. An original still-running child is reconnected before the coordinator acquires the existing native-model batch lease; the child inherits that lease so an operator exit cannot release it prematurely. This uses the same mechanism already used by parameter studies. It creates no queue, scheduling service, solver, dataset or duplicate child task.

Ordinary per-case native failures retain the selected continue-on-error behavior. Stop, operator detach, process resource/signal interruptions and native identity/result failures stop this attempt rather than launching the remaining cohort. The original ensemble writer retains its interrupted/error record. Full native failures and source logs stay in the run's existing supervision directory.

Older complete and unsupervised ensemble results remain usable. A historical inline calculation must finish at its current owner boundary before installing this source; it has no detached-worker identity that can be retroactively invented. Keep active old workers and their source intact. New supervised worker requests capture the relevant full application source hashes.

## Complete source integration

The source consists of:

- model/ensemble_native.py: original plan and native-case binding;
- operator/ensemble_jobs.py: original ensemble coordinator through the existing supervisor and batch lease;
- operator/native_jobs.py: ensemble dispatch, request context, Stop and snapshot;
- model/native_worker.py: independent original ensemble binding validation;
- operator/ensemble_service.py: existing ensemble.run action enters that same coordinator;
- operator/web/jobs.mjs: the original calculation console supports ensemble progress and Stop;
- operator/receive_ensemble_recovery.py: the original operator/native recovery course;
- this guide.

Keep all concurrent scientific/source/operator contributions. The existing portable application includes model and operator directories; all new leaves travel through that original distribution. No new action, endpoint, permission or registry is added. Existing authenticated task, cancellation/resume and native-log routes remain unchanged.

## Original receiving operation

The accepting current native owner selects an actual saved ensemble and its existing authorized Workspace. Use its installed compatible GIS/InVEST Python, complete current application and original operator-state directory. Close that owned operator at the existing source-adoption boundary before running this course; its original state lock prevents two controllers from owning it.

```sh
<original-native-python> -B <current-application>/operator/receive_ensemble_recovery.py \
  --workspace <original-workspace> \
  --operator-state <original-operator-state> \
  --ensemble-id <original-ensemble-id> \
  --operation-id <original-stable-operation-id> \
  --output <owned-receiving-directory>
```

This receives the entire selected ensemble, all original run results and the existing report. At the first actually live owned worker it saves that exact execution, closes the operator, opens the same operator state, resumes the same task, and reconciles the original worker result. If all cases were already complete or finished before an observable live worker, it says so explicitly; that is result receiving, not observed restart recovery. Do not invalidate accepted results merely to force a restart demonstration. Use an already requested genuinely new scientific case if actual restart operation is required.

The course retains its exact selection, original plan, completed pre-existing runs, original worker execution/result/reconnection, full final task/run records and report task in ensemble-recovery.json. Reinvoke the SAME command/output directory after interruption. It reuses the same operation IDs and current original requests. A failed native or report operation keeps its original outcome and resumes through the same task. The course has no fabricated native result or substitute model.

After the native course, restart the original operator with its normal supported recipient launcher. As the producing owner, operate the completed Ensemble and calculation console at the actual desktop/screenshare and narrow widths. LOOK at the real screen or screenshots. Open all final report pages and downloaded data/maps, inspect original physical units and source support, save/export the original Workspace/Study through its maintained complete transfer and independently reopen it. Preserve the scientific workflow and all original attachments. Fix actual clipping, unreadable labels, broken controls or source discrepancies directly.

Code/source review, a completed CLI, a receipt or an unviewed screenshot is not rendered acceptance. This course is a focused part of the existing native application operation, not a separate verification product or new browser/controller. Keep Tim's files and interpretation under his control and retain TJLabs and original scientific-source attribution.

## Owner direction

Read CURRENT_OWNER_DIRECTION.md, the current full post-call build bank F0C8R2SQ0NP and both project AGENTS files. Bryce's expanded instruction is that Tim can run his own actual data through this system. Preserve its original layout, scientific meaning, units and history; perform the true input-to-result workflow. No arbitrary simulation or feature cap and no expired14:00 stop apply. Current relationship messages and contracts remain with Bryce as directed; ordinary authorized account creation and standard ToS remain available. No new paid service, private repository or Actions work is introduced.

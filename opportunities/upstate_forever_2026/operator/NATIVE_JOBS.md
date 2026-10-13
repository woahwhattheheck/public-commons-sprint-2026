# Native calculation console and process recovery

Operation ES-SUPERVISION-20261012 adds a native calculation console to the maintained Upper Savannah operator. Start the same saved run through the existing Run original models action. The existing Workspace remains the source of the selected grid, parameter profile, land-cover scenario, original InVEST execution, retained stages and physical outputs.

## Open and explain the product

Open the current operator startup URL, choose the study, then choose Native model runs. Open the prepared run and select Run original models. The task detail now includes Open calculation console. Existing runs with an associated task also have this button in their native-result detail.

The console shows the actual native stages, retained files, elapsed worker time, memory, free workspace storage, the last worker heartbeat and the original engine output. Choose Native model log or Worker process output to inspect either complete source stream a page at a time. Read from start resets that stream. Follow new output keeps the latest returned text visible.

| What Bryce does | What appears | What it means | A sentence for the walkthrough |
| --- | --- | --- | --- |
| Open a prepared native run | The retained grid, profile and scenario identifiers | These exact saved inputs define the calculation | “This run uses the study and parameter choices we selected.” |
| Start the run and open its console | Actual worker updates, native stages and the model log | The original engine is executing in an isolated Linux process | “We can follow the calculation as it runs and inspect its output.” |
| Inspect a completed stage | The stage's original completion time and retained file count | That native stage has been saved for reuse | “Completed work stays with the project, so we can continue from it.” |
| Stop calculation | Stop request followed by the worker's real terminal state | Only this calculation's owned process group receives the stop | “We can stop this run while keeping its completed stages.” |
| Resume retained run | The same original run selection and a new operator attempt | The native engine verifies and reuses its saved stages | “We are continuing the same case with the work already saved.” |
| Reopen an interrupted operator and reconnect | The existing worker identity and continuing log | A still-running worker is reattached without launching another calculation | “We can restart the operator while keeping this calculation running.” |
| Inspect native result | The existing output view and its physical nutrient/sediment files | The result remains part of the original scientific workspace | “These outputs are the model's saved results for this case.” |
| Download operation record | A JSON record of the current selected inputs, task, worker and stages | The exact operational context is portable | “The project retains how this result was produced.” |

The console reports stages directly from the native run record. It does not display a fabricated percentage or estimated completion time. Land-cover edits are optional; the saved scenario determines whether that stage exists.

## Implementation and integration

Additive source:

- model/native_worker.py executes Workspace.run in its own Linux session.
- operator/native_jobs.py manages launch, live status, retained execution records, stop requests and reconnection.
- operator/web/jobs.mjs and jobs.css supply the existing operator's calculation console.
- install_native_supervision.py composes the required server and browser registrations against current source.

The installer preserves full shared-file preimages and a source installation record under .native-supervision-preimages. It also copies its own complete installer to the application root and appends install_native_supervision.py and install_extensions.py to the current portable application's declared file inventory, retaining every existing entry. The console's runtime source, CSS and guide already travel through the original model/operator directory inventory. An absent optional root installer remains skipped by the original exporter. It preserves every unmodified current contribution. Its anchor checks identify the exact source boundary if a colleague has changed the same registration. Apply the source to a receiving copy or between existing inline native runs, then open that installed operator version. The first upgrade should occur before the operator begins the next native calculation. Revision 2 recognizes exact first-revision member hashes, retains their full preimages, and updates the graceful-detach registration in place; unrelated current source edits are preserved.

From the complete increment directory:

    python3 -B install_native_supervision.py --application /absolute/current/upstate_forever_2026

Start the existing operator with its original selected workspace and operator-state directory:

    python3 -B /absolute/current/upstate_forever_2026/operator/server.py \
      --workspace /absolute/original/workspace \
      --operator-state /absolute/original/operator-state

Use the startup URL returned by that process. It carries the current local operator capability.

Existing API calls remain:

    POST /api/actions
    {"workspace":"<existing workspace key>","action":"run.start",
     "payload":{"run_id":"<existing native run ID>"},
     "operation_id":"<original operation ID>"}

    GET /api/task?id=<task ID>
    POST /api/task/cancel {"id":"<task ID>"}
    POST /api/task/resume {"id":"<task ID>"}

The task view adds _native_job. The console reads:

    GET /api/native-job?workspace=<workspace key>&id=<task ID>&stream=native&offset=0

The response contains task, native_job and a log page. stream is native or process. Use log.next_offset for the next page. Byte offsets refer to the original file, and log.reset identifies a source stream that shortened. The normal operator authorization and exact workspace check apply.

NativeJobs.execute(task, workspace) returns the original completed Workspace run record for the original run.start task. Programme execution retains its existing owner, task boundary and native helper. Do not enqueue a child task and wait inside the original operator's single-worker pool: programme integration must call its owned execution helper directly. The original scientific engine and its native stages remain the computation implementation.

## Retained result composition

When ECO-RUN12 retained execution is installed, keep its input/result retention around the supervised worker. Run this installer with --retention to select that composition, including on an operator that already has native supervision. It also recognizes the exact existing ecsa_runs.upstate.invoke_original_run handler installed by ECO-RUN12 and composes it into NativeJobs.execute_retained. An already joined source keeps that same dispatch on subsequent installation.

Keep the complete original ecsa_runs package in the current application. The installer appends ecsa_runs to the original portable APPLICATION_DIRECTORIES inventory and retains both root installers in APPLICATION_FILES; existing names stay in place. The normal exporter skips optional absent paths. This preserves the current root retention package with the shipped application, including directory-aware native tree restoration. A previously packaged operator/ecsa_runs remains included by the operator tree. The current source receiver can use:

    /opt/pyvenv/bin/python -B install_native_supervision.py --application /absolute/current/upstate_forever_2026 --retention

The retained wrapper receives a view that delegates every workspace attribute and method to the actual Workspace, except run. That single method verifies the original requested run ID and invokes NativeJobs.execute with the actual Workspace. Its return is the unmodified original native result. Source freezing, same-task lost-success recovery, native-tree retention and export remain in the original ecsa_runs package.

The original wrapper does not catch NativeJobDetached. During an operator restart it passes through to the existing operator task handler, which records interrupted. Input blobs already frozen by the wrapper remain reusable; it writes a completed retention entry after the native result returns. Resume enters the same original task: it either restores that task's completed retained result or reconnects the same worker through the delegated run method.

This composition was read against both ECSA_Retained_Native_Execution_2026-10-12.zip and the complete current 23-file F0C8Q6C81U2 native/operator source. Their callable is invoke_original_run(operator, task, workspace, run_id). The current module also accepts source_runs in the original task payload and seeds the explicitly selected completed NDR and SDR stages before calling Workspace.run. On a resume with a live owned worker, execute_retained reconnects that worker first, before the outer wrapper attempts its assembly run lock. Once it returns the complete original result, the wrapper reuses that result and retains the unchanged original task payload. The initial selected-stage assembly still uses the owner's exact seed_completed_models implementation. New worker requests retain the full original payload in addition to the full native selection; earlier matching retained requests remain readable. The current retention owner continues to maintain its module. The installer recognizes exact earlier revisions of this supervisor during source upgrade.

## Saved process state and recovery

Each execution lives under the original run's supervision/<execution_id> directory. It retains the request and selected source hashes, launch and worker records, heartbeat, original process output, any stop request and signal records, result or failure, and final supervision state. The native.log file remains the original run-level model log.

The worker is launched with a new Linux session and writes its state independently of the operator. Linux PID, kernel boot ID, process start ticks, process group and command digest distinguish the actual owned worker from a recycled process identifier. Reconnection checks that identity before attaching. Every stop signal checks the same identity and uses a shared signal record to avoid duplicate requests from the detached worker and an attached supervisor.

During normal SIGTERM or SIGINT shutdown, the original operator sets its closing flag. The monitor records a detached supervision state, leaves the owned worker alive, and completes its operator task and attempt as interrupted. This releases the original operator's thread-pool shutdown without waiting for the calculation. After an abrupt operator exit, startup also marks the in-flight task interrupted. Open its calculation console. If the worker remains alive, Resume reconnects the same execution. If a result completed while the operator was closed, Resume imports that original completed result. If the worker ended, the same run can continue through its native stage verification and reuse.

Stopping begins with an interrupt, then escalates for that owned group after the retained grace period. The selected run keeps completed native stages and their original artifacts. A worker that ends unexpectedly leaves its process log and retained source selection; the supervisor reconciles a stale running record only after it can acquire the original native run lock.

### Memory and native-cache observations

The existing execution record, worker record and heartbeat include a `resources` snapshot from the actual calculating process. Native failures retain `resources_at_failure`, and original-reference start events include the same snapshot. These fields record process resident/high-water memory, the resolved cgroup v2 memory usage and limits, memory events, selected memory-stat counters, and the explicit GDAL/BLAS thread and cache settings inherited by that process. If GDAL is already loaded, the snapshot reads its cache usage and usable-memory value; it reads the cache maximum only once actual cached blocks show that GDAL has initialized the cache.

The Native calculation console shows the latest saved worker observation alongside its current process memory. After the worker exits, the same console keeps the last observed resident/peak memory, shared group usage and limit, cache values, inherited settings, and observation timestamp. Group event totals are labeled as lifetime counters. The API selects observations only from the matching execution ID and complete process identity, with the worker-start record as a fallback; older workers continue to show their existing live-process metrics. The original operation-record download includes the same retained observation.

Compare the latest heartbeat with the execution's recorded timestamp when recovering an interrupted calculation. Cgroup event counts cover the selected group and its descendants; `memory.events.local` retains the local counters. The `shmem` value is included in `file`, so do not add those two memory figures. A missing optional kernel field remains absent, and read failures are recorded without aborting the model.

These observations stay outside native runtime fingerprints and scientific stage signatures. They preserve reuse of the same completed stages while making inherited cache limits and shared memory pressure visible. See the [Linux cgroup v2 memory interface](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html) and [GDAL cache API](https://gdal.org/en/stable/api/raster_c_api.html).

## Native receiving

Receive this increment into the current cumulative source and retain the same actual input Workspace. Complete the ordinary prepared-run → console → native result journey on the selected existing case. On an appropriate new calculation for that same prepared data, use the console's stop/resume operation and reconnect the same worker after reopening the operator. Retain the actual task ID, native run ID, execution IDs, worker records, native stage identities and visible screenshots with the original product handoff.

The source has been composed against the complete 72-file application carrier 7c4223, the 18-file operator/map/customer overlay F0C8GLD74CT, and the current 23-file native/operator carrier F0C8Q6C81U2. The current browser includes programmes, experiments and the shared extension host; its existing control order is preserved. Static asset registration changes only the original Python set literal and retains its union with the shared extension registry. The console reads the actual selection.models field, with the source's default NDR+SDR selection, and displays unselected models accordingly. It retains the complete selection and does not infer a running model from absent stage records. Use the installer for the narrow registration while preserving the cumulative application.

## Revision 6: original saved programmes and paired completions

Revision 6 adds operator/programme_jobs.py and composes the current operator/programmes.py at its two original calls: create_pair_completion and manager.resume. The complete current reference is main commit 3f34a239b84ca20b252d20d8756dfd04772a2d2b, retained in Slack F0C9K9Y5M40 (native journal and programme) and F0C89JHPMQX (operator host). The installer also accepts the older programme adapter that has only the resume call. It patches the currently present adapter and preserves its full preimage.

Start or resume a saved programme through the existing programme desk. Its original task now has Open calculation console. The console follows the original current case and resets its log cursor when the coordinator advances to another native run. Selected input identities include the programme ID, native run ID and digest of the original named bindings. Stop calculation and pause programme persists the existing programme pause before signalling the selected worker. The original programme desk remains the place to inspect all named cases, comparisons, matched pairs, reports and deliveries.

The maintained ComputeProgrammes coordinator still owns the baseline-first order, requested case selection, native source checks, completed-stage assembly, comparisons, report and experiment synchronization. A delegating Workspace view changes only the native process boundary. It preserves the genuine original operator task, operation ID, action and payload; each worker additionally retains the original programme binding. The native scientific runner, native_execution journal and Workspace source remain unchanged.

### Normal close, resume and changed case selection

During a native calculation, normal operator close detaches its monitor and leaves the same owned worker running. A deliberate detached or stopped outcome travels through the coordinator's existing KeyboardInterrupt interruption boundary, which saves the interrupted case and releases its execution locks. The operator receives the original NativeJobDetached or NativeJobCancelled and retains the corresponding interrupted or cancelled task state. Real native failures remain ordinary exceptions and use the original coordinator's failed-case behavior.

At native run, assembly and comparison entry, the proxy checks normal close and pending Stop before starting another case. A Stop that arrives before manager.resume clears its pause is reasserted at this actual execution boundary. Completed-case reuse therefore cannot launch another case after a close request. Comparisons already executing in the operator complete through their original method.

Before the coordinator resumes a requested case subset, the adapter reconnects any worker already owned by that same programme. This preflight only follows existing live workers: it cannot launch an omitted case. That worker's ordinary failure remains in its original journal and the selected cohort then follows the maintained coordinator's disposition. After an ordinary restart the original browser resumes the original task. An explicit new task for the same unchanged programme may also reconnect the same retained worker; its original task identity stays in the worker request and the observing task is recorded in reconnected.json.

For completed-stage assembly, the existing combine_runs call takes .run.lock before Workspace.run. The proxy reconnects the selected live worker before that assembly call, so a normal restart does not contend with its own running child. All selected donor run IDs, full native selection and original assembly checks remain in place.

### Paired completion identity

The original paired-completion action can create its saved child and run it in the same task. The adapter pins the actual expected or computed preview before calling the original create_pair_completion method. It stores this task-specific preview at compute-programmes/PARENT/supervision/TASK.preview.json. A restart therefore reuses the original coordinator's retained request and child even when newly completed model work changes the current preview.

Once the original child is selected, compute-programmes/PARENT/supervision/TASK.json retains its relationship to the genuine parent payload. Native worker requests bind that child; the task's original parent payload remains unchanged. This also covers the valid API path that omits expected_preview_id. The existing programme error handling, complete-result experiment synchronization and reporting tail remain in the original operator adapter.

### Receiving the current complete source

The increment contains ten full files, including `model/native_execution.py`, the saved-study supervisor adapter and the parameter-study API. Use the complete current application as the receiving base, then run the existing installer with the receiving native interpreter:

    ACTUAL_PYTHON -B install_native_supervision.py --application ACTUAL_APPLICATION --retention

Use the actual equipped host's original Workspace and saved programme. The installer parses each Python member and the resulting current shared Python sources before writing, preserves current preimages, checks for concurrent source changes, upgrades exact r1-r5 members and retains the root installer in the portable application inventory. The portable AST union also preserves the maintained owner's newer point-source and lake source manifests.

The focused product receive is the real existing programme: open its console, close the operator during a native calculation, reopen with the same operator directory and Workspace, and resume its original task. The native worker's execution ID, PID/start ticks and original run ID must remain the same while it is alive. Continue through the original programme result, report and download. The existing native journal remains available through model.cli run-status. If Stop is exercised, retain the actual programme pause and completed model stages, then resume that same task.

This source was composed against the complete pinned originals. The JavaScript console module parses in the available JavaScript runtime, and both current adapter call sites match exactly. Python installation and native lifecycle behavior are validated by the actual receiving interpreter and retained scientific Workspace.


## Maintained application integration

The complete reviewed revision 6 is composed with the maintained application from
ce3eaaecbeb6cfac2e95fe5bf3033f8afc1f18a2. The installer traverses the existing
nested static asset unions and adds only the original console assets; registered
desks, delivery inspection and rehearsal retain their current registrations.
The supervisor import follows the operator module path setup, including when the
server is loaded by another original receiving entrypoint. Current programme
recovery, scientific source lineage and the original native execution journal
remain with their existing implementations.

Process-log requests carry the selected execution ID as well as the run ID.
After Stop and Resume creates a new worker for the same retained run, the console
starts that new process.log at byte zero and clears the previously displayed
process output. The native-model log remains the original run-level stream.
Existing revision 6 source is an accepted exact upgrade predecessor.

Repeated installation recognizes the original console asset registration regardless
of its Python quote style and preserves the same current host registration.


## Completed output followed by an interrupted worker

A native worker can save its complete result and then receive a signal while exiting. The calculation supervisor verifies and keeps that original completed result, retains the directly observed signal in `supervision/<execution_id>/completed-interruption.json`, and stops the current study or programme attempt before another case starts. A matching explicit Stop request retains the normal cancelled-task disposition.

After reconciling the original host or stop request, resume the same saved study or programme. Reconnection verifies that result and advances without rerunning its native calculation. The interruption receipt remains in the original request directory even after successful reuse. A worker whose exit status is unavailable after reconnection does not acquire an inferred signal.

### Saved-study dependency during installation

The complete supervision increment includes `operator/parameter_study_jobs.py` and `operator/parameter_study_api.py`. The installed `model/parameter_studies.py` remains the scientific authority: the installer checks its maintained `native_case_context(workspace, key, run_id)` and `record_interruption(workspace, key, error)` interfaces before creating backups or writing application files. A receiving copy with an older study engine first needs the complete current application source.

The installer records that unchanged engine's exact byte length and hash under `retained_dependencies`, keeps its preimage, and checks that it has not changed before publishing the increment. Current source guards cover the exact maintained pre-supervision and supervised editions. Parameter selections, case IDs, numerical kernels and retained exports stay with that installed engine.


## Receive the complete Parameter result and case console

The native-supervision installer now receives the saved-study browser, original-attempt console, streamed result-query index and their shared catalogue readers together with the current native task adapter. This keeps a copied `ParameterStudyAPI` from importing a missing reader on its first execution or Results request.

Use the same current cumulative source directory as the increment:

```sh
python -B install_native_supervision.py --application /absolute/current/application --increment /absolute/current/source
```

The incoming source includes `model/parameter_case_status.py`, `model/parameter_result_query.py`, `model/record_catalog.py`, `model/delivery_catalogue.py`, the original Parameter studies browser and shared case-console module, and their operating guides. Existing scientific Parameter studies, native-model selections, source bindings and calibration remain the installed originals. Before any application write, the installer checks the exact scientific entry points used by the incoming adapter and both readers, records the retained dependency identities and parses every incoming Python member.

The maintained server read expression is extended by an AST source join. Original query expressions and unknown peer fields remain intact; missing case-history, result-range and expected-artifact fields are added. The current static asset expression is preserved while the required Parameter browser/console assets are registered. A current host is unchanged when it already supplies those fields and assets. The existing source-predecessor checks, preimage backup and concurrent-source rechecks continue to apply.

After receiving, open an existing saved Parameter study. Inspect the original case attempt and its retained log, then open Results, move between original result pages and range pages, and reopen the same saved study. The result reader uses the retained results artifact and returns its identity; it does not execute a native model. Use the same study's existing Run/Resume action when native continuation is required. See [the case console](../docs/PARAMETER_CASE_CONSOLE.md), [result queries](../docs/PARAMETER_RESULT_QUERIES.md) and [process recovery](../docs/PARAMETER_STUDY_PROCESS_RECOVERY.md) for the actual controls and retained-state behavior.

### Inspect the populated receiving application

Use the exact received source edition and a populated saved study with retained native results. At the intended desktop or screenshare width and a narrow width, open and visually inspect the actual screens or captured screenshots. Check readable labels and columns, spacing, overflow, clipped controls, log presentation, loading, empty and error states. Keep the plain industrial design and the original scientific work.

Operate the original case and attempt selectors, log controls, result and range paging, available exports and downloads, and reopening of the same saved study. Open the downloaded result or report and the retained package through their original receiving route. Record the exact source revision, application route, study ID, viewed screens and control/export/reopen outcomes with the existing saved-study receiving operation. Repair concrete display defects before presenting the outgoing product as ready. Source review and controller assertions support this work; actual product acceptance requires looking at the populated interface and operating it. For the 13 October 2026 sprint, preserve the existing scientific jobs and the 14:00 UTC cutoff.

## Receive compact saved-study case browsing

The same native-supervision increment includes `model/parameter_views.py` and the [saved-case browsing guide](../docs/PARAMETER_CASE_BROWSING.md). Opening a retained study uses the existing Parameter API's `view` read, returning the original requested case page and compact study state. State filtering, exact case/run selection and text search use `case_filter`, `run_id` and `query`; the installer adds missing fields to the original query expression without removing another component's fields.

The installed scientific engine retains its full inspection, calibration, execution and report contracts. Before writing, the installer checks its original `_baseline_versions(run)` helper and the retained model-selection/native-version functions used by the view. Their exact source identities join the existing dependency preimages and concurrent-change checks. The shared Programme console continues to use its independent original run reader; Parameter-only navigation is imported only in the Parameter read path.

On the same populated receiving study, open a later saved-case page, change the state filter, search for an original case/run, open that case's retained attempt and return to Results. Reopen the study and operate its existing native Run/Resume control only when continuation is intended. Check these actual controls at desktop/screenshare and narrow widths under the preceding receiving rule; preserve the accepted original native operation and outputs.


## Installed Parameter study → SourceReports continuation

The native supervision increment also includes the complete saved Parameter scientific-source controller and `model/parameter_report_source.py`. Receive the current shared SourceReports/ensemble source producer first; the installer verifies and retains that scientific source unchanged. It also checks the original parameter export-member API and the SourceReports `openForSources` capability before writing any application file. The installed Parameter component declares these shared family dependencies.

Open a real saved Parameter study, choose **Prepare scientific source**, select the original cases, reporting areas and pollutants, and complete the existing queued preparation. **Compose selected scientific report** opens the shared composer with that exact retained source. Reopen an earlier completed preparation task after preparing another source: its original `source_id` renews download tickets for that earlier result, while its `experiment_id` opens the original study. The installer joins both identities into the current task decorator, forwards `source_id` alongside all existing query fields, and preserves unrelated host callbacks and static assets.

The HTTP read-dispatch AST selector deliberately excludes the completed-task replay call. A fully current server has both calls; receiving this increment must remain repeatable on that source. The shared source renderer, numerical study kernel, result tables, support counts and retained original edition remain authoritative.

Use the same equipped receiving application and original saved study for desktop and narrow-width operation. Prepare a selected source, open it in the composer, inspect actual PDF/HTML/Markdown and original exports, then reopen its original task and Workspace. Look at the rendered outgoing pages, operate downloads/map links and confirm the original choices survive. Source publication alone does not claim that native/rendered journey. Full controls and exact source semantics are in `docs/PARAMETER_SCIENTIFIC_REPORTS.md`.

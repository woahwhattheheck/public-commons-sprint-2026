# Receiving-water operating and receiving course

This course continues **ECO-RECEIVING-WATER-9B2C-20261013 / WO29** on the original Upper Savannah scientific application. A555's accepting host and original scientific operation remain the execution owner. It completes a populated source-to-customer workflow through the maintained Workspace, source importer, Chemistry engine, Operator queue and portable receiver.

It does not launch the separate analytical physics study. Preserve any already accepted engine3 study directory and its actual outputs. The physical study and these source-informed seasonal scenarios answer different questions.

## Scientific starting point

Use the complete installed source edition containing the receiving-water adapter, current operator controls, engine0.4.0, scientific reporting and these three course files. Do not run from a three-file extract.

The preferred selection is an existing immutable one-phase Chemistry case. Supply its original ID and its explicit Hartwell boundary inflow, boundary outflow and storage reach IDs. Its species, initial chemical masses, concentrations, loads, exchanges and reaction coefficients remain unchanged. They are not inferred from hydrology.

If no chemical case exists, **--authored-unit-tracer** explicitly uses the original study_storage.single() constructor. It retains a conservative tracer with **1 kg initial mass**, zero incoming tracer concentration and no reaction or external chemical load. This is an authored unit-response scenario, not a measured pollutant concentration, calibration, ecological prediction or contaminant-load estimate.

The existing scientific Workspace must already exist. The course neither selects a different project silently nor replaces another scientific operation.

## Original sources and quality

The source family retains all twelve unchanged quarterly CWMS responses:

- Inflow: Hartwell.Flow-In.Ave.1Hour.1Hour.Raw-SHEF_SAS.
- Selected outflow: Hartwell.Flow.Ave.1Hour.1Hour.Raw-SHEF_SAS.
- Storage: Hartwell.Stor.Inst.1Hour.0.Raw-SHEF_SAS.

The complete sources.json, source-receipts.json, selected-source-periods.json and twelve original bodies are retained in the owned output and verified against actual URLs, byte counts and SHA256 values before Workspace intake. The original source files and flags travel with each case.

Scenarios start January1, April1, July1 and October1,2025. Each covers21 days with three168-hour periods. Flows explicitly have interval-ending support. The mean uses every signed eligible hourly original value. Negative original values remain in the source/support counts; there is no clipping, missing-row removal or filling.

Flow eligibility is explicitly [3], storage eligibility [0]. These are selected original values, not a claim about undocumented provider quality meanings. Only exact positive initial storage initializes volume. Later observations compare against the continuous flow-derived trajectory.

The October22 storage observation has code -2147480957. It remains **quality-excluded**: its raw value stays retained, while observed_minus_predicted_m3 is null. The preliminary selected-period file contains a raw difference; that does not override the explicit native eligibility decision.

Unsupported intervals, off-grid timestamps, excluded flow qualities, negative aggregate flow and nonpositive storage require a corrected scientific selection. The browser leaves one eligibility field empty, observes the error, then corrects the same visible draft.

## Original equipped invocation

Use absolute paths. Output and scratch must be outside the original scientific Workspace. Preserve both directories across retries. The existing node_modules must contain playwright/index.mjs; select the actual installed Chromium.

Existing chemical template:

~~~sh
PYTHONDONTWRITEBYTECODE=1 /ABS/PYTHON -B \
  /ABS/COMPLETE_APP/source_tools/receiving_water_course.py \
  --workspace /ABS/ORIGINAL_WORKSPACE \
  --output /ABS/OWNED_OPERATION/receiving-water \
  --scratch /ABS/OWNED_OPERATION/receiving-water-scratch \
  --template-case ACTUAL_IMMUTABLE_CASE_ID \
  --inflow-id ACTUAL_BOUNDARY_INFLOW_ID \
  --outflow-id ACTUAL_BOUNDARY_OUTFLOW_ID \
  --reach-id ACTUAL_STORAGE_REACH_ID \
  --node /ABS/EXISTING_NODE \
  --node-modules /ABS/EXISTING_NODE_MODULES \
  --chromium /ABS/EXISTING_CHROMIUM \
  --source-revision ACTUAL_SELECTED_SOURCE_COMMIT
~~~

Explicit unit-response selection:

~~~sh
PYTHONDONTWRITEBYTECODE=1 /ABS/PYTHON -B \
  /ABS/COMPLETE_APP/source_tools/receiving_water_course.py \
  --workspace /ABS/ORIGINAL_WORKSPACE \
  --output /ABS/OWNED_OPERATION/receiving-water \
  --scratch /ABS/OWNED_OPERATION/receiving-water-scratch \
  --authored-unit-tracer \
  --node /ABS/EXISTING_NODE \
  --node-modules /ABS/EXISTING_NODE_MODULES \
  --chromium /ABS/EXISTING_CHROMIUM \
  --source-revision ACTUAL_SELECTED_SOURCE_COMMIT
~~~

The default source directory is source/receiving-water-hartwell-2025 in the complete application. --source-directory can select its exact materialized location. --operator-state optionally selects a compatible original Operator state; otherwise the course retains its Operator state under this operation and opens the original Workspace through the original OperatorProcess class. It does not implement another service or queue.

Do not start while another owner is mutating the selected Workspace. Reconcile the accepting owner and actual handle first. The course holds a nonblocking operation lock and passes it to the browser child. Server/browser lifetimes are sequential and closed before each receiving phase.

## Source-to-result user course

For each season, the original browser selects the template, chooses retained inflow/outflow/storage files, opens original columns and rows, and sets units, interval support and quality through the visible controls. It corrects an incomplete eligibility selection, previews every period and verifies168 complete flow intervals per period.

It saves the immutable prepared case through the original queue, opens that case and its physical controls, selects simulate and daily samples0 through21, then runs the exact original analysis. It opens chemical mass, samples, basis budgets, storage and storage budgets through the existing result collections.

The browser prepares and opens the saved scientific report, downloads every available preparation/analysis/report file, and exports the complete editable Chemistry ZIP with all selected original sources and the completed run.

The first preparation and final editable-export replies are intentionally lost **after original server acceptance**. The complete original request is saved before sending. Recovery submits the same body and operation ID and verifies the same native task. A reload then opens original saved cases, results and report. Every captured queue body, task ID, native result and file identity remains in the browser journal.

## Independent editable receiving

The native course calls the original Chemistry.receive on each downloaded editable ZIP in a separately initialized Workspace. It checks complete project equality, original-to-received run mappings and unchanged artifact descriptors.

It saves a notes-only child of the first received case through Chemistry.save_case, then replays that original receive. The same receipt must return while every later file and child remains. Accepted numerical results are not recalculated.

The exact received ZIPs are also retained in the recipient’s original Sources intake. A fresh original Operator selects each full archive and operates **Receive editable ZIP**, verifying the same native receipt after later work. It then opens the editable cases, received runs and notes edition. Producer and recipient case IDs remain connected through the native receiving map; they are not falsely equated.

## Full Workspace handover

After all cases and reports complete, model.portable.backup creates the self-contained Workspace ZIP with complete installed application source, intermediates and deliveries. It lives outside the Workspace.

The original restore or resume_restore independently receives that exact archive in the same owned destination. Native verification checks the full manifest/database snapshots. Original plain sources, cases and completed run records are compared with retained bytes. Source-view paths are derived; the original objects and native receiver establish their receiving identity.

A fresh OperatorProcess launches the application carried inside the archive, then the browser opens every original seasonal case, result and report. This validates the actual delivered application rather than the producer's development tree.

## Attachments and actual visual inspection

Complete delivered archives are retained and extracted before reports open. Unsafe members, aliases, duplicates and encryption are rejected. This preserves original HTML/image/CSV relative links.

The last browser phase opens every unique delivered original/extracted member. HTML opens as the actual report; full JSON/CSV/text is displayed in an inert readable view retaining its original identity. Screenshots cover1440px and390px widths. The full member list and screenshots stay with the operation.

The producing owner must **open and look at the actual screenshots and outgoing screens**. Automated capture does not establish visual review. Inspect curves, axes, units, mass accounting, storage observations, excluded flags, tables, narrow scrolling, all important controls, attachments and reopening. Fix real clipping, broken links, unreadable plots or input faults in the same maintained application. Keep the presentation plain and industrial.

Use only a browser available to the original operation. Respect any active owner reservation of a local in-app browser; an isolated host/cloud browser may continue. Do not navigate, resize, capture or inspect an owner-reserved browser.

## Continuation

Repeat the same command with the same original selection/output/scratch. course.json is the native journal. The four browser journals retain operate, editable, reopened and attachments phases.

A captured request always reuses its exact body and operation ID. Before a UI request exists, the unfinished visible step can continue; after capture, it is reconciled through the original queue. Interrupted tasks use the original resume control. Failed tasks stop for a concrete source/input repair; --resume-failed-tasks then explicitly resumes the retained task.

The default observation window is14,400 seconds. Expiry is a retained active-task outcome, not permission to create another calculation. Reopen the same task.

Executable identity lives in separate complete source-edition history. A selected repaired implementation may resume unfinished work while immutable business selections and completed numerical results remain. --source-revision records the real selection.

After completion the command verifies saved result files and returns the retained course. It does not rerun physics. For a presentation correction, prepare a saved scientific report from the original completed run, or retain a separate following report over original Project/result/request for standalone physics outputs.

## Complete output

- course.json: immutable business selection, full stages, source history, native receiving and completion.
- course-input.json: complete source collection, chemical template, four selections and original run request.
- originals/: twelve complete provider responses and original metadata.
- downloads/: exact preparation, analysis, report and editable project files.
- opened-archives/: complete ordinary members for relative-link receiving.
- complete-scientific-workspace.zip: full original Workspace and application.
- complete-original-catalog.json: original immutable case/run inventory.
- Four browser journals: complete queued requests and results.
- screenshots/ and attachment-views/: actual rendered evidence.
- Private startup control exists during its phase and is removed afterward; bearer capability is not printed.

The source packet does not claim these phases have executed. Return the actual native process receipt, complete output/archive and viewed screenshots through the existing A555/scientific receiving case.

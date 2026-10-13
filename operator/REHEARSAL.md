# Upper Savannah operator rehearsal and handover

TokenJunkieLabs · UPSTATE-REHEARSAL-HANDOVER-A5F3-20261013  
Part of UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012

Use **Operator rehearsal** in the existing Upper Savannah application to prepare, practice and retain a prospect walkthrough of an actual scientific case. The rehearsal records the selected study, original model runs, evidence shown, explanation, timing, screenshots and receiving result. It stays inside the original scientific Workspace and travels with its normal backup.

The native source, regional acquisition, InVEST calculations, scenarios, maps, conservation plans, run programmes, customer reviews and incremental transfer remain the existing application operations. The rehearsal links to those working controls and records what was actually available. Additional cases, scenarios and teaching attempts can be saved repeatedly.

This guide describes the implemented controls and reusable receiving programme. A particular regional result is demonstrated only when the accompanying run receipt identifies that exact source, case, files and completed operation. A prepared source package by itself does not establish a successful model run or a finished visual walkthrough.

## Open the current application

Receive the complete maintained application before installing this additive component. The original [application assembler](../source_tools/APPLICATION_ASSEMBLY.md) joins the complete source and newer components, and can capture the actual installed source after their guarded installers have run.

The ten rehearsal files are:

- model/rehearsal.py
- operator/rehearsal.py
- operator/rehearsal_cli.py
- operator/web/rehearsal.mjs and rehearsal.css
- operator/install_rehearsal.py
- operator/REHEARSAL.md
- operator/rehearsal_receiving.py
- operator/rehearsal_browser.mjs
- operator/rehearsal.example.json

Install all ten from the received addon directory into the selected application:

~~~sh
python3 -B operator/install_rehearsal.py \
  --application /owned/current-upper-savannah-application
~~~

When using a complete source packet, add its exact path:

~~~sh
python3 -B operator/install_rehearsal.py \
  --application /owned/current-upper-savannah-application \
  --source /owned/rehearsal-addon.json
~~~

The installer composes the current server, app and navigation. It preserves existing scientific task handlers, project-transfer decoration, extension-registry web assets and active-desk cleanup. It records complete previous and following files before publication. A different current owned source requires its explicit predecessor identity in the complete packet; a concurrent shared edit is preserved for composition. Repeating the same installation is supported.

Installation updates source. Reopen the original operator after its current work has stopped. Use the same installed scientific Python environment:

~~~sh
cd /owned/current-upper-savannah-application
python3 -B operator/server.py \
  --workspace /owned/current-upper-savannah-study \
  --operator-state /owned/current-upper-savannah-operator \
  --restore-directory /owned/received-studies
~~~

Open the exact local URL printed by the server. Choose the retained study in the existing workspace chooser, then **Operator rehearsal** in the left navigation. Its fragment route is **#rehearsal**.

The printed startup object contains a private local connection capability. Retain it privately for the CLI; the shareable walkthrough contains original files and results, without that live capability.


### Selected model scope

The current original application can retain an NDR-only run, an SDR-only run, or both. The rehearsal reads the native `model.model_selection.run_scope` result for every selected run. Calculation readiness requires that run's declared native stages and original output files. An intentionally omitted model remains visibly omitted; it does not become a failed or invented output. Comparisons retain the original common-artifact and model-scope fields, so a comparison can contain only the outputs shared by the selected runs.

The complete RFP delivery remains a separate requirement. Its seven map families need both models and their physical outputs, together with the declared protection, water-quality and priority context. A completed selected-model calculation does not imply that this full delivery is available. The case evidence includes selected, completed and omitted models, expected and available artifacts, the retained stage timing, and actual units.

This rehearsal edition requires the current original `model/model_selection.py`. Its installer names that missing source explicitly if an earlier application is selected. It also preserves the existing Scenario analysis desk when moving into or out of the rehearsal view.

## Prepare a case Bryce can explain

Use the **Prepare** view to name the walkthrough, its operator and audience. Describe the actual case in ordinary language: the source date, geography, which scenario is the baseline, what changes in each alternative, and which results have already been calculated.

Choose either **Recorded results** or **Live walkthrough**. Recorded mode is useful for a stable meeting case. Live mode permits an explicitly selected original calculation to support fresh timing. Both modes preserve the actual native run identities and state.

Select these existing objects in the Prepare form:

| Selection | What it identifies | What to check before the call |
| --- | --- | --- |
| Source edition | The retained original source collection and its provenance | Publisher, vintage, actual retained inputs and geographic scope |
| Grid | The original model grid and reporting mask | Projection, dimensions, resolution, nodata treatment and covered area |
| Parameter profile | The native biophysical and model parameter definition | Who selected it, its method and whether it is working or scientifically accepted |
| Baseline run | An actual run whose original scenario is a baseline | Run ID, source/grid/profile selection, native state and outputs |
| Alternative runs | An ordered selection of actual runs on the same grid | The land-cover or management change and any profile change |
| Comparison | The existing comparison for exactly that ordered baseline and alternatives | Direction is alternative minus baseline |
| Map delivery | The original delivery for exactly those runs | All required map families, individual physical outputs and retained files |
| Spatial review | An optional existing saved geographic view | Its actual selected layers, extent, legend and saved interpretation |

Selecting a baseline derives its actual grid and profile. Selecting the grid derives its original source collection. Conflicting explicit selections are rejected. A comparison or delivery for different runs is rejected; the application does not quietly substitute a nearby result.

A field may remain unselected while independent teaching work continues. The missing dependent evidence remains visible and its step can be deferred. Give the missing item and next action in the note. This does not prevent practice on the completed parts of the product.

Save the definition. The saved rehearsal receives an immutable ID, a positive revision number, the original project ID and a complete record hash. Keep that exact ID in the meeting brief and opening instructions.

## The five working views

**Prepare** retains the selected case and complete editable teaching definition. An unsaved browser draft remains separate from the latest native revision. If another action advanced the record, read that revision and explicitly adopt it before saving the retained draft.

**Walkthrough** presents the nine steps below. For each, use the actual linked controls, select **Begin**, perform the action, then record **Observed** or **Deferred**. Begin retains the starting selection and time. Record captures the actual evidence at completion and links any selected original tasks and media.

**Evidence** shows the complete selected scientific objects, retained task facts, native stage timing and attached media. It distinguishes the saved record from the current live inspection. A file marked present has passed the declared presence check; the original download and export paths verify its complete byte identity.

**History** opens immutable prior revisions and their events. It keeps earlier attempts when the selected case changes. Old work is still inspectable; current completion is derived from matching scientific selections.

**Handover** exports the selected teaching revision, opens its full download tickets, and links the original scientific backup/restore controls. Use both teaching and scientific packages for a working delivery.

## Practice the nine steps

The words in the final column are prompts Bryce can adapt to the actual selected case. They are not assertions that an unavailable result exists.

| Step | What Bryce does | What he should see and explain | A sentence he can say |
| --- | --- | --- | --- |
| 1. Open the actual study | Open the retained source edition from the walkthrough | Publisher, date, scope, original files and identities | “These are the exact source files for this case, and every result can be traced back to them.” |
| 2. Explain the geography | Open the grid and spatial review; show reporting and upstream context | Real coordinates, extent, reporting mask, aligned working grid and original input resolution | “The calculation includes its upstream contributing area; this is the specific area we are reporting.” |
| 3. Explain parameters | Open the selected profile and its native definitions | Actual coefficients and model choices, with scientific interpretation kept explicit | “The scientist can inspect and choose these assumptions, and each run preserves the profile it used.” |
| 4. Explain alternatives | Open the baseline and selected scenario records | The actual land-cover or management change, ordered alternatives and any changed profile | “This alternative changes these selected conditions while retaining a traceable baseline.” |
| 5. Inspect or run calculations | Open the original run, stages and logs; start a fresh original run only when explicitly selected | NDR/SDR state, actual logs, artifact identities and native stage times | “This is the original model execution, and these are its retained outputs and elapsed times.” |
| 6. Inspect maps | Open the actual physical output or saved spatial review; inspect legend, units and extent | Distinct nutrient/sediment outputs and the selected map-family inventory | “The units and legend tell us what this layer represents; the selected view remains linked to the original calculation.” |
| 7. Compare cases | Open the existing comparison of the selected runs | Direction, quantities, units and explicit parameter/context changes | “These differences are the alternative minus the baseline for the same selected comparison.” |
| 8. Export a delivery | Open the native map delivery and its real downloads | Complete GIS files, maps, quantitative tables, source and method metadata | “The operator receives the maps and the underlying editable data, with the methods needed to interpret them.” |
| 9. Receive the working copy | Begin transfer, make the original backup, restore that exact archive and inspect the receiving rehearsal | Same project and archive identity, independent receiving workspace, exact current teaching revision | “We have opened the transferred working copy and matched this saved rehearsal inside it.” |

A step can be practiced more than once. Repeated attempts remain in the record with their own start, finish, notes, tasks, file identities and outcome. Begin the appropriate step before attaching its completed observation. If a step is unavailable or interrupted, record Deferred with the actual reason.

Use the original **Run programmes** desk for repeated selected model runs, its pause-after-current-run and same-task resume. Use the existing conservation and scenario controls to create additional alternatives. The teaching record has no scenario-count ceiling and does not create a parallel run controller.

## Explain the seven map families precisely

The issuer's [complete 18-page RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf) asks for the following map families. The existing delivery engine retains these families and their actual selected run identities:

| RFP family | Application family key | Explanation to retain with the selected map |
| --- | --- | --- |
| Future sediment loss | future_sediment_loss | Sediment result under the explicitly selected future or management alternative |
| Future nutrient runoff | future_nutrient_runoff | Nutrient result under that named alternative and its original assumptions |
| Critical drinking-water protection | critical_drinking_water | Protection geography and context derived from the selected source-water evidence |
| High-quality waters | high_quality_waters | The actual source designation and selected geography |
| Current nutrient export | current_nutrient_export | Baseline nitrogen/phosphorus outputs with their physical units |
| Current sediment export | current_sediment_export | Baseline sediment output with its physical units |
| Combined pollutant priority | combined_pollutant_export | A planning combination whose normalization, weights and selected area remain visible |

The family name does not establish a future forecast, a water-quality designation or a scientist's acceptance by itself. Explain the selected source and method attached to the current layer. Preserve the separate physical outputs alongside any combined priority score.

NDR and SDR raster outputs and catchment totals require different unit labels. The original [InVEST NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) describe the native output semantics. This application retains nutrient raster rates in kg/ha/year and SDR rates in metric tonnes/ha/year, with its original area conversion used for mass summaries. The teaching evidence labels retained nutrient totals kg/year and sediment totals metric tonnes/year. Read the actual descriptor for the selected output before quoting a quantity.

The working 30 m grid does not make a coarser rainfall or soil input a 30 m observation. The original source resolution and resampling lineage remain material. The South Carolina reporting area, upstream contributing model domain and individual utility focus watershed are distinct selections. Show which one the current quantity covers.

The issuer's sampling, bacteria, cyanotoxin and microbial-source-tracking context is separate from an InVEST nutrient/sediment estimate. Do not present those model outputs as measured observations or as a bacterial prediction.

## Saved completion follows the current case

The record keeps every old attempt. Current completion is computed separately from the scientific selection recorded by each attempt:

- Study follows the selected source edition.
- Geography follows source and grid.
- Parameters follow the selected profile.
- Alternatives and calculations follow source, grid, profile, baseline and ordered alternatives.
- Maps additionally follow the selected spatial review and delivery.
- Comparison follows the exact comparison selection.
- Delivery follows the selected delivery.
- Transfer follows the full selection, including the two actual backup/restore task IDs.

Changing the selected baseline or profile therefore preserves the old attempts as history and requires the affected current steps to be practiced again. Selecting different backup/restore tasks affects transfer completion without erasing compatible scientific steps.

The latest compatible attempt controls the current outcome. A later compatible Deferred attempt stays deferred even if an older attempt was observed. Evidence-ready describes the available native evidence; Observed describes a retained compatible teaching outcome. Neither is a separate scientific approval.

The native record response supplies authoritative completion metadata beside the immutable record: per-step state, current attempt index, compatible indices and a boolean match for every historical attempt. The browser, overview and printable walkthrough use that same rule.

## Timing, screenshots and the short recording

A teaching attempt records elapsed time between Begin and Record. That interval may include explanation, waiting or inspecting files. It is labeled as such.

Fresh native calculation timing is supported only when the selected original run and its NDR/SDR stage facts establish actual new work during the active teaching attempt, and an original completed run task matches it. An already completed run opened during a live-mode rehearsal remains a recorded result for timing purposes. Keep the stable meeting result available while a newly selected calculation runs.

Before a speed discussion, show the actual source acquisition/preparation receipt, native stage timings and receiving/download duration separately. Do not combine them into an invented end-to-end benchmark. The reusable receiving programme retains its original task attempts and browser measurements for this purpose.

Attach original screenshots and a short walkthrough recording through the step's media control. Supported native filename extensions are PNG, JPG, JPEG, WEBP, WEBM, MP4, MKV and MOV. Each file is limited to 256 MiB and the operator's selected upload capacity. The original complete bytes, filename, media type, byte count and SHA256 remain bound to the saved attempt.

If the browser supplies no media type, the original upload records application/octet-stream. The accepted filename extension still identifies a supported media attachment; the interface does not invent a MIME value that differs from the received file.

Show at least the selected source/geography, a readable result map, comparison meaning, real export and receiving copy. Inspect desktop and a narrow phone layout. Record actual screenshots of this version; a source-only build has no visual success claim. The reusable Playwright caller uses the configured existing browser/runtime and appends its actual media and output receipts to the same rehearsal.

## Task recovery and later edits

All mutations use the existing operator queue. The browser retains the complete posted workspace, action, payload and operation ID before sending. The server may coalesce an identical active request into an existing task with a different operation ID. That returned actual task is retained with the original frozen input.

If a response is uncertain, keep the pending action and use **Reconcile**. The interface first looks for the original operation ID, then compares the full native task input and request hash. A pre-send census excludes unrelated old terminal tasks. An actual new task, an originally queued/running task, or a terminal task that genuinely resumed can remain a candidate.

A queued transition is meaningful: the original resume action sets queued before its worker appends a new attempt. Later attempts retain their actual native start/end fields. If more than one exact candidate exists, inspect and select the actual matching task; the interface does not guess by proximity or create an unrelated request.

For a failed or interrupted original task, inspect its error and use **Resume** on that exact task after addressing the cause. A resumed request retains its original expected revision. A new edited definition must be saved against the actual current rehearsal revision.

After a request completed, replay returns its original recorded result before the current revision guard. It does not move the current record backwards. An independent receiving operator can keep a later local note while the older transfer request still returns its original receipt.

When the queue coalesced a submitted request into another actual task, the unused submitted operation ID is not a server-side alias. A literal native replay therefore uses the accepted task's original complete envelope and operation ID. The programme retains both that envelope and the initially submitted request; it never resubmits an unregistered alias after the matching task became terminal.

Browser drafts and pending requests remain in the original browser's durable storage. The receiving programme preserves the selected local port and browser profile so reopening the same programme can recover that origin's pending work. If the exact port is occupied, reconcile the original listener rather than opening a second competing programme.

## Transfer the current teaching revision correctly

The transfer observation checks more than matching project names.

1. Open the current saved rehearsal and choose Transfer.
2. Select Begin. This creates the exact active rehearsal revision that will travel.
3. Use the original Workspace backup. Keep its complete archive and original completed task ID.
4. Restore that exact archive through the original operator. Keep its original task ID.
5. Open the independent receiving workspace and inspect the rehearsal copied inside it.
6. Back on the sending rehearsal, select exactly that completed backup and restore pair.
7. Record Observed.

The native action checks the original project ID, backup bytes/SHA, receiving identity and different workspace alias. It then reads the exact active rehearsal revision inside the receiving Workspace and matches its entire record hash. An older backup of the same project cannot establish that the current teaching record was transferred.

The receiving copy contains the active pre-completion edition; the sending copy then records transfer completion in its next edition. These are intentionally different points in the same history. Close the copied active attempt as Deferred in the receiver if you are only making a local note there; it did not itself perform another backup/restore.

The full scientific Workspace backup carries original source, configuration, study inputs, scenarios, results and rehearsal history. The teaching export contains the selected rehearsal, full teaching history through that revision, printable HTML, editable Markdown and attached media. Supply both for the complete operator handover.

The newer [incremental project-transfer service](../model/PROJECT_TRANSFER.md) is also preserved. Its parts, archives, acceptance and restore continue through their existing controls and request records. This rehearsal's explicit transfer observation uses the original whole-backup/restore pair described above.

## Connected CLI and exact request files

The CLI talks only to the authenticated original local operator. It does not start a model worker.

~~~sh
python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json overview

python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  record --id ACTUAL_REHEARSAL_ID

python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  record --id ACTUAL_REHEARSAL_ID --revision 3
~~~

Select another already registered workspace with the global --workspace ACTUAL_WORKSPACE_ID argument.

A full save request has the original queue envelope:

~~~json
{
  "workspace": "ACTUAL_WORKSPACE_ID",
  "action": "rehearsal.save",
  "operation_id": "UPSTATE_REHEARSAL_SAVE_20261013",
  "payload": {
    "title": "Upper Savannah selected-case walkthrough",
    "operator": "Bryce",
    "audience": "Internal product rehearsal",
    "mode": "recorded",
    "selection": {
      "source_collection_id": null,
      "grid_id": null,
      "profile_id": null,
      "baseline_run_id": null,
      "alternative_run_ids": [],
      "comparison_id": null,
      "delivery_id": null,
      "spatial_review_id": null,
      "backup_task_id": null,
      "restore_task_id": null
    },
    "notes": "Choose the actual retained objects before observing their dependent steps.",
    "science_notes": "Record the scientific choices and acceptance state for this specific case."
  }
}
~~~

Replace ACTUAL_WORKSPACE_ID with the original identifier. Fill selected objects from the actual overview; null means unselected. Saving a later edition also supplies the saved id and expected_revision in payload. Keep the exact complete request file for recovery.

~~~sh
python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  submit --file /owned/rehearsal-save-request.json

python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  task --id ACTUAL_TASK_ID

python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  resume --id ACTUAL_TASK_ID
~~~

Supported actions are rehearsal.save, rehearsal.begin, rehearsal.record and rehearsal.export. Begin supplies id, expected_revision, step_id and note. Record adds outcome, the exact task_ids, upload_ids and note. Export pins id and revision.

The original queue operation ID uses 16–100 ASCII letters, digits, underscores or hyphens. Keep one unchanged complete request per action. Mutation JSON remains bounded at the original 4 MiB. The CLI separately permits a complete JSON response up to 64 MiB so retained histories are not confused with action-body capacity. Whole file downloads stream independently.

After a completed export, select one exact filename or ticket ID from the task's _downloads:

~~~sh
python3 -B operator/rehearsal_cli.py \
  --connection /owned/private/operator-startup.json \
  download --task ACTUAL_EXPORT_TASK \
  --member operator-walkthrough.zip \
  --out /owned/delivery/operator-walkthrough.zip
~~~

The client checks the original Content-Length, ETag, full byte count and SHA256. It publishes a complete file exclusively and reuses an existing destination only when the full identity matches.

## Complete native and browser receiving programme

Copy rehearsal.example.json to a private actual-input file. Select the existing Workspace directory, separate output directory and full teaching definition. Every source/run ID comes from that original Workspace. The supplied example leaves them explicitly unselected; it is not a manufactured regional result.

To reuse an existing browser, provide absolute paths for its Node executable, Playwright module and installed browser executable. The programme downloads no browser. Keep fresh_run_ids empty to inspect original recorded calculations. In live mode, only actual run IDs expressly listed in fresh_run_ids may start the original run.start action.

~~~sh
cd /owned/current-upper-savannah-application
python3 -B operator/rehearsal_receiving.py \
  --input /owned/rehearsal-input.json
~~~

The programme holds one journey lock, starts the original operator, and carries out this same scientific/teaching workflow:

1. Retain the exact input and every original queued request.
2. Save the rehearsal and inspect/record or explicitly defer the first eight steps.
3. Begin transfer, create/download the complete original backup, upload/restore it and match the active rehearsal in an independent receiving copy.
4. Preserve a later local receiving note.
5. Export and verify every member of the complete native teaching packet.
6. Replay the original save and restore after later editions and verify that current records remain intact.
7. Run the configured actual desktop/phone browser journey and retain its media, timings and result.
8. Export the final teaching edition and full scientific Workspace, receive it separately, close/reopen the operator, and match the saved revisions.
9. Publish a complete delivery ZIP containing the actual requests, reports, media, downloads and receiving results.

The native checkpoint is results/native.json. The final receipt is results/complete.json; it separately records browser_state as COMPLETE or NOT_CONFIGURED. It does not label a missing browser phase successful.

When a browser is configured, --native-only stops after the retained native phase so the same input can later continue without that flag. The actual selected case, original task IDs and receiving copies remain the same.

If a task fails, inspect its retained terminal response and error. Resume only the same selected phase after addressing the cause:

~~~sh
python3 -B operator/rehearsal_receiving.py \
  --input /owned/rehearsal-input.json \
  --resume PHASE_FROM_THE_RETAINED_ERROR
~~~

If an uncertain response leaves several exact coalesced candidates, read the retained census and explicitly resolve that actual phase:

~~~sh
python3 -B operator/rehearsal_receiving.py \
  --input /owned/rehearsal-input.json \
  --resolve PHASE_FROM_THE_RETAINED_ERROR=ACTUAL_TASK_ID
~~~

The programme reuses the complete frozen request, including its original expected revision, and validates the actual task input. It does not silently convert a failed task into a fresh operation. Source fixes can be installed while preserving the same original Workspace and output records.

Keep the complete scientific archives and result JSONs from every useful completed stage. Interrupted browser work leaves the successful native checkpoint available. A final delivery inventory binds each original member by path, byte count and SHA256, and the programme verifies the entire completed ZIP on reopen.

Each native and final checkpoint freezes its complete retained file inventory before publication. A resumed journey verifies every original path, length and SHA256 before opening the operator, including the scientific archive, teaching files, accepted-request receipts, browser result, screenshots and recording. The final bundle verifies that same closure again. A missing or changed original stays unresolved: recover the same bytes through its existing task and file ticket or retained archive. The programme does not create a new backup to conceal a lost checkpoint or silently replace an original digest with the changed file's hash.

## Questions Bryce should be able to answer

**What can we change?** The selected source edition, scientific profile, original scenario/run selection and repeated alternatives, using the existing application controls. The rehearsal records those exact selections and which teaching steps remain current.

**Which decisions belong to their scientist?** The scientific method and profile choices, interpretation of observation comparisons, applicability of protection/high-quality designations and meaning of combined priorities. A working profile or saved explanation does not imply approval.

**What happens while a model is running?** The original task/run views show actual state, stages and logs. A completed recorded case remains available for explanation. The teaching attempt records the waiting interval separately from native calculation time.

**Can we reproduce the result?** The full scientific Workspace retains original inputs, selections, model source/configuration and outputs. The programme actually restores a separate copy and compares the saved teaching revision. Cite the accompanying receiving receipt for the demonstrated version.

**What if the source is missing?** Name the exact missing input and dependent output. Continue the independent study, selection, profile, operator and training work; keep the affected step deferred. Do not substitute an invented observation or result.

**What does the customer get?** Original GIS/data outputs, readable maps/tables and methods, editable scientific project/source, a full working backup, an editable teaching guide, saved history and actual screenshots/recording, with a complete receiving result for the supplied edition.

## Source and requirement references

- [Issuer RFP and combined appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf): complete 18-page document. The original retained publisher PDF is 7,470,549 bytes, SHA256 04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf.
- [Original acceptance folder](../source/acceptance/20261012/README.md) and [33 retained review requirements](../source/acceptance/20261012/review-requirements.json).
- [Scientific run programmes](../PROGRAMMES.md), [current application assembly](../source_tools/APPLICATION_ASSEMBLY.md), [incremental project transfer](../model/PROJECT_TRANSFER.md), and [original customer review](CUSTOMER_REVIEW.md).
- The existing eight-stage teaching contribution and original model/application ownership remain in the Upper Savannah Sales parent 1791724121.853269. This persisted rehearsal adds actual revision, timing, media and receiving records to that original workflow.

The commercial starting proposal does not limit product development. Additional scenarios, completed scientific work, operating improvements and further rehearsals can continue. Tim outreach and meeting commitments remain with Bryce.

# Saved native-model study → complete editable GIS handover

The existing **Editable GIS projects** desk can select a saved native-model study directly. It reads the producing study's captured records and reuses its original native rasters, signed comparisons, prepared grid and source files. The ordinary GIS queue, offline viewer, QGIS working copies, ZIP receiving, source adoption and saved review decisions remain the same product.

## Open a saved scientific report directly in editable GIS

In **Sources → Saved scientific reports**, open the actual saved edition. Each ordered study exposes **Open original source files**. A retained native-model study whose original project is open also exposes **Prepare editable native GIS**. This opens the existing GIS desk with that exact source and saved scientific report selected. Received source collections remain inspectable; native raster export requires the original restored model project.

The GIS preview preserves the report edition ID and a digest of its complete verified file descriptors. Its original PDF, HTML, data, selection, figures and edition/operation records travel unchanged as a document attachment with their relative hierarchy. A report containing several studies stays a complete report; the GIS layers belong to the explicitly selected native cohort.

You may choose another saved scientific report containing the exact same source or choose no additional report. Native study reports and numeric source context continue to travel normally. Pending or failed context previews cannot silently remove a selected report from an export.

### Include actual recorded execution history

The **Saved execution history** control lists saved histories containing exactly the selected native run set. Choose a snapshot explicitly, then inspect its capture time and summary. The application verifies the same original project, run selections, completed artifacts, land-cover input stage, grid, profiles and scenarios before attaching that history. Later unrelated stages may remain in the history with their own recorded capture time. Missing intervals remain missing; reused calculation intervals remain separate from the receiving run’s local work.

The original history HTML, numeric CSVs, full frozen source records, identity, manifest and ZIP travel as one document attachment. This is an observed execution snapshot, not an estimate of how long an unrecorded operation took. The history component is optional for ordinary GIS export. Install the maintained `native-run-history` component before selecting a saved history; the existing complete source handover contains its own dependencies and receiver.

### Continue the actual native course

Use the existing `source_tools/receive_native_study_gis.py` entrypoint and actual saved IDs:

```sh
python -B source_tools/receive_native_study_gis.py \
  --application "$APP" --workspace "$WORKSPACE" --state-directory "$STATE" \
  --source-collection-id "$COLLECTION" \
  --scientific-report-id "$SAVED_REPORT" --execution-history-id "$SAVED_HISTORY"
```

Both context flags are optional. Reopening the same state directory retains the exact accepted queue requests and selected context hashes. Use a separate receiving state for a deliberate new report/history choice; completed phases in the existing course stay intact. The receiver verifies every context member’s original path, byte count and hash after independent GIS receiving, then reopens the original operations and download after Operator restart.

The complete `gis-native-study` component declares the existing scientific-report component. The maintained installer adds one callback to the existing Sources host and preserves its other callbacks. The callback uses the existing asynchronous openDesk contract, so the original GIS desk finishes mounting before its intake method runs. Its shared report provider and controller replacements accept the known original predecessor or identical successor; a newer owner revision must be composed before installation. The ordinary native history modules are imported lazily.

Open the actual outgoing GIS browser, QGIS project, every attached HTML/PDF/table/archive and the complete cold-reopened application as directed by `CURRENT_OWNER_DIRECTION.md` version **2026-10-13.3**. This continuation consumes completed scientific results and retained history without rerunning the source models.


## Use the retained study

1. Open the scientific Workspace that owns the saved native study. A restored copy of that original project is supported; its local directory and operator key may differ.
2. Open **Editable GIS projects** and choose **Saved native-model study**. The chooser lists registered saved-native-ensemble sources. Sources from another project remain identifiable and direct you to the original project containing their native rasters.
3. Inspect the completed run count, original comparison count, report companion count, declared quantities and retained grid/scope. The original source title and scope distinguish a simulated square from an edition using actual watershed geometry.
4. Set a useful handover title and, if desired, its display coordinate system. Native working grids, geometry, NoData and physical units remain unchanged by the display CRS. Selecting a saved study disables independent manual run/grid/comparison selections so the handed-over cohort cannot silently differ from the chosen report.
5. Build the complete GIS project through the existing original task queue. Open its layer/source view, inspect the original numerical CSV tables and download the complete ZIP. A completed rendered study report, when selected in the preview, travels with all of its declared files.
6. Extract the whole ZIP and open `OPEN_GIS.html` and `project.qgz`. Keep every directory together. The recipient may edit independent GIS working layers, seal and pack a new edition, receive it through the existing desk and review its actual changes. The original model inputs, run records and report stay intact.

The public client continuation is `createForNativeStudy({workspace_key, source_collection_id, source_id})` on the existing `gis-projects` controller. It freezes the source selection, rereads the original source and rejects delayed replies after Workspace or form changes. It prepares the ordinary export form; the user retains the existing build action.

## What travels

- Every physical raster actually captured by the saved report, with its original source file identity and declared per-cell units. A later unrelated native output is excluded from that historical report handover.
- Every original comparison selected by that report, with its retained subtraction direction and source references. The original report retains the exact common/full/excluded support and undefined percentages.
- The prepared study grid and the distinct original model-domain geometry, reporting-area geometry and reporting mask. A saved source never gains a new geographic interpretation through export.
- The entire registered scientific source: original numerical report, all source companions, original grid/run/profile/scenario/input records, coefficient tables, figures and other original declared files.
- Each original numerical CSV also appears as a typed table in the offline source desk. These heterogeneous tables have no invented single unit; their actual column definitions and report declarations remain in the same package.
- If the chosen saved-source operation already has a completed rendered report, the exact selected rendering and every declared operation file travel as an additional original document group. The queued selection binds their descriptor hash.
- Explicit original project, source collection/source/body hash, ensemble, report, member/profile/scenario/run and reporting-mask bindings.

Annual N/P mass reaching the modeled stream, sediment mass, cell values, common-support totals and scenario differences are distinct quantities. No raster is multiplied by cell area again. The export performs no native solve, reprojection of model values, resampling, renormalization or numeric aggregation. The original source labels identify simulated inputs; this handover cannot establish measurements, calibration or intake concentrations.

## Complete same-Workspace native receiving

Use the maintained full installed application and the existing source-owning Workspace. Keep the producing calculations and any queued writer intact; admit the source change at the existing installation boundary. The source-only receiving course below resumes its exact recorded operations and does not launch a model.

```bash
PYTHON -B APP/source_tools/receive_native_study_gis.py \
  --application APP \
  --workspace ORIGINAL_WORKSPACE \
  --state-directory ORIGINAL_OUTPUT/native-study-gis \
  --source-collection-id ACTUAL_SAVED_STUDY_COLLECTION_ID
```

When exactly one local saved native-study source exists, the collection argument may be omitted. Multiple retained editions require an explicit original collection. Read available choices with the existing GIS catalogue, or `gis_native_study.choices(workspace)`; never substitute an ensemble ID for a source collection ID.

The receiver opens the actual original Operator, previews that captured source, queues `gis.project.export`, downloads through the original ticket, uploads the unchanged ZIP, queues `gis.project.receive`, verifies the independently received complete edition and original source companions, closes the Operator and cold-reopens its original records and download. Its journal retains accepted operation/task identities before waiting, including native identical-active-request coalescing. A retry uses the same saved payload and accepted native task. An incomplete phase may resume through the original native task API.

The result `native-study-gis-result.json` supplies actual export/receipt IDs, file paths, source/run/comparison counts, original units/scope and archive identity. `native-study-gis-receiving.json` retains the original request and phase history. Use an independently named state directory for a deliberately different source edition; keep the prior course.

The completed SAME5156 course reported on October13 is **the original 1,296ha simulated Piedmont headwaters square**,120×120 cells at30m in EPSG26917, with identical simulated model/reporting rectangles and simulated utility overlays. Its actual project is `1b6a344c-df5a-4986-a5e4-47a2d158324b`; ensemble `8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4`. It retains its completed native baseline/restoration/matched-control and parameter-course outputs. The original-geography Upper Savannah successor is a separate explicit source edition under its existing scientific/runtime owners. Choose each by its actual retained source, not by assumed location or an abbreviated label.

## Source installation and preservation

The additive component fragment is `integration/component_fragments/gis-native-study.json`. It includes the new adapter/receiver/guide and the complete maintained GIS joins, with original core, GIS and ensemble dependencies. Full application assembly includes this component and preserves the current shared catalogue.

The maintained `install_gis_projects.py` also receives `model/gis_native_study.py`, this guide, the native receiver and fragment. It requires the installed original `ensemble_study_transfer.py` and `native_versions.py` dependencies before writes. It preserves current registered-host integration and the original direct-host catalogue route where present; every source change is preflighted with current predecessors, backed up and subject to its existing concurrent-source checks and rollback.

Preserve merged3987's entire geographic review implementation and producer version, the saved original-vector decisions family, current delivery/atlas integration, and newer same-path successors. The native study adapter is additive to those current paths. A source installation never replaces a Workspace, operator state, input source or completed native output.

## Open and use the actual outgoing product

On the receiving scientific host, open the selected populated study and its GIS desk at the actual screenshare width and390px. Choose the actual source, inspect its grid/scope and units, edit the handover title, build and reopen the original task, use all selected downloads, and open the extracted offline viewer and QGIS project. Inspect all native layers and their mask/support labels, the complete original CSV tables, figures, report pages, source/provenance files and the received/reopened project. View real screenshots, operate the controls and repair the actual affected result before presentation. Source inspection and queue completion are not visual acceptance.

The maintained current owner direction follows in full, followed by the standing ALL-attachments instruction. It applies to this receiving command, handoff and any delegated continuation.

---

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.


---

<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->


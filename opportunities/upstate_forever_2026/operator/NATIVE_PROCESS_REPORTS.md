# Native process reports in the scientific operator

Open **Native process reports** beside **Native run desk**. This is the browser workflow for the maintained original-stage producer in `model/native_process_report.py`. It reads the original completed NDR and SDR outputs, preserves their actual producing versions and file identities, builds the original watershed process report, and imports its scientific recipe into the existing Sources catalogue.

A completed NDR stage can be selected even when its parent run is still running or its SDR stage failed. The parent status remains visible. Each selected model must be complete in every selected run and meet the producer's original source, geometry, version and units contract.

## Receive the complete maintained application

The registered extension is `operator/extensions/native-process-reports.json`. Its backend, browser module, stylesheet and this guide travel with the existing application component catalogue. The component requires the existing core application and observed-context/report producer. Receive the complete selected application with the maintained source assembler and installer, then restart the existing operator using its normal startup procedure.

The browser uses the original authenticated API, queued operation service and verified file tickets. Its source files are:

- `operator/native_process_operator.py`
- `operator/extensions/native-process-reports.json`
- `operator/web/native_processes.mjs`
- `operator/web/native_processes.css`
- `operator/NATIVE_PROCESS_REPORTS.md`

The maintained producer remains `model/native_process_report.py`, `model/process_quantities.py` and `model/NATIVE_PROCESS_QUANTITIES.md`. It requires the same GIS Python environment as the original native outputs, plus the installed scientific PDF formatter. The desk uses that producer directly.

## Open the checked Native run cohort

In **Native run desk**, select the original grid, profiles and scenarios, choose the unchanged baseline, and check the intended cells. **Report completed model stages** groups those cells by their original profile and retained native model scope. Each group lists its actual run IDs, parent states and retained stage completion times.

Choose **Open NDR report**, **Open SDR report**, or **Open NDR + SDR report** when the displayed completed count covers the entire checked cohort. The first run is the chosen baseline; every other checked scenario follows in the original scenario-selection order. This includes a matched control stored as another baseline-kind scenario. A baseline alone is supported. An unfinished or missing checked case remains visible and prevents that scope from opening; deliberately uncheck it to request a smaller cohort.

Compact run-state records provide the completion hints displayed here. The process desk then reloads its original native catalogue and accepts the entire ordered selection only when every requested model has a completed stage and its original watershed output, with all runs on the same native grid. Missing runs, another grid or an incomplete requested stage preserve the existing process draft and display the issue. The ordinary producer preview then validates original producing versions, geometry, quantities and source identities.

The maintained opening API is:

```javascript
openDesk('native-process-reports', 'createForRuns', {
  workspace_key,
  run_ids: [baselineRunId, restorationRunId, matchedControlRunId],
  models: ['ndr', 'sdr'],
  title: 'Original native baseline, restoration and matched control'
});
```

All IDs refer to retained original runs. The method preserves their order and does not remove unavailable members. The existing scalar `createForRun` entry point delegates to the same receiving path. A newer navigation, manual order change or Workspace change supersedes a delayed catalogue opening. Accepted queued operations remain accessible in their original Workspace.

Opening this form retains the selected scientific inputs for preview; preparation, model execution and report submission remain the existing explicit operator actions. Continue with **Preview original stage selection**, inspect actual producing versions and support, and build the queued report. The completed report can be opened alone or appended to the current ordered Sources report, exported with its original companions, and restored through the maintained editable Study workflow.

Receive both current browser modules (`operator/web/run_workbench.mjs` and `operator/web/native_processes.mjs`), their extension descriptors and this guide in the same complete application. The host's existing `openDesk` route checks the selected Workspace and view while mounting the receiving desk. Preserve current programme/run assembly, scientific producers and other shared application leaves.

For actual receiving, use the already owned native Workspace and its retained run roster. Exercise the complete checked baseline/restoration/control route, including completed NDR while SDR remains unfinished when such an original case exists. Open and inspect the resulting report and all original attachments at desktop and 390-pixel widths, use the actual controls and export/reopen the retained product. Keep the running model's existing writer and report execution course; this extension does not introduce a separate execution controller.

## Select the original stage cohort

1. Open the actual scientific Workspace containing the retained native runs.
2. Choose **Native process reports** and enter a useful report title.
3. Choose the baseline native run. This is always the first ID in the producer's ordered `run_ids` selection.
4. Optionally select alternatives on that baseline's original grid. Move alternatives up or down to set their retained report order.
5. Select the completed NDR and/or SDR models shared by all chosen runs.
6. Inspect the original run table: parent status, completed model, actual execution version and fallback basis, and whether the original watershed registry output exists. **Open run** uses the ordinary native-run detail.
7. Choose **Preview original stage selection**. The producer verifies the original cohort, geometry prerequisites, observed producing source version and registry bindings. It returns the deterministic report identity.
8. Choose the presentation: render PDF/HTML now, or retain the complete scientific source and tables for later rendering. When the installed producer advertises original process figures, the optional figure control retains that explicit choice in its scientific selection; selected SVG figures still use the scientific renderer.
9. Choose **Build process report**. The original queue retains that exact selection and preview identity before work begins.

A single baseline is a complete report. It contains quantities and per-quantity support; the alternative-change tables have zero data rows. The preview's **Selected native stage files** count covers the chosen stage registry files, companions and arguments. It is not the size of the final package: the report also retains original grid geometry/mask, parameter profiles, scenarios, biophysical tables and implementation sources.

Preview and build compare normalized selection values with object keys in canonical order, preserving ordered run/model arrays. The actual server's sorted JSON and the producer's explicit `include_figures: false` default therefore retain the same selected identity. The queued request uses the complete normalized `preview.selection`.

The client does not infer producing versions from the requested run declaration. Preview delegates to the maintained producer, which verifies the original completed stage or observed runtime module. Requested legacy metadata alone cannot satisfy its original 3.20 process-unit contract.

## Read the original result

The completed task exposes **Open original process report**. Saved CLI reports appear in the same desk's report list. The result keeps:

- The exact baseline and alternative order, original grid, profiles and scenarios.
- Producing model versions and their source basis.
- Each selected stage's completion time, retained reuse provenance and registry file/companion count.
- Actual operation state and phase, completed stage-analysis count and any original error.
- The imported scientific source collection and source ID.
- The original rendered PDF, HTML, Markdown and structured report data.
- Original quantities, support, change and paired-support CSVs.
- The complete source recipe, process data and scientific identity.

The PDF opens through its ordinary verified file ticket. All other files remain available as original downloads. Use the complete ZIP when opening the HTML report with its relative source links.

### Original table inspection

The desk provides four tables without changing their scientific values:

| Table | Original contents |
| --- | --- |
| Watershed quantities | Native watershed masses and explicitly derived quantities |
| Original finite-cell support | Original and reconstructed totals, valid cells, area and per-quantity coverage |
| Native watershed changes | Alternative-minus-baseline changes in native watershed quantities |
| Same-cell changes and coverage | Baseline/alternative intersection, paired masses and coverage differences |

Each page shows up to 100 original rows. Model, run and watershed filters apply only where that original CSV has the corresponding column. The full CSV download remains unchanged by these view filters. Table headers and values are displayed as recorded; blank unavailable values remain blank.

Native watershed masses and reconstructed pixel-centre masses have different support and remain separately labeled. NDR nutrient values use kg/year; SDR values use metric tonnes/year. Per-hectare raster values are converted once by the producer's observed pixel area. No additional calculation or aggregation occurs in the desk.

## Continue or reopen

The producer keeps verified checkpoints for original file transfers, each model analysis and each baseline/alternative support analysis. Use the existing task's **Resume original selection** to retry that same queued request after interruption. Its preview identity remains a guard against silently changing the executed native source.

A report that imported its scientific source before a rendering failure can still show that original source, its exact CSV tables and original source companions. Failed or interrupted build tasks expose **Open retained process state** only when that report was actually created and its original identity/source validate. A preview rejection that created no report has no fabricated result link. **Preview and continue original report** returns its exact scientific selection to the form. Preview again and build to continue the original producer or create a distinct current edition when its native execution or implementation has changed.

Draft selections, selected result/table and the queued operation identity are retained per Workspace in the browser. The original queue and report directory remain authoritative across browser restart. Navigating to another saved result does not let an older task completion replace that deliberate selection. Switching Workspace or detaching the desk invalidates outstanding UI reads. A submission that completes after detachment is recorded under its original Workspace.

## Add to a retained scientific delivery

The process report is already a typed original source, with `metadata.report_schema = "upstate.observed-report/v1"`. It appears in the ordinary ordered scientific-report selector.

For an existing delivery:

1. Open the saved process report.
2. Select the desired saved delivery under **Continue with this scientific source**.
3. Choose **Open delivery with this report**.
4. Review the ordinary delivery form and submit through its existing workflow.

The backend reads that delivery's actual retained selection and calls the producer's `attach` function. Earlier scientific reports keep their original order; this exact new source is appended once. The compatibility primary selector remains the first source. The old aggregate report binding is removed so the original delivery engine binds the complete new source set.

The UI waits for the actual imported collection and source entry to be visible in the selected Workspace before opening the form. A Workspace change cancels that handoff. Full map-delivery prerequisites remain enforced by the existing form. The standalone process PDF and source package are available for a single model or baseline without requiring a full map-delivery cohort.

## Export the complete source-linked report

Choose **Export complete report and original sources**. The existing queue produces a retained ZIP and supplies its normal verified download. It contains the complete original process-report file inventory, with the producer's directory hierarchy unchanged:

- `report.html`, PDF and other formatter outputs;
- Original report recipe and source manifest;
- All four CSVs and structured process result;
- Original grid, native vector/raster/sidecar, argument, profile, scenario and parameter-table companions;
- Calculation implementation and verified analysis checkpoints;
- The original operation record and `NATIVE_PROCESS_PACKAGE.json` with each member's byte length and SHA-256.

Large originals are streamed into the ZIP and verified during copying. The package identity binds the report, exact member inventory, source selector and operation record. Repeated export reopens the verified completed package. The same Workspace retains both report and package for its ordinary full archive/independent receiving workflow.

The operator's build and package actions hold the original Workspace archive lock during writes, preventing an ordinary backup from capturing a partially written operator product. The producer's own original operation lock still protects its analysis checkpoints.

## Registered API

| Method or queue action | Purpose |
| --- | --- |
| GET `/api/native-processes/catalog` | Original completed-stage catalogue and retained report summaries |
| POST `/api/native-processes/preview` | Producer preview for `{selection}` |
| GET `/api/native-processes/report?id=...` | Saved original report, execution details and ordinary file tickets |
| GET `/api/native-processes/table?id=...&table=...` | Original CSV page; optional model/run_id/watershed/offset/limit |
| POST `/api/native-processes/delivery` | Read saved delivery and append the exact report source |
| `native.process.build` | Queued `{selection, expected_preview_id, render}` through the original producer |
| `native.process.package` | Queued `{id}` complete linked package |

All routes are registered in the existing extension registry. Read-only preview does not enqueue calculations. Build and package use normal write authorization, existing task attempts/resume and original request identity. Source and output paths resolve only within their retained scientific scope.

The controller additionally exposes `createForRun({run_id})` and `openSaved(id)` through the existing `openDesk` bridge, so another maintained native workflow can open this desk with its actual original run or saved report. Completed task navigation already uses that bridge.

## Actual receiving continuation

Use the same native Workspace and producer operation that already owns the completed original stage. Receive these operator sources alongside the producer's merged source and restart the operator in its existing GIS environment.

Open the completed stage through the desk, preview its one-run NDR or SDR selection, build the original report, inspect the original PDF and quantity/support CSVs, export the complete source-linked ZIP, and reopen the saved result. When the existing native course has a compatible saved delivery, append the report through its ordinary form. Preserve the actual Workspace, native run, stage and task IDs when returning the result or first exception.

For a complete source/engine description, see [Native process quantities](../model/NATIVE_PROCESS_QUANTITIES.md).

## Complete application component

The owned `integration/component_fragments/native-process-reports.json` declaration selects all five operator files and the original three producer files, with the maintained `core` and `observed-context` dependencies. Receive this fragment with those actual source bodies. The merged component-fragment loader composes it with the current shared application catalogue and validates the complete local dependency and resource closure. The shared baseline catalogue remains owned by its current maintainers.

## Continue in the saved scientific-report composer

A saved process report with its verified original source opens the maintained standalone Scientific Reports composer. These choices are available for completed reports, source-only products, and scientific sources retained before a rendering failure.

- **Open this report only** replaces the composer's selected sources with this exact process source and uses its report title.
- **Add to current report** preserves the existing ordered draft and nonempty title, appending this exact source once.

The desk waits for the original source collection and entry to be visible in the captured Workspace, then calls `openScientificReport({workspace_key, sources, title, selection_mode})`. The mode is explicitly `replace` or `append`; original source IDs come from the verified saved product. A different result, Workspace or detached desk cancels a waiting handoff. The existing composer additionally preserves a draft edited while replacement is waiting for its source catalogue. Use the normal current preview, render queue, saved scientific edition, exports and independent reopen workflow.

Receive the current shared `app.mjs`, `source_reports.mjs` and `source_report_editions.mjs` selection-mode contract with this desk through the existing complete application. The optional composer capability controls whether these actions appear. The process producer, report queue and mapped-delivery action retain their existing behavior.

In the same original native receiving operation, use a populated saved process result and an existing composer draft with another source. Operate replacement and addition, repeat addition to confirm one source entry, and reopen the original result. Also operate a source retained after interrupted rendering. View the exact outgoing desktop/screenshare and 390-pixel screens, open the PDF/HTML, export and extract the complete source ZIP, and reopen its deliverables and working project. Fix visible defects in that actual product.

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

## Current owner demonstration direction — 2026-10-13 10:30 UTC

Original coordination message: https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791887422395359 . The following complete instruction is retained for the workers receiving this application.

BRYCE CURRENT DIRECTION — ECOSYSTEM MODEL / DEMO / PRESENTATION. Pass this complete update into current worker assignments and onward handoffs; the feed is moving quickly.

Exact new owner instructions:
“do the simulated model”
“just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it”
“and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast”
“just checking dont pause anythi g”

Implementation direction:
• Tim/Ecosystem already publishes GIS, watershed/environmental modeling, data analysis, map/report publishing and natural-capital decision-support work. Do not assume a tools/capacity gap or pitch generic GIS as novel. Build a concrete production workshare he can compare with his existing workflow; prime retains scientific direction/method choices/review/client relationship.
• Center the demonstration on THIS UpperSavannahRFP: actual geographic/source shapes,30mgrid, upstreammodeldomain vsSCreportingmask andutilityfocus, clearlysimulatedrealisticinputs, nativeInVESTNDR/SDR baseline+restoration+matchedcontrol, annualN/Pkg/year andsedimenttonnes/year reachingstream, meaningfulcomparison/maps/report, editableparameters/sourceeditions andexport/coldreopen. Keep load/concentration and stream/intake distinctions correct.
• Actual simulatedmodel execution and the connected usable product are the hard priority. Runtime/source existence or another plan is not the run. Preserve already-running jobs andonewriterperWorkspace; use existingequippedruntime or provision an isolated actualexecution environment when needed. Root has explicitlytakenactualexecution; otherbuildscontinue.
• Make relevance and speed visible through what Tim can USE: chooseinputs/assumptions→run→inspect differences→revise→hand over work his team can continue. Show actualproducedartifacts and real elapsedhistory; no inventedtimings/guaranteedreaction. Avoid stockscreen/decorativepitch/demo-onlytheatre.
• Open/look/use finalproduct and ALLattachments asrecipient, fixobviousdefects, naturalgenerativeTTS/mediaifused, actualapprecordingratherthan generatedscreenspretendingexecution. No review/testtheatre or substitutionforhardbuild.
• Cascade thisdirection to otherEcosystem/product/model/report/presentationpeers atnextsafemessageboundary; persistindurablecurrentworkorders/startupguide andincludeversion/pathwithnextsubstantiveresult. Don'tstopactivecalculations, restartheld/deletedtasks, spawnanothercontroller oraskBryce torelay.
No bid/prime-yesgate or arbitraryproduct/featurecap. TODAY10a.m.Eastern/14UTCcutoffremains. Existingfocusedvalidation,noPrivateGitHub/Actions,labattribution,contact/meeting/spendcontrols remain. SharedGitHubcurrentownerbrief landingunderopportunities/upstate_forever_2026; Rootwillreturntheactualpath/head.

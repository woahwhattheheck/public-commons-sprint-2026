# Source-selected development and protection scenarios

TokenJunkie Labs · Eco scientific operator · original WO17 continuation

## What this adds

Open **Source-selected land changes** in the existing scientific operator. Select retained parcel, planning or other polygon-source editions; choose the original feature IDs; write explicit land-cover conversion and protection policies; inspect their native footprints; and run the resulting scenarios with each selected original baseline profile.

The original **Future disturbance** desk remains available for its distance-to-stream designs. This desk authors changes from explicitly selected source features. A parcel boundary, planning designation or ownership attribute is source context. The operator supplies the counterfactual conversion policy and its scientific reason.

Every case uses the existing scenario/footprint machinery and native model queue. It preserves the original grid, profile, biophysical coefficients, source files and completed baseline. Nitrogen and phosphorus are annual kg delivered to streams; sediment is annual tonnes delivered to streams. Read each quantity on its own valid support.

## Design a study through typed controls

1. Open the original scientific Workspace and choose **Source-selected land changes**. The catalog reads that project's retained sources, completed baseline runs and earlier studies.
2. Choose **New study**. Enter a title, purpose and source references. Select the completed baseline profiles to compare. The model checks that they use the same original grid and baseline scenario type.
3. Add a named case with its scientific reason. Add one or more ordered land-change patches to that case. Enter the patch label, reason, original land-cover codes and destination code.
4. Choose the retained conversion source edition. If it has several layers, open **Choose source features**, select the actual layer and open it. Feature selection uses the original Fiona feature IDs. Business identifiers and every original attribute are displayed as context.
5. Select features across the paginated inventory. **Filter this page** affects the current page only. Previous and next page controls preserve all selected IDs; the complete selection is visible separately. No unvisited page is implicitly selected.
6. Choose **Convert selected eligible cells**, or choose **Convert selected cells outside protected features** and add one or more retained protection sources. Select the protected source features explicitly.
7. Add the other cases and patches. Patch order is scientific input and stays in the saved selection. Use **Move case up/down** and **Move patch up/down** to change the explicit order. The optional complete-selection editor also preserves the full native declaration.
8. Choose **Prepare footprint preview**. This explicitly saves or reuses derived source masks, scenario records, native run selections and footprint records. It performs no native model solve. Review the original source editions, grid, case/profile roster, area/count tables and ordered land-cover transitions.
9. Choose **Save original study** to bind this exact selection and footprint plan to the original queued operation. The working copy becomes frozen. Use **Separate editable copy** to change a saved design while retaining its earlier history.

The footprint preview computes binary masks on the actual model lattice using the original cell-centre rule (`all_touched=False`). For protection, the effective mask is the selected conversion mask with protected cells excluded. A wholly protected selection can produce a zero-change case. Source polygon area in hectares and grid-cell area in hectares are shown separately. Counts distinguish selected, valid, nodata, excluded and eligible cells. Ordered native footprints retain the actual class transitions and final classes for each original profile.

## Run and compare

Choose **Queue remaining original cases**. Each prepared run is admitted through the existing `run.start` action. Completed runs stay attached to their original identities. A run already represented by an original saved request is read or resumed through that request.

Use **Native task and logs** for the original progress, logs, interruption and resume controls. **Read original result** recovers the exact task result after a lost browser response. A retry uses the full retained original request and operation ID; an interrupted task uses the existing task-resume action.

Once all native cases complete, refresh the saved study and choose **Create or reopen complete report**. Read **Modeled annual change** for the case, baseline/profile, artifact, exact original units, alternative-minus-baseline change and valid support. Expand an original comparison to inspect its complete source record. The report downloads include their explicit original file labels and sizes.

Model outputs describe the authored scenarios. Interpretation remains tied to the selected source editions, grid, coefficients and assumptions. These calculations do not establish the probability or timing of development.

## Retain and reopen work

The browser saves the complete selection and exact original command history to IndexedDB. Each write compares the prior revision within one transaction. If another tab saved first, the visible draft remains available: download it, save a separate copy, or explicitly reopen the other tab's version. No tab silently replaces another tab's revision.

**Download working copy** retains the selected original source/layer/feature IDs, all policies, baseline choices, optional full input, original requests and received results. **Open working copy** checks the project and re-reads its original operations. It preserves the imported file's original text and metadata with the new local copy. The working copy is an editing and operation-history document.

Use **Prepare editable Study** to open the existing Study desk with this original source-selected study root. Its standard preview shows the retained grid, scenarios, profiles, source files and run dependencies before the existing Study export action. Open the resulting selected Study through the normal receive controls.

Use **Transfer complete editable project** for the retained GIS/source bodies, masks, scenario records, native outputs, report files and full scientific project. That invokes the existing project-transfer workflow. Reopen the delivered project before opening its browser working copy. The model's workspace verifier checks each saved source-selected study as part of the existing extension verification.

## Original implementation

- `model/source_disturbance.py`: retained source selection, polygon masks, scenario/footprint preparation, run roster, native comparisons, report and project verification.
- `operator/source_disturbance.py`: authenticated catalog, source-feature pages, footprint preview, study/result reads, exact queued-operation recovery and report-file transport.
- `operator/web/source_disturbance.mjs`: typed authoring, source-feature selection, native task controls, footprint/result tables and complete working-copy lifecycle.
- `operator/web/source_disturbance_storage.mjs`: complete-copy validation and transactional revision storage.
- `operator/extensions/source-disturbance.json`: original operator registration, routes, actions, view, assets and workspace verification.
- `integration/component_fragments/source-disturbance.json`: complete application-source assembly membership.

Source reads and actions use the existing authenticated workspace and task queue. The report preview route serves only members of the retained report inventory, with script execution disabled. Full task recovery checks the original workspace, action, payload, operation identity and project before using a result.

## Continue the original receiving course

Use the existing restored scientific project, operator process, native runtime and browser operation. Select actual retained polygon sources and completed baselines already in that project. A source-selection working copy is sufficient to specify the chapter; retain its exact selection with the existing receiving state.

Operate the typed controls to select at least one development case and its source-protected comparison. Inspect the footprint area, excluded-cell and transition tables before native execution. Run the original prepared cases; inspect completed native maps and the annual quantity tables; create and open the actual report and its downloaded files. Download the complete working copy, reload the browser, reopen it and read the original operations. Transfer the complete editable project through the existing workflow and cold-reopen it, checking that source features, selected cases, original runs and report files remain usable.

Carry `CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4` and the current application instruction files. Before presenting the outgoing application or any attachment, the responsible producer must open/run/render that exact version, LOOK at the real result and operate its important controls. Inspect actual screenshare and narrow widths, populated/empty/loading/error states, downloads and reopening; repair any broken or unreadable result. Use the existing receiving operation and retain its exact source/version and observed outputs with its original handoff.

## Native receiving entry point

After the selected original cases and report are complete, the existing equipped receiver can run the maintained receiving chapter with its own unchanged Python runtime:

```bash
python -B APPLICATION/source_tools/receive_source_disturbance.py \
  --workspace ORIGINAL_WORKSPACE \
  --study-id ORIGINAL_STUDY_ID \
  --operation-id ORIGINAL_RECEIVING_OPERATION \
  --output EXTERNAL_RECEIVING_DIRECTORY
```

Replace each placeholder with the actual existing operation's absolute application, Workspace and output paths and original saved study ID. Keep the output outside both the source Workspace and application directory. The chapter reopens the original report and GIS members, replays its retained report operation, makes or resumes the complete Workspace archive, restores it into its existing receiving directory, and invokes the copied application's reader to verify cold reopening. It also exports the selected editable Study through the maintained Study transfer, cold-receives its full dependency closure, replays its original report request, and reopens the exact received Study with the copied application. It starts no new model calculation. Its retained intent and results support continuation in the same output directory.

Open the resulting report, raster and vector files and selected Study in the existing browser/GIS viewers. The native reader and the human-facing application inspection are complementary steps in this same receiving operation.

# Save and hand over an unfinished Climate Management design

TokenJunkieLabs · Ecosystem Sciences  
Owner direction: `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`.

A scientist can now save a named Management comparison before completing its period labels, scenario-role mapping, scientific question or native cases. Open **Management across forcing → Working design**, enter a design name and author, and choose **Save working revision**. The original raw controls are retained, including blank fields, original period order, the explicit reference period, each reference/treatment/control study-and-case pair, selected reporting sources and the difference-map checkbox.

This continues the existing Management desk and its native Workspace. Saving or opening a working revision starts no native model and builds no comparison. The ordinary **Preview comparison** and **Build this comparison** remain the scientific validation and calculation paths. They require the original completed compatible cases and common finite support already defined in `CLIMATE_MANAGEMENT.md`.

## Work normally, retain revisions

1. Select original forcing cases for the roles you know. The menu shows their actual state; an unfinished case can be mapped into working material. It must complete before scientific preview.
2. Enter a design name, author and revision note. Save even while other controls remain blank. Names and attribution must be nonblank; scientific content may be incomplete.
3. Continue editing, then save another revision. A save pins the last known series head. If another user saved that branch first, reopen that head or explicitly choose **Save as new branch**. No user's revision is overwritten.
4. Open an earlier revision under **Open saved designs, original revisions and browser recoveries**. It restores that revision's exact fields. Saving on an earlier stale head is rejected; branching is explicit.
5. **Download unfinished recovery** preserves current fields, attribution, selected original history and any pending original save request. **Export complete saved history** creates native downloads of the full ancestor history and selected raw draft. The original task page exposes both files.
6. **Export editable working Study** selects the actual `climate-management-working` revision in the original Study desk. Preview and export there, using the ordinary archive queue and receiving path.

Local browser storage remains a convenience. The named native revision is the durable original record. A history JSON contains immutable study identities and reporting collection records; it does not embed the large raster/source objects. Use the selected Study or full Workspace archive to transport those bytes.

### Scientific report lineage

If the unchanged fields match an opened saved revision, Preview sends its exact `working_origin.revision_id`. The native Management model independently normalizes that saved raw draft and compares it with the submitted scientific selection before accepting the origin. Changed fields must be saved as a new revision before scientific preview on that branch. An imported history must first be saved as an explicit new branch.

A completed report keeps that original working revision and all ancestors in its selected Study closure. Reports made before working designs existed remain valid and have no invented origin. Opening a completed report restores its scientific fields into a fresh editable working series; the report's immutable original origin remains in the retained report.

## What the original bindings mean

Each selected role pins the complete immutable original Climate forcing study identity from its `selection.json`, and verifies that a nonblank case ID names its original baseline or declared case. A blank case with a real study still retains that study; a blank study has no invented native binding. Reporting choices pin their original source collection records and exact selected source IDs when present.

The saved design does not freeze a mutable latest-report pointer or a case's running/completed status. Finishing an original case therefore does not invalidate the scientist's saved design. On explicit open/import/receiving, every selected immutable study identity and reporting collection must still match. No similarly named source, scenario or case is substituted.

The selected Study visitor includes every ancestor working revision, each referenced original forcing family through its existing visitor, all planned source editions and native inputs, original reporting-source companions, and whichever scientific outputs were captured by the original family's transfer rules. Existing capture-time receipts and original owner locks remain authoritative. A later unrelated report or receipt is not discovered during replay. A working Study may contain pending native cases; receiving preserves them without dispatching a solver.

## Compare two saved designs

The same desk now offers **Compare saved working designs** for exact before/after revisions, including unfinished choices and explicit branches. Save a readable HTML/CSV/JSON/ZIP handover and export its complete editable Study without a scientific calculation. See [Compare and hand over saved Management designs](CLIMATE_MANAGEMENT_DESIGN_COMPARISON.md) for original APIs, alignment semantics and the same receiving course.

## Native CLI and original Operator API

Use the same complete application and existing Workspace. No command creates a replacement Workspace:

```bash
"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" list

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" --output "$OUTPUT/saved-working.json" \
  save --request "$ORIGINAL_SAVE_REQUEST"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" --output "$OUTPUT/opened-working.json" \
  open --revision "$ORIGINAL_REVISION"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" export --revision "$ORIGINAL_REVISION"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" preview --revision "$ORIGINAL_REVISION" \
  --selection-output "$OUTPUT/reviewed-management-selection.json"
```

The save input is the actual original queued payload, or an unfinished recovery retaining that pending request. Preserve request and series IDs on retry. A new revision uses a new request ID and its actual prior revision as parent. A fork uses a new series ID, `parent_id:null` and the original `forked_from` revision; imported histories also carry their complete `imported_package`. No runtime-ready or solver dispatch is hidden in these commands.

Native queued actions:
- `climate-management.working.save`: full attributed raw-design request.
- `climate-management.working.export`: `{revision_id}`.

Read routes:
- `GET /api/climate-management/working-list?workspace=...`
- `GET /api/climate-management/working-view?workspace=...&id=...`

The existing catalogue/state now includes `working_designs`. Native item kind and selected Study root are both `climate-management-working`. The existing desk exposes `openWorkingRevision({workspace_key, revision_id})`; the Study catalogue and dependency preview use this method. Original file tickets verify opened native downloads.

## Continue the original receiving course

This is part of the original Climate2171/3403/6080/9417 application, alongside the complete native and browser course described in `../source_tools/CLIMATE_MANAGEMENT_RECEIVING.md`. Preserve its actual project, accepted task and source identities. Do not start another climate solve just to exercise working designs.

At a quiet boundary in the actual retained Workspace:

1. Open Management and map actual retained role cases. Leave one label or treatment choice blank deliberately, preserving the known originals. Save a named attributed revision. Read its exact ID and raw draft from the original working-view route.
2. Edit the original design and save a second revision. Open the first, inspect the complete ordered history, and explicitly fork it. Verify both original revisions remain intact and a stale-head save cannot overwrite the second.
3. Download the unfinished recovery and both native history/draft files, open and inspect them, and import the complete history as an explicit new branch in the same actual source environment. Reconcile a retained original save request once and confirm the native revision ID is reused.
4. Export that actual working root through the original Study desk, including its source/native dependency closure. Download the complete archive; receive it through the existing upload/restore queue into a distinct location. The project identity, original working revision/package IDs and all named source bindings must remain exact.
5. From a copied complete application, open the received Study's working-design button. Check all period/role fields, unfinished values, original case identities, attribution and ordered history. The full original source companions must remain independently openable.
6. If the selected cases already completed, finish the missing fields, save a new revision and preview using its working origin. Build through the original Management queue only if that exact comparison is part of the existing authorized course; reuse any completed original comparison. Its selected Study must include the working origin and ancestors. Existing scientific report/figure/PDF/GIS inspection continues unchanged.
7. Compare the original native run count and completed run bytes before/after the working-only sequence. Saving, history export and Study receiving must not add a native run.

Record actual task IDs, revision IDs, selected-Study archive identities and any first precise exception in the same original course. Source review alone is not native receiving completion.

## Complete source and actual visual use

The maintained `climate-management` component includes this guide, the native working model/visitor, CLI and same-desk browser helper. Its existing `climate-forcing` and `study-transfer` requirements carry the original source family and archive engines. The shared Study model and browser joins must travel with the complete application. Preserve compatible newer shared source; use the maintained assembler's exact guards rather than replacing unrelated modules.

Before presenting the outgoing application or attachments as ready, the producing worker must open/run the exact delivered edition, personally LOOK at desktop and 390-pixel views, operate save/open/fork/import/retry/Study navigation, inspect loaded/empty/error states, and open every delivered history, raw draft, archive, scientific report, map and project in its normal reader. Capture and actually view the resulting screenshots; counts, successful HTTP or source review do not replace observation. Repair clipping, lost fields or unusable controls in the authorized product. Preserve TokenJunkieLabs attribution and current owner controls. No native or rendered acceptance is asserted by this guide.

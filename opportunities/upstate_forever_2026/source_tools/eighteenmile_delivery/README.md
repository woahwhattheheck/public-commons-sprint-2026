# Eighteenmile original monitoring and editable fieldwork delivery

These additive producers join the existing native Eighteenmile outcome to a readable offline source desk and the application's original editable fieldwork workbench. They do not replace any native numerical method, report formatter, plan store or source importer.

## Open the delivered work

The original laboratory plan is `eighteenmile-2023-original-lake-samples`, revision 2, in project `dc92b8b9-6eda-4362-b12d-3cf2ef6c9007`. It retains 88 original observations and 48 visits. Its saved outcome is `49e01b0b18aed62f15b78e061d96fc594cabf625d101278304ae84da401dfe8c`.

`START_HERE.html` contains the historical comparison, original figures, searchable selected records, full original-row inspection and embedded native CSV/JSON/ZIP downloads. The companion two-page PDF presents the same native values. The complete delivered application/Workspace ZIP retains the source collections, both original fieldwork plans, the saved native comparison and the original report files.

`Eighteenmile_Editable_Field_Plan.html` contains the complete original offline implementation workbench with the retained laboratory plan already loaded. Its shortcuts open laboratory results, field visits, sites and handover. Use the original filters and export controls; export JSON to retain a portable editable copy. Browser edits are separate from the native project until explicitly imported. The existing workbench manages its browser copies; the preparer adds no separate data model or storage engine.

## Produce from the retained original outcome

Run from the received scientific application environment, with absolute paths to its Workspace and the saved native result JSON:

```sh
python deliver_implementation_outcomes.py \
  --result /absolute/native-result.json \
  --workspace /absolute/received/workspace \
  --output /absolute/new-reading-desk
```

The producer reads and verifies every retained native report member and its original file identity. It emits the reading desk, unchanged native report directory and ZIP, explicit selection JSON, and `rerun_selection.py` for deliberate native calculation of a new selection. Supply a new output directory; previous delivered editions remain intact.

This reading desk is intentionally bound to the original April-June versus July-October 2023 SV-838/SV-840 selection and its two analytical methods. It is not a generic narrative for other selections. The native selection and all measurement values are read from the saved result, not recalculated in presentation code. The 57 selected records include 54 quantified and 3 censored results. The overall 15-date shared union does not imply identical support for both series.

The periods occupy different calendar months and have no recorded management event. The interval endpoints preserve original reporting-limit support; they are not confidence intervals. Microcystins/nodularin has a study-station change interval spanning zero and a distinct paired contrast that omits the missing October 17 reference. All original numerical outputs and units remain attached to their source rows.

## Prepare the original editable workbench

```sh
python prepare_field_editor.py \
  --application /absolute/received/application \
  --plan /absolute/original-plan.json \
  --output /absolute/new-prepared-editor
```

The supplied application's `operator/web/implementation_workbench.html` and `model.implementation_schema` are authoritative. The native plan validator runs before packaging. The producer embeds the original plan and opens it through the original JSON importer. Existing browser copies are continued through the maintained `openPlan` API. The original-edition button also uses the existing importer, retaining its normal draft handling.

The selected original template used for the completed delivery was 196,491 bytes, SHA-256 `2b1634a7f61e223d893f5009b3bd2c47413ea25f3c388322793d57412d1bb3e5`. The producer records the actual supplied template identity rather than overwriting a newer application. The wrapper adds readable phone tables and focusable horizontal regions; original result controls and source records stay unchanged.

## Return a deliberately edited plan to the native project

Use the actual current revision of the receiving plan as the optimistic-concurrency expectation:

```sh
python receive_prepared_field_plan.py \
  --application /absolute/received/application \
  --workspace /absolute/received/workspace \
  --plan-json /absolute/browser-return.json \
  --expected-revision 2
```

The original `ImplementationStore.import_document` owns validation, conflict handling, history and revision allocation. An existing newer plan is not silently overwritten. The receiving helper prints the actual status, applied revision, document digest and record counts.

## Completed use and source continuity

The exact delivered original comparison was executed in cloud Linux and independently reopened through its bundled application's source. Desktop and 390-pixel reading desk, both native SVGs, both PDF pages and downloaded native report ZIP were opened and viewed. The phone comparison intervals were repaired to remain fully visible.

The prepared original editor was opened with all 88 observations. Its six censored records were filtered and exported with their source context. Desktop and phone field/result views were used and inspected, including keyboard table scrolling. An unchanged original JSON export matched the original plan. A description-only edit was exported through the browser, imported into a fresh browser, then received by the original native importer in a separate restored project as revision 3. All scientific/source collections and the retained revision-2 digest stayed unchanged; the revision-2 outcome reopened. Browser-origin storage persistence is distinct from this completed portable export/import course.

The scientific report/briefing/crew source composition is a separate ongoing continuation of this same original project. These additive helpers do not install, replace or impersonate that source family. Keep active native calculations and their current source owners intact.

## Active producing direction

Carry the complete included `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, with this source handoff. Its canonical path is `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`. Preserve the October 13, 2026 14:00 UTC cutoff and the active geographic native modeling priority.

Before presenting a changed outgoing edition, open and visually inspect that exact populated product and its attachments, use the important controls, export and reopen. Apply focused repairs directly; reuse accepted unchanged results rather than running broad suites or repeated checks. Preserve the project-level owner instructions, source/copyright attribution, contact controls, active compute and concurrent source changes.

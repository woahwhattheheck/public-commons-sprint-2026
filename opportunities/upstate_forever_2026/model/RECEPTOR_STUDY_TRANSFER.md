# Transfer an editable source-water study

The existing **Source-water areas** desk now offers **Transfer editable study** for each saved original watershed network, prepared source area, source-water programme, experiment comparison, receiving-area inventory, and scientific geography report source. The action rereads the exact saved record in its original Workspace, then opens the maintained selected-study desk. Its normal preview shows the native records and complete files before the existing export queue creates the portable archive.

The complete source-results ZIP remains available for reading and GIS reuse. Editable Study transfer additionally retains the original Workspace records and native dependencies needed to reopen and continue the scientific work.

## What travels

| Saved selection | Original editable continuation |
| --- | --- |
| Watershed network | Exact retained source body, original profile and drainage links, HUC12 memberships, geographic view, and original source references |
| Prepared source areas | Original network, ordered receiving areas, unchanged polygon sources, source collection, and original scenario-area handoff |
| Source-water programme | Prepared areas, original grid/profiles/scenarios, the paired experiment, original compute-programme selection/progress, and exact native run identities |
| Experiment comparison | Original experiment and complete retained case snapshot, completed receiving-area inventories, native run cohort, original GIS products and producing-model provenance |
| Receiving-area inventory | Original baseline and alternatives, original geography sources, native grid and profiles, and any selected native map delivery |
| Scientific geography report source | Original recipe and all unchanged companions, frozen network/preparation product records, original source capture, and editable same-project source records |

The original compute-programme continuation retains its read-only validated programme and progress records, completed comparisons, delivery references, source-stage donor runs, and saved matched-pair child programmes. A received programme continues through the existing native programme controller. Transfer does not prepare a new model run, recalculate quantities, infer a profile, or change the original run state.

When **Include related results** is enabled in the selected-study desk, the closure also follows saved preparations belonging to the chosen network; saved land-cover scenarios and source-water programmes belonging to those preparations; and source-water comparisons and inventories whose original experiment or complete native run cohort is already selected. The preview names the added records. Disable the option for only the requested records and their required dependencies.

## Saved scientific report editions

A source geography report is recognized by its explicit original source scope, report schema, source ID and URI, and its frozen provenance record. The transfer helper compares every declared recipe input and original companion against the retained CAS bytes. It also verifies the captured network and optional prepared-area result records and their complete product inventories.

For a source from the same original project, the saved edition follows those original editable records and the original producer source collection. An equivalent reimport in another source collection is accepted only when its body, companion paths, byte counts, hashes, URI and producer metadata match. A report from a different original project remains a complete self-contained source package; its foreign IDs are not looked up as local scientific records.

This join is called only by the maintained saved scientific-report edition resolver. Ordinary source imports retain their existing dependency policy.

## Restore and continue

Use the existing selected-study export, transfer or original portable restore. After restore, open **Source-water areas** to inspect the saved network, prepared areas, programme and result inventory. Prepared areas still open their original scenario tools; a source-water programme still opens its exact native programme; saved comparisons retain their original case snapshot and GIS files.

Original `.network.lock`, `.prepare.lock`, `.batch.lock`, `.inventory.lock` and `.report.lock` boundaries are used during capture. Compute-programme capture also observes the original programme, execution and control locks. File contents and directory inventories are checked by the maintained Study transfer writer. Reading the closure does not materialize source views or rewrite report records.

The retained network describes original upstream HUC12 relationships. It does not imply that a geography-only report contains modeled pollutant quantities. Physical inventories continue to identify their original baseline, alternatives, grid support, annual units and producing model versions.

## Saved projected-map editions

Original R8 reports retain their complete source geography. R9 reports with maps additionally retain the original projected SVG figures, figure specification, geometry-reader inventory and the exact renderer source bytes. The transfer checks the version 2 identity, original native runtime declaration, selected network and prepared areas, ordered figures and every map companion against the original saved capture. Receiving reads those artifacts without re-rendering the maps or requiring the former GIS runtime to be installed. The editable original records keep their source identities.

The common report-source receipt limits restored archives to the editable source histories originally captured for each source pair. An older archive can therefore reopen its retained ordered report and companion bytes without unexpectedly requiring later-added producer records. A new explicit selection follows the complete current typed source history.

## Component integration

The additive helper is `model/receptor_study_transfer.py`. Its public contract is:

- `ROOT_KINDS`, `DOCUMENTS`, `LOCKS` and `LABELS` extend the original selected-study catalogue and record resolver.
- `visit(closure, kind, key, value, reason=None)` validates the six original source-water record families and the original `compute-programmes` continuation.
- `related(closure)` follows only explicit native source-water relationships when related results are requested.
- `lock_paths(closure)` returns the original relative lock paths.
- `catalogue(workspace, kind)` lists saved records without creating native state.
- `include_source(closure, collection_id, entry)` verifies the original declared scientific geography source and records its binding through the existing report-source receipt.

The original native owners remain authoritative: `receptor_network_cli`, `receptor_scenarios`, `receptor_programmes`, `receptor_experiments`, `receptor_cli`, `receptor_report_source`, and `ComputeProgrammes`. The helper uses only their retained contracts and the original pure programme record/state validators.

The component fragment keeps the Receptors, native programme and Study transfer modules together in a cold application. The maintained source installer admits these files as an optional layer and checks the original dependencies when the shared core imports the helper. It preserves the existing mandatory Decision package and all previous preimage guards.

## Verification

The exact current original Receptor controller was executed in V8 with its transport and document interface stubbed. All six saved-result kinds handed the exact server-returned ID and title to the original selected-study desk. Checks covered a Workspace A → B → A change, detach while reading, repeated clicks, mismatched returned identity, and absent host capability. This is controller execution, not a browser or native scientific run. Actual receiving uses the existing authorized source-water operation and original export/restore queue.

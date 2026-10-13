# Editable source-water reports in selected Studies

A saved Source-water areas scientific report can travel with its original editable
watershed network and prepared intervention polygons. The selected Study uses
the existing scientific-report edition, original source store, archive writer and
normal receiving operation.

## Complete journey

1. Open the saved watershed network or prepared-area result in Source-water
   areas. Create its scientific report source. Projected maps are an explicit
   option; the source-only default preserves the original R8 product identity.
2. Use **Scientific report** on that retained result to open the existing composer.
   Save the rendered scientific-report edition, preserving its ordered original
   source choices.
3. Export that saved scientific report through **Study transfer**. Its selected
   source now retains the complete original report, network and optional
   prepared-area product directories, together with the prepared vector source
   collection. Original polygon bodies, memberships, profile, drainage links,
   report recipes, figures and renderer source remain in their recorded paths.
4. Restore the selected Study with the normal Workspace receiver and reopen its
   saved Source-water areas results. Prepared source areas remain available for
   the original scenario and native-run forms.

The transfer follows only the source-water report actually selected in the saved
scientific-report edition. It does not expand the Study to unrelated source-water
products or unrelated project runs.

## What the selected archive retains

| Retained item | Purpose |
| --- | --- |
| `receptor-report-sources/<report-id>/` | Complete saved source recipe, report, figures, original captured inputs and result record |
| `receptor-networks/<network-id>/` | Original polygon body, profile, drainage graph, memberships and complete network result |
| `receptor-scenario-areas/<preparation-id>/` when selected | Original per-area polygon subsets and saved preparation |
| Original report and prepared-area source collections | The same source choices used by the native desk and scenario forms |
| Typed scientific-report lineage in the existing Study receipt | Exact source identity, original project, product records and complete captured member descriptors |

The adapter reads source objects directly. It validates the original immutable
report identity, complete network and prepared inventories, recipe input hashes,
original source binding and prepared vector bodies. Staging holds the existing
report, network and preparation locks. Independent receiving resolves that same
typed lineage before accepting its receipt.

Original source data are copied from their retained products. The transfer does
not run a native model, recalculate a watershed, prepare replacement polygons,
rerender a map or change a saved scientific-report selection.

## Check the restored selected Study

From the received complete application, with its actual interpreter:

```sh
python -B -m model.receptor_report_transfer \
  --workspace ACTUAL_RESTORED_SELECTED_WORKSPACE \
  --report-id ACTUAL_SAVED_SOURCE_WATER_REPORT_ID
```

The command first uses the normal selected-Study verification, then independently
opens each requested editable report through `receptor_report_source.inspect`,
its network through the original network reader and its prepared areas through
`receptor_scenarios.inspect`. It returns the actual project, Study and report
identities, original source choice, source binding, prepared collection and
per-area HUC counts. No renderer or model installation is needed for this
receiving check.

The original regional receiving operation is
`ES-20261012-RECOVERY-SCIENCE-2329`. Its retained 217-HUC product has four ARJWS
and 32 PRWD prepared polygons. Use the actual report ID created by that operation
and its actual selected-Study restore path; the report ID differs when projected
maps are explicitly included.

The existing `source/observed-report-20261013/receive_operator.py --selected-study`
course remains the renderer, exporter and independent receiver. Add the command
above after its actual selected-Study restore. Full Workspace receiving remains
a separate complete-project check.

## Older and external editions

Earlier selected archives may contain the complete captured source files without
the editable product directories. They remain valid source-only editions. A
report imported from another project likewise keeps its complete original
capture and donor identity without resolving coincidentally equal local product
IDs.

New same-project archives that retain editable products record that relationship
in their normal Study receipt. Removing a recorded product or source collection
cannot turn such an archive into a successful source-only receiving result: the
actual lineage must still match the retained receipt. An incomplete local product
directory is an error, while an older source-only archive with no such directory
keeps its original reading behavior.

The optional receiving command requires a typed source-water receipt when an
explicit report ID is supplied. Older archives continue to open through the
normal receiver and their retained scientific source/report.

## Complete application installation

`integration/component_fragments/receptor-scientific-source.json` lists this
helper and guide for both the Source-water areas and Study transfer components.
The maintained dispatcher invokes `receptor_report_transfer.include_source`
only for each selected scientific source, and the existing Study staging code
includes `receptor_report_transfer.lock_paths` alongside its other producer
locks. Preserve all current peer callbacks when composing these two shared
joins. The existing complete application installer supplies the full selected
source tree and its normal source-store and transfer dependencies.

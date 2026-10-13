# Saved conservation plans → editable native scenarios

This is the current **Upstate** saved-plan adapter. It is separate from the earlier `eco_bridge.py` field-factor adapter. The original conservation module selects and records plans; this workbench edits geometry after receiving those original records. The original `Workspace` remains the only scientific importer, scenario writer and run preparer.

## Browser workflow

Start the normal editor, then choose **Import saved plan**. Select the complete `upstate.conservation-binding/v1` JSON produced by the original `model.conservation_bindings.bind_plan(workspace, plan_id, include_geometry=True)` operation. Choose the exact original geometry view: reporting portions by unit, whole selected units, reporting union, or whole-unit union. No alternative view is inferred.

The complete original binding bytes—including Unicode, JSON numeric representation and an optional UTF-8 BOM—are retained inside the immutable project baseline. Original selected string identifiers, including leading zeros, source-edition keys, native run/source descriptors, plan/study references, scientific contract and projected-plane hectares remain present. The original selected units are not reranked. Display geometry is the original consumer's WGS84 view; its source descriptors continue to identify the original native-CRS files and companions.

Create an alternative, edit its polygons, optionally draw new ones, exclude fields or add notes, and save. **All included polygons in the selected alternative** become the treatment footprint. The map's geodesic measurements describe edited display geometry; they do not replace the saved plan's projected-area fields. Edits can extend beyond the original selection: the exported original reference explains provenance, not a claim that the new geometry is identical to that selection.

Choose **Land-cover scenario** and enter explicit source and destination land-cover codes and a reason. The original model checks these against its retained raster and biophysical-table selection. Optionally provide actual saved grid/profile IDs and the original selected model names to prepare a native run. Numeric property edits are handled by the separate field-factor adapter and cannot silently enter this geometry/code path.

**Export complete native handover** writes:

- `design.geojson` and the unchanged parsed original `baseline.geojson`;
- exact `conservation-binding.json`, a complete independently editable `design-project.zip`, and `native-selection.json`;
- the per-file inventory and receiving guide.

The nested editable project reopens through **Receive project**, including its original binding, alternatives, notes and source properties. An independently received project gets a new editor ID; its sender is unchanged. Native model input objects remain in the original Workspace or its complete portable restoration, referenced by the original consumer. The design ZIP is not a replacement for that scientific Workspace archive.

## Current native receiving

From this source directory, use the original application and its retained Workspace:

```sh
python conservation.py receive conservation-design.zip \
  --native-source /absolute/path/to/upstate_forever_2026 \
  --workspace /absolute/path/to/retained-workspace \
  --revision-directory /absolute/path/to/retained-design-revision
```

The receiver validates the whole handover and asks the **original** `model.conservation_bindings.resolve_reference(workspace, reference)` to reopen the selected plan. Source references, selected-unit records, original asset descriptors and scientific contract must correspond before writing. It then retains the original files in a create-only revision directory. An identical interrupted receiving can be repeated; differing existing files are not overwritten.

The accepted original source manifest is `upstate.sources/v1`, with `captured_at`, `entries`, and scope. Its vector entry uses `role: SCENARIO_MASK`, source-relative `path`, SHA-256, `source_crs: EPSG:4326` and original companion paths/hashes. `uri` identifies this retained editor revision; `vintage` comes from that actual revision's saved timestamp. The native importer creates its own content objects and view paths. GeoJSON receives no invented layer name.

The receiver calls, in order:

```python
collection = workspace.import_sources(revision_directory / "sources.json")
scenario = workspace.save_scenario({
    "title": title,
    "kind": "landcover",
    "source_collection_id": collection["id"],
    "reason": reason,
    "patches": [{
        "mask_source_id": design_source_id,
        "from_codes": source_codes,
        "to_code": destination_code,
        "reason": reason,
    }],
    "design_source_reference": original_plan_reference,
    "design_revision_id": editor_revision_digest,
})
# Only when original grid/profile selection is supplied:
run = workspace.prepare_run({**original_run_selection, "scenario_id": scenario["id"]})
```

Its `native-receipt.json` contains the real returned collection/scenario/run IDs. Original computation remains with the native runner; no second queue or ecological engine is created. Application integration can import `register_landcover(workspace, bundle_bytes, revision_directory)` inside the original operator's task/Workspace locking path. The standalone receiver should run against an otherwise idle Workspace, as with other direct native writers.

The adapter follows the complete E7A1 consumer source `F0C8RR36873` and exact original importer helper delivered at Slack thread reply `1791851148.768209`, parent `1791724121.853269`, channel `C0BTTA66TK3`. These are the maintained conservation and original-source interfaces, not the older v5 field-density methods.

## Python and CLI authoring

```sh
python conservation.py import saved-plan-binding.json \
  --geometry-role reporting_units --output editable-project.json
python conservation.py export editable-project.json \
  --alternative ACTUAL_ALTERNATIVE_ID \
  --from-code ACTUAL_SOURCE_CODE --to-code ACTUAL_DESTINATION_CODE \
  --reason "Actual design rationale" --output conservation-design.zip
```

Supply integers in place of the code placeholders. Repeat `--from-code` for additional source codes. `--grid-id`, `--profile-id` and repeated `--model` preserve an explicit native run selection. Output files are create-only and repeat-safe for identical bytes.

Python entry points: `import_binding`, `binding_for`, `source_summary`, `landcover_plan`, `export_landcover`, `read_landcover`, `register_landcover`. HTTP: `POST /api/import-conservation` accepts original bytes as `source_base64`; `GET /api/projects/ID/conservation-source` returns retained context; `POST /api/projects/ID/upstate-plan` returns the complete ZIP. All writes use the editor's normal same-origin request protocol and SQLite revision persistence.

## Executed coverage

The complete Chromium DOM/JS journey uses Python HTTP transport to the actual running editor, preserving its managed browser network policy. It receives a complete authored binding including a UTF-8 BOM, edits vertices, retains original areas/IDs, exports the actual ZIP, receives the nested project independently, edits it and checks the sender. Desktop and phone captures were inspected; zero page exceptions were observed.

`tests/test_conservation_journey.py` executes full filesystem/source-manifest receiving and the original published call sequence using an explicit interface fixture. Its records and geometry are authored engineering inputs, not a native scientific run. It checks every retained body/companion hash, source IDs and source/code/run selections, repeated receiving, changed-file rejection and all four geometry views. Full installed-model scientific execution is owned by the maintained native application receiving operation.

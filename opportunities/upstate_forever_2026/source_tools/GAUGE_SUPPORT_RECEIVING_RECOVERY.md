# Continue an original Gauge receiving operation

The maintained entrypoint is `python -B -m source_tools.receive_gauge_support`. It imports the retained daily-flow coverage, original NLDI gauge points and selected catchments, and the original regional HUC polygon source. It builds the saved Gauge support, prepares its original scientific source, saves a scientific report edition, retains a complete Workspace archive, and exports that selected report with its editable Gauge, Station Geography and regional dependencies. The final selected-study reopening runs in a separate Python process using the application inside that archive.

## Continue the existing regional course

Continue `source_tools/receive_watershed_edition.py` first, using the original complete-source manifest, Workspace and output directory. That receiver preserves the completed watershed report separately from its current-source analysis. Use its original report ID in the Gauge selection.

From the complete maintained application:

```sh
"$PYTHON" -B -m source_tools.receive_gauge_support \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/gauge-receiving" \
  --report-id "$ORIGINAL_REGIONAL_REPORT_ID" \
  --huc-manifest "$ORIGINAL_HUC_SOURCE_MANIFEST" \
  --huc-source-id upstate-wbd-upstream-domain-20261012 \
  --huc-id-field huc12
```

Preserve explicit `--reporting-huc12` and `--utility-selection` arguments from the original request. An existing imported HUC collection can instead be selected with `--huc-collection`. Daily coverage and NLDI paths default to the maintained original source family inside the application. The native Workspace importer retains every original source companion.

The default catchments are NLDI upstream **whole catchments**, with `splitCatchment=false`. Their support can extend below a gauge within its NHDPlusV2 catchment. The report retains this interpretation, original station coordinates and complete geometries.

An explicitly captured alternative remains available through `--catchment-manifest` or `--catchment-collection`, `--catchment-source-id`, and `--support-kind`. The model verifies the selected whole, indexed split or coordinate-derived method against the actual features. The receiver preserves those exact choices and the original whole-source checkpoint identity.

## Saved scientific report and editable selected transfer

After the original support build, the receiver prepares the existing Gauge typed scientific source with `model.gauge_report_context.prepare(..., render=False)`. It retains that exact registered source capture in `phases.scientific_source`; a retry reuses the original capture and source collection.

The existing scientific report publisher, `model.scientific_report_editions.preview` followed by `render_prepared`, saves the report under `scientific-report-editions/<id>/`. This is the same saved-edition contract used by the operator scientific composer and Study transfer. It produces the original PDF, HTML, Markdown, data, coordinate/source companions and rendering-source records. The receiver retains its exact preview before rendering, so a retry uses the selected source order, binding, title and renderer identities.

The selected transfer contains one root:

```json
{
  "schema": "upstate.study-selection/v1",
  "title": "Original Gauge editable scientific report",
  "roots": [
    {"kind": "scientific-report-editions", "id": "<actual saved report ID>"}
  ],
  "include_related_results": false
}
```

The maintained `model.study_transfer.export_study` writes `gauge-selected-report-<report-id>.zip`. Its existing Gauge helper validates and retains the saved Gauge selection/build, Station Geography, original regional report, complete original source collections and companions, source-capture tree, maps, scientific report files and native application. The receiver verifies the captured same-project lineage and required native records before accepting the archive. It does not change the shared Study engine or map a foreign source onto a local study.

The selected archive is restored into `selected-report-reopened-<report-id>/`. The receiver verifies every declared member, then launches the current Python interpreter with `-I -B` and the **restored selected archive's application**. It removes `PYTHONPATH` and `PYTHONHOME` from this child environment. That child imports the archived receiver and calls the archived Study verifier and scientific-edition inspector.

The cold check requires equality of the original Study receipt, project, saved report and operation, Gauge/build, Station/build, regional report, original source references, selected catchment interpretation and scientific source body. Its result records the actual interpreter, hostname, PID, archived application path and IDs. The exact process output and log remain in the original receiving directory. A native failure reports its exit status and retained log; it does not mark the selected report as reopened.

## Complete Workspace snapshots remain explicit

A new operation saves the report before creating the original `gauge-support-workspace-<gauge-id>.zip`, so that first full snapshot already includes the scientific edition and its source.

A previously completed original archive remains unchanged. The receiver verifies its existing descriptor and all original Gauge, station, regional and source members. If it predates the new scientific report, it retains an additional full snapshot at `gauge-support-workspace-<gauge-id>-scientific-<report-id>.zip` and reopens it in `reopened-scientific-<report-id>/`. If the original archive already contains the exact new report/capture members, the current scientific phase reuses it and its existing reopened directory. The original path is recorded beside the current scientific snapshot, so the earlier archive is never relabelled as containing a later report.

The selected-study archive is distinct from these full Workspace snapshots. Its cold child always uses the application from the selected-study archive, including the current source-lineage helpers.

## Checkpoints and useful outputs

The operation stays in `receiving-gauge-support.json`. Existing original identity fields remain unchanged; the added pipeline is identified by `receiving_edition: gauge-scientific-study-receiving-v2`.

| Phase | Retained result |
| --- | --- |
| `support_build` | Actual Gauge edition, Station Geography, original build and support interpretation |
| `scientific_source` | Exact registered Gauge source capture and native collection/source IDs |
| `scientific_preview` | Original saved preview ID and file descriptor |
| `scientific_report` | Actual saved scientific edition/operation and complete report file descriptors |
| `workspace_backup`, `independent_reopen` | Original full archive, application fingerprint and reopened Gauge |
| `scientific_workspace_backup`, `scientific_workspace_reopen` | Full current report snapshot or explicit reuse of the original |
| `selected_report_archive` | Selected Study ID, archive descriptor, source lineage and saved report receipt |
| `selected_report_cold_reopen` | Actual independent process result, original IDs, exact archive/application fingerprints and log |

The existing direct Gauge report command remains available for an already saved edition:

```sh
"$PYTHON" -B -m model.gauge_report_context \
  --workspace "$WORKSPACE" --edition-id "$GAUGE_EDITION_ID"
"$PYTHON" -B -m model.gauge_report_context \
  --workspace "$WORKSPACE" --edition-id "$GAUGE_EDITION_ID" --inspect
```

That producer's standalone release is retained separately. The receiver's saved scientific edition supplies the selectable report root for editable Study transfer.

## Interruption and resume

Run the same command with the same Workspace, output and original selections. A nonblocking `.receiving.lock` prevents concurrent receivers for that operation. A different source request is rejected before it can replace the retained operation.

A completed `support_build` is reopened and verified directly; its geometry is not rebuilt. The source capture, preview and completed scientific edition are reused after their original identities are checked. A changed renderer after an uncompleted preview is reported by the existing publisher; the retained preview is not silently rewritten.

Archives use the maintained same-opened-file portable verifier. A previously recorded path, byte count or SHA-256 cannot be replaced. An archive published before its checkpoint is reconciled in place. A restore published before its checkpoint is verified against every original archived member. Missing or changed previously checkpointed artifacts remain explicit errors.

The final state becomes `complete` only after the full current scientific snapshot and selected-study cold reopening finish. `--prepare-only` retains the original source-preparation behavior and stops before the GIS build or scientific publication. Every archive and receiving directory remains outside the source application and Workspace. Partially populated or incompatible destinations are preserved for same-operation repair.

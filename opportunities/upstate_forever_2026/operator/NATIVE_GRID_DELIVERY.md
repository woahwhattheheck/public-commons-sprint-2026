# Original-grid delivery and offline handoff

The delivery producer now retains the completed Workspace grid and carries it through the scientific audit, package capture and offline atlas. Original input and output pixels keep their existing coordinates and units.

## Grid binding

A newly built delivery includes `grid/grid.json`, copied byte for byte from the selected run's completed `grids/<grid-id>/grid.json`. The manifest declares:

```json
{
  "grid": {
    "schema": "upstate.retained-grid/v1",
    "id": "<original Workspace grid ID>",
    "record": "grid/grid.json",
    "audit_scope": "source-native"
  }
}
```

The original model grid ID and context buffer remain in `model.grid_id` and `model.upstream_buffer_m`. The audit recomputes the grid ID from the original `spec` and `grid` objects with the Workspace's canonical JSON serialization. It also requires a complete original record, matching model and declaration IDs, and the original selected buffer.

The audit checks projected metre coordinates, width and height, all six affine coefficients, nominal resolution and cell hectares. Output rasters must agree with this retained geometry and with each other. Affine comparisons use an absolute tolerance of 0.000001 metre; cell-area comparison uses 0.000000001 hectare. Cell area comes from the affine determinant.

## Choosing the delivery scope

A delivery selection may explicitly set `audit_scope` to `regional-30m` or `source-native`. If omitted, the producer selects `regional-30m` for the original unrotated 30-by-30-metre grid with positive context buffer, and `source-native` for other original grid selections.

The source-native contract permits the original 15-metre Gura grid and zero added context. The audit compares that zero with the completed grid selection. It does not replace the original modelling domain or resample the outputs. An explicit regional selection still requires the regional grid and positive buffer. Existing manifests without a grid declaration retain those regional requirements.

The producer includes its current `DELIVERY_FORMAT_VERSION` in the delivery identity, so a newer package format creates a new delivery edition. Rebuild with the installed producer to include its current grid, report and capture behaviour. Existing run, grid, profile and source identities remain the source of the rebuilt delivery; completed native model runs can be reused.

## Complete package and offline atlas

Package capture includes the original grid record under the `model.grid` role and preserves the current capacity and disk-space controls. The same file may appear in the project-asset catalogue; path deduplication keeps one captured file with its applicable roles.

The offline browser is generated after receiving-water assets, analysis assets and the HTML, Markdown and JSON report files have been attached. Its original relative links therefore cover the complete delivery. Extract the whole delivery ZIP and open `maps/index.html`; retain the extracted directory structure when moving or sharing it. The native grid record is available with the other original files.

To check a received delivery in the existing GIS environment:

```sh
python audit.py /absolute/path/to/extracted/delivery.json --out /absolute/path/to/audit.json
```

Use the existing package and receiving workflow to capture and reopen the delivery. The audit preserves the original checks for numeric exports, required source provenance, map PDFs and FGDC sections.

## Source composition

This integration adopts the retained-grid audit and raster checks authored in the original 7F24 v2 source bank, [F0C8QG025R8](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QG025R8). It adds the canonical Workspace identity check and connects that contract to the current delivery producer, package collector and complete offline catalogue. The integration packets carry exact preimages and postimages for reproducible composition into the existing application.

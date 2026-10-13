# Observed watershed land-cover changes

The **Observed watershed change** desk makes the completed original Annual NLCD watershed analysis usable for a selected group of HUC12s. It reads the original 2023 and 2025 annual inventories and all original directional transition cells. Users can inspect a subset, save its complete comparison, download the offline report and tables, and open the retained report source in the existing Scientific Reports workflow.

The existing **Land-cover changes** desk remains the place for a new comparison from selected rasters or native run outputs using its fractional polygon-overlap method. The observed watershed desk uses the completed source analysis's native pixel-centre method. These products have different area support and should retain their respective methods when compared.

## Operator journey

1. Open **Observed watershed change** in the current Workspace.
2. If the source has not been retained there, choose **Import completed 217-HUC source**. This submits the normal native queue action against the installed original source manifest. Open **Choose original watersheds** on its completed task.
3. Choose an original analysis. The reader verifies the bound annual and paired result documents and displays their original HUC12s, names, states and support. Search by HUC12, original name or state. **Select visible** adds the current filtered rows; clearing the search preserves the selected set.
4. Choose one or more watersheds and name the comparison. **Inspect selected watersheds** opens the full directional matrix and class gains, losses and net changes. Switch between the selected non-overlapping union and each selected HUC; display cells, hectares or percent of each earlier paired class.
5. Choose **Save comparison and report source**. The normal original operator form freezes the selected source edition, HUCs and title before queue submission. A retry uses that form's original operation ID. Tasks retain the operation if a later display or catalogue refresh fails.
6. Open **Open selected watershed comparison** on the completed task, or choose it from the desk's saved comparison list. All original files have ordinary authenticated native download tickets.
7. Download **selected-huc-landcover.zip** for the complete standalone report, selected CSV and JSON data, Scientific Reports recipe/source manifest, and original input documents with their declared companions. Extract the ZIP together and open **report.html**.
8. Choose **Open in Scientific Reports**. The existing composer receives the actual retained OBSERVED_CONTEXT collection/source pair and title. Its normal report/delivery workflow binds and copies every selected source member.
9. Use the original Workspace backup/restore workflow to transfer the editable Workspace and saved comparison desk. Restoration verifies the saved selection files and original report-source companion membership. A source ZIP can also be imported through the existing scientific source manifest workflow for report composition in another Workspace.

Draft source selection, HUCs, filter, title, matrix quantity and last opened saved edition are scoped to the original local Workspace key. Saved comparisons belong to the scientific project's original ID. Browser reads reject a late result if the selected Workspace, source or comparison selection changed.

## What the numbers mean

The original producer defines 16 Annual NLCD classes and retains every one of the 256 earlier-to-later class pairs for each HUC, including zero counts. The rows of a displayed matrix are the earlier year and the columns are the later year. The diagonal is unchanged class.

The reader preserves seven support quantities:

| Quantity | Meaning |
|---|---|
| Selected native cells | Every original pixel selected by the source watershed rule |
| Paired-valid cells | Cells with supported original classes in both years |
| Earlier-only valid | Earlier-year class is available, later-year value is NoData |
| Later-only valid | Later-year class is available, earlier-year value is NoData |
| Both NoData | Neither year has a supported class |
| Stable class cells | Paired cells whose class is identical in both years |
| Changed class cells | Paired cells whose class differs between the two years |

The first four validity categories partition selected support:

    paired-valid + earlier-only + later-only + both-NoData = selected cells

Stable plus changed cells equals paired-valid cells. Changed percentage is changed cells divided by paired-valid cells. A selection with zero paired-valid cells has an unavailable percentage, with its zero denominator shown explicitly.

Class gains are off-diagonal transitions into a class; losses are off-diagonal transitions out of it. Net is later minus earlier on paired support, and equals gains minus losses. The desk also retains independent annual class counts, areas and unmatched valid counts. It does not silently substitute paired margins for an annual inventory.

The hectare conversion uses the absolute determinant of the original native affine transform, divided by 10,000. Both original rasters are bound to EPSG:5070. The exact transform and declared cell area remain in the report, and stored source area values must agree with their cell counts. The source analysis uses **centre inclusion; half-open scanline edges; even-odd ring parity**. It reports zero overlapping selected cells. The reader requires that condition before summing selected HUCs, then checks all original HUC counts and directional matrices against the source domain union. Union percentages are computed after summing counts; they are not averages of watershed percentages.

A changed annual product classification alone does not establish the physical cause, the date of a change within the interval, or classification accuracy. These class observations do not estimate pollutant export. Original whole-HUC reporting attributes and class support remain attached.

Class names follow the official USGS Annual NLCD legend: https://pubs.usgs.gov/fs/2025/3001/fs20253001.pdf . Original result documents retain their producer metadata, raster SHA-256 identities, declared product years, NoData codes, source-domain hash and coordinate operation.

## Original source contract

The installed published source manifest is:

    observations/landcover_2023_2025/model-sources.json

Import uses the existing Workspace source importer, which retains primary bodies and declared companions. The reader chooses a retained analysis-run entry by its actual collection and source IDs. It resolves annual and transition entries by the exact byte size and SHA-256 bound in that analysis-run document; labels and filename guesses never substitute for the source identity.

Supported documents are:

- upstate.original-landcover-analysis-run/v1
- upstate.landcover-zonal-summary/v1, one for each declared product year
- upstate.annual-landcover-transitions/v1

Required comparisons preserve the same original grid, domain, source attributes, declared raster editions and pixel rule. Each original HUC12 is a 12-character string. Both independent annual inventories must have the same HUC inventory and original properties as the paired result. Class and support counts are nonnegative integers. Each matrix contains all 16 × 16 class pairs exactly once. Row and column margins must agree with the declared paired class margins and with the independent annual inventories after accounting for their explicit unmatched valid cells.

This workflow reads completed source documents. It does not reopen large original rasters or re-run the native raster producer during source browsing or selection.

## Retained products

Each saved comparison directory is content addressed under:

    observed-landcover-selections/<selection-id>/

The selection identity binds the project ID, complete original source entries, title, HUC12 selection, source hashes, coordinate method and producer identity. Completed output is immutable and reusable. The receipt is published after the complete files, source registration and source binding succeed.

| File | Retained content |
|---|---|
| selection.json | Complete selected report, per-HUC matrices, paired and independent annual margins, original metadata and identities |
| original-inputs.json | Actual original source entries, raster/hash bindings, grid and method |
| huc-summary.csv | Every selected original HUC and its full support, original properties and changed percentage |
| huc-classes.csv | Every selected HUC × class, with independent annual and paired class margins, gains, losses, net and unmatched counts |
| huc-transitions.csv | All 256 directional pairs for every selected HUC, including zero pairs |
| selected-transitions.csv | Complete selected-union matrix, cells, hectares and earlier-class denominator percentages |
| report.html | Standalone readable report, full union matrix and original-member links |
| observed-report.json | Actual upstate.observed-report/v1 recipe for the maintained Scientific Reports composer |
| sources.json | Original native source manifest for the recipe and all of its companions |
| originals/ | Complete original analysis-run/annual/transition documents and their declared companions |
| selected-huc-landcover.zip | Complete portable source/report tree |

CSV headings explicitly distinguish cells from hectares. Empty percentage cells mean the original denominator was zero. CSV string cells beginning with =, +, - or @ receive a leading apostrophe for safe spreadsheet opening; exact original strings remain in the JSON documents. HUC12 values retain their leading zero in the CSV text; import that column as text in spreadsheet applications.

The selected report ZIP carries the complete original result documents, rather than pretending to contain the original raster pixels. Their raster identities and native computation metadata remain bound in those documents. The scientific source recipe links all retained inputs, and the ordinary Workspace archive carries the project and application for reopening.

## Integration

This feature is additive:

- model/observed_landcover.py owns native source validation, selection, reports and retained source registration.
- operator/observed_landcover_operator.py uses the existing queue, read routes and native download tickets.
- operator/extensions/observed-landcover.json registers the desk, item kind, task controls and restored-Workspace verification.
- operator/web/observed_landcover.mjs and observed_landcover.css supply the neutral browser interface.
- The maintained extension host supplies getState, api, endpoint, openForm, submitAction, openDesk and openScientificReport. No shared application controller needs replacing.

Native actions are observed.landcover.import and observed.landcover.save. Read routes are /api/observed-landcover/catalog, /api/observed-landcover/inputs and /api/observed-landcover/edition. The inputs route uses POST with an explicit selection. Supplying huc12s returns the complete selected comparison; omitting them returns the original HUC inventory.

Example queue payload for saving uses actual retained identities:

    {
      "source_collection_id": "<actual source collection ID>",
      "analysis_source_id": "<actual analysis-run source ID>",
      "analysis_sha256": "<actual analysis-run body SHA-256>",
      "huc12s": ["030601010704"],
      "title": "Lower Six and Twenty Creek annual class change"
    }

The source registration uses the maintained model.observed_context and model.landcover_report_source portable ZIP writer. Existing model.common and model.reuse retain immutable bytes and verified original members. The feature is included by the maintained cumulative application/extension loader and the original Workspace portable application inventory.

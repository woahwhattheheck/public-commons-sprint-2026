# Land-cover scientific figures

The Land-cover **Prepare scientific report source** action now retains a native vector map and three numerical figures per selected comparison. They enter the existing Scientific Reports preview, PDF, HTML and editable selected-Study transfer through the original source recipe. The complete interactive ledger, all CSV/GIS outputs and every original source remain attached.

## What the figures show

The geography map contains every original reporting polygon, vertex and hole. It reads `ledger/zones-original.geojson` through the same maintained polygon reader used for the ledger, using `_landcover_zone_id` and `_landcover_zone_name`. Its per-polygon analysis areas must match the completed ledger. Standard metre-based analysis grids use their actual CRS in the map. A non-metre analysis grid has an explicitly declared EPSG:6933 display transformation, while all numerical quantities retain the original analysis CRS and area basis. The map has equal XY scale, projected-grid distance and grid north.

For every original comparison, three additional figures show:

1. **Unique study-area class areas.** Reference and comparison hectares come from the row and column sums of the complete original domain transition matrix. Open circles and filled squares preserve the two roles. Axis labels use NLCD codes; full class names and exact values remain in the figure-data file and report tables.
2. **Net change by land-cover group.** Every retained group appears in its original order. Positive values mean the comparison has more group area; negative values mean less. The zero reference line makes the sign clear. Group definitions and gain/loss/net values remain those of the completed reducer.
3. **Reporting-area coverage and change.** Every original polygon with both numerical values is plotted. The horizontal denominator is inside-grid polygon area; the vertical denominator is valid analysis support. The caption reports the complete count and unavailable count. Overlapping marks may represent multiple polygons. The complete data file retains all polygons, including unavailable quantities.

The unique-union summary and per-polygon values remain distinct. Overlapping polygons are never added to obtain the study-area union. Source-edition order and explicit original labels remain intact. All area values are hectares under the ledger's stated area basis; percentage panels retain their different denominators. Land-cover areas do not estimate pollutant exports.

## Retained files and reproducibility

`model/landcover_report_figures.py` consumes the already-copied original ledger inside a report-source directory. It opens no input raster and repeats no raster accounting. Its `prepare(directory, edition, report, labels, expected_implementation)` returns ordinary file descriptors, a figure-spec path and ordered figure selections.

Each completed source includes:

- `figures/landcover-figures.json`: the native scientific-figure specification, exact geometry bank, per-polygon geometry identities, original CRS/area metadata, and complete numerical drawing coordinates.
- `figures/landcover-figure-data.json`: every original class/group/polygon figure quantity, including unavailable entries.
- One complete SVG per figure, drawn at the same 511.2-point width through the existing native scientific renderer.
- Exact source bodies for the figure producer, original polygon reader, scientific renderer and projected map renderer under `implementation/`.

The source identity includes all four implementation hashes. Each new source uses producer edition `saved-landcover-report/2`; previous immutable sources remain readable through the unchanged `get` and catalogue paths. The shared map and statistical rendering code are unchanged.

The producer verifies the copied ledger identity, completed state, original comparison order and polygon inventory. It reconciles the transition sum with the original valid support, verifies the original polygon areas after reopening, and refuses changed implementation sources during capture. It retains its complete output through the existing report-source manifest and CAS import.

## Existing native continuation

Adopt this producer with its helper and component dependencies into the current annual-source or simulated-input Land-cover operation. Reuse its actual completed ledger ID; prepare this new immutable report source once. Use its returned source selection in the original Scientific Reports operation.

Inspect the geographic and numerical figures in the native PDF and HTML, then export the saved Scientific Report through the current selected-Study receiver. Reopen the retained report and original land-cover ledger in the restored project. The editable transfer keeps the new figure specification, SVGs, source code and original inputs automatically because they are ordinary recipe companions. Preserve the original operation and producing run/source IDs throughout.

# Seven-family map atlas and complete delivery

The **Map atlas** desk prepares the original complete GIS delivery and opens the retained result in the browser. It adds an ordered PDF atlas, a page catalogue, and print controls to the existing native delivery workflow.

## Prepare a release

Open **Map atlas → Prepare release**.

1. Choose the baseline and the completed land-cover alternatives. The desk checks the original delivery requirements: NDR and SDR are complete, every case uses the baseline grid and profile, and each alternative has an explicit land-cover scenario. Selected cases that need attention remain visible. Move an alternative up or down to set the principal future map and the order of additional scenario sheets.
2. Select the original protected-land, parcel, hydrography and wetland editions. Add the actual drinking-water source area and designated high-quality-water overlays. The source inspector shows the native layer, fields, geometry type, CRS and original sample rows. Field filters use a JSON object so strings, numeric identifiers, booleans and null keep their exact types. Saved water-designation binding fields remain attached to the unchanged selection.
3. Set the printed atlas title, subtitle, landscape paper, DPI and map-family titles. Set the common display percentile and the separate pollutant weights/priority caps. The control explains their distinct roles.
4. Add the responsible metadata contact, interpretation, original observed-load comparisons and editable saved-map work. Submit **Build atlas and complete GIS delivery**.

The new view uses the existing authenticated `delivery.build` action and serial queue. It keeps a workspace-specific draft in the current tab, reuses the same operation ID after an uncertain response, and offers **Download selection** / **Load selection JSON** for transferring a draft. Ordinary task refreshes keep the form in place. An explicit **Refresh choices** updates the visible source/run choices.

A saved watershed report can open the desk with its exact baseline, ordered alternatives and source-report identity. The source report binding is validated before a delivery identity is created. A changed scientific cohort is explained by the existing report-release service.

## Open the result

**Saved releases → Open atlas and files** shows the retained release and its exact file-download tickets.

- **Open complete atlas** previews the single PDF, including cover, contents and every map sheet.
- **Atlas page** jumps to the selected sheet inside that document.
- **Map PDF** opens the original standalone family/scenario PDF.
- **Download JSON index** and **Download CSV index** provide page numbers, exact map keys, run IDs, raster paths, physical units and shared display limits.
- **Download complete GIS package** receives the original full package, including the new atlas/index files and linked saved-report outputs.
- **Revise this selection** opens the complete original selection as a draft, retaining source bindings, receptor settings and other authored delivery extensions.

The required seven families remain the original identifiers in `model.common.MAP_IDS`. The atlas groups each family in that order and preserves the selected alternative order within each future family. There are five baseline/context map sheets plus two sheets per land-cover alternative. The cover and contents pages are additional pages.

## Print settings

All settings live inside the original delivery selection's `map_settings` object.

| Key | Meaning and default |
| --- | --- |
| `title` | Printed atlas/study title. Blank uses the delivery title. |
| `subtitle` | Optional explanatory text on the cover and map sheets. |
| `paper` | `a4` (default), `letter`, or `a3`, in landscape orientation. |
| `dpi` | Whole number from 120 to 600; default 220. |
| `family_titles` | Optional title overrides keyed by the seven original family identifiers. |
| `display_percentile` | Exact native-cell display percentile, 0–100; default 98. |
| `weights` | Existing nonnegative pollutant decision weights; at least one positive. |
| `caps` | Existing optional positive pollutant priority caps in the native raster units. |
| `percentile` | Existing priority normalization percentile; the original default remains 95. |

Display scaling uses the current `cartography.shared_display_scale`: separate baseline pollutant scales, and one shared signed scale per pollutant across every future alternative. Each alternative uses the largest of the exact per-raster percentile caps. The combined index retains its fixed 0–1 scale. The renderer receives the existing numerical raster, units, selected overlays and saved scale; it does not recalculate the native models.

Map footers use the current regional delivery's affine-derived cell dimensions. Original NDR/SDR outputs, source-water labels, legal designation semantics, receptor specifications, geographies and report text remain supplied by their existing components. The map atlas records those current titles and source descriptions.

## Retained products and recovery

The existing delivery record gains `atlas` and these three `files` keys:

| Key | Path within the retained delivery |
| --- | --- |
| `map_atlas` | `maps/watershed-map-atlas.pdf` |
| `map_atlas_index` | `maps/atlas-index.json` |
| `map_atlas_csv` | `maps/atlas-index.csv` |

Every standalone map stays in its original `maps/<map-key>.pdf` path and remains under `state.maps`. The delivery's original package manifest includes the atlas products as project assets. The atlas version enters the delivery digest so an existing release remains an immutable earlier edition.

Standalone maps and atlas sheets are saved from the same Matplotlib figure. On resume, completed standalone maps are verified and retained. Figures are rendered again only as needed to reconstruct an interrupted multi-page PDF. The final PDF is replaced atomically after all pages are written; its JSON/CSV indexes record the completed file hash and exact page count.

A resumed GIS package is reused only when its captured manifest matches the current manifest and its retained technical audit passed with no missing references. A changed or failed earlier capture stays available in its original directory; the current release is packaged in a deterministic sibling directory with its own package-hash ZIP. Repeated resume can find and reuse that exact current package.

## Browser integration

The installed `operator/extensions/map-atlas.json` manifest registers the desk through the current extension host. The additions do not require another server route or shared-app dispatcher.

`attachMapAtlas(host)` exposes the ordinary `mount`, `update` and `detach` lifecycle, plus:

```javascript
await host.openExtension('map-atlas', 'create', {
  workspace_key: originWorkspaceKey,
  selection: {
    title: reportTitle,
    baseline_run_id: baselineRunId,
    scenario_run_ids: orderedAlternativeRunIds,
    source_report_id: savedReportId
  }
});

await host.openExtension('map-atlas', 'open', deliveryId, {
  workspace_key: originWorkspaceKey
});
```

`create` also accepts those selection fields directly. It checks the originating workspace before and after asynchronous navigation, preserves every supplied selection field and opens a fresh draft in `map-atlas`. `open` applies the same workspace check around loading and navigation, retrieves the complete retained delivery using `/api/item?kind=deliveries&id=...`, and shows its atlas and downloads. A workspace change rejects the handoff before accepting the other project's cohort. The source-report button returns through `openExtension('scenario-reports', 'open', reportId, {workspace_key})`.

The controller uses `getState`, `api`, `navigate`, `refreshState`, `openItem`, `openExtension`, and `showTask`. Download links use the existing exact-file capability route. Source inspection uses the existing `/api/source-info` route. Actions use the original request shape `{workspace, action, payload, operation_id}`.

## Source composition

Apply the additive module, browser assets, manifest and this guide alongside the exact literal source joins supplied with the component. The joins preserve current receiving, programme, receptor, source-water designation and other shared-source edits.

The report binding joins use `model.report_release.bind_report` and `retain_report`. Install the paired report-release component in the same composition. It supplies the immutable source report snapshot, hash-bound selection and retained report files.

Original requirement: [Upstate Forever issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf).

PDF implementation uses the existing [Matplotlib PdfPages interface](https://matplotlib.org/stable/api/backend_pdf_api.html#matplotlib.backends.backend_pdf.PdfPages). The atlas adds no runtime dependency.

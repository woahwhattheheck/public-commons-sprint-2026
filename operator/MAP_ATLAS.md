# Seven-family map atlas and complete delivery

The **Map atlas** desk prepares the original complete GIS delivery and opens the retained result in the browser. It adds an ordered PDF atlas, an offline map catalogue, native pixel inspection, comparable scenario views and print controls to the existing native delivery workflow. Study and source titles retain the actual workspace geography.

## Prepare a release

Open **Map atlas → Prepare release**.

1. Choose the baseline and the completed land-cover alternatives. The desk checks the original delivery requirements: NDR and SDR are complete, every case uses the baseline grid and profile, and each alternative has an explicit land-cover scenario. Selected cases that need attention remain visible. Move an alternative up or down to set the principal future map and the order of additional scenario sheets.
2. Select the original protected-land, parcel, hydrography and wetland editions. Add the actual drinking-water source area and designated high-quality-water overlays. The source inspector shows the native layer, fields, geometry type, CRS and original sample rows. Field filters use a JSON object so strings, numeric identifiers, booleans and null keep their exact types. Use **Retained water selection → Use saved selection** to apply the native designation, including its exact selected source, legal reference and original source hash. Inspect or reopen that saved designation directly from the source card.
3. Set the printed atlas title, subtitle, landscape paper, DPI and map-family titles. Set the common display percentile and the separate pollutant weights/priority caps. The control explains their distinct roles.
4. Add the responsible metadata contact, interpretation, original observed-load comparisons and editable saved-map work. Submit **Build atlas and complete GIS delivery**.

The new view uses the existing authenticated `delivery.build` action and serial queue. It keeps a workspace-specific draft in the current tab, reuses the same operation ID after an uncertain response, and offers **Download selection** / **Load selection JSON** for transferring a draft. Ordinary task refreshes keep the form in place. An explicit **Refresh choices** updates the visible source/run choices.

A saved watershed report can open the desk with its exact baseline, ordered alternatives and source-report identity. The source report binding is validated before a delivery identity is created. A changed scientific cohort is explained by the existing report-release service.

## Water and contributing-area choices

The source step reads the existing saved water-designation catalogue. Applying a selection calls the original `/api/water-designations/apply` route, so source_collection_id, source_id, layer, selection_id, rule_reference and native_source_sha256 travel together. Copying a selection, loading its JSON, revising a release and submitting it preserve the full overlay object. The native atlas release checks a saved ID against its complete original designation before assigning the release identity; a field filter that changes that saved geometry must be expressed as a new saved choice.

**Load installed profiles** reads the original `source/receptor-profiles/utility-focus-20261012.json` from the installed application. The selector also offers receptor specifications retained in earlier releases. **Use profile** preserves each complete area definition, its source URI and geographic basis, whole HUC12 strings and the source profile descriptor. **Load profile JSON** accepts the original receptor specification, a saved delivery selection or this atlas's source-context download. The expanded profile editor retains optional native network/layer/field choices and other original fields.

The selected profile table lists the named areas, their original anchors and selection basis. **Inspect original network fields** opens the selected source layer and sample, using the baseline grid's model-domain source unless the specification names a different retained network. The existing regional receptor engine performs its original upstream traversal and native same-pixel comparisons.

Published source-water protection polygons and designated-water geometries remain the original overlays. Contributing HUC12 footprints, their source network and original receptor definitions are displayed and retained separately.

The Water designations desk's **Use in delivery** applies its original saved selection and opens the atlas when registered. Its existing delivery-editor fallback receives the same complete binding. Workspace changes during either handoff are rejected before the selected source can enter another project.

## Open the result

**Saved releases → Open atlas and files** shows the retained release and its exact file-download tickets.

- **Open complete atlas** previews the single PDF, including cover, contents and every map sheet.
- **Atlas page** jumps to the selected sheet inside that document.
- **Map PDF** opens the original standalone family/scenario PDF.
- **Download JSON index** and **Download CSV index** provide page numbers, exact map keys, run IDs, raster paths, physical units and shared display limits.
- **Download source choices** includes complete water-designation records, source identities, rule references, receptor profile, resolved native network and the retained receiving-water analysis identity, scope, normalization, families and measurement. Original receptor GeoPackage, CSV and report files are also offered directly.
- **Inspect pixels and geography** opens an individual pollutant or priority panel in the native spatial workbench with its original raster, source filters and physical range.
- **Compare alternative maps** selects two matching panels for linked side-by-side or swipe inspection. Each original scenario retains its own identity and nodata mask.
- **Download complete GIS package** receives the original full package, including the PDF atlas, offline browser, indexes, original GIS assets and linked saved-report outputs. Extract the complete ZIP and open `index.html`; its atlas catalogue link opens the retained browser with all companion files in place.
- **Revise this selection** opens the complete original selection as a draft, retaining source bindings, receptor settings and other authored delivery extensions.

The required seven families remain the original identifiers in `model.common.MAP_IDS`. The atlas groups each family in that order and preserves the selected alternative order within each future family. There are five baseline/context map sheets plus two sheets per land-cover alternative. The cover and contents pages are additional pages.

## Inspect an original panel

In a completed release, choose **Inspect pixels and geography** beneath the required panel. The native workbench opens its exact retained TIFF, reporting boundary and original selected source-water, designation and protected-land geometries. Receptor contributing areas and current receiving-water family-union geometry follow their original bindings.

Use **Inspect** for original pixel values and intersecting feature attributes, **Pan** and zoom for the retained view, **Mark** for annotations and **Save review** for an immutable scientific review. Existing map-pack export controls create the printable PDF, PNG, SVG and original point/geometry records. The saved review and export are available for inclusion in a later release.

**Back to atlas and files** returns to the same release. Reopening the same inspection during the desk session retains its current in-memory view. **Open original printed sheet** opens the retained PDF.

WATERLINK priority panels use the actual post-override raster recorded in the verified atlas index. Their overlay uses the retained analysis GeoPackage's `receiving_waters` layer and exact `kind=family_union` / `family` selection, with the original analysis and plan identity. Native receptor outlines use complete retained contributing-area polygons; the printed atlas clips those outlines to the reporting area. The inspection explains that extent difference and keeps the reporting boundary visible.

## Compare alternative maps

The completed release's **Compare alternative maps** section offers quantities with at least two retained alternatives. Choose the **Left source**, the compatible **Right source**, and **Linked side by side** or **Swipe between sources**, then select **Open paired inspection**. The right selector lists only the same family and pollutant with the same signed/absolute meaning, compatible units and identical atlas display range. The backend verifies both original raster descriptions before opening the view.

| Comparison requirement | Original information checked |
| --- | --- |
| Same release and scientific reference | One verified atlas index, baseline run, source-report binding and selected model grid |
| Same physical quantity | Exact map family, original panel quantity title, signed/absolute flag and compatible physical units |
| Different alternatives | Two distinct retained scenario run IDs and separately retained original raster selections |
| Same native grid | Equal CRS, width and height, and matching full affine placement using the native renderer's grid tolerance |
| Common physical display range | Equal retained minimum and maximum, with the original physical unit and signed interpretation |
| Original geography | Both panels' source, legal designation, receptor and receiving-water bindings; shared overlays are retained once |
| Original values and masks | Each raster is read directly; each keeps its own nodata mask and native band |

The paired header names both alternatives and their atlas pages. **Open left original sheet** and **Open right original sheet** return to the two retained PDFs. The interpretation and saved source lineage include both map keys, panel indices, original raster hashes, scenario IDs, common baseline, grid, report and atlas-index identity.

For signed future-export maps, each source already represents **its alternative minus the common original baseline**. Negative values mean lower modeled export than that baseline; positive values mean higher export. Linked and swipe inspection display those two original deltas directly. The workbench's general source slots are labeled **Left source** and **Right source** so neither alternative is mistaken for the model baseline.

The original swipe convention reveals the **right/comparison source on the left of the divider**, above the full left/primary underlay. The slider label states that convention. Transparent nodata remains transparent and point inspection reports each original source separately.

The existing **Right source minus left source** view remains an explicit operator choice. With two signed maps from the same baseline, that subtraction is the difference between the two alternatives. It uses only cells valid in both originals. Review the selected physical display range when switching to that derived view. The scientific run baseline/alternative metadata stays attached to the original data; the generic viewport labels describe the sources currently selected.

Pair preparation performs original-file and metadata reads. It does not start NDR/SDR model runs, change native values, or generate replacement scenario rasters.

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

The existing delivery record gains `atlas` and these five `files` keys:

| Key | Path within the retained delivery |
| --- | --- |
| `map_atlas` | `maps/watershed-map-atlas.pdf` |
| `map_atlas_index` | `maps/atlas-index.json` |
| `map_atlas_csv` | `maps/atlas-index.csv` |
| `map_atlas_sources` | `maps/source-context.json` |
| `map_atlas_browser` | `maps/atlas-browser.html` |

Every standalone map stays in its original `maps/<map-key>.pdf` path and remains under `state.maps`. The delivery's original package manifest includes the atlas products as project assets. The atlas version enters the delivery digest so an existing release remains an immutable earlier edition. Current atlas products use `seven-family-atlas/v4`; the current native-grid `delivery_format` digest field remains intact. The JSON index embeds the same original source-context object, including the retained receiving-water analysis. The offline browser is written from the actual audited package member set and links those exact original assets; it is opened through the extracted package's `index.html`. The CSV writer protects spreadsheet text while retaining numeric display scales as numbers.

Standalone maps and atlas sheets are saved from the same Matplotlib figure. On resume, completed standalone maps are verified and retained. Figures are rendered again only as needed to reconstruct an interrupted multi-page PDF. The final PDF is replaced atomically after all pages are written; its JSON/CSV indexes record the completed file hash and exact page count.

A resumed GIS package is reused only when its captured manifest matches the current manifest and its retained technical audit passed with no missing references. A changed or failed earlier capture stays available in its original directory; the current release is packaged in a deterministic sibling directory with its own package-hash ZIP. Repeated resume can find and reuse that exact current package.

## Saved atlas review collections

A review saved from **Inspect pixels and geography** or **Open paired inspection**
now retains its atlas origin as a typed record, separate from editable notes.
Use **Reviewer**, **Disposition** and **Finding or resolution** in the native
editor, then **Save review**. Dispositions are **Open**, **Addressed** and
**Closed**. They describe the review finding and stay with that immutable
revision. Geographic extent, annotations, overlays and physical display settings
remain editable.

Return through **Back to atlas and files** to **Saved atlas reviews**. The
collection lists every revision branch for this exact release, its current
heads, original panel or pair, reviewer, finding and completed map packs.
**Refresh reviews** receives newly completed save and export tasks. **Open saved
review** restores the exact saved viewport and annotations; **Revision history**
opens any earlier revision. Saving from a retained review creates a successor
using the existing native previous-review relationship. Parallel successors stay
visible as separate current branches.

**Download review log CSV** provides a spreadsheet-ready finding log. **Download
review collection JSON** preserves the collection's exact IDs, index hash,
source panel selections and export descriptors. These downloads describe the
collection; the original editable records and native files remain in the
scientific workspace.

Select the current reviews and completed map packs to include, then choose
**Prepare release with selected reviews**. The original model cohort, source
choices and map settings open at **Review and build**. A selected map pack also
includes its exact saved review. The existing delivery builder retains the
original review JSON and export assets, and the offline catalogue lists them
with the other captured files. Exported PDF appendices and local map-pack pages
show the typed finding and original atlas identity.

The saved context uses `upstate.atlas-review-context/v1` and an
`upstate.atlas-review-origin/v1` origin: original project, delivery,
atlas-index SHA256, panel keys/numbers and native raster selections. Native
save, reopen, export and restore validate that origin against the retained
atlas index and original source bindings. A revision keeps the same origin.
Changing the selected raster bands begins an independent review instead of
relabeling an atlas finding. Legacy notes-only reviews remain available through
the original global review list and delivery selectors.

Read-only inspection also accepts an original `received_snapshot`
registered by the existing portable receiver. This does not mark a snapshot
as a newly built complete delivery. The working archive must retain every
review-referenced original delivery's index, selected source files and state,
under the same original delivery ID; the accompanying portable closure keeps
these snapshots nonrecursive. Restored reviews use the original source
identities and the existing native validation/export machinery.

## Browser integration

The installed `operator/extensions/map-atlas.json` manifest registers the desk through the current extension host. The atlas backend registers these reads through the existing extension registry:

| Route | Purpose |
| --- | --- |
| `GET /api/map-atlas/source-context` | Read the installed original receptor profile |
| `POST /api/map-atlas/inspect` | Open one retained panel's exact native raster and geography |
| `POST /api/map-atlas/compare` | Open two compatible retained alternatives through the same native renderer |
| `POST /api/map-atlas/reviews` | Read this release's typed review collection, complete history and native map packs |
| `POST /api/map-atlas/review` | Validate and reopen one original saved review and its panel or pair |

Inspection bodies carry `workspace`, `delivery_id`, `map_key` and `panel_index`. Comparison bodies carry `workspace`, `delivery_id`, `left` and `right` objects with `map_key` / `panel_index`, plus `mode` as `compare` or `swipe`. Both return the authenticated workspace key and an original Spatial review target. The existing registry loads it without a shared server or app-dispatcher edit.

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

Apply the additive atlas and comparison modules, browser assets, manifest and this guide alongside the exact literal source joins supplied with the component. The paired inspection feature requires the merged single-panel inspection and offline atlas components (PR2860 and PR2826). The joins preserve current receiving, programme, receptor, source-water designation and other shared-source edits.

The two source-context successor joins call `map_atlas.bind_water_selections` before the delivery digest and pass the original saved records to the atlas writer. They leave the current native-grid `delivery_format` and existing atlas digest fields intact. The designation browser joins use the original `/api/water-designations/apply` contract and preserve its original editor fallback.

The report binding joins use `model.report_release.bind_report` and `retain_report`. Install the paired report-release component in the same composition. It supplies the immutable source report snapshot, hash-bound selection and retained report files.

Original requirement: [Upstate Forever issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf).

PDF implementation uses the existing [Matplotlib PdfPages interface](https://matplotlib.org/stable/api/backend_pdf_api.html#matplotlib.backends.backend_pdf.PdfPages). The atlas adds no runtime dependency.

## Continue a saved Decision calculation into the delivery

Open a completed calculation in **Decision studies** and choose **Prepare map release**.
The preparation panel reads that original saved calculation and its study revision.
For a frontier, select the **Retained frontier point** explicitly. Select the
**Scientific profile** whose original baseline and chosen alternative will supply
the maps, then choose **Open map release**.

The atlas opens its existing preparation form with that exact native run pair.
The full Decision comparison across profiles remains attached to the release;
the selected profile specifies which original raster outputs the maps display.
The original package-selection model chooses a complete modeled scenario.
Its physical results are never added to another modeled package.
A saved calculation without an eligible local native pair keeps its original
explanation in the preparation panel.

Continue through the original source context, delivery mode, map settings,
contact and interpretation choices, then choose **Build atlas and complete GIS
delivery**. The source-decision link keeps its baseline and alternative fixed.
The existing **Choose a different run cohort** control removes the attached
decision link when starting an independent map selection.

### Retained calculation and reports

The completed delivery carries the saved Decision study revision, calculation
and optional frontier point, explicit display profile, original selected package,
and exact native baseline and alternative identities. Its decision report retains
the full original economic inputs, capacities, metric scales, weights, profile
probabilities when supplied, objective and outcomes across the studied profiles.

The queued native delivery retains the original full decision project export
alongside the selected study/result, implementation selection and HTML/CSV
reports. A resumed build reuses the first captured complete project export;
unrelated later study revisions do not replace that delivery's history.
The scientific and client reports contain the retained decision interpretation,
and the complete GIS package includes the associated decision files.
The original full working archive retains the editable scientific workspace.

In **Saved releases → Open atlas and files**, use **Open saved Decision
calculation** to return to its exact revision and calculation, including the
selected frontier point and display profile. The adjacent downloads open the
retained original decision files. **Revise this selection** preserves the same
decision attachment for a later map edition.

### Native composition

The original `model.robust_decisions.eco_robust.decision_delivery` helper validates
the selected calculation and native cohort before the delivery identity is
computed. The original `delivery.build` queue retains its reports and export
inside the existing build lock. The selection's `source_decision` pins the study,
revision, calculation, optional point, selected package, display profile and
content hashes. The `decision_*` file entries participate in the normal
delivery manifest, offline navigator and complete working archive.

The browser uses the existing read routes
`/api/robust-workbench/delivery-options` and
`/api/robust-workbench/delivery-release`, followed by the existing
`openExtension('map-atlas', 'create', {workspace_key, selection})` capability.
Its return action uses
`openDesk('robust-workbench', 'openForCalculation', selection)`.
The Decision operation queue, atlas renderer and physical model engines retain
their original ownership.

# Management across forcing periods

This is an analysis of **already completed original Climate forcing runs**. It lets a scientist ask whether a selected management scenario reduces modeled annual export under several retained forcing editions, and whether that benefit changes relative to an explicitly selected reference period.

It does not create precipitation or erosivity data, prepare a new scenario, invoke NDR/SDR, or resume a pending native run. Use the existing Climate forcing workflow for those operations, then select its completed cases here. An unfinished study can still be retained and exported through the ordinary selected Study workflow, but every case used in this comparison must have a completed original native result.

## Open and select the original cases

Open **Management across forcing** in the original operator.

1. Choose a title and the scientific question. Keep the source-period interpretation explicit: an annual forcing-pattern sensitivity is different from an attributed climate trend.
2. Add each period with a stable period ID and a readable label.
3. For every period, choose its original **reference study and case**, and its original **treatment study and case**. The original case ID `baseline` means that study's actual original baseline; it is never inferred from a label.
4. If a control is useful, select its original study and case for **every** period. Controls are optional, but a partially populated control column is not accepted.
5. Choose the explicit reference period against which changes in benefit will be reported.
6. Keep the full original reporting area, or add retained polygon source selections. Optional polygons are intersected with the unchanged original reporting mask. A zero intersection remains visible as unavailable support.
7. Preview the complete selection. Check the original study, scenario, run, source edition and period identities. Build through the original queued action only after reviewing that preview.
8. Open the saved report and its downloads. A later edit creates a newly reviewed selection; it does not replace an earlier saved result.

Each role uses one original forcing study across periods. For example, the reference column can use the original reference-scenario study's baseline and annual-2025 cases, while the treatment column uses the corresponding cases from a treatment-scenario study. **Case labels and array positions do not establish correspondence.** The explicit role selectors do, and the model independently checks the source editions and prepared fields.

The role names are analyst-selected scientific labels. Calling a scenario “control” does not establish randomization, field evidence, spatial matching or covariate balance. Preserve the existing scenario's documented design and any actual matching ledger when interpreting it.

## Required scientific compatibility

The model accepts the matrix only when all selected cells belong to the same actual Workspace and meet these conditions:

- Every named case exists in its named retained Climate forcing study and has an actually completed native run.
- Every role retains one original scenario across periods; reference, treatment and control scenarios are distinct.
- All roles share the same original base physical grid, source preparation, profile, native model/output scope and compatible native model versions.
- Actual lattice, affine transform, CRS, dimensions, model domain, reporting geometry/mask, upstream buffer, DEM, original NLCD and erodibility remain unchanged.
- Within each period, reference, treatment and control use the same original precipitation/runoff and R-factor source selections, source identities, effective units and actual aligned forcing raster identities.
- A land-cover treatment's effective native land-cover artifact remains byte-identical across its periods. Different roles may intentionally have different effective land cover.
- Annual mass outputs have the original Workspace's declared mass-per-pixel units and verified original bytes.

A source edition can retain an equal normalized pattern and therefore little or no NDR response. It is not removed or relabeled as failure. Conversely, two runs with unrelated grids or profiles are rejected even if their totals look plausible. Use the appropriate existing structural or parameter comparison for that question.

The same forcing raster may have different *native normalization behavior* under different management scenarios if their valid native supports differ. The original native arguments, profile, completed cases and source metadata travel with the comparison; a common reporting mask does not redefine NDR's model-domain normalization.

## Meaning of each reported quantity

For a selected period \(p\), metric \(m\) and area, let \(E_R\), \(E_T\) and \(E_C\) be annual modeled exports for the reference, treatment and optional control on the shared valid cells.

| Quantity | Calculation | Meaning of a positive value |
| --- | --- | --- |
| Management benefit | \(E_R(p)-E_T(p)\) | Treatment exports less than the reference. |
| Control-adjusted benefit | \(E_C(p)-E_T(p)\) | Treatment exports less than the selected control. |
| Benefit interaction | \([E_R(p)-E_T(p)]-[E_R(p_0)-E_T(p_0)]\) | Benefit is greater than in explicit reference period \(p_0\). |
| Control-adjusted interaction | \([E_C(p)-E_T(p)]-[E_C(p_0)-E_T(p_0)]\) | The control-adjusted contrast is greater than in \(p_0\). |
| Benefit percentage | \(100(E_R-E_T)/E_R\) | The signed benefit relative to the common-support reference export. |

Negative benefit means higher modeled export with treatment. An interaction is a contrast of modeled scenario differences, **not an estimate of observational causation**. The optional control-adjusted quantity is algebraically control minus treatment; it is not a new statistical adjustment or a claim that the control is unbiased.

A zero reference export gives an unavailable percentage, rather than infinity or a substituted denominator. Zero common finite support gives unavailable mass contrasts. The report retains the reason and denominator.

### One common finite mask per metric

For each output metric, the report intersects the finite, non-NoData pixels of **every selected period and scenario role**, within the original reporting mask. That same intersection is used for every period's benefit and interaction. A selected reporting polygon further restricts that shared mask by the original pixel-center rule.

Different metrics can have different common masks. Nitrogen is not forced onto sediment's valid support, and a pairwise comparison is not silently substituted for the all-selected-run mask.

Each metric and reporting area retains:

- reporting cells;
- common finite cells and hectares;
- excluded reporting cells;
- the common-support GeoTIFF;
- every original run's independent finite total, valid cells/hectares, common total, excluded finite total and missing reporting cells.

The independent totals remain useful to inspect coverage. They are **not** substituted into the interaction calculation. Adding a period with more missing data can reduce the common area, so a new selection may differ from a smaller previous comparison. The immutable selection and mask make that change inspectable.

### Original units and one area conversion

This model consumes the original Workspace's converted `run.artifacts`:

- nitrogen/phosphorus export: `kg/pixel/year`;
- sediment export: `metric_tonnes/pixel/year`.

The maintained native adapter has already applied the output-specific rate-to-mass conversion. This report sums those pixels directly to annual kg or metric tonnes. It does **not** multiply the mass totals by pixel area again. Pixel area is used separately to report hectares.

Raw native output names alone do not establish these units. Keep the exact original artifact descriptors and native arguments. Soil loss, delivered sediment, nutrient source loads, retention and export to streams are different quantities. This comparison reports the selected original export artifacts; it does not reinterpret export reduction as local retention, reservoir concentration or downstream in-stream processing.

### Annual precipitation and erosivity

An annual PRISM pattern versus a retained climatological normal is a source-period sensitivity. It is not by itself a climate-change attribution. Publisher station networks, methods, temporal support, resolution and uncertainties stay in the original source bindings. Period labels are explicit annotations, separate from publisher metadata.

With automatic NDR normalization, a uniform proxy multiplier can cancel when valid model-domain support is unchanged. A fixed positive original `runoff_proxy_av` preserves a different magnitude relationship. The report displays the actual retained profile setting and keeps native argument files.

R-factor is selected independently for SDR. Keeping it unchanged is a legitimate explicit design. Changing precipitation does not automatically change R-factor; no undocumented rainfall-ratio conversion is performed.

## Saved products and scientific report composition

A complete report is retained at:

```text
climate-management-reports/<report-id>/
```

Its original files include:

- `report.html`: readable standalone explanation and tables;
- `results.json`: complete numerical result and interpretation metadata;
- `benefits.csv`: period/area/metric benefits and interactions;
- `independent-totals.csv`: all original independent/common/excluded totals;
- `support.csv`: exact per-metric denominators;
- `snapshot.json`: original studies, selected cases, full native run records, source bindings, parameters, scenarios and implementation identity;
- `observed-report.json`: ordinary `upstate.observed-report/v1` source;
- `common-support/*.tif`: the exact finite masks;
- `reporting-area.gpkg`: original reporting geometry;
- available original `native-arguments/`;
- `MANIFEST.json`, `sources.json` and `climate-management-results.zip`.

When result maps are selected, the report also retains the complete original selected annual mass GeoTIFFs and per-period benefit/interaction rasters. Every benefit/interaction map uses the same metric-wide common mask as the tables. Signed raster values retain the original annual mass-per-pixel unit. The common-support raster uses 1 for selected common finite cells and 0 outside.

The report's ordinary source pair is returned as:

```json
{"source_collection_id": "<actual saved collection>", "source_id": "climate-management-report"}
```

Select that retained source in **Scientific Reports**. The existing renderer composes its sections, tables, original files and source links with other selected scientific sources. No second PDF engine or report-specific importer is required. The product is a modeled analysis even though it uses the application's existing `OBSERVED_CONTEXT` transport role.

The typed source collection also exposes the benefits table, original reporting polygon and generated/result rasters for the existing GIS source workflow. A heterogeneous comparison table has no single invented unit: its metric/unit columns and quantity note are authoritative.

HTML display uses approximately eight significant digits. JSON and CSV retain the computed numerical values. CSV text starting with a spreadsheet formula character is apostrophe-prefixed; the exact original text remains in JSON. No original scientific source is modified.

## Original operator/API contracts

The installed extension is `climate-management`. It uses the existing native task queue and original download tickets.

| Operation | Original route or action | Payload |
| --- | --- | --- |
| Catalogue | `GET /api/climate-management/catalog` | Current Workspace key through the ordinary operator. |
| Preview | `POST /api/climate-management/preview` | `{"selection": ...}`. |
| Build | queued `climate-management.build` | `{"selection": ...,"expected_id":"<exact reviewed preview ID>"}`. |
| Open | `GET /api/climate-management/report` | `id=<actual saved report ID>`. |
| Native item | `climate-management-reports` | Original `id`. |

The complete native selection is:

```json
{
  "title": "Original management benefits across retained annual patterns",
  "purpose": "The scientist's actual management question",
  "reference_period_id": "normal",
  "periods": [
    {
      "id": "normal",
      "label": "Original retained reference period",
      "reference": {"study_id": "<actual reference study>", "case_id": "baseline"},
      "treatment": {"study_id": "<actual treatment study>", "case_id": "baseline"}
    },
    {
      "id": "annual-2025",
      "label": "Actual retained annual source period",
      "reference": {"study_id": "<same actual reference study>", "case_id": "<actual prepared case>"},
      "treatment": {"study_id": "<same actual treatment study>", "case_id": "<actual prepared case>"}
    }
  ],
  "reporting_areas": [],
  "difference_maps": true
}
```

These placeholders document the contract; they are not native IDs or a fabricated example run. The catalogue supplies actual available studies/cases. Add a `control` selector to every period only when using an actual third original scenario.

The model API is `catalogue(ws)`, `preview(ws, selection)`, `build(ws, selection, expected_id)`, `get_report(ws, id, verify=True)`, `list_reports(ws)` and `verify_all(ws)`. Routine catalogue/task refresh reads the retained metadata and original source-member binding without rehashing all scientific rasters. An explicit verified open checks the full files and archive.

An original task can be resumed through the original operator. The complete report ID is derived from its frozen scientific identity. A completed record reopens; a partial report directory resumes under its original lock. Changed inputs or changed implementation produce a different reviewed identity. They do not overwrite a completed old report.

## Export, receive and cold reopen

Choose the saved comparison as the typed **Climate and management comparisons** root in the existing selected Study workflow.

The native visitor retains:

1. the exact complete saved report, source manifest, ZIP, JSON, CSV, HTML, masks and selected maps;
2. its explicit reference period and period/role matrix;
3. every named original Climate forcing study through that family's maintained visitor;
4. the original baseline, prepared cases, native grids, profiles, scenarios, source collections, source manifests and scientific outputs;
5. each parent family's frozen captured report membership, including any retained incomplete native work.

All originals remain authoritative. The visitor does not discover later unrelated GIS receipts or recompute the management report. Its receipt records exact member identities. An older archive with an empty management receipt does not acquire a later report during verification.

Use the original Study capture, native download, upload/receive and copied-application reopening operations. In the received Workspace, open the saved comparison, its ordinary Scientific Report source, the CSV/JSON and available maps. Re-export the same selected root to check onward portability. The whole Workspace backup remains available through its existing API.

The guide and published source are implementation deliverables. They are not evidence that a native result or visual receiving course ran. On the accepting original source host, the operator must open, look at and use the actual report and all outgoing attachments at desktop/mobile sizes, inspect one original map/mask and a numerical row, and reopen the copied application before describing the delivery as human-ready. Preserve the accepting host's original process/task IDs and any real exception.

## Component and ownership

The additive model and Study visitor are `model/climate_management.py` and `model/climate_management_study_transfer.py`. They compose the original Climate forcing family, original Study capture, native model/output selection and ordinary scientific report source format.

No changes to native solver, cache, donor matching or forcing-source acquisition are required by this comparison. Original Climate, structural sensitivity, multivariate control, parameter interaction and scientific report owners retain their existing workflows. The component must travel with its declared Climate forcing/Study dependencies and the complete current application source.

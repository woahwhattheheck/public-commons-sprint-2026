# Calibration source-design review

## What the operator gets

The maintained Calibration and validation desk now explains the original source support for the current evaluation before saving a calibration selection. After **Inspect original catchments**, the review reports training and validation coverage for each positive-weight pollutant, the scale used to normalize the training objective, every leave-one-training-group-out fold, and alternative single-group holdouts. The operator can apply a reviewed holdout to the existing draft and download the complete source-design JSON.

The review uses the exact native preview returned by `model.calibration.preview`. It uses the original annual reference units, actual connected spatial groups, source identities and native temporal aggregation. Current group names and merges, candidate runs, objective weights and explicit normalization scales remain operator choices. Candidate prediction coverage continues to be determined by the existing native calibration execution.

## Source support and scoring

A calibration partition needs at least one original annual reference for every pollutant with a positive objective weight. Each pollutant also needs a positive normalization scale. The default scale is the mean of the mean annual references within each selected training group; validation references do not set this scale. An explicit scale retains the operator's source or rationale.

The native objective first averages squared residuals within each spatial group, then averages those group means for each pollutant, divides by its training scale squared and applies the selected relative pollutant weight. The source review exposes the corresponding per-unit squared-residual coefficients. Nitrogen and phosphorus remain kg/year; sediment remains metric tonnes/year. This shows how the design weights individual source units without combining their physical masses.

A held-out group can have useful metrics for only some selected pollutants. The review distinguishes that partial coverage from a complete combined validation objective. Every stability fold is assessed against its own remaining training groups and recalculated training scales. Reserving a group for validation removes it from all subsequent training folds.

Original overlapping upstream catchments and repeated station identities remain connected as defined by the native preview. Naming several groups alike merges them; the review never splits one original connected group. Multiple measurement periods are retained within the original catchment/pollutant reference unit, rather than being counted as new independent spatial groups.

## Actual Upper Savannah source example

The package includes `source/calibration-design/upper-savannah-reference-support.json`, derived from the seven original targets in the published tributary selection at upstream commit `e4c664be8409bf1ba515f9c44fb855279ee86fde`. It pins the original USGS table hashes, native observation-record identifiers and source release. The rows are:

| Original reach | Nitrogen, kg/year | Phosphorus, kg/year | Sediment, metric tonnes/year |
| --- | ---: | ---: | ---: |
| Chattooga 6269342 | 270438.4381 | 96111.0042 | 7201.8484 |
| Broad 6280111 | — | 223025.1307 | 141611.9058 |
| Stevens 11730084 | 139789.3642 | 19086.9896 | — |

The values use the original `ACTUAL` and `ACTUAL_MT` calibration-target fields. Regional predictions in `PLOAD_TOTA` and `PLOAD_MT` are different quantities. The source-global period is 1999-10-01 inclusive through 2014-10-01 exclusive, with 2012 reference conditions. It supplies one long-term mean annual target for each original reach and pollutant; it does not supply fifteen independent annual observations. These annual values are not multiplied by fifteen. Individual target standard errors and station-specific sampling windows are absent from these mapper tables.

The included constituent-incidence derivation treats each of the three supplied reaches as one reference group. With all three in training and nitrogen, phosphorus and sediment selected, all three possible training folds retain source references for all three pollutants. Only the Chattooga held-out group has all three pollutants for a complete combined held-out objective. If Chattooga is reserved for validation, Broad plus Stevens collectively still support the three-pollutant training objective, but leaving either remaining group out removes nitrogen or sediment from training. This exposes the practical tradeoff between the complete external holdout and additional internal stability analysis.

The operational review obtains its groups from actual retained geometries and source station identities. Its results may therefore differ from this explicit constituent-incidence example when overlap or operator merges connect groups. The five-reach, eleven-target broader selection contains nested mainstem upstream basins; five named reaches do not by themselves establish five independent spatial groups.

## Native workflow

1. Import or bind the original annual source with its actual upstream polygons.
2. Choose candidate runs, source records, positive pollutant weights and any sourced normalization scales in the existing Calibration desk.
3. Inspect original catchments. The native preview resolves the source units and connected groups.
4. Review **Source support for this evaluation**. Adjust complete-group roles or names; the design view updates from the same retained preview.
5. Optionally use a reviewed single-group holdout. The draft keeps its objective and group merges; the operator can inspect the resulting training and validation coverage.
6. Save the existing calibration selection and run the native analysis. Full original catchment coverage and actual candidate prediction eligibility remain part of that analysis.
7. Download the source-design review when retaining the planned evaluation alongside its eventual native result.

The extension changes no native calibration, ranking, uncertainty or map formulas. It preserves the existing Calibration task journal, observed-source handoff, source-error sensitivity and residual-map entry points.

## Install into the current application

```sh
python operator/install_calibration_design.py --application /absolute/current/application --source-root /absolute/received/component
```

The installer applies six guarded changes to the existing browser controller and unions one asset into the existing extension descriptor. The included controller and descriptor are complete review postimages for the pinned upstream source. The installer preserves later unrelated current edits whenever the exact six integration seams remain available. A changed seam requires an actual maintained merge. The maintained sixth change discards an in-flight preview when its source selection has changed or become incomplete, so a late response cannot pair earlier source units with a newer selection in the design review or download.

The five additive source files are the design module, patch description, installer, this guide and the original target-incidence reference. Installation retains every changed preimage and writes a pending intent before any feature replacement. It accepts its recorded current/pending additive-file hashes on resume. A completed identical installation returns the same receipt.

## Verification performed

The actual seven source records were resolved from the three original USGS mapper tables and matched to the published tributary selection by their native canonical observation-record IDs. The pure design function was exercised in V8 with those actual constituent incidences, including the all-training and Chattooga-validation designs above. A focused normalization branch check covers zero references and an explicit positive sourced scale. The integrated browser controller passes JavaScript grammar checking, and all six guarded edits reproduce the same bytes on repeat application.

The source-derived example is an incidence calculation. Current native GIS geometry and candidate raster support are resolved by the application's existing preview and analysis.

## Original sources and native method

- USGS Southeast source release: https://doi.org/10.5066/P9A682GW
- Nitrogen calibration targets: https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/37
- Phosphorus calibration targets: https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/36
- Sediment calibration targets: https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer/39
- InVEST 3.20 freshwater calibration guidance: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/calibration_freshwater.html
- Current project source contract: `source_tools/SPARROW_REFERENCE.md`, `source_tools/ANNUAL_REFERENCES.md`, and `model/calibration.py` at the pinned upstream commit.

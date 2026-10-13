# Upper Savannah scientific workspace and GIS delivery

This is the complete source, modeling, review and delivery application for the Upstate Forever EC-SDC mapping opportunity. It extends the original `audit.py` and portable GIS release package with retained source editions, the original InVEST NDR/SDR engines, a browser operator, reviewed land-cover scenarios, quantitative comparisons, parcel priorities and complete receiving.

The original [RFP and appendices](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf) and [SC procurement notice](https://scbo.sc.gov/printad?a=69283) identify a November 6, 2026, 5 p.m. ET proposal deadline, a total project ceiling of $50,000 and final delivery by November 1, 2027. The retained 18-page issuer PDF is 7,470,549 bytes, SHA256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`.

## Open the complete product

Use the original equipped Python environment described in [model/README.md](model/README.md), including InVEST 3.20.0 and its matching GIS dependencies. From this directory:

```sh
python -B -m model.cli runtime
python -B operator/server.py \
  --workspace /absolute/upper-savannah-study \
  --create \
  --title 'Upper Savannah source study' \
  --source-manifest /absolute/retained-source/sources.json
```

Open the complete loopback URL printed by the server. The operator uses the same scientific workspace and model stages as the CLI. Retained work is reopened by omitting `--create`.

The operating guides cover distinct parts of that same application:

| Guide | Complete workflow |
| --- | --- |
| [Scientific workspace](model/README.md) | Source editions, parameter selections, aligned grids, native model runs, quantitative scenarios, observed-load comparisons and portable receiving |
| [Browser operator](operator/README.md) | Source inspection, saved forms, original operation queue, model logs, seven-map delivery, download and restore |
| [Original source preparation](source_tools/README.md) | Native raster preparation, physical units and composing original inputs into one source manifest |
| [Source interpretation](source/SOURCE_METHODS.md) | Basin selection, original hydrology, source vintages and published regional parameters |
| [Complete native receiving](model/NATIVE_RECEIVING.md) | The existing source-to-model-to-delivery run on the selected equipped host |
| [Operator receiving](operator/RECEIVING.md) | Browser operation, retained delivery, full archive and independent reopen |
| [RFP response map](RFP_RESPONSE_MAP.md) | How the original requirements map to the maintained product and partner decisions |

## Source choices that govern the study

The reporting boundary is the original PlanningBasins2023 feature whose `Basin` is `Upper Savannah`, retained with all shapefile companions. The hydrologic model domain is a separate native WBD/ToHUC selection that includes contributing land upstream of the reporting mask. The four original utility-focus HUC12s are a specific subarea used for source-water and initial parcel work. Each of these geometries remains independently identified.

The current source edition retains the original 30-file geography and parameter packet, its metadata and the original source-acquisition program. The combined regional biophysical profile preserves Georgia 2019 nutrient coefficients and Duke 2022 sediment C/P values with row-level lineage. A saved profile identifies its intended current-model semantics and any later scientific revision. Original source bodies and a changed scientific selection stay separately available.

The grid takes the actual projected 30 m NLCD cells as its alignment. Native input units, resampling rules, observation periods, regional coefficient vintages, reporting coverage and upstream extent are retained with the chosen run. The whole working archive carries those choices to the recipient.

## Complete operating journey

1. Import and inspect the original source edition, including source files and their sidecars.
2. Select a referenced biophysical profile, the full reporting boundary and the covering hydrologic domain.
3. Prepare the original 30 m grid with DEM, land cover, precipitation, rainfall erosivity and soil erodibility.
4. Save the observed land-cover baseline and explicit, source-bound alternatives.
5. Run the original NDR and SDR stages. Reopening an interrupted run continues its retained selection and completed stages.
6. Compare quantitative outputs, qualified original annual-load observations and the actual parcel/overlay coverage.
7. Build the seven-family GIS release with physical rasters, metadata, maps, report and scientific working archive.
8. Receive the complete delivery and reopen the original project, selections and results.

See the same original CLI commands and schemas in the model guide. Every browser action calls these maintained operations.

## Original technical release audit

The original delivery manifest schema is `upstate-ec-sdc-2026/delivery-v1`. It binds model identity, source records, the declared upstream buffer, three physical export rasters, seven map PDF roles, metadata and the final report.

The retained raster checks inspect the actual single-band GeoTIFF headers and numeric cells: projected metre CRS, square nonrotated 30 m cells, shared grid, physical export units and useful finite nonnegative data. Map and report review includes their original files, cartography, intended audience and interpretation. `TECHNICAL_PRECHECK_PASS` records the result of the original technical checks; the prime's scientific and publication decisions are separately retained in the project.

The original portable package remains available directly:

```sh
python package_delivery.py pack /absolute/release/manifest.json /absolute/new-package
python package_delivery.py verify /absolute/new-package
```

Open `new-package/index.html` for the original navigator. Include known GIS project dependencies and sidecars in the manifest's `project_assets`. The complete model delivery also exposes one `delivery-package.zip` with the audited package, its complete scientific workspace and a member-bound transfer manifest.

## Current application source

As of October 12, 2026, the complete model, operator, source preparation and receiving programs are published in the original PR34174. The retained native source packet and the original regional profile are in this tree. The original equipped-host work items carry the remaining source acquisition and the full regional run; their result will update this same product's delivery record.


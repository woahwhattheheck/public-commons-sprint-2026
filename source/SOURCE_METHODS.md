# Upper Savannah source methods

This source edition supports the existing Upstate Forever conservation and source-water workbench. It binds the reporting geography, hydrologic context, published parameter references and original provider interfaces to their source editions. Each actual model run records the selected sources, their hashes, the grid, the model version and the operator's parameter choices.

## Project scope and reporting geography

The issuer's October 2026 RFP requests seven map families for the South Carolina Upper Savannah basin at a 30 m working resolution, together with explanatory methods, usable GIS deliverables and conservation priorities. The four HUC12 examples in its appendix are useful focus areas within the wider basin. The original 18-page PDF is retained as `official-rfp.pdf`, 7,470,549 bytes, SHA-256 `04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf`. Its native capture receipt and rendered pages remain with the original source package.

Sources: [issuer RFP](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf), [SCBO notice](https://scbo.sc.gov/printad?a=69283).

The final 2025 South Carolina basin plan supplies a more precise geographic definition than the HUC label alone. Its South Carolina planning area is approximately 3,195 square miles. The broader cross-state drainage includes Georgia and a small North Carolina portion. The downstream limit is the Savannah–Stevens Creek confluence below Thurmond Dam. Its HUC8 context includes Seneca, Tugaloo, Upper Savannah and Stevens, together with the applicable part of Middle Savannah below Thurmond Dam. The complete Savannah HUC6 `030601` extends much farther downstream.

Source: [SCDES final 2025 Upper Savannah River Basin Plan](https://des.sc.gov/sites/des/files/Documents/BOW/Water%20Resources/Hydrology/Upper%20Savannah/FinalUpperSavannahRiverBasinPlan2025.pdf), chapter 2, printed pages 2-1 through 2-3.

Three geography editions are retained independently:

| Retained source | Identity and use |
| --- | --- |
| USGS WBD capture | Native service metadata, complete Savannah HUC6, all ten associated HUC8 features, and the four selected HUC12 focus features. Original geometries and attributes remain in the captured Esri JSON. |
| PlanningBasins2023 | The five original shapefile components from the immutable `capellett/scsf` source commit `45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95`. Its Upper Savannah record is row 5, with 10,285 ring vertices, native NAD83 / UTM zone 17N metres and calculated planar area 8,274.068790 km². Its original DHEC/DNR lineage and metadata remain attached. |
| South Carolina state, 2026 | The full original Census TIGERweb state geometry and January 1, 2026 layer metadata. This is the administrative clipping source. |

The PlanningBasins2023 Upper Savannah polygon (original record 5, selected by Basin = 'Upper Savannah') is the reviewed reporting mask for this delivery, consistent in area with the final basin plan. The operator records the adopted reporting mask separately from the upstream modeling extent. A modeled upstream contribution from Georgia remains attributable to its own hydrologic context when reporting South Carolina conservation priorities.

Sources: [USGS WBD service](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer), [immutable planning-basin files](https://github.com/capellett/scsf/tree/45f7ea3ca968c96e2fc6188d7f55c3b0ce60da95/data-raw/planning_basins2023), [Census state layer](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0).

## Focus watersheds

The native HUC12 response preserves these exact source records:

| HUC12 | Source name | WBD area, km² | Downstream ToHUC |
| --- | --- | ---: | --- |
| 030601010703 | Upper Six and Twenty Creek | 77.41 | 030601010704 |
| 030601010704 | Lower Six and Twenty Creek | 111.71 | 030601010804 |
| 030601020507 | Lower Tugaloo River | 241.56 | 030601030100 |
| 030601020502 | Choestoea Creek | 99.40 | 030601020507 |

These source areas sum to 530.08 km². Their geometries support complete focus-area runs and source-water prioritization. Upstream accumulation follows the retained drainage relationships and actual model grid. A single HUC boundary does not stand in for all of its upstream catchments.

The WBD responses were requested with original geometry, without an output coordinate-system override or a generalization parameter. Their native service CRS is WKID 102100 / latest WKID 3857. The HUC6 service's published simplification metadata is retained. Area calculations for the analytical grid use its explicit projected analysis CRS rather than treating Web Mercator square metres as ground area.

## Published nutrient-reference profiles

The Georgia study by Fabio Jose Benez-Secanho and Puneet Dwivedi, published May 15, 2019, supplies an original regional reference for nitrogen and phosphorus loads and retention. Its original model was InVEST 3.4.2; its NLCD comparison used the 2006 edition. The source HTML, all extracted tables, the two complete biophysical CSV files and their provenance are preserved together.

Source: [original paper and Appendix A](https://www.mdpi.com/2076-3298/6/5/52), DOI [10.3390/environments6050052](https://doi.org/10.3390/environments6050052).

| Profile | Original table | Rows | Published retention lengths | Nitrogen subsurface proportion |
| --- | --- | ---: | --- | ---: |
| NLCD reference | Appendix A1 | 15 | `crit_len_n=30 m`, `crit_len_p=30 m` | 0 |
| GlobCover reference | Appendix A2 | 21 | `crit_len_n=290 m`, `crit_len_p=290 m` | 0 |

The two original tables have different source classes and several different retention values. The importer selects a named profile and an explicit class mapping. Original decimal values and class names remain available for review.

The paper's loading values are in kg/ha/year and its retention efficiencies are dimensionless fractions. Its methods cite export-coefficient literature and measured agricultural loads, with mixed original source lineage. The reference profile therefore records the legacy measured-runoff/export interpretation. Current InVEST versions distinguish `measured-runoff` from `application-rate`; the run specification stores that choice for both nutrients.

Source: [official InVEST version history](https://github.com/natcap/invest/blob/main/HISTORY.rst), NDR loading-semantics change; the original paper, section 2.3.4 and cited loading references.

The study's threshold-flow-accumulation settings were 10,000 cells for the approximately 10 m USGS surface, 1,111 cells for the 30 m surface and 123 cells for the approximately 90 m NASA surface. Its k value of 2 was a retained reference setting in the spatial-resolution experiment. A local calibration is recorded with its own observed loads, time period and objective when those observations are supplied. These 2019 Georgia profiles remain distinguishable from the original 2016 Upstate Forever project inputs.

## Sediment inputs and physical units

The sediment model retains each selected R, K, C and P source independently. The source catalogue gives actual provider routes and units; the chosen raster or table edition is bound in the run manifest.

NRCS Soil Data Access provides the original relational path `legend → mapunit → component → chorizon`. Retain survey area, source version, `mukey`, `cokey`, component percentage, horizon depths, null values, `kffact` and `kwfact`. The source dictionary distinguishes fine-earth K from K adjusted for rock fragments. The representative-value policy and component weighting are explicit choices. Current InVEST SDR documentation specifies a factor of 0.1317 when converting its documented customary K units to SI.

Sources: [NRCS original soil query example](https://nasis.sc.egov.usda.gov/NasisReportsWebSite/limsreport.aspx?report_name=SDA-SVI-related_soi_+properties), [NRCS November 2025 table dictionary](https://sdmdataaccess.sc.egov.usda.gov/documents/TableColumnDescriptionsReport.pdf), [official SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/sdr.html).

The source catalogue also preserves the NOAA/NRCS historical R-factor inventory and the original regional RUSLE2 climate-file routes with their actual historical vintages. Selecting a historical R surface records that time basis alongside current land cover. Published regional C/P values retain their original class definitions and paper provenance before mapping into the current land-cover classes.

For a 30 m by 30 m projected grid cell, the analytical area is 0.09 ha. A model output expressed per hectare is multiplied by the actual cell area in hectares to obtain a per-pixel amount. Nutrient kg and sediment tonnes retain distinct units. The run's actual engine version and output-band unit declaration determine the conversion; report code does not assume that every version emits the same units. NoData remains distinct from measured or modeled zero.

## Elevation, land cover and grid

The original 3DEP ImageServer metadata is retained with its native response hash. It advertises a multi-resolution elevation mosaic, one F32 band and spatial reference 3857. The source selection records the actual elevation product, acquisition version and grid before hydrologic processing. Numeric elevation data, explicit resampling and the selected projected grid remain reproducible in the model source plan.

Source: [3DEP ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer), [3DEP product metadata](https://www.usgs.gov/ngp-standards-and-specifications/3dep-product-metadata).

MRLC's current Annual NLCD CONUS Collection 1.2 was released June 10, 2026 and covers 1985–2025. The MRLC direct downloads and AOI viewer are the published free access routes. The selected year, product, class schema, original file hash and NoData are retained. The current collection is distinct from the Georgia study's 2006 reference classifications.

Sources: [MRLC current data](https://www.mrlc.gov/data), [MRLC tools and collection notice](https://www.mrlc.gov/tools), [MRLC AOI viewer](https://www.mrlc.gov/viewer/).

The analytical grid fixes CRS, affine origin, pixel dimensions, extent, masks and alignment. Categorical land cover uses a categorical resampling policy; continuous physical inputs retain their appropriate interpolation policy. Reporting outputs use the same fixed grid for baseline and scenario comparisons.

## Conservation and parcel joins

PAD-US supplies protected-area inventory, management and GAP-status context. Its complete inventory contains overlapping fee, designation and easement records; the published spatial-analysis derivative removes overlaps using its documented prioritization. The chosen representation and its version are retained. Area-based protection fractions use a union within each parcel or analysis unit so overlaps do not count twice.

Source: [USGS PAD-US 4.1 download and methods](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download), DOI [10.5066/P96WBCHS](https://doi.org/10.5066/P96WBCHS).

South Carolina's effective classified waters are recorded from the published R.61-68/R.61-69 source and associated GIS edition. The SCDES September 25–October 26, 2026 triennial review is a separate proposed edition. Regulatory classification, measured condition, modeled pollutant export and the customer's priority weighting remain separate fields.

Source: [SCDES water quality standards and current review](https://des.sc.gov/programs/bureau-water/water-quality-standards).

Oconee's original public parcel layer exposes polygon geometry, edition-local OBJECTID, GPIN, TMS_NUMBER, acreage, deed/plat references and edit/source fields, with native WKID 2273 and a 1,000-record service page limit. The model preserves parcel identifiers and original source attributes. Geometric overlap with the analysis grid determines physical allocation; coincident names do not establish parcel identity.

Sources: [Oconee GIS department and official parcel viewer](https://oconeesc.com/departments/gis), [original Oconee parcel layer](https://arcserver2.oconeesc.com/arcgis/rest/services/PARCELDATA/MapServer/1).

## Source custody and delivery

The companion inventory records exact original file bytes and hashes. HTTP captures distinguish requested URL, final URL, response time, original body identity and retained gzip identity. Original provider attributes, metadata, table rows and source geometry stay accessible beside derived masks and reports.

Every operated delivery joins the original source edition, grid and parameters to native model outputs, source-water/parcel calculations, staff review decisions, legends and complete receiving exports. Future source refreshes create separate retained editions so an earlier accepted map can still be reopened with its exact inputs.

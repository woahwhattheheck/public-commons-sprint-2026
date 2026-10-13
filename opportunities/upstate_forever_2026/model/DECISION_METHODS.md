# Upper Savannah decision methods

## Purpose and model identity

This companion connects annual nutrient and sediment outputs to conservation, restoration, and investment choices. It compares complete land-cover alternatives, preserves the physical quantities produced by the modeling application, and exposes the effects of costs and parameter choices.

Each decision edition carries its selected physical outputs. An edition can use nitrogen, phosphorus, sediment, or an available subset. Economics, support, sensitivity, and frontier dimensions follow that selected set. An output absent from the edition has no reported reduction. A requested target for an absent output retains its value and an unavailable status, so it cannot qualify an alternative.

The selected application uses **InVEST® 3.20.0**. Each comparison retains the model version, input collection, physical land-cover changes, reporting geometry, and unit basis. A later software release or data edition is an explicit revision of the analysis.

InVEST changed NDR and SDR raster outputs from quantities per pixel to quantities per hectare in version 3.15.0. A model version alone therefore cannot establish the units of a downstream product: the existing application has already converted its derived reporting rasters to annual mass per pixel. [InVEST release history](https://github.com/natcap/invest/blob/main/HISTORY.rst)

## 1. Read the selected quantity before calculating totals

Retain the selected product's path, pollutant, physical quantity, unit basis, annual time basis, model version, grid, and geographic support.

| Selected product | Quantity represented | Conversion to a reporting total |
|---|---|---|
| Native NDR `n_total_export.tif` | Annual nitrogen export, kg/ha/year | Multiply included cell values by cell area in hectares |
| Native NDR `p_surface_export.tif` | Annual phosphorus export, kg/ha/year | Multiply included cell values by cell area in hectares |
| Native SDR `sed_export.tif` | Annual sediment export, metric tonnes/ha/year | Multiply included cell values by cell area in hectares |
| Derived reporting raster labeled `kg/pixel/year` | Annual nutrient mass assigned to each cell | Sum included cell values directly |
| Derived reporting raster labeled `metric_tonnes/pixel/year` | Annual sediment mass assigned to each cell | Sum included cell values directly |
| A supported summary whose `sum_units` already express annual mass | Aggregated mass over its stated support | Use the existing mass value directly |

The native output names and rate semantics follow the selected [NDR 3.20.0 source](https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/ndr/ndr.py) and [SDR 3.20.0 source](https://raw.githubusercontent.com/natcap/invest/3.20.0/src/natcap/invest/sdr/sdr.py). Their execute functions return output registries; adapters use those paths instead of guessing filenames.

The application accepts the retained sediment spelling `metric_tonnes` and converts the displayed result to `t/year`, where t means metric tonne. Nutrient reporting uses `kg/year`.

For a projected raster measured in meters, cell hectares equal the absolute determinant of the two-dimensional pixel transformation divided by 10,000. A complete 30 m square cell covers 0.09 ha. A native density of x kg/ha/year contributes 0.09x kg/year for that cell. An already converted cell mass contributes its existing value.

**Apply area conversion exactly once.** The backend reads the selected product's actual units. A raster labeled only with annual mass, such as `kg/year`, needs explicit `unit_basis: "mass_per_pixel"` to resolve its spatial meaning.

For each pollutant, every available alternative and the baseline use one common finite-cell mask. Different pollutants can have different masks, which remain visible in their respective coverage records. Missing cells do not enter totals as zero.

Original baseline totals describe that output's own valid cells. The paired baseline and alternative totals describe the common comparison cells. Use the paired totals when interpreting reduction percentages.

The boundary extraction method belongs to the product identity. A complete-cell total and a fractional-intersection total have different spatial support. Keep the selected method consistent throughout a comparison.

## 2. Separate hydrologic routing from reporting geography

| Geographic object | Purpose |
|---|---|
| Contributing model domain | Supplies upstream terrain, land cover, and routing needed to calculate export |
| RFP reporting area | Defines where results are summarized and presented |
| Utility intake catchment | Identifies land contributing toward a particular intake |
| Focus watershed or other reporting unit | Provides a stable geography for local comparison |

The model domain includes relevant contributing land across administrative boundaries. The model's watershed inputs must also retain that land; extending the DEM alone cannot repair a watershed mask that removes upstream contributions. Reporting clips follow the required routing.

| Utility | Focus watershed | HUC12 |
|---|---|---|
| Anderson Regional Joint Water System | Upper Six and Twenty Creek | `030601010703` |
| Anderson Regional Joint Water System | Lower Six and Twenty Creek | `030601010704` |
| Pioneer Rural Water District | Choestoea Creek | `030601020502` |
| Pioneer Rural Water District | Lower Tugaloo River | `030601020507` |

Names and identifiers are cross-checked against USGS records for [Upper Six and Twenty](https://nas.er.usgs.gov/Queries/SpecimenViewer.aspx?SpecimenID=263596), [Lower Six and Twenty](https://nas.er.usgs.gov/queries/SpecimenViewer.aspx?SpecimenID=266197), [Choestoea](https://nas.er.usgs.gov/queries/SpecimenViewer.aspx?SpecimenID=263594), and [Lower Tugaloo](https://nas.er.usgs.gov/queries/SpecimenViewer.aspx?SpecimenID=264086). Utility grouping follows the retained RFP appendix.

**The WBD edition selected for the delivered baseline remains the geometry authority.** The live [USGS WBD service](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer) reports an October 2026 refresh. That service does not silently replace the snapshot used by an existing run. Preserve the selected edition, retrieval date, identifiers, and geometry identity; introduce a boundary revision through a matching baseline and alternatives.

Nested or overlapping catchment totals cannot be added as independent contributions. A combined total uses a unique geographic union or disjoint incremental areas.

## 3. Interpret each map family through its decision

These families follow the retained Upper Savannah workshare. The original [issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf) remain the scope authority.

| Map family | Decision supported | Physical interpretation |
|---|---|---|
| Future sediment loss | Where could an alternative increase erosion or sediment delivery? | Compare sediment export with baseline. Display supplied USLE soil-loss layers separately from delivered sediment. |
| Future nutrient runoff | Where would an alternative change nutrient pressure? | Preserve separate annual nitrogen and phosphorus export differences. |
| Critical drinking-water protection | Which contributing lands have the greatest protection value? | Combine intake context, physical changes under explicit alternatives, and the selected planning criteria. |
| High-quality waters | Where are source-designated high-quality waters and their contributing lands? | Preserve the authoritative designation and its source; join modeled pressures as additional information. |
| Current nutrient export | Where does the baseline produce large nutrient contributions? | Display absolute nitrogen and phosphorus export and reporting totals. |
| Current sediment export | Where does the baseline produce large sediment contributions? | Display annual delivered sediment with units and reporting support. |
| Combined pollutant priority | How do selected planning preferences combine the physical results? | Use saved normalization references and weights, with individual components visible. |

Current export and conversion sensitivity serve different decisions. A currently low-export forest can have high protection value if its conversion causes a large increase. A currently high-export area can offer restoration value if an intervention reduces export.

The project includes nutrient-related cyanotoxin concerns and E. coli. Annual modeled loads support pressure assessment; field observations retain their measured quantity, laboratory units, station, date, and method. The [issuer's project announcement](https://www.upstateforever.org/news/upstate-forever-seeks-consultant-for-gis-mapping-and-modeling-services) establishes the project context and participating utilities.

## 4. Preserve the direction of change

For baseline B and alternative S:

- **Export change = S − B.** Positive values mean increased modeled export.
- **Avoided export or reduction = B − S.** Positive values mean an improvement.
- **Percent reduction = 100 × (B − S) / B**, when B is positive.

When baseline export is zero, the percentage is unavailable and the absolute difference remains available. Preserve negative reductions because they show a worsening outcome or a tradeoff.

Each alternative is paired with its baseline under the same model profile, grid, and model version. Sensitivity comparisons also retain the same baseline definition, grid, and model version across profiles.

The semantic scenario identity uses the source collection and ordered physical land-cover patches. Changing a title or descriptive note does not create a different scientific scenario; changing a physical patch does.

## 5. Attribute benefits to the affected catchment

NDR estimates long-term annual nutrient delivery to the stream network. Nitrogen can include surface and subsurface contributions, while phosphorus follows the surface pathway. The native result ends before subsequent in-stream processing and reservoir fate. [Selected NDR method guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)

A source-cell export represents material originating from that cell and delivered downstream. Subtracting export from source load does not locate retention on that same cell. A downstream buffer can change exports attributed to several upstream source cells.

Management evaluation uses the export difference over the affected catchment. Keep the intervention footprint for implementation, alongside the catchment response.

SDR distinguishes soil loss from sediment delivered to streams. It represents overland rill and inter-rill erosion; bank erosion, gullies, and separately supplied sources need their own accounting. Native avoided export includes avoided local erosion and retention of sediment arriving from upslope. [Selected SDR method guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)

Label the native endpoint as delivery to the modeled stream network. Any intake or reservoir load calculation identifies its added transport or trapping method.

**Evaluate a project bundle through its actual joint scenario run.** Isolated project benefits cannot establish the joint effect because one intervention can alter what reaches another. Budget selection therefore operates on complete supplied alternatives. Parcel rows describe the existing case and retain their original coverage and context.

## 6. Compare costs on an explicit basis

A cost record attaches to a reference alternative's run ID and retains currency, capital cost, annual operating cost, horizon, discount rate, source title, source URI, source date, and an optional note.

For a selected-zone edition, state the costed implementation footprint in that note: the complete modeled bundle, or a defined intervention inside the zone. Attach reductions from that same implementation. The bridge carries the supplied cost amount unchanged; any allocation of a shared project cost needs its own documented rule. The companion cost intake provides sourced South Carolina assistance rates and separately identified charge components.

For capital C, constant annual operating cost O, service horizon T, and real discount rate r:

- At r > 0, annualized cost = C × r / [1 − (1 + r)^−T] + O.
- At r = 0, annualized cost = C / T + O.
- Present value = capital plus annual operating cost multiplied by the corresponding annuity present-value factor.

The horizon and discount rate are explicit assumptions. A ten-year cost horizon does not change an annual model output into a ten-year prediction.

Annualized cost divided by a positive annual reduction produces currency/kg for nitrogen or phosphorus and currency/metric tonne for sediment. Label this **annualized cost per unit reduced**. An upfront capital cost divided by annual reduction is a separate capacity metric.

Unknown costs remain unavailable. Zero or negative reductions have no positive-reduction cost-effectiveness value; the signed environmental outcome remains visible.

The budget can specify `capital_limit`, `annualized_limit`, or both, in an explicit currency. Every supplied limit applies to the complete alternative.

## 7. Read prepared criteria and the Pareto frontier correctly

The physical Pareto comparison maximizes the signed reductions of the selected pollutants. Read the reported physical axes with its frontier basis. A dominates B only when A is at least as good in every compared dimension and strictly better in at least one. Exact ties remain tied.

Comparisons occur within groups with identical support identifiers. Annualized cost becomes an additional dimension when all members of that support group have known costs in the same currency. Otherwise the frontier describes the physical dimensions.

A nondominated alternative offers a tradeoff that another supplied member does not improve in every compared dimension. It can still miss a budget or target.

**Prepared decision status and Pareto badges belong to the saved report.** Browser filters change the visible shortlist. They preserve the original assessment and frontier. The sidebar's Prepared criteria button restores the report's budget and targets; Selection request exports the chosen criteria for a new backend assessment.

For an optional combined map priority, select and save a reference for each pollutant, convert each component to that dimensionless scale, apply saved weights, and display the components. Hold the reference fixed across alternatives. Nitrogen, phosphorus, and sediment remain separate physical quantities.

The decision desk's tradeoff analysis uses the selected physical reductions directly. The map-family planning index remains a separately specified product.

## 8. Compare sensitivity on matching support and candidate membership

Each profile pairs an alternative with its own baseline. Sensitivity includes the primary comparison and supplied `sensitivity_comparison_ids`.

The backend requires the same semantic physical scenario, selected physical outputs, and actual support identifiers. A missing or incompatible member retains its reason and makes `complete` false. Its value does not enter the accepted summary.

For accepted paired results, the report retains minimum, maximum, median, q10, q90, improved-member count, and improved fraction. Quantiles use linear interpolation at position (n − 1) × p in the ordered values. These quantities describe the supplied profiles.

The improved fraction counts positive reductions among accepted members. It becomes a probability only under an independently justified probabilistic sampling design. One accepted member remains one member.

Rank ranges use the intersection of semantic candidates present on the same support in every accepted profile. The report retains rank_candidate_count and rank_basis separately from the load summaries. Read a rank against that count: rank 1 of 1 provides no comparison with another alternative.

Useful profile axes include documented uncertainty in source coefficients, retention parameters, runoff inputs, and routing choices. Decision preferences such as weights, targets, and budget stay separate so users can identify the reason a choice changes.

When stream initiation is expressed in pixels, preserve its physical area across resolutions: initiation area in square kilometers equals threshold pixels × cell area in square meters / 1,000,000.

## 9. Preserve the selected source collection

A newly available dataset is a candidate revision. Retain original resolution, period, processing, and units even when an input is resampled to the common analysis grid.

| Input | Primary source | Retained information |
|---|---|---|
| Land cover and impervious surface | [USGS Annual NLCD](https://www.usgs.gov/centers/eros/science/annual-national-land-cover-database) | Collection, year, classes, native resolution, reclassification |
| Elevation | [USGS 3DEP](https://www.usgs.gov/3d-elevation-program/about-3dep-products-services) | Product identity, vertical datum, conditioning, resampling |
| Watershed boundaries | [USGS WBD HUC12](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6) | Selected edition, identifiers, geometry, retrieval date |
| Runoff proxy | [PRISM normals](https://www.prism.oregonstate.edu/normals/) | Variable, period, native resolution, normalization reference |
| Soil attributes | [NRCS gSSURGO](https://www.nrcs.usda.gov/resources/data-and-reports/gridded-soil-survey-geographic-gssurgo-database) | Map-unit join, component/depth aggregation, source units |
| Rainfall erosivity | [JRC GloREDa](https://esdac.jrc.ec.europa.eu/content/global-rainfall-erosivity-database-gloreda-and-monthly-r-factor-data-1-km-spatial-resolution) | R-factor units, period, native resolution, selected surface |

Annual precipitation used as an NDR runoff proxy and rainfall erosivity used by SDR are distinct inputs with separate descriptors and processing paths.

## 10. Use the report as a complete decision edition

Start with the baseline, reference profile, reporting support, model version, and annual units. Read the signed physical reductions before the cost or planning score. Use the saved criteria, view filters, and stated Pareto basis to examine complete alternatives. Inspect sensitivity through its accepted members, exclusions, and candidate basis.

Unavailable alternatives remain identifiable through their original IDs and input reasons. They do not contribute cells or physical totals to the available comparison.

Summary-only compatibility exports retain original saved deltas. The supported same-cell analysis supplies percentages, cost effectiveness, and a decision frontier.

The report preserves the comparison, inputs, costs, and assumptions underlying each complete alternative.

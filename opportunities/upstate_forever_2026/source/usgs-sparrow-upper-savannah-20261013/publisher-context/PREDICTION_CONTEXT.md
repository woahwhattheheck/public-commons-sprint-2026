# Five-reach SPARROW prediction and source-budget context

**All fifteen original predictions are present: five reaches × nitrogen, phosphorus and suspended sediment.** This chapter resolves the publisher's abbreviations using its actual retained index HTML and referenced JavaScript, then preserves every metric and source component. It adds no native solve or fitted model. Historical calibration tables remain a separate edition.

## Publisher-backed field and unit mapping

The actual publisher code maps layer0 to phosphorus,9 to nitrogen and27 to suspended sediment. Its catchment definitions label nutrient mass in kg and sediment mass in MT; its HTML defines those loads as mean annual and MT as metric tons. The combination establishes kg/year and metric tonnes/year, consistent with the original XML release dictionary. This is stronger evidence than the abbreviated ArcGIS aliases alone.

| Field | Meaning | Nitrogen / phosphorus | Suspended sediment | Support |
|---|---|---|---|---|
| ACCL | Accumulated load (kg) | kg/year | metric_tonnes/year | reach_accumulated |
| INCL | Incremental load (kg) | kg/year | metric_tonnes/year | reach_incremental |
| ACCY | Accumulated yield (kg/km2) | kg/km2/year | metric_tonnes/km2/year | reach_accumulated |
| INCY | Incremental yield (kg/km2) | kg/km2/year | metric_tonnes/km2/year | reach_incremental |
| DACCL | Delivered accumulated load (kg) | kg/year | metric_tonnes/year | delivered_to_coastal_target |
| DINCL | Delivered incremental load  (kg) | kg/year | metric_tonnes/year | delivered_to_coastal_target |
| DACCY | Delivered accumulated yield (kg/km2) | kg/km2/year | metric_tonnes/km2/year | delivered_to_coastal_target |
| DINCY | Delivered incremental yield (kg/km2) | kg/km2/year | metric_tonnes/km2/year | delivered_to_coastal_target |
| CONCENTRAT | Predicted mean-annual flow-weighted concentration | mg/L | mg/L | Accumulated reach |
| DEL_FRAC | Fraction reaching the retained downstream coastal target | unitless | unitless | TARGET is preserved |

**Incremental does not mean hillslope-only:** the publisher includes attenuation over half the incremental reach. Accumulated loads include upstream reach attenuation. Delivered loads target the Atlantic Ocean in every selected row; they do not represent delivery to the selected station.

## Complete fifteen-row accumulated / local / coastal view

Values displayed to two decimals; complete originals and full precision remain in JSON/CSV. No totals are added across reaches. INCL is the local incremental value; ACCL is the entire upstream accumulated value.

| Reach | Constituent | Unit | ACCL | INCL | DACCL | DINCL | Concentration mg/L | Delivery fraction |
|---|---|---|---:|---:|---:|---:|---:|---:|
| Chattooga | nitrogen | kg/year | 254839.31 | 1440.41 | 103315.31 | 583.96 | 0.4871 | 0.4054 |
| Chattooga | phosphorus | kg/year | 32735.77 | 217.61 | 4300.18 | 28.59 | 0.0626 | 0.1314 |
| Chattooga | sediment | metric_tonnes/year | 32423.86 | 141.35 | 667.64 | 2.91 | 61.9735 | 0.0206 |
| Broad | nitrogen | kg/year | 1689403.13 | 2483.76 | 1078473.42 | 1585.57 | 1.4710 | 0.6384 |
| Broad | phosphorus | kg/year | 250901.58 | 408.69 | 113092.07 | 184.21 | 0.2185 | 0.4507 |
| Broad | sediment | metric_tonnes/year | 197228.43 | 342.41 | 31313.40 | 54.36 | 171.7302 | 0.1588 |
| Stevens | nitrogen | kg/year | 291263.64 | 312.26 | 210274.95 | 225.43 | 1.4455 | 0.7219 |
| Stevens | phosphorus | kg/year | 45212.61 | 47.99 | 30744.98 | 32.63 | 0.2244 | 0.6800 |
| Stevens | sediment | metric_tonnes/year | 52280.52 | 27.13 | 17861.56 | 9.27 | 259.4526 | 0.3416 |
| Jackson | nitrogen | kg/year | 5674677.98 | 346.59 | 4604802.40 | 281.24 | 0.9160 | 0.8115 |
| Jackson | phosphorus | kg/year | 577898.09 | 42.21 | 457816.72 | 33.44 | 0.0933 | 0.7922 |
| Jackson | sediment | metric_tonnes/year | 364832.17 | 6.91 | 138883.85 | 2.63 | 58.8883 | 0.3807 |
| Cohens | nitrogen | kg/year | 5753623.29 | 6941.20 | 5082364.64 | 6131.39 | 0.8633 | 0.8833 |
| Cohens | phosphorus | kg/year | 569791.65 | 809.71 | 496114.48 | 705.01 | 0.0855 | 0.8707 |
| Cohens | sediment | metric_tonnes/year | 269358.60 | 287.90 | 151868.47 | 162.32 | 40.4171 | 0.5638 |

## Source allocations and scale

The full export has120 metric budgets and880 source-component values, covering all eight mass/yield/delivered metrics. Each budget preserves original total, component sum and exact sum-minus-total residual. Shares are descriptive publisher-model allocations; small residuals remain visible and are never silently balanced.

| Reach | Constituent | Largest accumulated component | Share | Largest local incremental component | Share | INCL / ACCL |
|---|---|---|---:|---|---:|---:|
| Chattooga | nitrogen | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 62.29% | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 52.13% | 0.5652% |
| Chattooga | phosphorus | Natural Sources | 91.37% | Natural Sources | 78.61% | 0.6647% |
| Chattooga | sediment | Forested Land and all surficial geology classes | 67.83% | Forested Land and all surficial geology classes | 56.74% | 0.4359% |
| Broad | nitrogen | Manure, including indirect transport through atmosphere to stream | 66.00% | Manure, including indirect transport through atmosphere to stream | 49.86% | 0.1470% |
| Broad | phosphorus | Manure | 56.55% | Natural Sources | 49.22% | 0.1629% |
| Broad | sediment | Agricultural Land and Residuum in sedimentary rock(discontinuous) | 36.56% | Agricultural Land and Residuum in sedimentary rock(discontinuous) | 52.06% | 0.1736% |
| Stevens | nitrogen | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 54.45% | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 70.82% | 0.1072% |
| Stevens | phosphorus | Natural Sources | 76.57% | Natural Sources | 97.05% | 0.1061% |
| Stevens | sediment | Forested Land and all surficial geology classes | 27.39% | Transitional Land and Alluvium and residuum in very fine - grained sedimentary rock and igneous and metamorphic rock | 58.15% | 0.0519% |
| Jackson | nitrogen | Manure, including indirect transport through atmosphere to stream | 39.07% | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 74.16% | 0.0061% |
| Jackson | phosphorus | Natural Sources | 43.55% | Natural Sources | 99.80% | 0.0073% |
| Jackson | sediment | Agricultural Land and Residuum in sedimentary rock(discontinuous) | 24.94% | Channel Sources | 95.85% | 0.0019% |
| Cohens | nitrogen | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 38.86% | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background | 68.71% | 0.1206% |
| Cohens | phosphorus | Natural Sources | 45.90% | Natural Sources | 91.24% | 0.1421% |
| Cohens | sediment | Agricultural Land and Residuum in sedimentary rock(discontinuous) | 24.36% | Transitional Land and Alluvium and residuum in very fine - grained sedimentary rock and igneous and metamorphic rock | 33.42% | 0.1069% |

### Interpretation for the existing model workflow

- Chattooga's accumulated phosphorus is dominated by the publisher's Natural Sources component; Broad has a different source mix. These model allocations cannot be reused as directly measured loading coefficients.
- Nitrogen labels for fertilizer and manure explicitly include indirect atmospheric transport. The separately named atmospheric S5 category must not be relabeled as all atmospheric delivery.
- Local and accumulated mixtures differ sharply. Jackson's local sediment is dominated by Channel Sources, whereas its accumulated sediment carries upstream land-cover/geology components. A hillslope sediment-export model does not include an equivalent direct channel-source term by default.
- The incremental fraction of accumulated mass is small at the selected reaches. Matching only a reach ID or annual unit would hide the difference between a local incremental catchment and the whole upstream watershed.
- Delivered load uses the original coastal target and delivery fraction. Do not subtract it from the station load and call the difference a measured local removal.
- Report attribution, source period, quantity, fraction and catchment support in the original WO28 selection. The source-map JSON supplies documented labels, not automatic comparable status.

## Full publisher source-key definitions

### nitrogen

| Source suffix | Exact publisher label |
|---|---|
| S1 | Municipal Wastewater Treatment Discharge |
| S2 | Urban Land |
| S3 | Farm Fertilizer, including indirect transport through atmosphere to stream |
| S4 | Manure, including indirect transport through atmosphere to stream |
| S5 | Atmospheric Emissions and Subsequent Deposition from Power Plants, Other Industry, Vehicles, and Background |

### phosphorus

| Source suffix | Exact publisher label |
|---|---|
| S1 | Municipal Wastewater Treatment Discharge |
| S2 | Urban Land |
| S3 | Farm Fertilizer |
| S4 | Manure |
| S5 | Phosphate Mining |
| S6 | Natural Sources |

### sediment

| Source suffix | Exact publisher label |
|---|---|
| S1 | Urban Land and Alluvium and residuum in very fine- grained sedimentary rock and igneous and metamorphic rock |
| S2 | Urban Land and Residuum in sedimentary rock(discontinuous) |
| S3 | Urban Land and Fine - and medium - grained sediments, residuum in alluvium, and residuum in carbonate and fine - grained sedimentary rock |
| S4 | Agricultural Land and Alluvium and residuum in very fine - grained sedimentary rock and igneous and metamorphic rock |
| S5 | Agricultural Land and Residuum in sedimentary rock(discontinuous) |
| S6 | Agricultural Land and Fine - and medium - grained sediments, residuum in alluvium, and residuum in carbonate and fine - grained sedimentary rock |
| S7 | Transitional Land and Alluvium and residuum in very fine - grained sedimentary rock and igneous and metamorphic rock |
| S8 | Transitional Land and Residuum in sedimentary rock(discontinuous) |
| S9 | Transitional Land and Fine - and medium - grained sediments, residuum in alluvium, and residuum in carbonate and fine - grained sedimentary rock |
| S10 | Forested Land and all surficial geology classes |
| S11 | Channel Sources |

## Calibration and current prediction editions

All11 overlapping old calibration PLOAD and current prediction ACCL values differ. The magnitude varies: some nitrogen differences are extremely small, while sediment differs materially. Source rounding or later source revisions may contribute, but this packet does not establish cause. Keep both exact editions; this table is not a trend or a native residual.

| Reach | Constituent | Old PLOAD | Current ACCL | Current − old | Relative % | Unit |
|---|---|---:|---:|---:|---:|---|
| Chattooga | nitrogen | 254839.3072 | 254839.3066 | -0.0005999999993946403 | -0.000000 | kg/year |
| Chattooga | phosphorus | 32731.5194 | 32735.7713 | 4.251899999999296 | 0.012990 | kg/year |
| Chattooga | sediment | 33071.8723 | 32423.8616 | -648.0107000000025 | -1.959401 | metric_tonnes/year |
| Broad | nitrogen | No calibration row | 1689403.1287 | — | — | kg/year |
| Broad | phosphorus | 251048.0444 | 250901.5849 | -146.4595000000263 | -0.058339 | kg/year |
| Broad | sediment | 201128.2778 | 197228.429 | -3899.848800000007 | -1.938986 | metric_tonnes/year |
| Stevens | nitrogen | 291263.6422 | 291263.6382 | -0.0040000000153668225 | -0.000001 | kg/year |
| Stevens | phosphorus | 45203.4859 | 45212.6075 | 9.12159999999858 | 0.020179 | kg/year |
| Stevens | sediment | No calibration row | 52280.5156 | — | — | metric_tonnes/year |
| Jackson | nitrogen | 5674678.1205 | 5674677.9751 | -0.1453999998047948 | -0.000003 | kg/year |
| Jackson | phosphorus | 578111.7842 | 577898.0923 | -213.69189999997616 | -0.036964 | kg/year |
| Jackson | sediment | No calibration row | 364832.1673 | — | — | metric_tonnes/year |
| Cohens | nitrogen | 5753623.402 | 5753623.2861 | -0.11589999962598085 | -0.000002 | kg/year |
| Cohens | phosphorus | 569956.099 | 569791.6542 | -164.4448000000557 | -0.028852 | kg/year |
| Cohens | sediment | No calibration row | 269358.6005 | — | — | metric_tonnes/year |

The actual app also labels calibration ACTUAL as Beale-or-Fluxmaster estimated TN/TP load and PLOAD as SPARROW estimated load, in kg/year. Its sediment popup identifies ACTUAL_MT as SSC-or-TSS and PLOAD_MT as SSC, in MT/year. These publisher-backed units resolve the earlier dictionary-only uncertainty; the prior calibration chapter remains an exact historical analysis edition. The popup calls TSS_CONV a conversion factor, but the negative retained value is interpreted through report equation3 as a log coefficient. Preserve the original coefficient and the separately derived published-method context, not a direct negative multiplier.

## Reusable scientific selection guidance

For ACCL select external_model_estimate / annual_mass_rate / reach_accumulated; for INCL select reach_incremental and retain half-reach attenuation. Delivered quantities require an explicitly different coastal-target support definition. Yield and concentration remain separate quantities. Suspended sediment is the publisher's analytical fraction, not an automatic equivalence to native total sediment export. A record remains context-only unless the original scientific assessment establishes quantity, fraction, spatial and temporal compatibility.

Complete original support fields include numeric COMID_ORIG, decorated COMID, STRM_NAME, GP1/GP2/GP3, TARGET, CUMAREAKM2 and INCAREAK_1. The latter is a truncated publisher extra-field alias qualified against the dictionary's IncAreaKm2; the original name/value is never rewritten. No geometry rings were returned. Source rows alone do not establish the native catchment boundary.

## Original sources and reproduction

| Role | Bytes | SHA256 | Source |
|---|---:|---|---|
| publisherHtml | 61841 | de9a0426af64a791e88fb67d5682c2e9fbb2c2305cf79116b57d553ae9249d9f | https://apps.usgs.gov/sparrow/sparrow-southeast-2012/ |
| publisherJavaScript | 106565 | dc0f7551a5101e543a0699b3b4bef95713df258e76b43b075ecc7d5676c81d13 | https://apps.usgs.gov/sparrow/sparrow-southeast-2012/scripts/combined.js |
| receivedPredictions | 143661 | d1904b8730b0f1209f71489bfb93cb0dd9d5222cabaf702b86168d6412b13827 | received-predictions.json |
| nitrogenCalibration | 139120 | f7e2bb7c22c644bf618d48e8fbb0729b44ab5c1f5343fb4a61261fd460911f48 | b2782e54fe4edf261b726fa0cd1f6c7403274cf8 |
| phosphorusCalibration | 136921 | 6e70bccc5666d8e4bd3389026bfc1242516817c462e4149c063b5e678c8a1ec0 | 07640c9b8ba4aa9d0e35f5fa915a036e9e1cbca2 |
| sedimentCalibration | 107033 | 81b0ee67b2898e4b3c9c95a04253eb98a9f3dabc29bb5a41f463ee609041b91e | 25e151d3ca35581d94c722ef129f7fb9d37f09a3 |
| dictionary | 174636 | 236439342336e3ceb0fe749335f5893910793eeb6fad25cd6aad8ebe099f067d | 58c760277208323c694cfc68482905e1626fd5d6 |

The complete input packet retains original texts and provider receipts. The small analyze.cjs recipe reproduces field-map JSON, complete result, this chapter and three CSVs from those originals without network access. Publisher HTML: https://apps.usgs.gov/sparrow/sparrow-southeast-2012/ ; exact configuration: https://apps.usgs.gov/sparrow/sparrow-southeast-2012/scripts/combined.js ; data release: https://doi.org/10.5066/P9A682GW ; scientific report: https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf .

## Boundaries

- Original received prediction edition remains distinct from original calibration PLOAD edition; all eleven overlaps differ and neither replaces the other.
- Accumulated load includes upstream sources and attenuation; incremental load includes within-catchment sources and half-reach attenuation. Neither is automatically the native NDR/SDR landscape-to-stream quantity.
- Delivered quantities target the retained coastal TARGET, here Atlantic Ocean. They are not amounts delivered to the selected monitoring station.
- Source contributions are model allocations, not observed emissions or experimentally isolated causal effects. Nitrogen fertilizer/manure labels include indirect atmospheric pathways; do not relabel all atmospheric transport as S5.
- Sediment source labels distinguish land cover and surficial geology plus channel sources. Full eleven-component labels and original fields are retained.
- Current rows have no geometry. Shape_Length/Shape_Area attributes are not polygon rings or a verified native catchment geometry.
- Original HTTP status/headers are unknown in the receiving packet. Full query intervals, original six source bodies and their byte hashes remain retained.
- No loads are summed across the five potentially nested reaches, no fitting or uncertainty estimate is invented, and no missing calibration cell is replaced.
- Source totals and shares retain published rounding residuals; no balancing component or normalization is applied.
- This source analysis ran as a complete pure calculation over retained files. Native implementation/runtime and rendered recipient acceptance remain the original equipped receiving course.

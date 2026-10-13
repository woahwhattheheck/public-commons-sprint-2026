# Five-reach published SPARROW calibration context

The complete retained regional tables yield **11 matches across 15 requested reach–constituent combinations**. All 1,582 regional records remain in the JSON/CSV exports; exact original table texts and dictionary remain in the input packet. This is publisher calibration context, not independent validation or a native model run.

## Exact requested reaches

| Reach | COMID | Nitrogen | Phosphorus | Sediment |
|---|---:|---|---|---|
| Chattooga | 6269342 | Published row | Published row | Published row |
| Broad | 6280111 | No exact calibration row | Published row | Published row |
| Stevens | 11730084 | Published row | Published row | No exact calibration row |
| Jackson | 22724211 | Published row | Published row | No exact calibration row |
| Cohens | 22726623 | Published row | Published row | No exact calibration row |

## Original values and unadjusted arithmetic

TN and TP retain `ACTUAL` / `PLOAD_TOTA`; sediment retains `ACTUAL_MT` / `PLOAD_MT`. **Physical units for these mapper aliases remain unresolved.** Related dictionary units are preserved below but are not silently assigned to different fields. Difference = PLOAD − ACTUAL; relative percent = 100 × difference / ACTUAL; ratio = PLOAD / ACTUAL. Display is rounded; exports retain original values and full computed precision.

| Reach | Constituent | ACTUAL field value | PLOAD field value | Raw difference | Raw % | PLOAD/ACTUAL | OBJECTID |
|---|---|---:|---:|---:|---:|---:|---:|
| Chattooga | nitrogen | 270438.44 | 254839.31 | -15599.13 | -5.77 | 0.9423 | 96 |
| Chattooga | phosphorus | 96111.00 | 32731.52 | -63379.48 | -65.94 | 0.3406 | 94 |
| Chattooga | sediment | 7201.85 | 33071.87 | 25870.02 | 359.21 | 4.5921 | 63 |
| Broad | nitrogen | — | — | — | — | — | No row |
| Broad | phosphorus | 223025.13 | 251048.04 | 28022.91 | 12.56 | 1.1256 | 95 |
| Broad | sediment | 141611.91 | 201128.28 | 59516.37 | 42.03 | 1.4203 | 64 |
| Stevens | nitrogen | 139789.36 | 291263.64 | 151474.28 | 108.36 | 2.0836 | 431 |
| Stevens | phosphorus | 19086.99 | 45203.49 | 26116.50 | 136.83 | 2.3683 | 423 |
| Stevens | sediment | — | — | — | — | — | No row |
| Jackson | nitrogen | 4002243.79 | 5674678.12 | 1672434.33 | 41.79 | 1.4179 | 579 |
| Jackson | phosphorus | 626063.27 | 578111.78 | -47951.48 | -7.66 | 0.9234 | 569 |
| Jackson | sediment | — | — | — | — | — | No row |
| Cohens | nitrogen | 4031255.29 | 5753623.40 | 1722368.11 | 42.73 | 1.4273 | 580 |
| Cohens | phosphorus | 636588.09 | 569956.10 | -66631.99 | -10.47 | 0.8953 | 570 |
| Cohens | sediment | — | — | — | — | — | No row |

## What deserves investigation

1. **Stevens has large positive raw differences for both nutrients:** TN +108.36% and TP +136.83%. Check the exact `scSV-354` load-estimation method, reference period, station/catchment support and source components before attributing this disagreement to our native model.
2. **Chattooga differs by constituent:** TN −5.77%, TP −65.94%, and sediment raw ratio 4.5921. Nutrient identifiers are composite `comb600_6269342` / `comb665_6269342`; sediment is `02177000`. Preserve those distinct identifiers rather than assuming homogeneous measured references.
3. **Jackson and Cohens have the same direction in nutrient arithmetic:** TN roughly +42%, TP roughly −8% to −10%. This does not establish statistical independence or common cause. Do not sum nested loads or count them as independent experiments.
4. **Broad has no exact TN calibration row**, but TP and sediment are present. Absence does not establish no nitrogen monitoring/prediction; the separately owned prediction acquisition remains necessary.
5. **Sediment has a published method adjustment:** Chattooga and Broad both retain `CONSTITUEN=TSS`, `TSS_CONV=-1.1735`. Across the regional table, 383 rows have that pair; 12 are `SUSPSED` with zero. The official report equation3 defines the TSS-to-SSC-equivalent model relationship. The separate derived section applies it conditionally while preserving every original raw value; it does not create new measurements or independent validation.

## Published-method SSC-equivalent context

The official [USGS SIR2019-5135 report, page60 and equation3](https://pubs.usgs.gov/sir/2019/5135/sir20195135.pdf) gives: suspended-sediment load = total suspended solids load × [1/exp(bCONVERT)]. This edition applies that relationship to the retained TSS_CONV coefficient only when CONSTITUEN is TSS and the coefficient is finite/negative; SUSPSED with zero is retained unchanged. Other patterns are flagged without conversion. The factor uses the exact retained -1.1735, not the report's rounded 3.23. This is a conditional model-method interpretation of matching field names/patterns, not a direct definition of mapper aliases or a new observation.

| Reach | Original ACTUAL_MT | Original TSS_CONV | Exact-factor display | Derived SSC-equivalent ACTUAL | Published PLOAD_MT | Derived raw % | Derived PLOAD/ACTUAL |
|---|---:|---:|---:|---:|---:|---:|---:|
| Chattooga | 7201.85 | -1.1735 | 3.23328937 | 23285.66 | 33071.87 | 42.03 | 1.4203 |
| Broad | 141611.91 | -1.1735 | 3.23328937 | 457872.27 | 201128.28 | -56.07 | 0.4393 |

Chattooga's raw ratio therefore compares a different analytical basis until this model method is considered. The adjusted results are useful for investigating lineage; they are not evidence that the native landscape-to-stream model is right or wrong. Sediment observations are absent for the remaining three targets in this table, so no derived values are created for them.

## Regional context, every record retained

These descriptive summaries are not performance targets. The JSON empirical percentile counts same-constituent rows with absolute raw relative difference less than or equal to the selected row. It is not significance, confidence or a quality grade.

| Constituent / lineage | Rows | PLOAD above raw ACTUAL | Below raw | Median raw relative % | Median published-method relative % |
|---|---:|---:|---:|---:|---:|
| nitrogen / all | 598 | 338 | 260 | 6.37 | — |
| phosphorus / all | 589 | 349 | 240 | 13.14 | — |
| sediment / all | 395 | 386 | 9 | 253.62 | — |
| TSS / TSS_CONV=-1.1735 | 383 | 379 | 4 | 262.72 | 12.18 |
| SUSPSED / TSS_CONV=0 | 12 | 7 | 5 | 14.63 | 14.63 |

## Dictionary definitions and unresolved mapping

The full original `P9A682GW-original-metadata.xml` defines model input/output variables. It does not directly define mapper labels `ACTUAL`, `PLOAD_TOTA`, `ACTUAL_MT`, `PLOAD_MT` or `TSS_CONV`. Related dictionary variables below are therefore distinct from the exact mapper fields being compared.

| Dictionary variable | Original definition | Original unit |
|---|---|---|
| flux_530_final | Detrended mean annual suspended solids load, kg/yr | kilograms per year |
| flux_154_final | Detrended mean annual suspended-sediment load, kg/yr | kilograms per year |
| flux_600_final | Detrended mean annual total nitrogen load, kg/yr | kilograms per year |
| flux_665_final | Detrended mean annual total phosphorus load, kg/yr | kilograms per year |
| flux_c80154_MG | Mean annual (for the decade centered on 2012) sediment load at monitoring sites, kilograms/yr; load is for suspended-sediment at sites where available, otherwise is for total suspended solids | kilograms per year |
| al_tn | Accumulated nitrogen load, kg/yr | kilograms per year |
| al_tp | Accumulated total phosphorus load, kg/yr | kilograms per year |
| al_ss | Accumulated suspended-sediment load | metric tons per year |

The dictionary source period is 1999-10-01 through 2014-09-30 for calibration targets and some inputs. Annual loads include detrended and long-term mean estimators, not literal single-year samples. Routed stream behavior differs from the native landscape-to-stream boundary. Shared monitoring-derived fitting data may overlap other references; agreement cannot be titled independent validation.

## Practical WO28 use

Use this as publisher-fit context. Any native/reference comparison still uses the original WO28 selections with explicit quantity, fraction, time, catchment support and fitting lineage. Keep uncertain mappings context-only. Prediction records still come from the existing five-reach source acquisition. Original rows, regional targets and field definitions remain downloadable.

## Source identity

| Retained source | Bytes | SHA256 | Git blob |
|---|---:|---|---|
| source/usgs-southeast-sparrow-2012/nitrogen-calibration.json | 139120 | f7e2bb7c22c644bf618d48e8fbb0729b44ab5c1f5343fb4a61261fd460911f48 | b2782e54fe4edf261b726fa0cd1f6c7403274cf8 |
| source/usgs-southeast-sparrow-2012/phosphorus-calibration.json | 136921 | 6e70bccc5666d8e4bd3389026bfc1242516817c462e4149c063b5e678c8a1ec0 | 07640c9b8ba4aa9d0e35f5fa915a036e9e1cbca2 |
| source/usgs-southeast-sparrow-2012/sediment-calibration.json | 107033 | 81b0ee67b2898e4b3c9c95a04253eb98a9f3dabc29bb5a41f463ee609041b91e | 25e151d3ca35581d94c722ef129f7fb9d37f09a3 |
| source/usgs-southeast-sparrow-2012/P9A682GW-original-metadata.xml | 174636 | 236439342336e3ceb0fe749335f5893910793eeb6fad25cd6aad8ebe099f067d | 58c760277208323c694cfc68482905e1626fd5d6 |

Primary sources: [USGS data release](https://doi.org/10.5066/P9A682GW), [Hoos and Roland 2019](https://pubs.usgs.gov/publication/sir20195135), [Southeast mapper](https://gis1.wim.usgs.gov/server/rest/services/Sparrow/SparrowSoutheast/MapServer). Transport here is exact original Git blobs, not a new ArcGIS acquisition.

## Boundaries

- Publisher calibration context only: no new native model result, fitting, prediction capture or independent validation.
- ACTUAL/PLOAD mapper aliases are retained. The original dictionary defines related flux and reach-output variables but not these aliases or TSS_CONV. Physical-unit mapping remains unresolved; no physical-unit conversion is applied. The separately labeled published-method sediment context changes analytical basis conditionally.
- Differences/ratios are arithmetic on published field pairs. No physical interpretation is inferred until matching fraction, support and mapper conventions are established.
- TSS and SUSPSED lineages remain separate. A distinct conditional published-method SSC-equivalent column applies original TSS_CONV using USGS report equation3 only to recognized original TSS/negative-coefficient or SUSPSED/zero patterns. No original value is overwritten; unexpected patterns remain unadjusted. Neither raw nor derived ratios are held-out validation or fit-quality grades.
- The dictionary period 1999-10-01 through 2014-09-30 covers calibration targets and some inputs. Detrended or long-term mean loads are not literal single-year 2012 measurements.
- Native NDR/SDR landscape-to-stream quantities differ from routed stream loads. These numbers do not establish comparable native support.
- No loads are summed across constituents or nested reaches; no confidence interval, pass threshold, model ranking or causal attribution is inferred.
- Missing exact COMID matches remain missing, never zero or a nearby substitute.
- Original HTTP metadata/times are not present in these Git receipts; source edition is pinned by complete blobs and SHA256.

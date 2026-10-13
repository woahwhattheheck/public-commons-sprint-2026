# Original headwaters demonstration: source loading, native delivery and routing

**SIMULATED DEMONSTRATION INPUTS; ORIGINAL COMPLETED NATIVE OUTPUTS**

## Decision and scope

In the original completed 1,296 ha simulated teaching case, corridor restoration reduces modeled stream export more than the matched off-corridor control for nitrogen, phosphorus and sediment under all four retained profiles. Both alternatives change the same 635 original cells (57.15 ha), with the same pasture/crop counts and closely matched precipitation. The ranking holds within each profile's exact common support.

This report joins the completed twelve original InVEST 3.20.0 runs to the independently replayed input chapter. It retains the original generated square, assumed physical/biophysical inputs, exact run/profile IDs and full numerical source. The Upper Savannah geographic edition is a separate case.

| Quantity | Retained value |
| --- | --- |
| Native course | 12/12 complete |
| Grid | 120 × 120; 30 m; EPSG:26917; 1,296 ha |
| Each changed layout | 635 cells; 57.15 ha |
| Profiles | MFD / D8 × SDR Lmax 122 / 333 |
| N and P units | kg/year delivered to modeled streams |
| Sediment units | metric tonnes/year delivered to modeled streams |

Read these as modeled annual masses. The report does not convert them into intake concentration or measured water quality; a receiving-water and flow/concentration analysis has its own source and support.

## Source change and placement

The original full-grid source arithmetic gives nearly equal assumed nutrient-source changes: corridor versus control reductions are 891.301394 versus 891.288826 kg N/year and 72.906282 versus 72.905246 kg P/year. Their differences are 0.0125676163 kg N/year and 0.0010358655 kg P/year. All four original profile records name the exact same coefficient-table SHA as that replay.

Native stream-export reductions therefore differ substantially despite nearly balanced source-loading changes. The comparison supports a placement-sensitive model result. It does not isolate distance from the generated stream axis as a single causal variable: the retained layouts also differ in elevation and in opposing class-specific K factors. Original changes in cover/retention and routing remain part of the modeled intervention.

| Profile | Pollutant | Corridor reduction | Control reduction | Extra corridor reduction | Reduction ratio |
| --- | --- | --- | --- | --- | --- |
| MFD/122 | Nitrogen (kg/year) | 2646.863 | 1099.860 | 1547.003 | 2.4065 |
| MFD/122 | Phosphorus (kg/year) | 212.165 | 89.026 | 123.139 | 2.3832 |
| MFD/122 | Sediment (t/year) | 127.911 | 113.907 | 14.004 | 1.1229 |
| MFD/333 | Nitrogen (kg/year) | 2646.863 | 1099.860 | 1547.003 | 2.4065 |
| MFD/333 | Phosphorus (kg/year) | 212.165 | 89.026 | 123.139 | 2.3832 |
| MFD/333 | Sediment (t/year) | 127.911 | 113.907 | 14.004 | 1.1229 |
| D8/122 | Nitrogen (kg/year) | 2685.037 | 1002.367 | 1682.671 | 2.6787 |
| D8/122 | Phosphorus (kg/year) | 215.194 | 81.271 | 133.923 | 2.6479 |
| D8/122 | Sediment (t/year) | 396.860 | 201.005 | 195.855 | 1.9744 |
| D8/333 | Nitrogen (kg/year) | 2685.037 | 1002.367 | 1682.671 | 2.6787 |
| D8/333 | Phosphorus (kg/year) | 215.194 | 81.271 | 133.923 | 2.6479 |
| D8/333 | Sediment (t/year) | 396.860 | 201.005 | 195.855 | 1.9744 |

The ratio compares two positive modeled reductions on identical cells within one profile. It is not a quoted price or a financial return. Full-grid assumed input loads and valid native export masks have different coverage; this report does not divide one by the other to infer a delivery fraction.

## Native baseline, restoration and matched control

Each row below uses a common baseline and exactly the same valid-cell mask across all three scenarios. The two saved scenario comparisons have identical baseline ID, support SHA and cell count; those identities are checked before this three-way table is derived.

| Profile | Pollutant | Baseline | Corridor | Control | Common cells |
| --- | --- | --- | --- | --- | --- |
| MFD/122 | Nitrogen (kg/year) | 3786.089 | 1139.226 | 2686.229 | 14034 |
| MFD/122 | Phosphorus (kg/year) | 300.995 | 88.830 | 211.969 | 14034 |
| MFD/122 | Sediment (t/year) | 700.435 | 572.524 | 586.528 | 13976 |
| MFD/333 | Nitrogen (kg/year) | 3786.089 | 1139.226 | 2686.229 | 14034 |
| MFD/333 | Phosphorus (kg/year) | 300.995 | 88.830 | 211.969 | 14034 |
| MFD/333 | Sediment (t/year) | 700.435 | 572.524 | 586.528 | 13976 |
| D8/122 | Nitrogen (kg/year) | 3815.335 | 1130.298 | 2812.969 | 14164 |
| D8/122 | Phosphorus (kg/year) | 302.921 | 87.727 | 221.650 | 14164 |
| D8/122 | Sediment (t/year) | 1011.979 | 615.119 | 810.974 | 14164 |
| D8/333 | Nitrogen (kg/year) | 3815.335 | 1130.298 | 2812.969 | 14164 |
| D8/333 | Phosphorus (kg/year) | 302.921 | 87.727 | 221.650 | 14164 |
| D8/333 | Sediment (t/year) | 1011.979 | 615.119 | 810.974 | 14164 |

For MFD/122, nitrogen reduction is 69.9102% in the corridor versus 29.0500% in the control; phosphorus is 70.4879% versus 29.5772%; sediment is 18.2616% versus 16.2623%. These percentages use each original common-support baseline.

The complete scenario CSV retains full precision, both original run IDs, comparison IDs, profile IDs, support hashes and source JSON pointers.

## Routing sensitivity on the actual intersection

Routing changes valid coverage. Comparing the full MFD and D8 totals directly mixes a routing change with a support change. The original parameter comparisons instead restrict both baseline surfaces to their exact intersection.

| Profile versus MFD/122 | Pollutant | Reference common | Alternative common | Change (%) | Common cells |
| --- | --- | --- | --- | --- | --- |
| MFD/333 | Nitrogen (kg/year) | 3786.089 | 3786.089 | 0.0000 | 14034 |
| MFD/333 | Phosphorus (kg/year) | 300.995 | 300.995 | 0.0000 | 14034 |
| MFD/333 | Sediment (t/year) | 700.435 | 700.435 | 0.0000 | 13976 |
| D8/122 | Nitrogen (kg/year) | 3786.089 | 3800.742 | 0.3870 | 14034 |
| D8/122 | Phosphorus (kg/year) | 300.995 | 301.841 | 0.2809 | 14034 |
| D8/122 | Sediment (t/year) | 700.435 | 1006.436 | 43.6874 | 13976 |
| D8/333 | Nitrogen (kg/year) | 3786.089 | 3800.742 | 0.3870 | 14034 |
| D8/333 | Phosphorus (kg/year) | 300.995 | 301.841 | 0.2809 | 14034 |
| D8/333 | Sediment (t/year) | 700.435 | 1006.436 | 43.6874 | 13976 |

On those original intersections, switching the baseline from MFD to D8 changes nitrogen by +0.3870%, phosphorus by +0.2809%, and sediment by +43.6874%. The D8-only 130 nutrient cells and 188 sediment cells are excluded from these contrasts. Complete per-scenario placement rankings above use each routing profile's own common support.

| Pollutant | Whole-total difference | Common-cell difference | D8-only amount | D8-only cells |
| --- | --- | --- | --- | --- |
| Nitrogen (kg/year) | 29.246458 | 14.653145 | 14.593313 | 130 |
| Phosphorus (kg/year) | 1.925470 | 0.845586 | 1.079885 | 130 |
| Sediment (t/year) | 311.544128 | 306.001543 | 5.542585 | 188 |

These three exact decompositions separate the changed common-cell mass from mass on newly valid D8 cells. Added coverage is 11.70 ha for nutrients and 16.92 ha for sediment. The full-precision parameter CSV retains the zero residual of each identity; no raster was regridded or re-summed here.

The recorded supports are 14,034 cells (1,263.06 ha) for MFD nutrients, 13,976 cells (1,257.84 ha) for MFD sediment, and 14,164 cells (1,274.76 ha) for D8. The native grid itself remains 14,400 cells (1,296 ha). This is an assumption sensitivity exercise, not a probability distribution or confidence interval.

## Slope-length-cap result

Changing SDR Lmax from 122 to 333 produces identical saved sums and byte-identical original and converted export rasters for all 18 routing × scenario × pollutant comparisons. The report checks both native-output SHA256 and converted-output SHA256 from the original complete run records.

| Routing | Scenario | Pollutant | Native SHA identical | Converted SHA identical |
| --- | --- | --- | --- | --- |
| MFD | baseline | Nitrogen | true | true |
| MFD | baseline | Phosphorus | true | true |
| MFD | baseline | Sediment | true | true |
| MFD | corridor | Nitrogen | true | true |
| MFD | corridor | Phosphorus | true | true |
| MFD | corridor | Sediment | true | true |
| MFD | control | Nitrogen | true | true |
| MFD | control | Phosphorus | true | true |
| MFD | control | Sediment | true | true |
| D8 | baseline | Nitrogen | true | true |
| D8 | baseline | Phosphorus | true | true |
| D8 | baseline | Sediment | true | true |
| D8 | corridor | Nitrogen | true | true |
| D8 | corridor | Phosphorus | true | true |
| D8 | corridor | Sediment | true | true |
| D8 | control | Nitrogen | true | true |
| D8 | control | Phosphorus | true | true |
| D8 | control | Sediment | true | true |

This is a no-response result for the two tested cap values in this retained case. It does not establish a universal lack of sediment sensitivity or infer an unexamined LS-factor distribution. The two routing choices remain materially different. All twelve retained SDR stages record their correct routing and Lmax in the original execution-input signature and were executed without stage reuse. NDR does not use the SDR cap; six equivalent NDR stages were retained through the original reuse mechanism.

## Recorded execution and source identities

The original retained model-stage start is 2026-10-13T10:25:11.721153+00:00; the final original run completed at 2026-10-13T10:25:37.406439+00:00. The recorded interval is 25.685 seconds and includes six reused model stages among 24 retained NDR/SDR stages. This interval excludes environment setup, source preparation, report generation and editable handover; it is not a new end-to-end benchmark.

| Original identity | Value |
| --- | --- |
| Ensemble | 8cb02b0fe3b6a96782525e8aa5607621dd0a456719c6651ce07a675d9cae1ff4 |
| Report | 9c0d1a2a6cf4bfa06a5811885d4bc8955ef9ccf5e020284a9b6169e86aa50cac |
| Run signature | 63985762ce5999a05f123d1148ce8e747d69e6ec85630a2708a2d9753fc66381 |
| Native model version | 3.20.0 |
| Report created | 2026-10-13T10:25:38.179335+00:00 |

The native inventory retains all 36 original output descriptors, full units, original and converted hashes, run IDs and completion timestamps. Original stage timing and reuse fields are retained alongside the unchanged source bodies.

## Use in the RFP workshare

For Tim's review, open the original scenario inputs, show the two equal-area land-cover edits, select a retained profile, and compare the original annual output maps with this table. Change an explicit input or alternative through the maintained workflow, then save and independently reopen the editable case. The input and native chapters can be selected together in the existing scientific report viewer.

The useful engineering handoff is the reproducible model/reporting workflow with editable assumptions, exact original sources, support-aware comparisons and a retained project. Scientific direction, scenario choice and interpretation remain with the modeling team. Apply the same sequence to the separate actual Upper Savannah source geography and RFP scope.

The existing original-native report owns its 15 scientific figures and raster views. This companion contributes the joined input/result interpretation and complete numerical audit paths without replacing those maps.

## Complete source and machine-readable outputs

- [Full precision interpretation](analysis.json)
- [All 24 original scenario comparisons](scenario-comparisons.csv)
- [All 12 within-profile placement contrasts](placement-comparisons.csv)
- [All 9 original parameter comparisons](parameter-comparisons.csv)
- [All 18 cap identity checks](cap-identity.csv)
- [All 36 original output descriptors](native-inventory.csv)
- [Original native numerical report](retained/numeric/report.json)
- [Original twelve native run records](retained/original/native-runs.json)
- [Original input analysis](../../source/headwaters_input_interpretation_20261013/analysis.json)
- [Original class-specific covariate balance](../../source/headwaters_input_interpretation_20261013/covariate-balance.csv)
- [Readable chapter](CHAPTER.md)
- [Offline report](report.html)


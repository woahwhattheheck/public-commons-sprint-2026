# Original headwaters demonstration: source change and placement

SIMULATED DEMONSTRATION INPUTS

## The question answered by this original case

SIMULATED DEMONSTRATION INPUTS. This chapter explains the original 1296 ha, 120 × 120 cell, 30 m demonstration square. Its terrain, source-water areas, land cover, precipitation and soil factors are assumed inputs. The actual Upper Savannah geographic model is a separate source edition.

Both alternatives convert 635 cells (57.15 ha) to forest: 236 pasture/hay cells (21.24 ha) and 399 cultivated-crop cells (35.91 ha). The riparian selection uses eligible cells within 90 m on each side of the generated stream-axis segments; the full corridor mask contains 1214 cells. The matched control selects eligible cells outside that entire corridor.

The practical comparison is placement with a closely matched nutrient source change. Read the native annual export differences together with the original changed-area and covariate tables to see how placement interacts with routing and retention.


## What the comparison holds constant

| Quantity | Original retained value |
| --- | --- |
| Grid and area | EPSG:26917; 30 m; 14,400 cells; 1296 ha |
| Changed footprint in each alternative | 635 cells; 57.15 ha |
| Original changed cover in each alternative | 236 pasture/hay (81); 399 cultivated crops (82) |
| Replacement cover | Deciduous forest (41) |
| Fixed full-grid inputs | DEM, precipitation, R factor and K factor |
| Control selection | Original land-cover strata; monotone minimum-L1 precipitation subset |
| Proxy normalization | Full original precipitation mean: 1480 mm/year |

The original 635 pair records retain their cell indices and precipitation residuals. Matching controls treated area, original cover counts and nearly the same runoff proxy. It does not equalize every soil, terrain or routing property at the changed locations.


## Annual nutrient source entering retention

For this source-generation table, each full-grid cell contributes its area in hectares × its assumed class coefficient in kg/ha/year × its precipitation proxy divided by the original full-grid mean. Sum all 14,400 contributions for each scenario. Both nutrients use the original measured-runoff setting; the assumed subsurface nitrogen proportion is zero.

These are annual nutrient source inputs before native retention and stream delivery. Their denominator is the complete original 1296 ha grid. The native comparison retains its own actual valid-support mask and exported quantities.

| Scenario | N input (kg/year) | P input (kg/year) | N input reduction (kg/year) | P input reduction (kg/year) |
| --- | --- | --- | --- | --- |
| Baseline | 11638.136040 | 906.332156 | 0.000000 | 0.000000 |
| Riparian restoration | 10746.834646 | 833.425874 | 891.301394 | 72.906282 |
| Matched control | 10746.847214 | 833.426910 | 891.288826 | 72.905246 |

The riparian source reduction exceeds the control source reduction by only 0.012567616 kg N/year and 0.001035865 kg P/year. This small residual follows from the original approximate rainfall matching.

| Original cover | N coefficient (kg/ha/year) | P coefficient (kg/ha/year) | Assumed retention efficiency | USLE C |
| --- | --- | --- | --- | --- |
| 21 — developed/open space | 8 | 0.9 | 0.05 | 0.05 |
| 41 — deciduous forest | 2 | 0.12 | 0.8 | 0.003 |
| 81 — pasture/hay | 10 | 0.7 | 0.35 | 0.025 |
| 82 — cultivated crops | 22 | 1.8 | 0.15 | 0.18 |

The four-class CSV is an exact replay of the original assumed source-generation table. Its source identity is retained independently of the completed native run's table identity.


## Placement and covariate balance

The pooled mean K factor is nearly equal, but pasture and crop have differences in opposite directions. Keep both original cover strata visible when explaining sediment or nutrient differences. The control's mean DEM elevation is 32.489975 m higher overall; original elevations do not substitute for native slope, LS, connectivity or transport length.

All 635 changed cells in each alternative

| Original input | Riparian mean | Control mean | Control minus riparian |
| --- | --- | --- | --- |
| DEM (m elevation) | 238.553357641 | 271.043333079 | 32.489975438 |
| Precipitation (mm/year) | 1485.631791343 | 1485.612171839 | -0.019619504 |
| R factor (MJ·mm/ha/hour/year) | 4599.140748031 | 4599.061220472 | -0.079527559 |
| K factor (t·ha·hour/ha/MJ/mm) | 0.030408773 | 0.030407290 | -0.000001483 |

Original pasture/hay: 236 changed cells in each alternative

| Original input | Riparian mean | Control mean | Control minus riparian |
| --- | --- | --- | --- |
| DEM (m elevation) | 239.571837119 | 278.160154288 | 38.588317169 |
| Precipitation (mm/year) | 1486.782309343 | 1486.767302199 | -0.015007144 |
| R factor (MJ·mm/ha/hour/year) | 4594.896186441 | 4582.213983051 | -12.682203390 |
| K factor (t·ha·hour/ha/MJ/mm) | 0.029965713 | 0.029213630 | -0.000752083 |

Original cultivated crops: 399 changed cells in each alternative

| Original input | Riparian mean | Control mean | Control minus riparian |
| --- | --- | --- | --- |
| DEM (m elevation) | 237.950948727 | 266.833884945 | 28.882936218 |
| Precipitation (mm/year) | 1484.951284456 | 1484.928936840 | -0.022347617 |
| R factor (MJ·mm/ha/hour/year) | 4601.651315789 | 4609.026002506 | 7.374686717 |
| K factor (t·ha·hour/ha/MJ/mm) | 0.030670833 | 0.031113315 | 0.000442481 |

The complete covariate CSV also retains each group's count, minimum, maximum and population standard deviation. A pooled balance statistic can conceal class-specific placement differences.


## How to read the completed native comparisons

Within each retained profile, compare the original baseline, riparian restoration and matched control on the same explicitly retained all-three valid support. The two pairwise comparison masks can differ; preserve the report's exact support-group identity when comparing alternatives.

Keep source change, placement and native routing as separate parts of the explanation. The nearly equal nutrient source reductions make location and transport relevant; the remaining soil and terrain differences mean this is a matched scenario comparison rather than an isolated estimate of one physical cause.

Read each profile's actual routing choice and SDR Lmax from its retained profile. Lmax belongs to the SDR slope-length calculation; nutrient routing and retention follow the NDR configuration. Sensitivity across selected profiles describes those assumptions and is not a confidence interval.

Use the actual completed native nitrogen/phosphorus exports in kg/year and sediment exports in tonnes/year, with their retained source-to-stream support. Any density also needs its actual support area. Receiving-water context preserves the distinction between modeled delivery to streams and measurements at an intake.


## Editable decisions for the modeling team

Start from the retained land-cover conversion, class coefficients and control-matching objective. A revised assumption becomes an explicit new source/profile edition while the original completed comparison remains inspectable.

For a different placement question, select a new treatment/control cohort and inspect both class-specific covariates and the resulting native common support. Record the changed area, eligible baseline classes, actual selected cells and the full matching objective.

Apply the same reasoning to the separate geographic course using its own publisher geometry, grid, coefficients and prepared selection. This chapter's cell arrays and 1296 ha denominator identify the original demonstration square.


## Retained inputs and reproducible tables

- Original input recipe and all 14,400 cell arrays: source/simulated_headwaters_20261013/input-recipe.json
- Original matched control and all 635 pair records: source/simulated_headwaters_20261013/matched-control.json
- Original control generator: source/simulated_headwaters_20261013/generate-matched-control.mjs
- Original coefficient/source producer: source/headwaters_input_interpretation_20261013/original/simulated_headwaters.py
- Original source accounting implementation: source_tools/headwaters_input_accounting.mjs
- Full-precision accounting and source identities: source/headwaters_input_interpretation_20261013/analysis.json
- Annual source-loading table: source/headwaters_input_interpretation_20261013/source-loading.csv
- Class-specific covariate table: source/headwaters_input_interpretation_20261013/covariate-balance.csv
- Assumed biophysical table source replay: source/headwaters_input_interpretation_20261013/biophysical-source-replay.csv


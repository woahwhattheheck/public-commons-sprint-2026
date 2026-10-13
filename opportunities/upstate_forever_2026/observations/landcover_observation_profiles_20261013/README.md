# Land-cover change and original station context across 217 watersheds

This source joins the completed original 2023 and 2025 Annual NLCD classifications with the original 197-coordinate WBD comparison. It provides **one complete profile for each of the 217 retained HUC12 watersheds**, eight land-cover group balances per watershed, and every original point interpretation. Existing scientific reports and the Workspace can select the resulting ordinary source tables.

The join connects named spatial units and the retained source inventory. Land-cover quantities use the original 217 watershed polygons and the same native 30 m raster cells. Station membership uses the dated official WBD query at each exact original coordinate. The source preserves each input's own geographic support and edition.

## Completed calculation

| Quantity | Executed result |
| --- | ---: |
| Retained HUC12 profiles | 217 |
| Watershed/group balances | 1,736 |
| Original point/coordinate-variant rows | 197 |
| Point rows within the retained land-cover domain | 183 |
| Point rows retained as outside-domain context | 14 |
| Unique gauge identities in the full original inventory | 80 |
| Unique gauges with retained observed flow | 29 |
| Unique observed-flow gauges with a point within the domain | 22 |
| Watersheds containing a retained observed-flow gauge point | 21 |
| South Carolina 2026 draft assessment stations | 87 |
| Watersheds containing one or more of those draft assessment stations | 49 |
| Watersheds containing both a draft assessment station and an observed-flow gauge point | 5 |
| Selected native cells in both annual classifications | 20,949,527 |
| Cells with different 2023 and 2025 classes | 1,089,063 |
| Selected domain area, hectares | 1,885,457.431353 |
| Area with different annual classes, hectares | 98,015.670070 |
| Share with different annual classes | 5.19850878% |

All 55,552 original HUC/class-pair cells were read. For every watershed, the complete paired matrix reconciles to its independent 2023 inventory, independent 2025 inventory, selected-cell total, unchanged-cell count, changed-cell count and saved area. Each of the eight group balances also reconciles: ending area minus beginning area equals gross gain minus gross loss. Both annual rasters have complete selected-cell support.

The exact source records place 22 observed-flow gauge identities in 21 HUC12s because two gauges share a watershed. The five watersheds containing both kinds of retained point are Middle Coneross Creek, Lower Eighteenmile Creek, Middle Chattooga River, Upper Rocky River and Upper Little River.

## Read the spatial support correctly

A gauge point identifies the watershed containing that location. Its measurement integrates its upstream drainage area, which can span several HUC12s. The `local_observed_flow_gauge_*` fields are therefore a **local point inventory**. Drainage coverage and upstream comparisons use the separately retained NLDI basin and network sources. An empty local-point field describes this retained inventory.

The assessment fields preserve the **South Carolina 2026 draft** edition. The regional domain spans state boundaries, while this particular assessment input is the retained South Carolina list. Empty assessment fields mean that this source contributes no listed station to that watershed. They support neither a water-quality classification for an unlisted watershed nor a comparison of the states' assessment coverage.

The land-cover fields describe changes between annual product classifications. Their geographic coincidence with an assessment cause supplies context for scientific review. Temporal attribution, contaminant origin, treatment effectiveness and nutrient export require their own observations and models.

## Developed-class changes alongside retained draft assessment sites

The table below is ordered by net gain in developed classes among watersheds that contain a station in the retained draft assessment. It presents physical quantities and exact original source codes. The complete ordering over all 217 watersheds is retained in `summary.json`.

| HUC12 | Original watershed name | Developed net change, ha | Forest gross loss, ha | Forest gross gain, ha | Draft assessment stations | Original cause codes | Local observed-flow gauge points |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| 030601010704 | Lower Six And Twenty Creek | 125.73 | 149.13 | 12.42 | RL-01020 | PH | None in retained point source |
| 030601010502 | Middle Coneross Creek | 124.20 | 138.96 | 81.63 | SV-004 | CD | USGS-02186645 |
| 030601010602 | Lower Eighteenmile Creek | 93.33 | 58.23 | 31.50 | SV-233, SV-268 | TN, TP, TURB | USGS-02186702 |
| 030601030713 | Hawe Creek-J. Strom Thurmond Reservoir-Savannah River | 77.04 | 1011.60 | 255.33 | CL-041, SV-066, SV-818 | CU, HGF, PH, ZN | None in retained point source |
| 030601010305 | Cane Creek | 76.59 | 151.92 | 49.50 | SV-311 | HGF | None in retained point source |
| 030601030203 | Upper Rocky River | 71.64 | 228.60 | 40.32 | SV-031, SV-037 | ECOLI, TURB | USGS-02187910 |
| 030601010702 | Lower Three And Twenty Creek | 70.83 | 118.53 | 25.11 | SV-111 | TURB | None in retained point source |
| 030601010803 | Upper Seneca River | 70.38 | 55.62 | 59.76 | SV-106 | HGF, PCB | None in retained point source |
| 030601030401 | Upper Big Generostee Creek | 63.81 | 118.80 | 112.23 | RS-02490, RS-22078, SV-822, SV-823 | BIO, ECOLI | None in retained point source |
| 030601020507 | Lower Tugaloo River | 57.87 | 180.09 | 179.28 | SV-234 | PCB | None in retained point source |

**Lower Eighteenmile Creek** contains both SV-233 and SV-268 in the draft assessment, with retained cause codes TN, TP and TURB across those two stations. Its local flow point is USGS-02186702. Developed classes increase by 93.33 ha; forest classes have 58.23 ha of gross loss and 31.50 ha of gross gain. The original source marks SV-268 as the only station whose minimum listed-cause priority is 1. The minimum belongs to the original per-cause priority record; the joined flag identifies that station.

**Lower Six And Twenty Creek** has 125.73 ha net gain in developed classes and the original RL-01020 PH listing. Its forest-group loss is 149.13 ha and gain is 12.42 ha. Its local observed-flow field is empty in the retained point inventory, so the next spatial comparison uses the existing upstream/network sources.

**Lower Tugaloo River** shows why the full balance matters: 180.09 ha leave the forest group and 179.28 ha enter it, leaving a net change of only -0.81 ha. Group membership changes and total class changes answer different questions; a transition between two forest classes contributes to total changed-class area while staying inside the forest group.

Original names and cause codes remain exact, including publisher spelling. Per-point rows retain the assessment description, impaired use, source page, coordinate source and official WBD response identity for interpretation.

## Files and fields

- `watershed-profiles.csv` contains all 217 HUCs, native-cell areas and class-change shares, developed/forest/agriculture/wetland group areas and gross/net balances, exact draft-assessment station and cause lists, unique local gauge identities and roles, original outfalls and lake-study points.
- `landcover-groups.csv` contains all eight mutually exclusive groups for every watershed: before/after area and share, net change, gross gain, gross loss and exact class codes.
- `original-location-context.csv` retains all 197 point identities, native coordinates and CRS, current official watershed match, coordinate variant, source hashes/URIs, assessment context and gauge role. The 14 outside-domain coordinate rows remain in this complete table.
- `summary.json` contains the exact domain totals and three complete physical orderings: developed net gain, forest gross loss and total changed-class percentage. Each ordered row carries its original station/cause and local observed-flow context.
- `input-manifest.json` binds all six complete original inputs and four generated outputs by path, size and SHA-256.
- `profiles_core.mjs` performs the source join and complete conservation calculations. `rebuild.mjs` is the executable replay.
- `landcover_observation_profiles.sources.json`, at the application root, is the ordinary native source manifest. It retains every original input and the complete replay as source companions.
- `integration/component_fragments/landcover-observation-profiles.json` includes this source in the existing cumulative application, with dependencies on the completed annual-land-cover and original-station components.

CSV identifier fields are strings, including leading-zero HUC12 values. List-valued cells contain JSON arrays; readers can recover exact members with JSON parsing after standard CSV parsing. The original-location table preserves coordinate alternatives as separate records, together with the original listed, draft-TMDL, July-TMDL, agency and study-scope HUC fields and their official-query comparisons. SV-840 retains its study HUC10 0306010106 alongside its current HUC12 030601010803. RS-06190 retains current/listed HUC12 030601030602 alongside the older TMDL HUC12 030601030502. Per-cause priorities and source use-support strings remain separate original fields. Watershed gauge counts deduplicate those alternatives by `entity_id`. All retained alternatives for any one entity match the same HUC12 in this edition.

### Defined land-cover groups

| Group | Annual NLCD codes |
| --- | --- |
| water | 11 |
| snow_ice | 12 |
| developed | 21, 22, 23, 24 |
| barren | 31 |
| forest | 41, 42, 43 |
| shrub_grass | 52, 71 |
| agriculture | 81, 82 |
| wetlands | 90, 95 |

These analytical groups partition the original classes. Agriculture includes pasture/hay and cultivated crops. Wetlands remain their own group, including woody wetlands. The developed group includes developed open space and the three developed-intensity classes.

Gross gain counts cells moving from another group into the selected group. Gross loss counts the reverse. Net change is the ending group area minus the beginning group area. All areas use the original affine-derived cell area, 900.0000006459331 square metres, and the original centre-inclusion rule.

## Receive and replay

Import the application-root `landcover_observation_profiles.sources.json` through the existing Workspace original-source importer. It contributes the complete source tables to the same regional project. The current scientific report builder can select those retained source tables alongside the existing focal-watershed and observation studies.

From the application root:

```sh
node observations/landcover_observation_profiles_20261013/rebuild.mjs --check
```

The command verifies every complete input's bytes before calculation, reconstructs all four outputs, checks their retained identities and compares the saved bodies. It uses Node's standard library and the included pure calculation module. The source dependency fragments carry both the original inputs and this complete receiving component.

## Original sources

The annual classification results, original 217-feature geometry identity and all per-HUC transitions were delivered in [PR3547](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3547), merge `ea6a7579a98d7192861eb74a380952671c9154b5`. The exact source manifest is `observations/landcover_2023_2025/model-sources.json`.

The 197-coordinate official WBD source and original assessment/gauge/outfall/lake properties were delivered in [PR3571](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3571), merge `88cc77e83721dbf1048e22cdb9f68b249c70dad2`. The exact source manifest is `observations/wbd_station_join_20261013/model-sources.json`.

Their original complete files are reused in place. This source's six-input manifest records the precise revisions used in the calculation. The separately completed [seven-focus-watershed interpretation, PR3615](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3615), and the gauge-specific NLDI land-cover calculation retain their existing scopes.

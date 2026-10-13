# Upper Savannah published study programme

The programme prepares complete regional coefficient alternatives, applies the published Upstate land-cover rules to the actual selected 30 m grid, and sends the resulting profiles and scenarios through the maintained `model.experiments` runner. That runner owns native execution, resumable case state, paired comparisons and summary output.

## Run the broad regional comparison

Run from the existing application root after its original regional baseline has been prepared. The baseline must select the actual full 217-HUC model domain and the retained current NLCD, DEM and climate inputs.

```bash
/opt/pyvenv/bin/python -B -m source_tools.upstate_study_profiles \
  --workspace /path/to/current-workspace \
  --core-result /path/to/regional-core-result.json \
  --profile-spec upper_flint_ndr=source/upper-flint-2024/profile-ndr.json \
  --profile-spec upper_flint_sdr=source/upper-flint-2024/profile-sdr.json \
  --profile-spec upper_flint_combined=source/upper-flint-2024/profile-combined.json \
  --study-scenarios --run \
  --output /path/to/study-programme-result.json
```

The existing regional core result supplies its real baseline run ID. An already retained run can instead be selected with `--baseline-run ID`. All spatial alternatives keep that exact grid ID. If the core was started as NDR-only, first compose the existing combined baseline from its original completed NDR stage and the completed SDR inputs; the profile comparison then runs the selected combined models.

The default joined profile choices are the original baseline, the complete Albright 2023 table, and that table with the eight reported Vickery–Quinn native parameters. The three explicit Upper Flint arguments add coherent nutrient-only, sediment-only and combined table alternatives. The maintained engine deduplicates equivalent choices. With six distinct profiles and seven distinct spatial alternatives, this programme contains 48 cases: each profile's own baseline plus its seven land-cover alternatives. Paired effects use the corresponding profile baseline.

The new binary-mask seam in `model.rasters.make_scenario` consumes aligned single-band 0/1 rasters directly. Source import retains the actual mask bytes and derivation alongside the ordinary `Workspace.save_scenario` record. This avoids converting selected raster cells into large polygon collections. Existing polygon masks continue through the same scenario engine.

## Published source choices

### Albright and colleagues, 2023

Mary Grace Albright, Caroline Vickery, Roy Bower and John E. Quinn,
“Patterns of land use change, land governance, and the supply of ecosystem services in a multifunctional landscape: A case study from Upstate SC, USA.”

- DOI: https://doi.org/10.1080/1747423X.2023.2234903
- Publisher: https://www.tandfonline.com/doi/full/10.1080/1747423X.2023.2234903
- Publisher-supplied author full text: https://www.researchgate.net/publication/372675263_Patterns_of_land_use_change_land_governance_and_the_supply_of_ecosystem_services_in_a_multifunctional_landscape_A_case_study_from_Upstate_SC_USA

Appendix 1 supplies all fifteen NLCD rows and eight numerical fields: nitrogen and phosphorus loads, their retention efficiencies and lengths, and USLE C and P. The retained CSV transcribes those 120 numerical cells, preserves row order and corrects spelling in descriptive labels. The numerical CSV is 829 bytes, SHA256 `64c5c803e09d50d9f51c029ece199a06c01d19951ae3fdce52b7fca7bb13bf8c`.

The paper used InVEST 3.9.0. Its NDR source maps the table loading rates directly to pixel loads. The current 3.20.0 `measured-runoff` category preserves that calculation; `application-rate` would additionally multiply by on-pixel nonretention. The derived profile records this version adaptation at each affected table cell. The published table leaves nitrogen subsurface proportions unspecified, so the retained baseline supplies those values.

Original implementation: https://github.com/natcap/invest/blob/3.9.0/src/natcap/invest/ndr/ndr.py

Current implementation: https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py

The source definitions also retain the paper's historical input conversions: precipitation in inches to millimetres, erosivity multiplied by 17.02, and its legacy scaled erodibility divided by 100 before multiplication by 0.127. Current prepared raster entries carry their own units and conversions; the study profile command changes coefficients and parameters only.

### Vickery and Quinn, 2023

“Climate-altered Precipitation is more Important than Land Use when Modeling Ecosystem Services Associated with Surficial Processes.”

Publisher and appendices: https://link.springer.com/article/10.1007/s00267-023-01861-6

The combined profile applies the eight supported native settings in Appendix 1:

| Native setting | Value |
| --- | ---: |
| NDR subsurface retention length | 200 m |
| NDR subsurface retention efficiency | 0.8 |
| NDR connectivity k | 2 |
| NDR stream threshold | 1000 contributing pixels |
| SDR connectivity midpoint | 0.5 |
| SDR maximum delivery ratio | 0.8 |
| SDR connectivity k | 2 |
| SDR stream threshold | 1000 contributing pixels |

The 1000-pixel threshold corresponds to 90 ha on a 30 m grid. Routing method, the dimensionless maximum RUSLE L factor (`sdr.l_max`) and other unreported settings retain their explicit baseline values. Current native phosphorus transport uses its surface path; only supported nitrogen subsurface parameters enter the current profile.

### Upper Flint, 2024

Abbasnezhad, Abrams and Wenger, Land 13(6), 893.

DOI: https://doi.org/10.3390/land13060893

Original complete supplement: https://www.researchgate.net/publication/381634619_land-2997438-supplementarypdf

The companion `source/upper-flint-2024` directory retains all thirteen original categories, their complete coefficients, the explicit nine-class nonurban NLCD mapping, and three ready profile specifications. Combined forest and shrub/herbaceous source categories map to the matching NLCD classes. The original five developed imperviousness categories require their actual bin definitions for an urban mapping; the source choices retain the selected regional water, developed and emergent-wetland rows.

## Seven spatial alternatives in the reporting area

The published 2016-baseline rules are applied to the selected current regional NLCD edition. The exact retained reporting mask defines management eligibility and the original forest-area denominator for the 116 South Carolina reporting HUCs. The other 101 contributing HUCs and the configured upstream buffer remain available to native hydrology. Reusing the existing reporting mask keeps scenario selection on the same pixel centres as reported model effects.

| Published rule | Regional alternatives |
| --- | --- |
| Convert 5% of original forest area to low-intensity development, NLCD 22 | Nearest and farthest from forest edge |
| Convert 2% of original forest area to medium-intensity development, NLCD 23 | Nearest and farthest from forest edge |
| Add forest equal to 5% of original forest area, selecting nonforest/nonwater cells | Nearest and farthest from forest edge; equal new 41/42/43 shares |
| Restore agricultural cells with slope at least 10% | Cropland 82 to mixed forest 43; pasture 81 to grassland 71 |

The installed InVEST 3.20.0 proximity-based scenario generator performs the six area allocations. It uses its native distance transforms, smoothing and external sorting with one fragmentation step. Both edge directions are explicit regional allocation choices, allowing the source comparison to expose their effect. The publication supplies the area and transition rules; retained derivation files record the selected regional placement.

Whole-cell quotas equal the floor of the published fraction times the original valid forest-cell count. The generator's area argument is placed a quarter cell below that integer-cell area because its implementation applies `ceil(area/pixel_area)`. Each output is then compared against the actual baseline, and its changed-cell count must equal the selected quota. New forest types cycle 41,42,43 over row-major selected cells, keeping their areas within one 30 m cell while avoiding a large north/south class assignment gradient. This equal-share placement is recorded in every derived scenario.

Steep restoration uses `pygeoprocessing.calculate_slope` on the retained, buffered original DEM. Its percent-slope output is compared with 10, then restricted to original agricultural cells inside the retained reporting-area mask. Output masks preserve the exact original grid, validity and source-class selection.

Original scenario generator:
https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/scenario_gen_proximity/scenario_gen_proximity.py

## Reuse and inspect the prepared programme

The operations retain their selections and mutable progress under:

- `study-programmes/<id>/`: published profile specifications, table identities and materialized profile IDs.
- `study-spatial-programmes/<id>/`: retained reporting-area mask and original NLCD, native arguments and outputs, source masks, scenario IDs, exact class-transition counts and preparation state.
- The existing `experiments/<id>/` tree: native case execution, paired comparisons and summaries.

The result includes `spatial_programme.scenario_ids` and `experiment.experiment_id`. Its native runs remain ordinary Workspace runs, including the same completed land-cover stage consumed by the LAND12 watershed land-cover ledger and existing map/delivery tools.

To prepare the spatial component separately:

```bash
/opt/pyvenv/bin/python -B -m source_tools.upstate_study_scenarios \
  --workspace /path/to/current-workspace \
  --baseline-run ACTUAL_BASELINE_RUN_ID \
  --output /path/to/spatial-programme-result.json
```

Pass that completed file through `--scenario-programme` to the profile command. Add other existing scenario IDs using repeated `--scenario` arguments. For table-only preparation, select `--baseline-profile`; `--preview` describes the actual current profile configurations through the maintained engine.

## Read the study report

After execution, the programme writes `experiments/<experiment_id>/study-report/index.html` with filterable native comparisons, actual changed areas, execution coverage and the source-profile response ranges. The report consumes the existing engine's paired-cell support groups, keeping unlike coverage separate. Its CSV preserves complete run, profile, scenario and comparison IDs.

The opening sentence uses the actual selected/completed case counts: source-only profile materialization describes its coefficient sources, a partially completed programme gives the completed count out of the selected total, and a completed programme identifies all selected cases. Source interpretation tables use the same short programme profile names as the native comparison tables. Expand **Original profile definition** beside a source name to inspect its complete retained title and profile ID; full coefficient values, original titles and source identities remain in the report data and embedded CSV downloads.

The native experiment link is saved before execution starts under `study-programmes/<profile_programme_id>/experiments/<experiment_id>.json`. If a native case fails, completed cases remain in the engine's partial summary and the report uses those retained results.

To refresh a report from an existing retained experiment:

```bash
/opt/pyvenv/bin/python -B -m model.study_report \
  --workspace /path/to/current-workspace \
  --experiment ACTUAL_EXPERIMENT_ID \
  --programme-result /path/to/study-programme-result.json
```

## Native runoff normalization for climate comparisons

NDR uses each precipitation/runoff-proxy value divided by a selected mean. With an automatically calculated mean and unchanged valid-cell coverage, a uniform positive precipitation multiplier cancels algebraically. Separate spatial climate editions therefore retain their actual raster patterns, and an absolute common-reference comparison selects the original baseline mean explicitly.

`--fixed-runoff-reference` derives that mean from the completed original native NDR `masked_runoff_proxy` raster through `model.runoff_reference`, using the same reducer as native InVEST 3.20.0. With `--run`, the command completes the selected baseline first. It adds corresponding profile variants with `ndr.runoff_proxy_av` set to that measured value and preserves the original choices.

Use this flag when a common runoff reference is part of the selected scientific comparison. A future precipitation edition belongs on its own prepared physical grid; the existing single-grid experiment engine keeps spatially different climate inputs in separate programmes. SDR receives its independently prepared erosivity input.

## Receiving verification

The joined regional driver installation, actual imports and first progress write were exercised offline against the maintained source. The new study modules passed Python AST compilation and top-level module loading. Native scenario generation, actual CSV/profile materialization and the regional model programme run on the receiving GIS worker with its original source rasters. Its retained programme state and native outputs provide the execution results for delivery.

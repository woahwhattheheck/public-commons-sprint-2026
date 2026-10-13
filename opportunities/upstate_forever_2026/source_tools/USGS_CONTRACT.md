# USGS P13YSTHM release contract compiler

This module turns the original released seasonal nutrient tables into the source contract consumed by the existing `source_tools.usgs_loads` preparation pipeline. The archive receiver supplies the actual members. The compiler resolves the original data dictionary, attaches source interpretations, joins model review records, and preserves the original strings. The native preparation pipeline then qualifies stations, sums complete annual loads, receives the selected upstream catchments, and publishes the existing observation source manifest.

The companion `source/usgs-seasonal-loads-20261012/contract-recipe.json` records the original archive identity, member discovery patterns, and the exact metadata locations behind those patterns. The retained `metadata2.xml` is the original 32,059-byte USGS attachment.

## 1. Original release and the useful acquisition order

The USGS release is **Estimated seasonal nitrogen and phosphorus loads in selected streams of the conterminous United States, 1999–2020**, DOI [10.5066/P13YSTHM](https://doi.org/10.5066/P13YSTHM). The original ScienceBase item is [6675b4dbd34e6f159fd10baf](https://www.sciencebase.gov/catalog/item/6675b4dbd34e6f159fd10baf).

| Original attachment | Published size | Original identity |
|---|---:|---|
| data_release3.zip | 1,897,877,062 bytes | Publisher MD5 `2dc4d81994c4fcbf7d27728eb16fdaef` |
| metadata2.xml | 32,059 bytes | SHA-256 `a1caa97c038d6b716490925c03a165aa1af3cbb8b45760b3ee560e7594fb7e95` |
| sciencebase-item.json, retained original item response | 14,766 bytes | SHA-256 `2c4bc4a73994c86e46dc882bbc4b4d625650fdc3f720b5458cb587b4db66ee9d` |

The original archive URL, exactly as recorded in the item's `files[].downloadUri`, is:

<https://www.sciencebase.gov/catalog/file/get/6675b4dbd34e6f159fd10baf?f=__disk__f8%2F3d%2F95%2Ff83d95e645907f5b7073c129a6581810e3acc81b>

The current metadata attachment URL from that same response is:

<https://www.sciencebase.gov/catalog/file/get/6675b4dbd34e6f159fd10baf?f=__disk__8a%2Faa%2F45%2F8aaa450a9d37e44fd4ccd24013238a6279d1b6c5>

The archive attachment was uploaded on 2024-10-15. The retained metadata attachment was uploaded on 2025-09-02 and declares a metadata date of 2024-10-15. The compiler pins the exact latter attachment because older catalog links point to a different metadata object.

Use the existing receiver's original central directory and member extraction capability. Obtain these useful members first:

1. **dataDictionary.csv** and the actual central directory listing. The metadata defines the dictionary's schema, while this CSV supplies the actual native variable meanings, units, and categorical values.
2. **master_site_list/** station catalogs and the CONUS `input_sitegage_TN.csv` / `input_sitegage_TP.csv` relationships. These distinguish the water-quality sampling station from the discharge station and retain their published drainage-area and reach relationships.
3. Released seasonal **Fluxmaster prediction tables** and **WRTDS seasonalFluxes_dataRelease.csv**. These are the inputs for annual reference loads.
4. Original **model review and fit summaries**, including `MCMResults_dataRelease.csv` and the Fluxmaster `output_wq_summary_betaest_all_*.csv` files, plus any master review tables described by the dictionary.
5. The small original `f.sumFluxes.R`, `workFlow.R`, and relevant SAS scripts when a variable's period or flow basis needs its executable source definition.

The release metadata names two Fluxmaster spellings: `output_predict_flux_all_sub_periods_TN.csv` in the reproduction instructions and `output_predict_all_sub_periods_TN.csv` in lineage text. The phosphorus names have the same discrepancy. The compiler recognizes both spellings for discovery and uses the actual received member and its dictionary rows for binding.

The public release already includes the estimated seasonal outputs. Keep the receiver focused on the tables and their source definitions; loading every WRTDS R object or rerunning the release's original many-day CONUS model computation is unnecessary for consuming those outputs.

Source locations: `metadata2.xml / dataqual/lineage/procstep/procdesc`, especially the fourth process step; `dataqual/lineage/srcinfo`; original `sciencebase-item.json / files`. The primary [USGS release page](https://www.usgs.gov/data/estimated-seasonal-nitrogen-and-phosphorus-loads-selected-streams-conterminous-united-states) and [USGS Water Data Catalog record](https://water.usgs.gov/catalog/datasets/8a7d3140-2272-433c-9359-30840125cd7c/) identify the same data release.

## 2. Inspect actual received members

Run the commands from the application root that contains the existing `model` and `source_tools` packages. Set `USGS_RECEIVED_ROOT` to the existing original-member directory and `USGS_INTAKE_WORK` to a separate working directory. The metadata and dictionary arguments are paths relative to the original-member directory.

~~~sh
python -m source_tools.usgs_contract inspect \
  --original-root "$USGS_RECEIVED_ROOT" \
  --metadata "$USGS_METADATA_MEMBER" \
  --dictionary "$USGS_DICTIONARY_MEMBER" \
  --output-json "$USGS_INTAKE_WORK/member-inspection.json"
~~~

`USGS_METADATA_MEMBER` must identify the exact `metadata2.xml` supplied with this source handoff or the same bytes already retained by the receiver. `USGS_DICTIONARY_MEMBER` is the actual central-directory-resolved path to `dataDictionary.csv`.

The inspection result contains:

- `role_members`: actual original paths matching each release role.
- `members`: actual file size, CSV headers, detected delimiter/encoding, dictionary definitions, and unresolved dictionary columns.
- `dictionary_files`: every distinct folder/file/description combination actually declared in the dictionary, with original dictionary record numbers.
- `release.metadata` and `dictionary`: byte identities of the actual inputs.

Inspection reads source table headers and the dictionary. It does not parse large seasonal tables merely to find their field names. CSV parsing defaults to UTF-8 with optional BOM and detects comma or tab delimiters. If an actual file uses a different text encoding, supply `--table-formats` with a JSON object mapping its original relative path to `{"encoding": "...", "delimiter": ","}` or the literal tab delimiter.

The ten published dictionary columns are:

| Column | Source meaning |
|---|---|
| folderName | Folder or folders containing the described file |
| fileName | Native file name |
| fileDesc | File description |
| varName | Native variable name |
| varDef | Variable definition |
| varDomMin | Lower numeric or date domain bound |
| varDomMax | Upper numeric or date domain bound |
| varUnits | Native units |
| varCharVal | Native categorical token |
| varCharValDef | Meaning of that token |

`metadata2.xml / eainfo/detailed` describes this dictionary CSV. It does not itself enumerate the numeric table's units, quarter labels, or estimator preference values. The compiler reads those from the actual CSV.

Automatic definition resolution matches the actual file name and the original folder suffix, preserving case. When the dictionary expresses a group of files with an unusual naming convention, a table's `dictionary_records` object can select actual dictionary record numbers for an individual native column. Those selected records must all define that column and one original dictionary file identity. Inspection exposes the records for that selection.

## 3. Build a binding from the inspected original tables

The binding is a JSON file with schema `upstate.usgs-release-binding/v1`. It is an explicit source interpretation, so station IDs, calendars, parameter columns, qualifier values, and method names come from the original received records.

Top-level fields are:

| Field | Required contents |
|---|---|
| schema | `upstate.usgs-release-binding/v1` |
| title | Descriptive title of the actual selected reference series |
| metadata | Original-root-relative path to the pinned metadata attachment |
| dictionary | Original-root-relative path, or table object with `path`, `encoding`, and `delimiter` |
| evidence_files | Optional alias-to-source definitions: `path`, optional `kind`, and `uri` for an external source |
| station_table | Actual station table, field mapping, and coordinate definition |
| load_tables | Original seasonal table bindings described below |
| reporting_area | Original reporting polygon `path`, its real `uri`, optional `layer` / `where`, and evidence |
| reporting_companions | Original-root-relative sidecar paths required by that reporting vector |
| selections | Actual selected station records and source-compatible upstream catchment identities |

Every referenced input stays inside `USGS_RECEIVED_ROOT`. The compiler retains exact source bytes under the compiled output, so that directory becomes the `--original-root` passed to `usgs_loads`. External source URIs, such as the actual WBD reporting polygon source, remain distinct from the nutrient release DOI.

An evidence item is either `{"path": "an actual original relative path", "location": "an exact source location"}` or `{"alias": "a declared alias", "location": "an exact source location"}`. References to external source paths can also provide their actual `uri`. The compiler resolves those items to the native `{"file_id": "...", "location": "..."}` structure. The aliases `metadata` and `dictionary` are created automatically. Dictionary references for mapped columns are generated automatically from the actual original record numbers.

Locations should identify the specific source field, dictionary record, metadata element, code line or expression, or retained source record that supports an interpretation. An original station's `selection_evidence` and its catchment's `identity_evidence` are separate fields and both are converted for native preparation.

### Station table

`station_table` includes `path`, optional `encoding` / `delimiter`, optional `dictionary_records`, `columns`, `coordinate_crs`, and `coordinate_evidence`. Required logical column mappings are `station_id`, `station_name`, `longitude`, and `latitude`. Optional published relationships include `flow_station_id`, `comid`, `area`, `flow_station_area`, and `huc8`.

The USGS catalog exposes the names `station_id`, `station_name`, `flow_station_id`, `comid`, `area`, `flow_station_area`, `lat`, `lon`, `altsite_id`, `altsite_area`, and `huc8`. Inspection determines which actual member contains the selected fields and what each one means.

The pinned FGDC metadata has no geographic-coordinate-reference definition. Bind `coordinate_crs` to the actual station dictionary or another retained original source that defines those coordinates. Preserve the station and discharge-gauge identities as separate fields.

### Seasonal load table

Each `load_tables` entry includes:

| Field | Meaning |
|---|---|
| path; encoding; delimiter | Actual member and text format |
| dictionary_records | Optional explicit dictionary record numbers per native column |
| columns | Logical `station_id`, `year`, `quarter`; optional `days`, `period_start`, `period_end` |
| series_id; series_evidence | Actual selected load-series and discharge-basis identity |
| period_definition | Original annual calendar, described below |
| period_normalization | Optional conversion of one native period label or start date into explicit year/quarter columns |
| parameters | Nitrogen and/or phosphorus definitions |
| joins | Optional original model-review joins |
| row_rules | Native qualifier values admitted for this table |
| inspect_columns | Original columns whose observed categorical values the existing inventory should show |

The source catalog identifies `WYEARS`, `QUARTERS`, `method_00600`, `load_00600`, `sload_00600`, `dsload_00600`, `method_00665`, `load_00665`, `sload_00665`, `dsload_00665`, and `if_flow_detrended` among the Fluxmaster-related variables. WRTDS-related names include `period`, `nDays`, `fluxSeason`, `complete`, and `model`. Choose each mapping from the actual selected file's header and dictionary. Similar-looking load fields can represent different flow treatments or statistical quantities.

The released estimates were prepared with water-quality observations and discharge data. Fluxmaster used five-parameter regression, and WRTDS used Kalman smoothing. The metadata describes drainage-area adjustment when water quality and discharge were measured at different locations. Preserve that relationship in `series_evidence` and the station mapping when selecting a calibration reference.

### Native annual calendar

`period_definition` contains:

- `annual_start_month`: the original starting month as an integer from 1 to 12.
- `year_label`: `start` or `end`, naming the year used by the original annual label.
- `quarter_values`: all four native string tokens in their original annual order.
- `source_end_inclusive`: optional true when original explicit end dates include the last day.
- `evidence`: source locations that define this calendar.

The FGDC overall coverage is 1999-12-01 through 2020-11-30. That coverage is useful context; the actual seasonal calendar still comes from the dictionary and released code. A winter quarter crossing January can belong to a different source-labeled year than a calendar-year or October water-year assumption would assign.

If the source already has separate year and quarter columns, bind them directly. If a source combines them in `period`, `period_normalization` can use:

- `mode: "label"` with `column`, a full-match `pattern` containing exactly the named groups `year` and `quarter`, and `evidence`.
- `mode: "start_date"` with `column`, the original `date_format`, and `evidence`. The actual source date must be the first day of one of the four source-defined quarters.

The original token remains in every normalized row. Derived fields use the reserved prefix `__usgs_`. An individual malformed period is retained with blank derived year/quarter fields and its original parsing issue. Native annualization then retains that source row in its exclusion report. A malformed binding grammar is rejected before normalization begins.

The existing annualizer also checks any supplied `days` and explicit period dates against the defined three-month quarters. A declared daily average is multiplied by the actual quarter day count, including leap days.

### Parameter, units, method, and uncertainty

Each parameter entry names `parameter` as `nitrogen` or `phosphorus`, `load_column`, `method_column`, and the exact native strings in `accepted_methods`. The emitted parameter codes are `00600` and `00665`.

The compiler derives the original mass unit and time basis from the load column's actual dictionary definition. It supports the native preparation units `kg`, `g`, `lb`, and `metric_tonnes`, and the native bases `season_total_mass` and `mean_daily_mass`. It recognizes explicit daily mass-rate units, explicit mass per season/quarter, and unambiguous dictionary descriptions of a mean daily quantity or seasonal total.

Where the source expresses plain mass units but leaves the time basis to its code or other original documentation, supply `unit_binding` with `mass_unit` and `value_basis` and add `unit_evidence`. This binding keeps the original numeric values unchanged and must agree with the dictionary's mass dimension. Concentration, discharge, mass per area, and unsupported time denominators cannot be relabeled as seasonal load units.

`uncertainty_columns` names actual original uncertainty fields. Their original tokens and dictionary references are retained. The annualizer preserves those fields by source row; it does not invent an annual uncertainty interval by adding standard errors.

`allow_mixed_estimators` is false unless explicitly true in the binding. A single annual reference otherwise requires one admitted original series and estimator across all four quarters. The compiler checks accepted method tokens against the dictionary's actual enumeration when that enumeration is present.

## 4. Join the original model-review records

The source release includes model fit and checking outputs as separate tables. A join adds those original qualifiers to a seasonal load row while preserving both sources.

Each entry in `joins` has:

| Field | Required contents |
|---|---|
| name | Stable identifier beginning with a letter and using letters, digits, or underscores |
| table | Original review-table `path`, format, and optional dictionary record selections |
| left_on | Actual seasonal-table key columns, in order |
| right_on | Corresponding actual review-table key columns, in order |
| columns | Review fields to retain as explicit normalized columns |
| where | Optional review-column-to-native-allowed-values map |
| required | True by default; false explicitly allows an unmatched review record |
| relationship_evidence | Original source locations supporting the key relationship |

For a nitrogen-only wide load table, the actual review table may need a constituent selection in `where` before joining by station. For a table carrying constituent or method in its own rows, include those original fields in the join keys when the release defines them as part of the relationship. Inspect the dictionary and the selected files to choose the exact key.

The compiler requires a unique selected review record for each right-hand key. An ambiguous join stops compilation with the conflicting key so it can be resolved by the original constituent, estimator, period, or summary selector. The compiler preserves exact station IDs as strings and trims their surrounding table whitespace; it does not coerce them to numbers or equate different station namespaces.

Every seasonal source row is written once. It records `matched` or `missing`, the actual review source file ID and record number, copied qualifier columns, and the complete original review record. Required joins become an ordinary native qualifier rule admitting `matched`. Missing review records and rejected qualifiers therefore remain visible in the original annual review.

A `row_rules` entry names `column`, `allowed_values`, and `meaning`. For a joined field, use `review.JOIN_NAME.ORIGINAL_COLUMN`. The compiler converts this logical name to the actual normalized column, attaches its original dictionary record, and validates allowed tokens against the source enumeration when present.

The official catalog lists possible review fields such as `model_prediction`, `low_thresh`, `high_thresh`, `model_category`, `summaryChoice`, `WQ_FLAG`, `FLUXM_FLAG`, `WRTDS_FLAG`, `CONUS_Load`, and `IRB_Load`. Their accepted values and their relationship to the selected estimator must come from the actual member's dictionary and review record.

## 5. Compile and use the existing native pipeline

Once the actual binding has been filled from inspection:

~~~sh
python -m source_tools.usgs_contract compile \
  --original-root "$USGS_RECEIVED_ROOT" \
  --binding "$USGS_INTAKE_WORK/release-binding.json" \
  --output "$USGS_INTAKE_WORK/compiled"

python -m source_tools.usgs_loads inventory \
  --contract "$USGS_INTAKE_WORK/compiled/source-contract.json" \
  --original-root "$USGS_INTAKE_WORK/compiled" \
  --output "$USGS_INTAKE_WORK/native-inventory.json"

python -m source_tools.usgs_loads qualify \
  --contract "$USGS_INTAKE_WORK/compiled/source-contract.json" \
  --original-root "$USGS_INTAKE_WORK/compiled" \
  --output "$USGS_INTAKE_WORK/station-qualification.json"
~~~

These calls use the original `usgs_loads` public CLI without changing its implementation. `compile` also calls the original `_load_contract` to verify the emitted file identities.

A binding can initially leave `selections` empty to produce inventory and station qualification. Use the actual qualified station records to fill the final selection. Keep the initial compiled directory intact, and compile the revised binding into a new output directory such as `compiled-selected`.

Each selection requires `station_id`, optional `catalog_record_number` when the catalog contains repeated station rows, `selection_reason`, `selection_evidence`, and `catchment`. The catchment requires `source`, `identifier`, `station_role`, `split_catchment`, and `identity_evidence`. The original native roles are `water_quality_station`, `published_flow_station`, and `published_reach`. The existing preparation code checks the actual NLDI station/reach identity against the selected catalog row and receives the full-resolution upstream basin.

Run the final selected contract through that same pipeline:

~~~sh
python -m source_tools.usgs_loads prepare \
  --contract "$USGS_INTAKE_WORK/compiled-selected/source-contract.json" \
  --original-root "$USGS_INTAKE_WORK/compiled-selected" \
  --output "$USGS_INTAKE_WORK/annual-reference"
~~~

The existing preparation result contains:

- `annual-loads.csv` and `observation-metadata.json`.
- `catchments.geojson` with the original selection's `catchment_id`.
- `annual-records.json` and `annual-review.json` retaining original source records and their admitted or excluded interpretation.
- `station-qualification.json`, `catchment-sources.json`, retained original files, and a content-addressed result.
- `source-manifest.json` with the original `OBSERVED_LOADS` and `OBSERVATION_CATCHMENTS` roles.

The annualizer requires one admitted original estimate for each of the four native quarters. Rejected alternate estimators remain visible. Duplicate admitted estimates, incomplete seasons, incompatible series, or disallowed mixed estimators do not silently become an annual reference.

## 6. Retention and reuse

Compilation writes:

| Artifact | Purpose |
|---|---|
| original-binding.json | Exact submitted UTF-8 binding bytes |
| original/ | Exact retained source files under their original relative paths |
| objects/ | One content-addressed copy of each retained original file; original paths are hard links |
| normalized/ | Streamed tables with original numeric strings, derived period fields, and review joins |
| source-contract.json | Existing `upstate.usgs-seasonal-loads-contract/v1` contract |
| result.json | Content-addressed compilation result, original identities, and normalization counts |

The binding is frozen before compilation starts. Source reads use the retained original copies, so a changing download cannot alter a table after its identity has been recorded. Normalized table identities incorporate the actual seasonal file, dictionary, metadata, review-file hashes, and binding. The result reports original row counts, period-issue counts, and matched/missing counts for each join.

A same-binding restart reuses a completed result after verifying its identity, the current selected original members, and every retained contract file. Interrupted compilation resumes within its existing directory; partial normalized output is replaced atomically. A different binding or different source bytes use a new output directory. One normal filesystem lock covers each compilation directory.

The code uses the existing project's file retention helpers. It reads only the selected original tables and joins, and delegates numeric annualization and spatial source preparation to the existing pipeline.

## 7. Connect the annual source to calibration

Admit the resulting source manifest into the existing source workspace. Use the original annual-observation and upstream-catchment IDs from that admission, then select actual completed native baseline run IDs in the calibration operator.

`model.calibration` compares the completed baseline candidates against the source annual references. It groups repeated years, station aliases, and overlapping upstream catchments so they stay within the same calibration or validation partition. It selects a working profile with calibration groups and reports validation for the selected profile separately. Review the visible reference periods against the actual model vintages when interpreting the result.

The USGS source values are **observation-derived seasonal nitrogen and phosphorus load estimates**, calculated from water-quality and flow observations using the released estimators. The source is intended to support broad regional modeling; the original metadata discusses model fit and the extent of individual model checking. Retain that scientific role and the actual source review flags in the annual observation metadata. This intake supplies the nutrient-reference arm of the regional model.

## 8. Source compatibility

The implementation was joined to the retained original `source_tools/usgs_loads.py` version whose Git blob is `f5f69584a5e26dca29edf58071b06ce005702863`. It emits the original contract fields used by `inventory`, `qualify`, `_period`, `annualize`, `_catchment`, and `prepare`. It preserves both station selection evidence and catchment identity evidence and uses the native accepted mass units and annualization bases.

The original metadata byte identity and complete dictionary schema were checked against the retained release packet. Actual member inspection and compilation run on the existing receiver once the original dictionary and selected tables have been received. The current packet's source definitions are sufficient to route that receiving order and perform the dictionary-driven compilation.

### Primary source links

- USGS release: <https://doi.org/10.5066/P13YSTHM>
- USGS release description: <https://www.usgs.gov/data/estimated-seasonal-nitrogen-and-phosphorus-loads-selected-streams-conterminous-united-states>
- USGS Water Data Catalog: <https://water.usgs.gov/catalog/datasets/8a7d3140-2272-433c-9359-30840125cd7c/>
- ScienceBase item: <https://www.sciencebase.gov/catalog/item/6675b4dbd34e6f159fd10baf>
- Original streamflow/water-quality matching methodology referenced by the release: <https://doi.org/10.3133/sir20195069>

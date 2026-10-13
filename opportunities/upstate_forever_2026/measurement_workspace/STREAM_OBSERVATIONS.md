# Original stream observations in Published studies

This extension imports the original state WQP nutrient records for SV-233, SV-245, SV-375 and SV-376 as a separate maintained study. It composes onto Published studies 1.4, including its original report, paired-analysis and explicit installed-context joins.

## Use the complete cohort

Run the existing installer from the complete project checkout:

```sh
python install_published_studies.py --application "$APPLICATION"
```

In Published studies, import **Eighteenmile Creek: four stream nutrient stations, 2020–2025**. The original action is `published-study.import`, payload `{"builtin_id":"scdes-eighteenmile-streams-2020-2025"}`. Open its returned study/version. Station, characteristic, sampling year and sampling month select original result rows. The Observed series and WQP source context tables show original fractions, methods, result types and limits; row details retain all 63 agency cells.

The CLI can use the same existing workspace:

```sh
python measurement_workspace/published_studies.py --application "$APPLICATION" --workspace "$WORKSPACE" import "$APPLICATION/observations/eighteenmile_stream_nutrients_2020_2025" --operation-id eighteenmile-streams-20261013
python measurement_workspace/published_studies.py --application "$APPLICATION" --workspace "$WORKSPACE" context scdes-eighteenmile-streams-2020-2025 --site SV-233 --parameter Phosphorus --year 2023
python measurement_workspace/published_studies.py --application "$APPLICATION" --workspace "$WORKSPACE" report scdes-eighteenmile-streams-2020-2025 --site SV-233 --parameter Phosphorus --year 2023 --destination "$WORKSPACE/stream-reports/sv233-phosphorus-2023"
python measurement_workspace/published_studies.py --application "$APPLICATION" --workspace "$WORKSPACE" export scdes-eighteenmile-streams-2020-2025 --destination "$WORKSPACE/stream-reports/eighteenmile-stream-study.zip"
```

The selected report carries the exact original observation record selectors and source inventory. The complete-study ZIP preserves the original inputs and can be reimported with the same version identity. The optional installed lake-context flag belongs to the original lake study; this stream builtin uses its own complete inventory automatically.

## Source contract and actual counts

The cohort contains **589 result rows, 153 activities, 408 numerical values and 181 below-quantification records**. Station support is SV-233: 263 rows / 68 activities; SV-245: 4 / 1; SV-375: 185 / 48; SV-376: 137 / 36. Original sample dates range from 2020-01-06 through 2025-12-04.

The original characteristic counts are Ammonia 124, Nitrate + Nitrite 153, Kjeldahl nitrogen 153, Phosphorus 153 and Nitrogen 6. All original fractions are Unfiltered. Six Nitrogen records have the publisher's Calculated result type. Each original characteristic, fraction, method authority/identifier, result value type, weight/time/temperature/particle basis and support unit identifies a separate series. No components are summed.

The two original CSV bodies are retained unmodified in `original/nutrients-2020-2022.csv` and `original/nutrients-2023-2025.csv`. Their exact query URLs, bytes, hashes, row counts and nonoverlapping date intervals are in `observation-sources.json`. The reader maps the original WQP columns directly into the maintained observation schema and retains `raw_cells`, CSV row numbers, source hash, source URL and original source selector.

Censored records keep their original blank value and reported-value unit, with the separately reported quantitation-limit value/type/unit. Quantified-only means use source numbers. The existing concentration support module supplies arithmetic intervals for complete compatible below-limit support; no value is assigned to an individual censored result. These are dated concentration summaries.

## Basin applicability

The retained 47-station Seneca catalogue provides original WGS84 coordinates. The original NLDI USGS-02186702 basin is requested with `simplified=false&splitCatchment=false`. The reproducible longitude/latitude polygon predicate finds all four station points inside that whole basin. It handles exterior rings, holes and a separately labeled boundary result. Exact coordinates, source hashes and predicate details are in `basin-membership.json`.

The whole basin contains the complete local reach catchment. Therefore `gauge_upstream_applicability` remains `not_determined_by_unsplit_basin`. This matters for SV-233 and any station sharing the gauge's unsplit reach. A future exact split-catchment result can add its own applicability record without rewriting these original observations.

The previous header-only Nutrient query for the exact USGS-02186702 station stays a distinct original source query. Four state monitoring-station observations do not alter that result.

## Reproduce and extend

```sh
node source_tools/build_eighteenmile_stream_study.mjs "$APPLICATION/observations/eighteenmile_stream_nutrients_2020_2025"
```

The builder requires the exact five public original bodies and checks their byte counts and hashes before producing the station selection, native source manifest, basin membership, cohort metadata and full study inventory. It does not download or silently replace inputs. Every output body is deterministic.

The original lake builtin and its chlorophyll/microcystin cohort handling remain intact. The new `measurement_workspace/source_observations.py` reader uses an explicit `upstate.observation-sources/v1` index, so future source cohorts can reuse the same native study/context/report/export actions. Only studies explicitly declaring `observation_calendar_filters: true` apply calendar controls to their source observations.

## Receiving check

Use the existing native observation workspace. Import the builtin, confirm 589 original rows / 153 activities, select SV-233 / Phosphorus / 2023, open several original rows including a censored one, export the selected report and complete study, then reopen the complete-study archive. Confirm the source hashes and version identity. The source builder and browser JavaScript have been exercised here; the original Python Workspace intake and archive round trip belong to this existing native receiving operation.

## Integrated nutrient and gauge-flow study

The stream builtin also retains the installed application-root
`eighteenmile_stream_nutrient_analysis.sources.json` when present. Its six native
entries expose the complete original report, activity/flow table, station
contrasts, agency-calculated nitrogen reconciliation, cohort summaries and
daily gauge flow. The report includes 589 original nutrient results, 153
activities on 106 dates, 2,192 daily gauge values, 41 reconstructed nitrogen
intervals, 116 station contrasts and 58 nitrogen-component comparisons.

The selected desk tables remain original stream observations. The linked
scientific report retains its own full 2020–2025 scope; station/year/month
filters in the desk do not change that retained report. Its comparisons use
original activity dates, analytical compatibility and censor intervals as
explained in the report. Agency-calculated nitrogen remains a distinct
publisher result, alongside the separately reconstructed compatible
TKN-plus-NOx intervals.

### Import and reopen

The builtin queue action remains:

```json
{"action":"published-study.import","payload":{"builtin_id":"scdes-eighteenmile-streams-2020-2025"}}
```

The existing host supplies workspace and operation ID. For a materialized
cohort edition, the same composition is available explicitly:

```sh
python ACTUAL_APP/measurement_workspace/published_studies.py --application ACTUAL_APP --workspace ACTUAL_WORKSPACE import ACTUAL_APP/observations/eighteenmile_stream_nutrients_2020_2025 --with-installed-context
```

Use **Open nutrient and gauge-flow study, 2020–2025** in the retained study.
Its original SVG map and all relative table links resolve through the
existing retained-file transport. **Export selected report** includes the
scientific report's complete original dependency tree in the downloaded ZIP.
**Export complete study** retains the original cohort, the analysis and all
native source identities; importing that ZIP recreates the same source
edition.

The analysis is retained beneath
`application-context/stream-nutrients/`, with its original application-root
manifest and original `observations/...` and `source/...` layout intact.
That namespace distinguishes the source cohort's own original filenames from
the analysis's unchanged PR3064 original filenames. Identical bodies retain
their separate declared paths. All six native entry IDs, member hashes and
original manifest bytes remain unchanged. The study's generated registration
adds the original native manifest as a companion so source views and report
ZIPs retain a complete rebuildable application tree.

After unzipping the selected report, the original Node command can rebuild
the scientific analysis from its retained originals:

```sh
node original-sources/application-context/stream-nutrients/observations/eighteenmile_stream_nutrients_2020_2025/analysis/build_study.mjs --output NEW_DIRECTORY
```

The original analysis output labels source rows as one-based data rows
excluding the CSV header. The desk displays physical original CSV row numbers
(including the header); raw row detail retains the original zero-based source
record index. These conventions are explicit so the same original result can
be followed between the source viewer and the scientific tables.

### Installed source integrity

The installer walks the exact analysis manifest, checks every original body
against its required byte count and SHA256, and copies the complete 31-file
family at its original application paths. The native project archive includes
`source/`, `source_tools/` and the stream analysis root manifest as well as
the existing study and consumer modules. Existing different original source
bodies are rejected before replacement.

The original whole-basin GeoJSON has no embedded legacy CRS member. Its
byte-identical source body is already declared EPSG:4326 in the stream
cohort's native vector manifest; the study registration preserves that
explicit declaration when registering the analysis companion. It does not
alter the original geometry bytes.

Directory intake uses the same exact study-files.json inventory as the builtin; installed analysis files are then composed through their native manifest. This prevents an installed analysis directory from being imported a second time without its source companions. The original inventory itself is retained in complete study exports.

Daily gauge flow is shared basin context. Whole-catchment membership does not establish that every sampling station is upstream of the gauge; the original report states that distinction and preserves its original station geometry.

## Selected source and support exports

Selected original-observation exports retain every source column in a separate CSV for each original response. The accompanying index binds every selected row to its original response hash, physical CSV row, activity identifier and source record ID. The complete agency responses remain unchanged in the complete study export.

The concentration-support CSV preserves each series key, sample fraction, method authority and identifier, result value type, original weight/time/temperature/particle-size basis, and support-unit spelling alongside its station, project, activity type and interval statistics. These fields keep different analytical series distinct outside the application.

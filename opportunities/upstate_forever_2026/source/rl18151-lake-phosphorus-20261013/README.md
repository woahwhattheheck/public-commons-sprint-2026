# RL-18151 original Lake Keowee observations

This component captures and prepares the original 2018-01-01 through 2026-10-13 Water Quality Portal records for `21SC60WQ_WQX-RL-18151`. It is a source producer for the maintained scientific Workspace, Observed water quality workflow and ordered scientific-report picker.

## Original scope

The retained ES-9960 acquisition catalogue F0C8TAWUZJ5 supplies three original request sets: Nutrient, Physical and Microbiological. Each includes annual period-of-record summary, Result, Activity and ResultDetectionQuantitationLimit. The source capture adds the original Station CSV. Publisher group ranges may contain gaps. Annual summaries retain complete available history, while individual response queries select the explicit 2018–13 October 2026 dates.

Original station page: https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/

The station is described by SCDES as Lake Keowee approximately 0.15 miles SSW of the end of Point North Drive, with WGS84 coordinates latitude 34.841024, longitude -82.903165. The original downloaded station table is authoritative for native registration; the compiler requires its declared datum and retains the complete row.

The current catalogue joins a retained 2024 total-phosphorus assessment at HUC12 030601010204: source record 5d50e961f2d6ea86619791dc, original table page 61 / row 1124, normalized record 1361. Its original normalized source SHA256 is 69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c. This dated assessment is context alongside measured source dates.

## Capture original agency responses

Python 3.10+ and its standard library suffice:

```sh
python -B capture_rl18151.py /actual/retained/rl18151-lake-phosphorus-20261013
```

The capture writes exact response bodies into `original/`, query/HTTP/time/hash metadata into `capture-manifest.json`, and a byte-safe `source-transfer.json`. A successful original is reused only after its exact URI, length and hash match. A rate/access response stops further source requests in that pass. HTTP 204 is retained as an actual empty response. Other incomplete responses remain recorded with their original error bytes. Repeating the same command resumes only pending originals; choose a separate directory to retain a changed agency edition.

The script has no GIS or scientific-model dependency. Do not strip qualifiers, blank measured values, activity dates, fractions, detection limits or laboratory metadata from its output.

## Compile the complete study

Place all six source files beside one another. Node 20+ runs the source-bound compiler:

```sh
node build-study.mjs /actual/retained/rl18151-lake-phosphorus-20261013
```

It verifies every original response and the retained acquisition-plan hash before producing:

- Complete original-record JSON/CSV with source-file, logical CSV record, original hash and full agency row.
- Annual cohorts separated by characteristic, fraction, unit, sample medium/subdivision, activity/result depth, analytical method, result type and chemical basis.
- Three discrete observation context tables.
- Original station GeoJSON with its declared WGS84 or NAD83 CRS and full source metadata.
- An offline `report.html` with comparable-cohort/date/qualifier/status filters, original numeric and censor-interval plot, per-record inspector, selected-source JSON export and links to every original.
- The native `observed-report.json` recipe and `sources.json` manifest retaining all originals, derived tables, source code and report companions.

An empty group remains an explicit original empty response. It does not become a fabricated measurement. Original Activity and DetectionQuantitationLimit files remain independent retained tables. The main result's explicit inline limit is used only when its units match the measured-result units; additional cross-table limit linkage is examined against the returned identifier fields before use.

## Scientific interpretation

The concentration and physical records are discrete observations at a lake sampling station. They are not annual catchment exports. No daily flow, watershed load, water-volume weighting or unsampled time-series value is reconstructed.

Recognized left-censored records use the interval from zero to the published detection/quantitation limit, with an open upper bound, only when the two original units match. Their reported value text remains unchanged. Unknown detection conditions, missing limits and incompatible units have unresolved numeric intervals. No half-limit substitution is applied.

Numeric min/max/median/mean describe only the reported numeric subset. An all-record mean interval is available only when every record in the exact source cohort has a comparable numeric interval. Records retain their original qualifiers and result status; the initial report excludes no quality code silently.

The full requested nine-year span is not a claim of complete sampling. Returned sampling dates/months and exact annual record/activity counts describe actual coverage. The current 2026 observations cover only the query endpoint. The source analysis keeps depths and laboratory methods separate before temporal interpretation.

## Receive into the existing Workspace

Run from the installed application root so its maintained `model` package is available:

```sh
PYTHONPATH=/actual/upstate_forever_2026 python -B \
  /actual/retained/rl18151-lake-phosphorus-20261013/import_rl18151.py \
  --workspace /actual/existing-workspace \
  --source-root /actual/retained/rl18151-lake-phosphorus-20261013 \
  --output /actual/retained/rl18151-native-receipt.json
```

The importer uses existing `Workspace.import_sources`, `source_file` and `import_observations`. It preserves each source collection and creates nutrient, physical and microbiological context editions for nonempty original groups. Its receipt gives actual source and observation IDs, project UUID, report recipe SHA and the original station source.

Add the returned `observed_context_source` selector to the existing ordered `observed_context_sources` delivery field. This incorporates the original RL-18151 report alongside the existing canonical hydrology, stream and microbial scientific documents. All report companion paths remain relative to the retained source root and travel through original-source viewing and native archive export.

For an existing capture from another authorized source host, retain its full response bytes and original query/HTTP receipt first. Adapt the explicit source map to that actual edition before compilation; do not rename or imply that a different query was used.

## Source lineage

Operation: A73C-RL18151-PHOSPHORUS-20261013.

Parent availability bank: 451,362 B, SHA256 c8e07035ae9ac68ff619ee3f48e128191eea2927d8055f34a76e1d2db2ce9836. Original acquisition-plan.json SHA256 d96c3e9340e66db4ddd93798ca50c8d9c0f0acac6a05c6bc248897cf0e9402cd.

Primary service documentation: https://www.waterqualitydata.us/webservices_documentation/

The source capture/analysis is additive to the maintained Workspace and original agency-source operations. No shared observation, Published Studies, calibration or report engine is replaced.

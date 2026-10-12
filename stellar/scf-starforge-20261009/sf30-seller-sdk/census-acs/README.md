# Census ACS retained dataset publisher

Publish a selected, reproducible American Community Survey release through the existing Stellar Forge dataset publisher, merchant and buyer. The application keeps original Census table rows, geography records, table shells, HTTP capture records and annotation workbooks together. Operators can sell either typed observations or the complete original source files. A buyer can restore the complete capture and pass its original native source package into the existing Peoria assembler.

The Census implementation is a trusted source driver for the original SF30 publisher. The publisher owns extraction, review, publication, recovery and schedules. Its original version store owns dataset editions. SF88 owns acquisition and delivery. SF82 owns merchant releases and process control.

## Runtime and entry points

Use the repository's maintained Linux environment: Python 3.10+, Node 22.16+ with `node:sqlite`, util-linux `flock`, and the existing SCF Node dependencies. The Python capture and consumer use the standard library. Keep this directory in its original repository layout so imports resolve to the original publisher and buyer.

| Entry point | Purpose |
| --- | --- |
| `capture.py capture` | Retrieve selected original five-year table-based Summary File records |
| `capture.py import` | Import a retained public source ZIP and optional original native package |
| `capture.py activate` | Select an immutable capture for one fixed publisher source |
| `publisher/cli.mjs` | Original publisher commands, with typed Census plan generation |
| `release.mjs` | Prepare a published candidate for the original SF82 dataset release |
| `consumer/receive.py` | Restore the complete source capture from an original SF88 acquisition |
| `consumer/peoria_assemble.py` | Feed original source package bytes into the existing Peoria assembler |

Run the commands below from the repository root. Set an absolute project directory on a persistent volume with room for the selected files, retained plans, candidate CSVs and buyer deliveries.

```sh
CENSUS=stellar/scf-starforge-20261009/sf30-seller-sdk/census-acs
PROJECT="$PWD/work/census-project"
```

## Capture an official release

The release year is the last year of the five-year period. A 2024 release describes 2020–2024. Select full detailed-table IDs and full Census GEO_IDs explicitly.

```sh
python3 "$CENSUS/capture.py" capture \
  --year 2024 --table B01003 --table B25064 \
  --geo 0100000US --geo 0400000US17 --geo 1600000US1759000 \
  --out "$PROJECT/capture-2024"
```

The collector streams the release's original table-shell file, geography file and one original data file per table. It retains each selected header and row byte for byte, including the original line ending. Shells are scanned completely because a table has many shell rows. Unique geography and data selections can finish once every requested GEO_ID has been found.

Each capture record distinguishes the exact retained selected bytes from the original stream prefix actually read. `complete_for_requested_ids` describes the selection; `complete_stream` describes whether the original response reached EOF. The receipt does not represent a partially read source as a complete download.

For the official 2022, 2023 and 2024 releases, the collector also retrieves the same-year Jam Values workbook and retains its original HTTP capture. Known 2023/2024 table-to-workbook bindings produce normalized bounds with the original workbook hash and cell addresses. Other release years retain supplied annotation sources and expose unresolved bounds until a matching binding is available.

The original source streams can be large even for a small selected result. The defaults are 1 GiB consumed per response, 128 MiB of selected capture files and a 300-second deadline for each stream. Explicit `--max-response-bytes`, `--max-selected-bytes` and `--timeout` options adjust the reviewed workload. An exceeded limit fails the capture and retains completed fetches.

Resume the same request after an interrupted fetch:

```sh
python3 "$CENSUS/capture.py" capture \
  --year 2024 --table B01003 --table B25064 \
  --geo 0100000US --geo 0400000US17 --geo 1600000US1759000 \
  --out "$PROJECT/capture-2024" --resume
```

A completed capture is immutable. The final `source.json` binds the exact manifest SHA-256; the manifest lists every member's original byte count and SHA-256. Opening a completed capture verifies the inventory again.

### Import an existing public capture

The importer accepts the two already used selected-source archive formats: `public-census-selected-source.v1` with an original source prefix, and `census.public-selected-source.v1` with flat original paths. It validates the full ZIP member inventory, selection metadata, table/geography joins and original capture records.

```sh
python3 "$CENSUS/capture.py" import \
  --archive /absolute/path/Peoria_ACS_2024_Public_Source.zip \
  --native-package /absolute/path/Peoria_ACS_2024_Original_Capture_Package.json \
  --annotation /absolute/path/annotations-2024.json \
  --out "$PROJECT/capture-2024"
```

The optional native package is retained as exact bytes. Every embedded source member must match one original public archive member. The consumer passes that same package to the original Peoria assembler.

An annotation specification has exactly these keys. File paths resolve relative to the specification:

```json
{
  "year": 2024,
  "file": "2024_Jam_Values.xlsx",
  "receipt": "2024_Jam_Values.xlsx.capture.json",
  "source_url": "https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2024_Jam_Values.xlsx"
}
```

The receipt must identify the same URL, HTTP 200, workbook byte count and SHA-256. The workbook, original receipt and any normalized cell bindings all enter the capture inventory. Import remains offline; supply the original annotation records with the archive.

## One source selector across releases

Select the first retained capture:

```sh
python3 "$CENSUS/capture.py" activate \
  --capture "$PROJECT/capture-2024" \
  --source "$PROJECT/source.json" --create
```

The result includes `source_sha256`. A later selection requires that current source hash:

```sh
python3 "$CENSUS/capture.py" activate \
  --capture "$PROJECT/capture-next" \
  --source "$PROJECT/source.json" \
  --expect-source-sha CURRENT_SOURCE_SHA256
```

Both captures must reside inside the source project. Selection uses the original current source as a compare-and-swap condition, a private kernel file lock and atomic replacement. Saved publication plans keep their own retained capture. Switching the selector therefore changes future plans while existing candidates remain reproducible.

## Create, inspect and publish a dataset

The two projections serve different customer needs:

| Projection | Contents | Default page |
| --- | --- | --- |
| `observations` | Typed estimates, MOEs, raw values, source geography/table labels, annotation bounds and provenance | 50 rows; maximum 250 |
| `source_files` | Every capture member plus the manifest, split into exact byte chunks | 10 chunks; maximum 10 |

Use separate publisher/version-store directories for the two dataset products. Each can publish successive compatible releases through its own original version store.

```sh
node "$CENSUS/publisher/cli.mjs" init \
  --workspace "$PROJECT/observations-publisher" \
  --source "$PROJECT/source.json" \
  --state "$PROJECT/observations-versions"

node "$CENSUS/publisher/cli.mjs" source \
  --workspace "$PROJECT/observations-publisher"

node "$CENSUS/publisher/cli.mjs" template \
  --workspace "$PROJECT/observations-publisher" \
  --query observations --name "ACS observations" \
  --out "$PROJECT/observations-plan.json"
```

Review the plan's columns, nullable values, public filters, ranges, sorts, extraction size and response limits. The supplied template uses the declared source types. Observation projections may select a subset of columns. Source-file delivery requires all eleven inventory and chunk columns with their canonical types.

```sh
node "$CENSUS/publisher/cli.mjs" save \
  --workspace "$PROJECT/observations-publisher" \
  --input "$PROJECT/observations-plan.json"

node "$CENSUS/publisher/cli.mjs" extract \
  --workspace "$PROJECT/observations-publisher" --plan PLAN_NUMBER

node "$CENSUS/publisher/cli.mjs" inspect \
  --workspace "$PROJECT/observations-publisher" --run RUN_UUID \
  --query 'limit=20'
```

Saving retains the original source configuration and every original capture member. Extraction reopens only that retained source, verifies the source before and after streaming, writes the original CSV candidate and records the complete selection. It does not change the active merchant.

For the first publication into a new target:

```sh
node "$CENSUS/publisher/cli.mjs" review \
  --workspace "$PROJECT/observations-publisher" --run RUN_UUID \
  --reviewer OPERATOR --note "Reviewed the selected release and public columns." \
  --initialize

node "$CENSUS/publisher/cli.mjs" publish \
  --workspace "$PROJECT/observations-publisher" --run RUN_UUID \
  --review REVIEW_UUID
```

For subsequent publications, start the original versioned merchant and review with the actual `--expect SNAPSHOT` and `--expect-revision NUMBER` reported by the target. The original publisher compares the current contract and uses the existing live control socket. Compatible new data advances the existing version store; retained snapshots remain available to pinned buyers.

An interrupted publication is reconciled through the original operation:

```sh
node "$CENSUS/publisher/cli.mjs" recover \
  --workspace "$PROJECT/observations-publisher" --run RUN_UUID
```

### Operator browser

```sh
node "$CENSUS/publisher/cli.mjs" serve \
  --workspace "$PROJECT/observations-publisher" --port 8467
```

The existing local publisher desk exposes source details, typed column selection, saved plans, extraction progress, candidate preview, review, publish, recovery, paginated history and schedules. Census source details use the shared `serviceQuery` renderer. Open a saved plan to preserve its reviewed defaults. For a new `source_files` plan in the browser, keep every column and set both default and maximum page size to 10.

Only one CLI or browser process owns a publisher workspace at a time. Stop the serving process before opening the same workspace from another command.

## Original merchant and SF82 release

Use the original dataset seller configuration tooling with the chosen payment asset, exact atomic price, pay-to address and public origin. The original versioned seller adds the optional `snapshot` query parameter without a default. This keeps the same merchant route usable by current and pinned buyers.

Generate the original snapshot-enabled seller while its version store is offline. Use the payment JSON format documented by the original dataset seller; retain exact atomic amount strings.

```sh
VERSIONED=stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs
node "$VERSIONED" configure \
  --state "$PROJECT/observations-versions" \
  --payment /absolute/path/payment.json \
  --origin https://merchant.example --path /census \
  --snapshot-selection --out "$PROJECT/generated-seller.json"
```

The original `serve` command starts that merchant with its existing dataset controls:

```sh
node "$VERSIONED" serve \
  --state "$PROJECT/observations-versions" \
  --seller "$PROJECT/generated-seller.json" --port 8468 \
  --control-transport loopback
```

Add the original `--facilitator` option for the selected payment facilitator. Its default startup exposes the original challenge-only merchant mode. Payment verification uses the existing native seller integration.

After publishing, prepare the five-file SF82 package with the generated snapshot-enabled seller configuration:

```sh
node "$CENSUS/publisher/cli.mjs" release-package \
  --workspace "$PROJECT/observations-publisher" --run RUN_UUID \
  --seller "$PROJECT/generated-seller.json" \
  --out "$PROJECT/merchant-release"
```

The release contains:

- `dataset.csv`: the exact original candidate CSV.
- `dataset.json`: its original dataset settings with a package-relative CSV path.
- `seller.json`: the exact operator-supplied generated seller.
- `source.json`: the exact capture manifest, extraction and publication binding.
- `binding.json`: the original version-store directory, dataset contract and baseline snapshot.

`prepareCensusRelease()` calls the shared SF82 `prepareDatasetRelease()` before returning. The latter reopens the original CSV, checks the snapshot and contract, and validates that the merchant exposes precisely the original dataset query capabilities.

Stage the package through the existing release API:

```js
import { initReleaseStore, stageRelease } from
  './stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

await initReleaseStore('/absolute/path/pilot');
await stageRelease('/absolute/path/pilot', {
  id: 'acs-observations',
  label: 'ACS observations',
  datasetPackage: '/absolute/path/census-project/merchant-release',
  runtime: { port: 8468 }
});
```

Use the original SF82 controller for start, readiness, drain, rollback and resume. Merchant release history and dataset edition history remain separate. Preserve the bound original dataset directory across merchant replacements.

## Acquire and restore the original source

Publish `source_files` using its own typed plan and original versioned seller. The original publisher's `buyer` command first reads current seller terms. With the reviewed intent, offer hash and option, it prepares the original SF88 acquisition configuration:

```sh
node "$CENSUS/publisher/cli.mjs" buyer \
  --workspace "$PROJECT/source-publisher" --run RUN_UUID \
  --seller http://127.0.0.1:8468 \
  --resource https://merchant.example/census \
  --query 'limit=10'
```

Follow the original returned buyer instructions and keep the same acquisition workspace after interruption. The response pages use original snapshot pinning and continuation. See [the consumer guide](consumer/README.md) for complete executable receive/reopen and Peoria handoff commands.

Source files are split into 49,152-byte chunks, whose base64 representation is at most 65,536 characters. Each delivery row includes the release period, capture ID, path, complete-file hash and length, chunk count/index/hash and content. The complete manifest is itself delivered. The receiver checks the full inventory, all chunk hashes, whole-file hashes and exact expected release. It detects an entirely omitted file as well as a damaged chunk.

The consumer uses the original SF88 delivery reader. A matching existing capture can reopen. An unrelated destination is rejected. When a native Peoria source package is present, the receiving helper passes its original bytes and matching method-source records into the existing private assembler.

## Data interpretation

Every observation preserves `estimate_raw` and `moe_raw`. Nullable numeric columns are conveniences for ordinary arithmetic; the raw tokens and separate status columns carry the exact source semantics.

| Source condition | Normalized behavior |
| --- | --- |
| Ordinary numeric estimate and nonnegative numeric MOE | Numeric values with 90-percent confidence metadata |
| Empty or explicit missing token | Null numeric value and missing status |
| Census special estimate/MOE token | Null where appropriate and a distinct source status |
| Open-ended median interval | Null point estimate; bound value/kind/label from the same-year workbook when resolved |
| Integer outside the JavaScript exact range | Null numeric value with precision-loss status; original text retained |
| Nonnumeric annotation or invalid numeric token | Explicit annotated/invalid status; original text retained |

Special tokens are interpreted by their estimate or MOE column role. A controlled estimate can retain its numeric estimate while its MOE has a controlled status. Negative ordinary estimates are not globally rejected because detailed-table semantics differ.

The annotation bindings cover the retained median gross rent, household income, owner costs with/without a mortgage, home value and year-built indicators for 2023/2024. Each resolved bound identifies the original workbook, hash, year, sheet and cells. The 2024 workbook's literal title cell says 2023; the adapter retains that original text and binds the official 2024 file to the 2024 release.

Geography IDs retain their full original strings and leading zeros. Table titles, universes, label paths, E/M variable names, original source file hashes, row hashes and source-line addresses remain available alongside values.

A release upgrade is an operational dataset replacement. For substantive ACS comparisons, follow Census guidance on non-overlapping five-year periods, variable definitions and changed geographies. The 2019–2023 and 2020–2024 periods overlap. This adapter performs no trend significance test or derived housing-study calculation.

## Retention and operations

Keep the source project, original publisher workspace, original version store, generated seller configuration, SF82 pilot and SF88 acquisition workspace on persistent private storage. Capture data and retained candidates contain exact source records; seller and buyer configuration can contain operational account information.

The original publisher's schedule commands are available unchanged. A schedule runs a retained plan; selecting another capture does not silently change that plan. Save and review a new plan for a new release, then update the schedule through its original revision controls. See the original [publisher schedule guide](../postgres/publisher/SCHEDULES.md).

Extraction failure retains its original run and progress. Reopen a completed matching capture; resume an unfinished identical source request; recover a retained candidate or uncertain publication through the original publisher. Current source selection, candidate review and version-store publication each use their own original identity.

## Source references

- [ACS Summary File](https://www.census.gov/programs-surveys/acs/data/summary-file.html)
- [Original table-based Summary File releases](https://www2.census.gov/programs-surveys/acs/summary_file/)
- [Original Jam Values workbooks](https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/)
- [Census guidance for comparing ACS data](https://www.census.gov/programs-surveys/acs/guidance/comparing-acs-data.html)

MIT.

## Installed command and agent publisher

The maintained distribution exposes `starforge census-publisher` for this same CLI and the `./seller/census-acs`, `./seller/census-acs/publisher`, `./seller/census-acs/publisher/plan` and `./seller/census-acs/release` module exports.

An existing original publisher can also be declared in the merchant MCP publisher connection with `kind: "census-acs"`, its private `directory`, and an optional original `seller`/`resource` pair. The host configuration selects its path; agent calls use the declared alias. All original `merchant_publisher_*` tools then operate the same saved plans, extraction runs, reviews, publication, buyer handoff and recurring schedule. Close the browser/CLI owner before opening that workspace in the merchant process. Reopening uses the original workspace lease and retained operation identities.

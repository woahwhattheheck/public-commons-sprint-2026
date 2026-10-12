# BLS labor data: capture, publish, acquire and reopen

This application takes original Bureau of Labor Statistics LAUS and QCEW files through a retained, reviewable publication and into an existing customer workspace. Analysts can query the published observations. Customers can acquire the complete original files and import them through their own established statistical engine.

The source application uses Python's standard CSV reader and the original Starforge source-dataset publisher. The publisher keeps its existing saved plans, candidate inspection, review, version store, browser, recurring refresh and buyer handoff. Managed deployment uses the original SF82 dataset release. Acquisition and delivery use the original SF88 and SF100 implementations.

## What an operator gets

| Surface | Work it completes |
| --- | --- |
| capture.py | Acquire official LAUS dictionaries/state files and QCEW county slices, resume an interrupted capture, import a retained original bundle, inspect its files and atomically select an edition. |
| source.mjs and project.py | Inspect an immutable source and stream typed LAUS observations, typed QCEW observations, or every original source-file byte. |
| publisher/cli.mjs | Initialize the original publisher, create typed plans, extract, inspect, review, publish, recover, operate its browser and recurring refresh, and prepare its buyer configuration. |
| release.mjs | Prepare the original SF82 dataset release package from an already published candidate and its original seller terms. |
| consumer/ | Restore a complete acquired source capture and pass original files through the existing Vitality catalogue, loader and workspace. |
| contract.json | Declare the exact columns, data types, selection shape, stream protocol and supported source limits shared by Python and Node. |

The default selection is a concrete Northeast Kingdom use case: Caledonia, Essex and Orleans counties in Vermont, LAUS years 2024–2026 with measures 03–06 and monthly/annual periods, plus the 2026 first-quarter QCEW slices for total covered ownership, all industries and all establishment sizes. The selection is explicit and can be changed before capture. All original source histories remain intact in the source-file delivery.

### Requirements

Use the maintained Starforge source or installed distribution, Linux with util-linux flock, Node 22.16 or later with its original dependencies, and Python 3.10 or later. Python capture, projection and receiving need only the standard library; the original buyer and customer application keep their own declared dependencies.

Runtime source declarations, captures, publisher directories and customer workspaces are private local operator files. The application creates source files with mode 0600 and directories with mode 0700. Imported raw file bytes remain unchanged.

The original Vermont LAUS source alone is 28,709,922 bytes. A complete source-file publication also holds its dictionaries, QCEW files, saved source copy, CSV/version, acquired pages and customer copies. Plan disk and memory for that complete operation. The source projector and copy/receiver paths stream bytes; the original dataset reader retains its published table in memory.

## Capture an original edition

Run commands from the source repository root. Choose an existing private parent directory for the project.

~~~sh
mkdir -m 700 /private/bls-project

python3 stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/capture.py capture \
  --directory /private/bls-project/captures/edition-1 \
  --laus-url https://download.bls.gov/pub/time.series/la/la.data.53.Vermont
~~~

The command captures the original LAUS area, series, measure and footnote dictionaries; the requested original state data; and the QCEW county/quarter slices named by the selection. Each source has an adjacent original HTTP receipt with URL, final URL, retrieval time, length and SHA256, plus available release headers.

Repeat the same command and directory after an interrupted operation. Completed file/receipt pairs are checked and reused. The saved capture request must agree with the requested source URLs and selection.

For another county group, period or field selection, make a JSON file containing the selection object from contract.json, edit its values and pass that file with --selection. Supply each necessary LAUS state-data URL with a repeated --laus-url. Supported LAUS measures are 03, 04, 05 and 06; supported QCEW slices are quarters 1 through 4.

### Import an already retained official source bundle

The original NEK source bundle is supported directly:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/capture.py import \
  --input /originals/NEK_Vitality_Official_Sources_20261011.zip \
  --expected-archive-sha256 3473bd56195b486c41a5042f5d9be4cfbf82bcf0d257528fe724b18caea9a28e \
  --directory /private/bls-project/captures/edition-1
~~~

An already unpacked original bundle directory is also accepted as --input. Import verifies the selected original source bytes against their adjacent capture receipts. Original bundle indexes and provenance remain available with the retained capture. The top-level archive prefix is normalized away while the original data/* filenames stay unchanged.

The original 2026-10-11 bundle contains these BLS files and their eight adjacent .capture.json receipts:

~~~text
data/bls-la-vermont.tsv
data/bls-la-area.tsv
data/bls-la-series.tsv
data/bls-la-measure.tsv
data/bls-la-footnote.tsv
data/bls-qcew-2026-q1-50005.csv
data/bls-qcew-2026-q1-50009.csv
data/bls-qcew-2026-q1-50019.csv
~~~

### Select the edition

The fixed source.json selects one immutable capture. Its initial creation uses the explicit absent precondition:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/capture.py activate \
  --directory /private/bls-project/captures/edition-1 \
  --source /private/bls-project/source.json \
  --expected-source-sha256 absent
~~~

The declaration contains only its schema, relative captured-manifest path and exact manifest SHA256:

~~~json
{
  "schema": "stellar-forge.bls-labor-source.v1",
  "capture": "captures/edition-1/_bls/capture-manifest.json",
  "captureSha256": "THE_SHA256_RETURNED_BY_CAPTURE"
}
~~~

The manifest schema is stellar-forge.bls-labor-capture.v1. It retains selection, source_prefix, sources, files, provenance and optional original catalogue keys. Every files member has its exact relative path, byte count and SHA256. The manifest is excluded from its own inventory; the capture identity is the SHA256 of its exact bytes.

## Create and inspect a publication

LAUS observations, QCEW observations and original source files have different query contracts. Create a separate original publisher and target for each projection you intend to offer.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs init \
  --workspace /private/bls-project/laus-publisher \
  --source /private/bls-project/source.json \
  --state /private/bls-project/laus-dataset

node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs template \
  --workspace /private/bls-project/laus-publisher \
  --query laus \
  --name "NEK resident labor statistics" \
  --out /private/bls-project/laus-plan.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs save \
  --workspace /private/bls-project/laus-publisher \
  --input /private/bls-project/laus-plan.json
~~~

The template includes the exact native string, integer, number and nullability declarations. It also supplies useful filters, range queries and sort columns. Review the returned plan ID and saved source selection, then extract that plan:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs extract \
  --workspace /private/bls-project/laus-publisher \
  --plan SAVED_PLAN_NUMBER

node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs inspect \
  --workspace /private/bls-project/laus-publisher \
  --run RETURNED_RUN_ID \
  --query 'limit=20'
~~~

Saving a plan retains the complete source under that original plan's directory. Changing the active source pointer later leaves the saved plan and its source bytes unchanged. The Python worker verifies original files and emits one typed row at a time. The Node adapter handles the original row consumer, row/byte limits, timeout and cancellation, checks the final worker result, and verifies the source again before the publisher can retain a completed candidate.

The original publisher exposes the same workflow in its browser:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs serve \
  --workspace /private/bls-project/laus-publisher \
  --port 8469
~~~

Open the returned local URL. Source inspection displays the actual service selection. Saved plans, extraction progress, candidate preview, reviews, publications, source/target identities, buyer handoff and schedule history are the original publisher views. Stop the server before opening the same publisher with another process.

### Review and publish the first candidate

Use the original run ID returned by extraction. The review binds the candidate and the target's initial state.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs review \
  --workspace /private/bls-project/laus-publisher \
  --run RETURNED_RUN_ID \
  --reviewer "Regional analyst" \
  --note "Reviewed the original county, period, measure and footnote selection." \
  --initialize

node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs publish \
  --workspace /private/bls-project/laus-publisher \
  --run RETURNED_RUN_ID \
  --review RETURNED_REVIEW_ID
~~~

Publication initializes the original version store. Configure its original merchant terms and run the versioned dataset seller using the maintained dataset-refresh command. Select loopback control when the host does not support Unix-domain listeners:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs --help
~~~

For a refresh, run that same original seller, inspect its current snapshot and revision, and use --expect and --expect-revision in place of --initialize. The original publish operation enforces that pair. If its reply is lost, the recover command reconciles the original candidate against the actual version store.

## Understand the two analytical projections

### LAUS: resident labor statistics

The 37-column LAUS projection retains county and original area/series identifiers; measure code and name; seasonal status; year and original period; monthly or annual-average coverage; raw and numeric value; status; original observation/series footnotes; captured dictionary references; and exact source row/hash/line metadata.

| Measure code | Meaning | Unit |
| --- | --- | --- |
| 03 | Unemployment rate | Percent |
| 04 | Unemployment | Persons |
| 05 | Employment | Persons |
| 06 | Labor force | Persons |

Monthly M01–M12 observations and M13 annual averages keep their original period identities. The original G footnote for 2025 identifies an eleven-month annual average excluding October. The output retains that dictionary explanation, coverage_months and excluded_months. U, X and N preserve unavailable annual averages, unavailable data and unavailable values respectively. Other captured footnotes remain attached to the original observation.

LAUS has a place_of_residence basis. Its employed-person series and a QCEW workplace job count are separate source concepts.

### QCEW: employment and wages at workplaces

The 34-column QCEW projection retains the original area, ownership, industry, aggregation and establishment-size dimensions. It produces one record for each explicitly selected metric while keeping the complete original row as raw_record.

The default selection contains all 32 declared quarterly metrics: eight base measures, their eight location quotients, and sixteen over-the-year changes/percentage changes. Original employment metrics have their specific month; quarterly wage and establishment metrics keep their quarter. Unit and metric remain explicit.

The base, location-quotient and over-the-year families use their own original disclosure fields. N produces a null numeric value with withheld status while retaining the original token, including a zero token. Other unrecognized disclosure text is retained separately and does not become a reported measurement.

Source-provided titles are retained where available. Ownership and county aggregation display labels use the primary BLS classification tables identified in project.py. Original codes and raw rows always remain available. Numeric conversion preserves raw decimal text and marks unsafe integer precision or non-finite/non-numeric values explicitly.

## Publish and acquire the complete original source

Create a second publisher/target and use template --query source_files. Keep the entire eight-column contract. Use the supplied ten-row page limit, 65,536-character cell limit and 921,600-byte native page bound. Each source chunk contains up to 49,152 original bytes.

The source_files projection contains all inventory members and _bls/capture-manifest.json. The receiving helper checks the complete inventory, so a query that leaves out a whole file cannot become a complete received capture.

Use the original publisher's buyer operation to inspect the actual running seller offer and prepare its reviewed original SF88 configuration:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs buyer \
  --workspace /private/bls-project/source-publisher \
  --run SOURCE_RUN_ID \
  --seller http://127.0.0.1:MERCHANT_PORT \
  --resource https://merchant.example/bls-originals \
  --query 'limit=10'
~~~

The configured resource must be the resource advertised by that original merchant. With the actual offer SHA, selected accept index and a unique intent ID, the same command's --offer-sha, --option and --intent arguments create its retained buyer configuration. The original SF88 buyer owns authentication, payment, attempts, cursor continuation, recovery and accounting.

The complete command/API walkthrough for SF88 acquisition, SF100 finalization, source restoration and original Vitality receiving is in [consumer/README.md](consumer/README.md).

## Operate a managed release

After a candidate is PUBLISHED and the operator has its original generated seller file, prepare the original SF82 package:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/bls-labor/publisher/cli.mjs release-package \
  --workspace /private/bls-project/laus-publisher \
  --run PUBLISHED_RUN_ID \
  --seller /private/bls-project/laus-seller.json \
  --out /private/bls-project/laus-release
~~~

The package contains the exact candidate CSV, original dataset configuration, seller terms, source/candidate/publication provenance and binding to the existing dataset version store. Source JSON includes the original captured-manifest bytes. A source_files dataset also carries every original file in its published rows.

Use the original releases.mjs API or release console to stage this package:

~~~javascript
import { initReleaseStore, stageRelease } from './stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs';

await initReleaseStore('/private/bls-project/releases');
await stageRelease('/private/bls-project/releases', {
  id: 'bls-laus-edition-1',
  label: 'Reviewed NEK resident labor statistics',
  datasetPackage: '/private/bls-project/laus-release',
  runtime: { port: 8470 }
});
~~~

The original release controller handles selection, start, restart, drain, rollback and reopen. Its binding points to the existing host-local dataset directory and exact query contract. Keep that directory with the deployment. The original version store retains historical snapshots and the source-file buyer retains its chosen snapshot across a later edition.

## Capture a later release and continue the same operation

Capture a later edition in a different directory. Inspect the current fixed source.json hash, then activate the new capture with that exact --expected-source-sha256. Activation verifies the whole new capture, acquires the local kernel lock and atomically replaces the selected source declaration.

Create and review a new plan against that active edition. The original target and query contract remain the refresh destination. Existing candidates, source copies, version snapshots and customer sessions keep their original identities.

The original recurring publisher can apply an explicitly configured policy using schedule-save, schedule-enable, schedule-run, schedule-pause and schedule-continue. Select a captured edition before a fresh plan; schedules operate the original saved source/plan and policy. Provider collection remains the capture command's operation.

Retain the project source pointer and capture directories, publisher workspaces, dataset version stores, original SF82 release store, SF88 sessions, SF100 deliveries and received customer sources. Reopen each by its original path. Completed copy/import operations verify matching destinations and reuse the same original source identities.

## Primary source specifications

- [LAUS flat-file format and series definitions](https://download.bls.gov/pub/time.series/la/la.txt)
- [Original LAUS footnote dictionary](https://download.bls.gov/pub/time.series/la/la.footnote)
- [LAUS current and historical data](https://www.bls.gov/lau/data.htm)
- [QCEW CSV data slices](https://www.bls.gov/cew/additional-resources/open-data/csv-data-slices.htm)
- [QCEW quarterly field layout](https://www.bls.gov/cew/about-data/downloadable-file-layouts/quarterly/naics-based-quarterly-layout.htm)
- [QCEW ownership classification](https://www.bls.gov/cew/classifications/ownerships/ownership-titles.htm)
- [QCEW aggregation classification](https://www.bls.gov/cew/classifications/aggregation/agg-level-titles.htm)
- [BLS geography concepts](https://www.bls.gov/bls/geography.htm)
- [BLS linking and reuse policy](https://www.bls.gov/bls/linksite.htm)

## Installed command and merchant MCP

The maintained Starforge distribution includes the complete application. Invoke
`starforge bls-publisher` with the same command and arguments shown above. The
installed `./seller/bls-labor`, `./seller/bls-labor/publisher`,
`./seller/bls-labor/publisher/plan` and `./seller/bls-labor/release` module exports
refer to these original source modules.

The original merchant MCP host configuration accepts a publisher whose `kind`
is `bls-labor` and whose workspace is the original BLS publisher directory.
Existing `merchant_publisher_*` tools open that workspace through
`openBlsPublisher` and retain its original capture selection, extraction,
review, publication, recurring execution, recovery and buyer handoff. Configure
the workspace on the host, then use the same merchant publisher operations that
serve the other maintained source applications.

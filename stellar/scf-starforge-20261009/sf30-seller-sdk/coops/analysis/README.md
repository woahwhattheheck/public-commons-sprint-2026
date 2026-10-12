# CO-OPS coastal analysis workbook

This is the analytical continuation of the SF30 NOAA CO-OPS source workspace. It uses two retained editions—six-minute water-level observations and six-minute tidal predictions—to produce an exact-time residual analysis and a portable analyst workbook.

The complete export has a self-contained browser page, an editable portable workbook, every paired source row in CSV and JSON, threshold episodes, unavailable-source detail and the original response files. The page opens from a local file and makes no data request.

## Analyst workflow

1. In the original coastal source workspace, retain the observation and prediction editions for the same station, datum, unit and GMT time basis. Select water_level observations and predictions at interval 6.
2. Open **Compare retained editions → Coastal residual workbook** in the original workspace, choose those observation and prediction editions, and select **Build and retain complete workbook**. A single original capture containing both products can supply both selections. The workspace retains every generated file through its original request journal. Download the complete offline HTML or editable workbook from the completion dialog or Handoff files.
3. Open the generated workbook.html. Review the selected source context and original files before applying a narrower window or quality selection.
4. Choose any upper/lower residual thresholds in the displayed source unit. Blank fields leave the corresponding threshold inactive. Apply the selection to update all calculations and plots.
5. Select a time in the paired table to inspect every original row at that timestamp, its quality fields and its source-array position. Ambiguous duplicates remain available for review.
6. Record the analyst, project, question, interpretation and follow-up. Save on the device or download the complete portable workbook.
7. Reopen that downloaded file with **Open source or workbook**. The page verifies the original file hashes and recomputes the saved analysis. Use **Print / save PDF** for the narrative report and the complete CSV/JSON exports for downstream engineering.

Device saves are maintained through IndexedDB in the current browser origin. A downloaded portable workbook carries the original source and analysis between browsers and machines.

## Create the workbook in the running source workspace

The existing Applications entry **Coastal Source Operations** opens the same
workspace and journal. On a retained edition, **Build coastal workbook** opens
the paired-source selector. Eligible lists contain the original GMT water-level
and six-minute prediction editions. The analytical core checks station, datum,
units, datum epoch and the overlapping six-minute clock before calculating.

Optional start and end values are GMT. Blank bounds use the full overlapping
source requests. Quality, inference/tolerance flags, sigma and residual
thresholds are retained with the named analyst, project, question, interpretation
and follow-up. The offline workbook allows the same complete selection and
interpretation to continue after download.

The native `analysis.export` action writes the whole existing bundle: HTML,
editable workbook JSON, full analysis, paired/episode/unplaced CSVs, every
original response and metadata file, manifest and operating instructions.
Each member has its own retained export identity and complete byte receipt.
The primary HTML already contains the full original source and offline tools.

The original `operationId` binds the exact edition pair, requested options and
notes. The native journal fixes `createdAt` before generation. Completed group
records reopen their original files before recalculation; partial publication
reuses the existing export writer's exact-byte continuation. Each retained
member is registered in the same workspace's **Handoff files**.

### CLI

Create an analysis-selection JSON object with `observationsEditionId`,
`predictionsEditionId`, and optional `options` and `analyst` objects. Use the
actual edition identities returned by the existing workspace. The selection
shape is the same as the source-owned API below.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/coops/cli.mjs \
  --session /absolute/original-coastal-startup.json \
  analyse --operation-id coastal-analysis-original-001 \
  --request /absolute/coastal-analysis-selection.json
~~~

Use `--workspace /absolute/original-private-workspace` for a stopped workspace.
Repeat the exact operation and selection after an interrupted reply. The
completion returns `workbookExportId`, `portableExportId` and every `files[].id`.
The existing `download --export-id ID --output NEW_FILE` command streams any
one of those complete original files.

The installed `starforge coops` command exposes the same native operations.
`starforge coops-analysis --input ... --output ...` reproduces the full directory
delivery from an original analysis input or downloaded portable workbook.

### API and Merchant tools

~~~js
const completion = await app.action({
  action: 'analysis.export',
  operationId: originalOperationId,
  expectedRevision: (await app.view()).revision,
  payload: {
    observationsEditionId,
    predictionsEditionId,
    options: {quality: 'verified', excludeInferred: true},
    analyst: {name, project, question, interpretation, followUp},
  },
});
~~~

`merchant_coops_analysis_export` provides the same action through the original
declared coastal workspace. The existing `merchant_coops_files` and
`merchant_coops_file_read` operations receive the complete retained outputs
with their original selectors, offsets and source identities.

The source-owned `analysisInputFromEditions(store, selection)` adapter selects
the actual `edition.query.products[]` and matching response receipts. It reads
the existing `store.object(receipt.sha256)` bytes, preserving UTF-8 BOMs and
whitespace. Accepted NOAA no-data responses yield explicit missing slots.
Unavailable metadata, failed responses and resources absent from the original
station advertisement remain available in the workbook's source inspection.

## Build a complete delivery

Use the maintained Node runtime from the repository root:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/coops/analysis/bundle.mjs \
  --input /absolute/path/to/original-coastal-analysis-input.json \
  --output /absolute/path/to/new-coastal-analysis-delivery
~~~

The output directory must be new; the command preserves an existing delivery. Optional --options /absolute/analyst-selection.json and --notes /absolute/analyst-notes.json apply a saved analyst choice. Passing an existing workbook.json as --input reproduces its selected analysis and interpretation.

The command prints the created paths, file lengths/hashes, coverage and numerical summary. It writes:

| File | Use |
| --- | --- |
| workbook.html | Complete offline browser workbook with original source embedded |
| workbook.json | Portable editable analyst selection and original source |
| analysis.json | Every selected slot, source reference, statistic, gap and episode |
| paired.csv | Complete paired table, including unavailable/excluded and off-grid rows |
| episodes.csv | All upper/lower threshold episodes and original peak references |
| unplaced.csv | Original rows with invalid/unrecognised timestamps |
| source/*.json | Exact original response and metadata bodies |
| manifest.json | Selected source/result identity and generated file inventory |
| README.txt | Standalone receiving instructions |

The printed report includes the currently displayed page of the paired table. The CSV and analysis JSON always include all selected rows. Large charts reduce only their displayed points, preserving each screen bucket’s first/last points and extrema in time order; the calculations and exports use every included original pair.

## Original retained-source interface

The core.mjs module is browser/Node-neutral and performs no network or filesystem action. The bundle.mjs module contains the full Node export integration. The retained.mjs adapter composes that exact bundle with the original source editions and native export store.

~~~js
import {buildAnalysisBundle} from './analysis/bundle.mjs';

const delivery = await buildAnalysisBundle({
  input: analysisInputFromTheOriginalEditions,
  options: selectedAnalystOptions,
  analyst: {name, project, question, interpretation, followUp},
});
~~~

The delivery.files array contains {name, type, bytes: Buffer, sha256}. The original provider can retain those files with its existing export/publication workflow. The prepared.sourceId, workbook.analysisSha256, result.coverage and result.statistics provide the export summary. It creates no workspace, payment, merchant release or source capture.

The input schema is stellar-forge.coops-analysis-input.v1:

~~~ts
type OriginalFile = {
  name?: string;
  sha256: string;        // original UTF-8 response body, lowercase SHA-256
  body: string;          // exact original response text, including whitespace
  receipt?: {
    url?: string;        // original request URL, checked against selected source fields
    [originalField: string]: unknown;
  };
};

type RetainedSeries = {
  editionId: string;     // the original retained source edition identity
  selection: {
    station: string;     // original seven-digit station identifier
    product: 'water_level' | 'predictions';
    datum: string;
    units: 'metric' | 'english';
    time_zone: 'gmt';
    begin_date: string;  // original explicit begin date/time
    end_date: string;    // original inclusive end date/time
    interval?: string | null; // omitted for water_level; "6" for predictions
  };
  pages: OriginalFile[];
  failedResponses?: OriginalFile[]; // exact original failed response bodies and receipts
  metadata?: Array<OriginalFile & {
    role: 'station' | 'datums' | 'details' | 'notices' | string;
  }>;
};

type AnalysisInput = {
  schema: 'stellar-forge.coops-analysis-input.v1';
  observations: RetainedSeries; // response array named data
  predictions: RetainedSeries;  // response array named predictions
};
~~~

The original provider’s capture/edition identity belongs in editionId. Map its saved request selection directly, and supply the exact original raw response text and digest. Do not regenerate a response body from projected rows. JSON-array source indices are zero-based; the accompanying row field is one-based. Every source reference includes its page number, file name, SHA-256 and original array name.

Explicit GMT timestamps accept YYYYMMDD HH:mm, YYYY-MM-DD HH:mm and ISO UTC strings. If an original request used a date-only YYYYMMDD, the observation begin is midnight and the inclusive end is the day’s final six-minute slot. Original request bounds remain in the source binding. The analysis starts at the first six-minute UTC clock slot at or after the overlapping request begin and ends at the last slot at or before its end. The request can begin between clock slots without shifting the observation cadence. Analyst endpoints must fall on those UTC clock slots (:00, :06, and subsequent six-minute marks).

Original metadata files are verified independently. A datums response’s reported epoch is carried into the context only when its reported station identity or original station-specific MDAPI request URL matches the selected station. A known different station is rejected. Conflicting reported epochs reject the join. When only one retained edition reports an epoch, the interface identifies which degree of metadata agreement is available without fabricating a second datum record.

## Calculation

For a uniquely paired finite observation and prediction at the identical timestamp:

~~~text
residual = observed water level − tidal prediction
~~~

The input must have equal station, datum, units and GMT time basis. The workbook makes no time-zone conversion, datum conversion, unit conversion or gap interpolation. Request-URL station/product/datum/units/time-zone/interval fields are reconciled with the retained selection when present.

A missing or ambiguous source value has no included residual. Identical duplicate timestamps are still ambiguous: the analyst can inspect all original occurrences instead of silently accepting one. Every expected six-minute slot is visible; off-grid original timestamps and invalid-timestamp source rows remain separately reviewable.

The rawResidual field retains a finite, unique mathematical pair even when an explicit analyst quality choice excludes it. The residual field is available only for included rows. Statistics and episodes use residual.

Coverage is computed against the number of inclusive expected six-minute slots. Finite-pair coverage is reported separately from inclusion after analyst filters. Counts of missing observation/prediction slots are independent, so a slot missing both contributes to both corresponding counts. The primary status table uses the first applicable exclusion reason; original rows and independent counts retain the full context.

The numerical summary is unweighted across included six-minute pairs. Sample standard deviation uses n−1; a single pair has no sample standard deviation. Quantiles interpolate the sorted order statistics at (n−1)p. RMS residual is the square root of the mean squared residual. These summarize the selected difference series.

Upper episodes include values greater than or equal to the upper threshold; lower episodes include values less than or equal to the lower threshold. Qualifying samples must be consecutive included six-minute slots. A missing value, ambiguous timestamp, quality exclusion or time gap ends the episode. Reported span is the difference between first and last sample timestamps; crossing times and continuous event duration are not inferred. Peaks retain both original source references.

## Quality semantics

The original q, f and s values travel with the workbook and exports.

| Original row | First f entry | Remaining entries |
| --- | --- | --- |
| q = p, preliminary | Count of one-second samples outside the three-sigma band | Flat, rate-of-change and height-limit flags |
| q = v, verified | Inferred-value flag | Flat, rate-of-change and height-limit flags |

A sigma field is the source’s standard deviation of one-second samples used to compute its water-level value. The page never treats it as the uncertainty of the derived residual.

The default includes every finite unique pair regardless of reported quality. Quality choices are explicit:

- **Verified only** or **Preliminary only** requires the matching original q.
- **Exclude inferred** removes inferred verified values and unreported inference status, while retaining preliminary rows whose first field is a sample count.
- **Exclude tolerance flags** removes flat/rate/height flags and unavailable flag detail.
- **Maximum sample sigma** removes values above the chosen bound and rows whose sigma is unavailable.

CSV exports follow ordinary quoted-field rules. Text that a spreadsheet could execute as a formula receives a leading apostrophe; numeric residual values remain numeric. Exact original source text and row values remain available in JSON.

## Saved analysis identity

A portable workbook embeds the original input, normalized analyst options, interpretation, calculator version and a SHA-256 of the recomputed analysis. Its source identity binds the original edition IDs, request selections, response-page hashes and metadata hashes. Reopen rechecks those files and recalculates the entire analysis before accepting the saved result.

Changes to notes remain editable analyst work. A different source selection is a different analysis source. If a later calculator version changes result semantics, the original version is required to reopen the saved calculation.

## Primary contracts

- NOAA CO-OPS [Data API](https://api.tidesandcurrents.noaa.gov/api/prod/): products, source request windows, units, datum, time basis and prediction interval.
- NOAA CO-OPS [response fields](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html): original water-level quality/flags/sigma and tidal-prediction fields.
- NOAA CO-OPS [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/): original station and datum metadata.

Keep engineering interpretation tied to the selected coastal source and project context. The original source workspace continues to own acquisition, edition review, publisher and customer receiving.

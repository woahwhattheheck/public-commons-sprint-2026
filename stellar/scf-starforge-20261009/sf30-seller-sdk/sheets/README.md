# Google Sheets merchant datasets

Publish a reviewed Google Sheets range through the original Stellar Forge
dataset publisher. Choose the workbook, stable tab ID, title, bounded rectangle,
exact header bindings and public scalar columns. Extract and inspect one retained
candidate, review the current target, then publish through the existing dataset
version store. Existing buyer snapshots and cursors retain their native behavior.

The source supports a live read-only Google connection and an exact retained
Spreadsheet resource obtained through an existing connected Google session. Both
paths use the same typed projection, original publisher browser, review history,
schedule, version writer and buyer preparation. Runtime dependencies are Node
22.16+ and, for the publisher, Linux util-linux `flock`. There is no Sheets npm
dependency, API key database, separate publisher state implementation or build.

All commands below start in the repository root. Choose a private working
directory outside the source checkout, with mode 0700 and regular files mode
0600. Paths are examples. Keep original Sheet contents, captures, source
configuration, credentials and publisher state there.

## Select a connected Sheet and retain its actual cells

Use the existing connected Google tools to read workbook/tab metadata and one
bounded range with `spreadsheets.get` CellData. Obtain `spreadsheetId`, tab
`sheetId`, exact title, grid dimensions, `userEnteredValue`, `effectiveValue`,
and `effectiveFormat.numberFormat`; formatted values can also be retained.
For example, the connected `get_spreadsheet_cells` tool accepts a range such as
`'Catalog'!A1:H500` and these cell fields:

```text
userEnteredValue,effectiveValue,formattedValue,effectiveFormat(numberFormat)
```

Save the returned original Spreadsheet resource JSON as a private file. Do not
replace it with an extracted array, a screenshot, a rendered CSV, or invented
cell values. The import uses the exact requested range, including its first row
of literal headers. It preserves the exact JSON bytes in `resource.json` and a
separate hash-bound `capture.json` manifest:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs import \
  --resource /private/sheets/provider-resource.json \
  --range "'Catalog'!A1:H500" --directory /private/sheets/capture-001
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs headers \
  --capture /private/sheets/capture-001/capture.json
```

`headers` reports column letters, exact header strings, observed native value
types, formula/error counts and unsafe numeric integers. It does not print data
row values. The import records local receipt time and the original resource
hash; it does not assert a Google historical revision or certify an arbitrary
operator-supplied JSON file.

Copy [example-projection.json](example-projection.json) into the private working
directory, then edit its explicit public columns. A field absent from this
projection never becomes an offered publisher column, even if the captured
rectangle contains private notes or other material. Optional `range` can narrow
the captured rectangle; its first row must be the reviewed header. Each binding
checks both absolute column letter and exact header text. Changing a column's
position or header requires a newly reviewed source declaration.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs prepare \
  --capture /private/sheets/capture-001/capture.json \
  --projection /private/sheets/reviewed-projection.json \
  --query catalog --out /private/sheets/source.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs describe \
  --source /private/sheets/source.json
```

`prepare` does not publish or start an extraction. New file paths are required;
the command does not overwrite an existing source or capture. A saved publisher
plan copies the exact capture manifest and original resource into its own
private plan directory. A later replacement of the original source/capture
cannot retarget that saved plan.

## Use a live read-only Google source

Copy [example-source.json](example-source.json) to the private working directory.
Replace its placeholder spreadsheet ID, tab ID, tab title, bounded range and
column/header bindings with the actual metadata. `sheetId` is the numeric tab
ID, not its index. The source only supports GRID tabs. The range includes the
header and explicit final row; unbounded ranges and entire-workbook reads are
not accepted. A rectangle may contain at most 1,000,000 cells.

Provide an authorized OAuth access token through the configured environment
variable using the operator's existing credential mechanism. Use the Sheets
read-only scope `https://www.googleapis.com/auth/spreadsheets.readonly` when
obtaining that token. The source stores only the environment variable's name.
It does not obtain, refresh, print or save credentials, change sharing, or use
an API key as a substitute for private workbook authorization.

Each explicit live extraction makes one `GET` to the fixed
`https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}` endpoint with
the exact range and CellData field mask. The client forbids redirects, limits
response bytes and time, and retains the original response before projecting it.
No provider write or implicit retry occurs. For a separately reviewed capture:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/cli.mjs capture \
  --source /private/sheets/live-source.json --query catalog \
  --directory /private/sheets/capture-002
```

Then use `prepare` to create a capture-backed source from those exact bytes, or
start the publisher with the live source directly. A live saved plan retains
its selection and environment reference; each later extraction captures a new
response under that plan's private `captures/` directory. A capture-backed plan
always extracts its own retained observation. Repeating extraction from an old
capture does not refresh Google data.

## Inspect, review and publish in the original browser

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/publisher/cli.mjs serve \
  --workspace /private/sheets/publications --create \
  --source /private/sheets/source.json --state /private/sheets/dataset --port 8452
```

Open the printed loopback URL. The publisher workspace must be new on first
creation. The target can be a new nonexistent dataset state directory, or an
already-running original dataset seller. Keep this operator listener separate
from the seller's public HTTPS resource.

1. In **Review the source and public columns**, choose the named range, inspect
   its declaration, and review public column types and any filters/ranges/sorts.
   Sheets' declared native types supply the initial form values. The original
   native CSV loader validates the final schema and query budget. Save with
   **Save reviewed plan**. Saving retains source bytes and the selected capture.
2. Choose **Extract saved plan**. One exact observation is projected, ordered,
   checked and passed to the original candidate writer. A formula/header/type,
   byte, row or deadline failure cannot produce a partial successful candidate.
3. Use **Preview candidate** for original dataset filtering and paging. Inspect
   the retained source observation, range, receipt time, capture hashes, skipped
   empty rows and formula count. The preview displays effective values, not
   spreadsheet formatting.
4. Enter the reviewer and change note and choose **Record publication review**.
   The review binds this candidate to the displayed target snapshot and revision.
   A new target is reviewed for initialization.
5. Choose **Publish reviewed candidate**. The original writer initializes or
   refreshes the target using that exact review. If another publication changes
   the target, refresh and review its current generation before publishing.

For a typed CLI draft, `sheets/cli.mjs plan --source SOURCE --query catalog
--out NEW_PLAN.json` fills the source's declared types. Review that JSON, then
use the original wrapper's `save`, `extract`, `inspect`, `review` and `publish`
commands. `node sheets/publisher/cli.mjs --help` lists exact options. The generic
publisher `template` command remains available and requires explicit type review.

## Scalar, formula and observation semantics

| Public type or policy | Exact behavior |
| --- | --- |
| `string` | Requires an actual Google `stringValue`. Leading zeros and large text identifiers remain exact. Numeric cells are never silently converted to supposedly exact text. |
| `integer` | Requires a Google numeric value within JavaScript's safe integer range. Large identifiers must be stored as text before capture. |
| `number` | Preserves the finite double in Google's `numberValue`, including formula results. Display formatting and currency rounding are not applied. |
| `boolean` | Requires an actual Google `boolValue`. Strings such as `TRUE` are not coerced. |
| `formula: "reject"` | Default for every public column. A formula cell requires an explicit source change before it can be exposed. |
| `formula: "effective"` | Publishes the actual calculated effective value using the declared scalar type. Formula source text is retained privately and is absent from public CSV. Provider formula errors refuse extraction. |
| `nullable: true` | A blank maps to the original dataset NULL. A real empty string is refused in this same nullable column because native CSV uses an empty nullable cell for NULL. Non-nullable text preserves real empty strings. |
| `emptyRows: "skip"` | Explicitly skips rows whose entire selected public projection is blank. The selected range and skipped count remain in the observation. Default `reject` refuses such rows. |

The range includes hidden and filtered rows. Sheet display filters are not a
public data selection rule. Use an explicitly prepared range or selected source
columns. Date/time-formatted numeric cells are refused: provide an explicit
text date column in the Sheet, or a separately prepared numeric serial column.
Locale and workbook timezone are retained as metadata; the adapter does not
infer a timezone or convert a displayed date into a timestamp.

The observation describes one Spreadsheet API response. It does not claim a
database transaction, a Google revision ID, a cross-request consistent snapshot,
or atomic recalculation across external formula sources. Missing trailing
GridData rows/cells represent blanks in the exact requested rectangle. Sorting
uses declared scalar values, nulls last, with original physical row order as the
final tie-breaker. Separate captures can naturally differ when the Sheet changes.

Google's [CellData](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells)
and [ExtendedValue](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/other#ExtendedValue)
references define effective values, strings, doubles and formula errors. The
[spreadsheets.get reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get)
defines bounded ranges and field masks; the [scope reference](https://developers.google.com/workspace/sheets/api/scopes)
describes authorization at the spreadsheet-file level.

## Original seller, buyer, refresh and reopening

After first publication, configure and start the original dataset seller using
the merchant's actual payment file and advertised HTTPS resource:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs configure \
  --state /private/sheets/dataset --payment /private/sheets/payment.json \
  --origin https://merchant.example --path /data --snapshot-selection \
  --out /private/sheets/seller.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/cli.mjs serve \
  --state /private/sheets/dataset --seller /private/sheets/seller.json --port 8423
```

Stop and reopen the publisher without `--create`, adding the running seller:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sheets/publisher/cli.mjs serve \
  --workspace /private/sheets/publications --port 8452 \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/data
```

Select the published extraction and **Load seller terms**, choose the actual
payment alternative and intent, then **Download original buyer configuration**.
The existing SF88 [dataset acquisition flow](../../sf88-operator-buyer-cli/DATASETS.md)
owns signer setup, approval, spending, execution, recovery and delivery. The
original [dataset version guide](../dataset-refresh/README.md) owns seller
configuration, facilitator/deployment options, retention and collection.

To refresh, capture the new Sheet observation and prepare a new private source
revision at the original source path through the operator's normal reviewed-file
replacement process. Choose **New plan** to load that revision; older plans keep
their own captured bytes. For a live source, explicitly extract its saved plan
again. Review and publish the new candidate. Existing cursor/snapshot selection
continues against the retained original version under native retention rules.

The original [continuous publication controls](../postgres/publisher/SCHEDULES.md)
are also available. A schedule on a live source can capture fresh Google data;
a schedule on a retained capture can only reproduce that observation. Rate,
credential and source failures leave the last published version available and
use the original failure/recovery policy. No independent timer or retry loop is
installed by the Sheets adapter.

On restart, use the same workspace without `--create`. Plans, observations,
reviews, candidates, activity and buyer configurations reopen from original
publisher state. Startup does not fetch a Sheet or republish a candidate.
Interrupted extraction and uncertain publication use the original **Reconcile
retained result** action; never substitute a new Google read for the old capture.
Stop the browser server before using a second CLI against the same locked
workspace. Keep both publisher and target state in the operator's backup process.

Errors distinguish expired authentication, workbook access denial, missing
workbook, quota limits, response size, timeout, changed capture bytes, changed
header, unapproved formula and scalar mapping. Correct the specific source or
credential, then request a new extraction; failed captures are not automatically
retried or promoted. Original capture files remain private even when their public
projection is successfully published.

## Embedding

`openSheetsPublisher(options)` in `publisher/model.mjs` delegates the complete
maintained publisher API to `openSourceDatasetPublisher` with a trusted Sheets
driver. No HTTP input can choose a driver implementation. `inspectSheetsSource`
and `openSheetsSourceFile` in `source.mjs` expose the source description and
`exportDataset(name, {}, {order, maxRows, maxBytes, maxRowBytes, timeoutMs,
signal, onRow})`. Callbacks receive native scalar/null rows and the declared type
metadata. The returned extraction includes the actual range observation and
private capture identity. `close()` aborts in-flight source work. API users should
close the original publisher in a `finally` block to release its workspace lock.

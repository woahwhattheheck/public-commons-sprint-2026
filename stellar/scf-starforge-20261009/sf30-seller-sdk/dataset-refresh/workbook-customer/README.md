# Workbook customer: publication, acquisition, delivery, and Analysis

This application receives the existing dataset publisher's exported review and exact prepared buyer file. It binds the merchant's workbook provenance to one original SF88 Dataset acquisition, retains the original SF100 delivery, and opens copied data through the existing typed file readers. The live Analysis integration attaches that same completed native session and delivery to the original Python workspace.

The merchant's workbook intake remains in [workbook](../workbook/). Its sheet/range/header review, date epoch, saved formula cache, column types, null decisions, CSV projection, and source-row map remain part of the original publisher review. Acquisition uses the selected dataset snapshot, original offer, prepared query, and original buyer/session configuration.

## Source and installed entrypoints

Requirements are those of the original SF30/SF88 product: Node 22.16 or newer. Live Analysis also uses the original Python Analysis workspace. The merchant's workbook parser uses its own bundled standard-library Python reader.

From this directory:

```bash
node cli.mjs --help
```

In an installed merchant package, the same files are under:

```text
source/stellar/scf-starforge-20261009/sf30-seller-sdk/dataset-refresh/workbook-customer/
```

The production distributor includes the entire SF30, SF88, SF100, and native Analysis components and preserves these relative imports. The cumulative source cut must contain this customer directory and the original native Analysis integration from PR 1266. The default runtime is the original SF88 directory beside these components; `--runtime` selects an explicitly supplied original runtime.

The JavaScript entrypoint is [index.mjs](index.mjs). It exports `WorkbookCustomer`, `WorkbookDelivery`, `WorkbookAnalysis`, `Buyer`, `nativeRuntimeDirectory`, and the packet creation/opening functions. Import it by its actual installed file path when using a package that does not expose an additional package subpath.

## 1. Review and publish the workbook in the existing merchant workspace

Use the original workbook UI or CLI to retain the XLSX, select a sheet and source range, review each public column, and prepare its deterministic CSV candidate. Review and publish the candidate through the existing dataset workspace. Its revision/snapshot checks preserve the candidate when the running generation changes.

Save two original outputs for this customer:

- The existing publisher review JSON, with schema `stellar-forge.dataset-publisher-review.v1`.
- The corresponding prepared buyer JSON for the selected, published snapshot and first-page dataset query.

The review's optional `candidate.workbookSource` contains the original workbook/source SHA256 and size, plan identity/revision/hash, parser hash, projection hash, source-row map hash/size, sheet, range, and header row. The customer retains that record and the complete original review bytes. It compares the review snapshot and selected fields to the original prepared buyer configuration.

The merchant can separately export a private workbook source ZIP through the existing `POST /api/workbook/export` route. It carries `original.xlsx`, `data.csv`, `dataset.json`, `workbook-projection.json`, `source-rows.jsonl`, `workbook-parser.py`, `candidate.json`, `review.json`, and its manifest. The customer dataset delivery carries the public reviewed provenance and acquired data; supply that separate raw-workbook ZIP when the intended recipient should receive the merchant's original source.

The maintained native input is the Census [2023 ACS special-value workbook](https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2023_Jam_Values.xlsx), 13,138 bytes, SHA256 `c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807`. The reviewed native case selects worksheet `Jam Values`, range `A20:G36`, header row 20, and the sixteen source rows 21–36. It maps A→`topic:string`, B→`lower_meaning:string`, D→`lower_value:integer`, E→`upper_meaning:string`, and G→`upper_value:integer`. The reference-table projection retains literal lower zeros and the original explanatory text. The original workbook intake owner runs that merchant case and supplies its exact resulting review/preparation/session to this customer arm.

## 2. Import the exact customer packet

Use a new private directory and a stable dataset ID. The ID names the original Node Buyer's dataset entry; the prepared buyer's original intent ID is retained independently.

```bash
node cli.mjs import \
  --packet /absolute/customer/census-2023 \
  --review /absolute/downloads/publisher-review.json \
  --config /absolute/downloads/buyer.json \
  --id census-jam-2023
node cli.mjs review --packet /absolute/customer/census-2023
```

Import validates the original publisher review, recomputes the prepared configuration with original `prepareReview`, and requires byte-for-byte equality with the downloaded buyer file. It also requires a single explicit native snapshot and a valid initial query. The customer writes the exact `publisher-review.json` and `buyer.json`, the source association in `request.json`, and the completion manifest last.

Repeating the same import reopens the packet or completes a retained prefix after interruption. A different source or selection uses another packet. The original merchant review is preserved even when the live seller later publishes a new workbook revision.

## 3. Initialize or attach the original acquisition

New acquisition, using the original private operator profile:

```bash
node cli.mjs initialize \
  --packet /absolute/customer/census-2023 \
  --app /absolute/private/buyer-app \
  --profile /absolute/private/operator-profile.json \
  --max-pages 4 --max-total-atomic 0
```

This example uses the zero-amount limit suitable for a free native offer. For a priced offer, use the reviewed page limit and total atomic spending limit in the original buyer policy. The original buyer validates that policy, signer configuration, ledger reservations, per-page execution, and finalization. Amounts remain decimal strings. Additional native caps are `--max-rows` and `--max-page-bytes`.

To use an already prepared original private operator workspace, pass `--workspace /absolute/original-workspace` in place of `--profile`. The customer verifies that workspace's selected operation and preparation against the packet. A reopened original Node dataset keeps its saved profile and immutable limits.

If the merchant/customer team already has the exact original session, attach it:

```bash
node cli.mjs attach \
  --packet /absolute/customer/census-2023 \
  --app /absolute/private/buyer-app \
  --session /absolute/original-dataset-session
```

Attachment reuses the original session, pages, workspace, limits, and recovery. It connects the packet to the original configuration hash, native session ID, expected snapshot, and original SDK entry. Use this path for the shared Census case.

## 4. Acquire, recover, and retain original financial state

```bash
node cli.mjs status --packet /absolute/customer/census-2023 --app /absolute/private/buyer-app
node cli.mjs run --packet /absolute/customer/census-2023 --app /absolute/private/buyer-app
node cli.mjs recover --packet /absolute/customer/census-2023 --app /absolute/private/buyer-app
```

`run` invokes the original Dataset's acquisition operation. It continues that session's remaining pages under the native limits; completed pages remain in the original session. `recover` invokes the existing native recovery implementation. The CLI returns the original `native` and `process` result, including incomplete or uncertain execution state.

The original `accounting`, `finalize`, `finalize-all`, and `export-accounting` operations are available with the same packet/app. `--options` accepts a file containing the original SDK operation's option object. Financial/accounting output remains separate from dataset completion and is preserved in the unchanged original delivery report.

## 5. Deliver and reopen the original room

After the original acquisition is COMPLETE:

```bash
node cli.mjs deliver \
  --packet /absolute/customer/census-2023 \
  --app /absolute/private/buyer-app \
  --out /absolute/customer/census-native-room
node cli.mjs delivery-list --packet /absolute/customer/census-2023
```

This calls the original SF100 delivery through `Dataset.deliver`. The customer retains its original report, including `nativeStatus`, `paymentStatus`, source binding, outputs, and hashes. Reopening a previously retained delivery uses that first complete report and the existing files.

The original room contains `dataset.jsonl`, `dataset.csv`, `review.html`, and `manifest.json`, alongside the native room's other original retained contents. The customer validates the selected snapshot and projected fields against its exact request.

## 6. Copy a portable receiving packet and use it offline

```bash
node cli.mjs copy \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room \
  --out /absolute/exports/census-receiver
node cli.mjs open --delivery /absolute/exports/census-receiver
node cli.mjs rows --delivery /absolute/exports/census-receiver
```

Copy streams the four completed SF100 output files with the original verified file implementation. It also retains the exact original review/config/request/packet manifest, acquisition association, and unchanged original native delivery record. The copy's completion manifest lists a fixed inventory and is published last. An interrupted copy retains completed files; rerunning the command verifies and reuses that prefix. `--max-output-bytes` supplies an optional whole-packet capacity limit.

`open` checks all file sizes/hashes and the source/native association entirely on local disk. `rows` streams original typed JSONL values. `copy-delivery` can create another copy from the portable directory.

The native report retains its original source and destination paths. A separate explicit `pathMapping` resolves the four files in the receiving directory for the original `DatasetDelivery` reader. The original report's configuration, source binding, snapshot, financial states, and content identities remain unchanged. A portable receiving packet consists of the public acquired outputs and their association; the original live acquisition and its operator workspace stay with the customer app.

JavaScript receiving:

```js
import { WorkbookDelivery } from './index.mjs';

const received = await WorkbookDelivery.open('/absolute/exports/census-receiver');
console.log(received.request.workbookSource);
console.log(received.native.nativeStatus, received.native.paymentStatus);

for await (const row of received.rows()) {
  // Original JSON scalar types and selected field names.
  consume(row);
}
await received.file('dataset.csv').saveAs('/absolute/exports/census.csv');
```

## 7. Attach the same native dataset to live Analysis

Start or reuse the original Python Analysis workspace according to its maintained operator guide. Register its actual live database directory:

```bash
node cli.mjs analysis-register \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room \
  --alias census_analysis \
  --database /absolute/analysis
node cli.mjs analysis-receive \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room \
  --alias census_analysis --source census_2023 --view census_2023
```

The bridge is the existing native `createNativeAnalysis` transport. It verifies the original running workspace identity and uses its existing loopback capability and Origin checks. The workbook customer supplies the actual native session, existing finalized SF100 room, session ID, configuration SHA256, and source-binding SHA256 from its retained acquisition/delivery.

The native `/api/native-dataset-source` adapter verifies the same COMPLETE session and existing delivery before registering the source. The original Analysis job imports that retained dataset, and optional view activation selects the original imported version under revision CAS. An already-running Analysis service keeps its original exclusive database lock.

An intake stores its exact source/import/selection intent before submitting work. The import uses a stable 32-character lowercase hexadecimal ID. Omitting `--import-id` derives that ID from the complete retained intent; repeating the same command reuses it. Source and completed activation receipts are retained, while moving job status remains in the original Analysis workspace. Resume reads the retained import job before considering a new start, so an older completed import still reopens after its source alias advances. If a native view selection committed before its final reply was saved, the customer reconciles the exact version and expected revision against the original selected-view state and retains an explicitly labeled observed-state recovery receipt. The native revision check remains unchanged.

Use `--columns-file` for the original field-to-SQL-column JSON object text. The browser and CLI keep that text and SQL `parameters_text` intact, including exact 64-bit integer tokens. Initial aliases use revision zero. Updating an existing source/view requires the reviewed current revision via `--source-revision` or `--view-revision`.

```bash
node cli.mjs analysis-history \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room --alias census_analysis
node cli.mjs analysis-resume \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room --alias census_analysis \
  --import-id ORIGINAL_32_HEX_ID
```

`--no-wait` returns the original active job. Interrupting the client wait leaves the original service in charge of its job; `analysis-resume` reopens the same import and completes its retained selection intent.

## 8. Query, export, cancel, and reopen in the original Analysis product

The original browser continues from the imported edition: save a query, inspect its bounded result, review the complete selected views, start a full query export, follow progress/cancel, and download JSONL/CSV/SQLite. Retained history reopens the same completed export.

The customer CLI also forwards every original Analysis operation:

```bash
node cli.mjs analysis-call \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room --alias census_analysis \
  --operation state
node cli.mjs analysis-call \
  --packet /absolute/customer/census-2023 \
  --room /absolute/customer/census-native-room --alias census_analysis \
  --operation query --request /absolute/reviewed-query.json --wait
```

A query request contains `id`, exact `sql`, `parameters_text`, `max_rows`, and the entire original reviewed `state.views` as `expected_views`. A full export uses `query-export` with a new stable ID, the reviewed completed query ID and `result_sha256`, and selected formats. Original `cancel-query-export`, `query-exports`, `job`, and `query-export-file` retain their native contracts.

For complete resumable file transfer, use the existing Python [query export receiver](../../../sf88-operator-buyer-cli/python/QUERY_EXPORT_DELIVERY.md). It streams the completed original exports, resumes with the server's immutable ETag/range support, and opens the result offline. The original full-query engine keeps SQL LIMIT, exact parameters, same-transaction selected views, typed values, cancellation, and final manifest semantics.

## Application composition

[examples/receive-workbook.mjs](examples/receive-workbook.mjs) is a callable customer flow around one original Buyer. Supply either the same original session or explicit new-acquisition limits. It completes acquisition, original delivery, portable receiving, and optional live Analysis import. It returns all original result objects to the host application.

The primary API methods are:

| Object | Operations |
| --- | --- |
| `WorkbookCustomer` | `create`, `open`, `review`, `initialize`, `attach`, `inspect`, `run`, `recover`, `accounting`, `finalize`, `finalizeAll`, `exportAccounting`, `deliver`, `openDelivery`, `deliveries`, `analysisSource` |
| `WorkbookDelivery` | `open`, `file`, `rows`, `readRows`, `copyTo`; unchanged `native`, `request`, `publisherReview`, `datasetManifest`, and explicit `pathMapping` |
| `WorkbookAnalysis` | `register`, `receive`, `resume`, `history`, `waitJob`, `call`, `close` |

Source revisions use new immutable workbook sources/plans, original publisher revision review, and a new customer packet for a changed prepared selection. The original completed packet and its receiving deliveries remain independently reopenable. The original Analysis source/view histories can compare and select those complete acquired editions.

# SF100: buyer dataset delivery for original SF30 + SF88

Node 22+, MIT. Assemble independently approved original SF30 dataset pages into a private delivery package with typed JSONL, spreadsheet-safe CSV, a source manifest and an offline operator review. The existing SF30 seller and SF88 buyer remain the source of each request, payment decision and saved response.

## From the durable buyer inbox

The existing [SF88 dataset-delivery guide](../sf88-operator-buyer-cli/DATASET_DELIVERY.md) connects explicitly selected saved inbox outcomes to this module. That adapter checks each actual saved response against its original buyer summary and then uses the same SF100 archive API described below.

SF100 operates on local files. It does not submit buyer requests, approve spending, sign transactions or download the next page. Each page has its own stable buyer intent and original approval.

## Original-source operator flow

Use original SF30's `dataset-cli.mjs`, `dataset-handler.mjs` and `serve.mjs`, with the existing SF88 review/execute flow and configured response-file destination. Save the actual JSON `stellar-forge.dataset-page.v1` response from each independently approved operation.

From the repository root, with the private parent directory already created:

```sh
S=stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery

node "$S/deliver.mjs" init --out /private/deliveries/pilot-001
node "$S/deliver.mjs" append --out /private/deliveries/pilot-001 \
  --page /private/sf88/page-001.json --intent original-approved-page-001 \
  --evidence /private/sf88/evidence-001.json

# Use the reported nextCursor in a separately reviewed SF88 request.
node "$S/deliver.mjs" append --out /private/deliveries/pilot-001 \
  --page /private/sf88/page-002.json --intent original-approved-page-002 \
  --cursor 'PREVIOUS_SOURCE_NEXT_CURSOR' \
  --evidence /private/sf88/evidence-002.json

node "$S/deliver.mjs" status --out /private/deliveries/pilot-001
node "$S/deliver.mjs" finalize --out /private/deliveries/pilot-001
```

Finalize after the original response reports `nextCursor: null` and all expected rows are present. A SHA-256 of the optional original evidence file is retained with its page. The original buyer outcome and settlement evidence supply the payment status.

## Importable API and batch delivery

Importing the module does not parse command-line arguments or write stdout. The CLI continues to accept `init|append|status|finalize`.

```js
import { init, appendMany, scan, finalize } from './deliver.mjs';

await init('/private/deliveries/pilot-001');
await appendMany('/private/deliveries/pilot-001', [
  {
    page: '/private/sf88/page-001.json',
    intent: 'original-approved-page-001',
    evidence: '/private/sf88/evidence-001.json',
  },
  {
    page: '/private/sf88/page-002.json',
    intent: 'original-approved-page-002',
    cursor: previousSourceNextCursor,
    evidence: '/private/sf88/evidence-002.json',
  },
]);
const delivery = await scan('/private/deliveries/pilot-001', { retainPayload: false });
if (delivery.nextCursor === null && delivery.count === delivery.total) {
  await finalize('/private/deliveries/pilot-001');
}
```

`appendMany(out, inputs)` accepts an ordered array of the same `{page, intent, cursor?, evidence?}` arguments as `append(out, args)`. Inputs are existing local response files from approved operations. It scans accepted history once at the start, validates and archives each next page while advancing the same state, then scans once at completion. Each scan retains page metadata and processes one response payload at a time. Parsing work grows with the archived data instead of rescanning all earlier pages for every addition. `append` delegates to this path with one input and retains its `PAGE_ACCEPTED` result; a batch returns `PAGES_ACCEPTED`.

Each next page is fully checked before its numbered file is created. An invalid later input leaves a valid accepted prefix and does not occupy the rejected page's archive number. Use `scan` or CLI `status` to continue from that prefix. A completed or finalized session rejects additional pages. Create-only archive filenames reject a competing writer at the same position; callers should assign one writer per delivery session.

The existing `init`, `append`, `scan`, `finalize`, `checkPage` and `checkCursor` exports remain available. `scan(out)` retains full parsed page records for compatibility; use `scan(out, {retainPayload: false})` for metadata and row counts without retaining dataset rows. CLI `status` uses this mode. `checkPage` also returns the normalized native query, typed ranges, selected order and query hash.

Finalization scans metadata, then re-reads and hashes each archived page against its recorded chain before writing CSV/JSONL. It holds one page payload at a time. Its failure cleanup removes only output files it created that still have their original filesystem identity; a competing finalizer that encounters an existing file cannot remove the successful writer's output.

## Exact original dataset query contract

The reader uses the current original [SF30 dataset handler](../sf30-seller-sdk/dataset-handler.mjs). It checks source schema, snapshot, declared column capabilities, ordered projection, typed equality and range filters, total rows, page size, cursor continuity and row types. It retains every source row in original response order.

| Query element | Preserved native behavior |
| --- | --- |
| Equality filters | Up to eight enabled columns; typed values, including null for a nullable column. |
| Range filters | Enabled string, integer or number columns; `gt`, `gte`, `lt`, `lte`; at most one lower and one upper bound per column. Null bounds and boolean range columns are rejected. |
| Sort | One enabled column, `asc` or `desc`, with `nulls: 'last'` and equal-value `ties: 'csv-record-order'`. |
| Coercion | Response values must already have the original loader's types. Safe integers, finite numbers, booleans and nullable values remain typed. An empty nullable source cell is null. |
| Projection | Requested field order is retained in each row and CSV header. A filtered or sorted column may be outside the projection. |
| Pagination | The exact preceding `nextCursor` is required; returned rows equal the original page boundary, and the final cumulative count equals the source total. |

For example, an original seller query can select `gte_amount=10&lte_amount=100&sort=-amount` when those capabilities are enabled. The response carries typed `ranges: [{column, operator, value}]` and an `order` object. SF100 binds both into the delivery query signature, cursor validation, manifest and review. It preserves the seller's order while joining pages.

The original base64url cursor carries `{v:1,s,q,n}`: snapshot, native query SHA-256 and cumulative offset. Its query input remains exactly:

```js
// No selected range or sort: original legacy hash remains byte-compatible.
{ fields, filters: sortedColumnValuePairs }

// Selected ranges and/or sort: native column/operator order is preserved.
{
  fields,
  filters: sortedColumnValuePairs,
  ranges: sortedColumnOperatorValueTriples,
  sort: { column, direction, nulls: 'last', ties: 'csv-record-order' } // or null
}
```

Range triples use column-name order, then `gt, gte, lt, lte`. A sort-only query includes `ranges: []`; a range-only query includes `sort: null`. Without either selection, those keys are omitted and the previous SF100 page signature is retained. Page limit is outside the native query hash, allowing a subsequent independently approved request to choose another valid limit.

Snapshot/query drift, conflicting bounds, disabled capabilities, duplicated intent or source payload, malformed cursor, missing rows, early completion and continuation beyond the total are rejected before an archive write. Legitimate identical row values are retained. Cursor or source-schema changes require explicit integration with the original seller contract.

## Private outputs and limits

The session is a create-only 0700 directory with 0600 generated files:

- `pages/00000.json`, etc.: each original parsed response, request cursor, buyer intent, raw source SHA-256, optional evidence SHA-256 and archive digest chain.
- `dataset.jsonl`: typed projected rows in original response order.
- `dataset.csv`: the same field order, with leading spreadsheet formula syntax neutralized for string cells.
- `manifest.json`: source snapshot, typed filters/ranges, selected sort, original query hash/signature, page custody, row counts and export hashes.
- `review.html`: offline industrial summary of the dataset, query and delivery outputs. Merchant rows are kept in the data files.

Limits are 4,096 pages, 1,000,000 source rows, 2 MiB per original response, 256 MiB across archived records, and 256 MiB of combined CSV/JSONL output. Accumulated archive size and prospective CSV/JSONL size are checked before each page write. Finalization also enforces the export bound.

Keep customer response files and generated packages private. The manifest establishes local source custody; original buyer evidence supplies payment and settlement outcomes, and merchant acceptance supplies the commercial delivery result. No hosted CI or GitHub Actions workflow is required.

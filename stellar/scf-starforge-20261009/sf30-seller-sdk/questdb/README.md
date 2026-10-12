# QuestDB native reports and retained datasets

The native QuestDB source connects reviewed named reports to the original
Starforge publisher. It discovers tables, executes typed SELECT reports, retains
complete source editions, and exports approved CSV datasets into the existing
publication, version, seller, scheduler and buyer workflow.

Use Node 22.5 or newer. The HTTP source needs no external database driver. Use
the maintained Starforge runtime for the complete merchant application.

## Connection and discovery

Declarations contain environment-variable names, never resolved credentials:

```json
{
  "schema": "stellar-forge.questdb-source.v1",
  "endpointEnv": "QUESTDB_HTTP_URL",
  "maxInFlight": 4,
  "startupTimeoutMs": 10000,
  "queries": {}
}
```

Set `QUESTDB_HTTP_URL` to the HTTPS database base URL. Include a trailing slash
when a reverse proxy mounts it below a path. Basic authentication additionally
uses `userEnv` and `passwordEnv`; bearer authentication uses `tokenEnv`. Choose
one method. `allowLocal: true` permits an explicitly selected loopback HTTP
server. Credentials stay in the server environment.

A queryless source supports catalogue discovery. Private capture directories
use mode 0700; retained files use mode 0600.

```js
import { openQuestDbSourceFile } from './questdb/config.mjs';

const opened = await openQuestDbSourceFile('/absolute/source.json', {
  env: process.env,
  captureDirectory: '/absolute/private-captures'
});
try {
  const catalogue = await opened.source.discover({ tables: ['trades'] });
  console.log(JSON.stringify(catalogue, null, 2));
} finally {
  await opened.source.close();
}
```

Opening reads the actual server `build()` and plans every saved report using
`LIMIT 0`. Native column names and types are pinned for that open source.
Later schema changes require a reviewed reopen.

Discovery retains the original `tables()` metadata, `table_columns()` rows,
designated timestamp, partitioning, WAL fields, observed build and request
references. It checks catalogue counts and refuses incomplete lists. Select up
to 128 tables for detailed discovery.

## Fixed reports

`compileQuestDbReport(report)` returns SQL, typed parameters, ordered columns,
limits, probe inputs and the original structured report. Save that declaration
in `source.queries`:

```js
import { writeFile } from 'node:fs/promises';
import { compileQuestDbReport } from './questdb/report.mjs';

const report = {
  kind: 'window',
  table: 'trades',
  timestamp: 'timestamp',
  timestampType: 'timestamp',
  window: { start: 'from', end: 'to' },
  parameters: {
    symbol: { type: 'symbol', enum: ['BTC-USDT', 'ETH-USDT', 'XLM-USDT'] }
  },
  columns: [
    { name: 'event_time', column: 'timestamp' },
    { name: 'symbol', column: 'symbol' },
    { name: 'side', column: 'side' },
    { name: 'price', column: 'price' },
    { name: 'amount', column: 'amount' }
  ],
  filters: [{ column: 'symbol', op: 'eq', parameter: 'symbol' }],
  maxRows: 100,
  maxBytes: 1048576,
  timeoutMs: 30000,
  probe: {
    from: '2026-10-12T07:30:00.000000Z',
    to: '2026-10-12T07:31:00.000000Z',
    symbol: 'BTC-USDT'
  }
};

await writeFile('/absolute/source.json', JSON.stringify({
  schema: 'stellar-forge.questdb-source.v1',
  endpointEnv: 'QUESTDB_HTTP_URL',
  queries: { executions: compileQuestDbReport(report) }
}, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
```

This example uses the documented demonstration trade schema. Discover the
selected server first; the example dates are reviewed inputs, not a promise
that a particular server retains that period.

The start is inclusive and the end exclusive. Both are valid UTC values with
the declared precision, and the end must be later. Identifiers are quoted
separately from typed values.

A named raw SELECT declaration is also supported:

```js
{
  sql: 'SELECT timestamp AS event_time, symbol, price FROM trades ' +
       'WHERE timestamp >= $from AND timestamp < $to AND symbol = $symbol',
  parameters: {
    from: { type: 'timestamp' },
    to: { type: 'timestamp' },
    symbol: { type: 'symbol' }
  },
  parameterOrder: ['from', 'to', 'symbol'],
  columns: ['event_time', 'symbol', 'price'],
  maxRows: 100,
  maxBytes: 1048576,
  timeoutMs: 30000,
  probe: {
    from: '2026-10-12T07:30:00.000000Z',
    to: '2026-10-12T07:31:00.000000Z',
    symbol: 'BTC-USDT'
  }
}
```

`columns` is an ordered array. Every parameter needs a probe value or default
for native planning. A template is a single SELECT or WITH expression.
Database account grants remain the authorization boundary.

When `report` metadata is retained, its generated SQL, columns, parameters,
limits and probe must agree with the declaration. Recompile after editing the
report so a reopened form continues to describe its actual saved SQL.

### Native sampling

Use `kind: 'sample'` and this sample configuration:

```js
{
  timestampAlias: 'bucket',
  sample: {
    interval: '1m',
    keys: ['symbol'],
    aggregates: [
      { name: 'executions', fn: 'count' },
      { name: 'volume', fn: 'sum', column: 'amount' },
      { name: 'first_price', fn: 'first', column: 'price' },
      { name: 'last_price', fn: 'last', column: 'price' }
    ],
    fill: 'none',
    alignment: 'calendar'
  }
}
```

The generated columns are timestamp alias, keys, then aggregate names.
Aggregates are count, sum, avg, min, max, first and last. Fill is none, null or
prev; alignment is calendar or first-observation. These are native SAMPLE BY
operations. The source does not add a separate synthetic time grid.

### Keyed preceding matches

Use `kind: 'asof'` with explicit left/right projected columns:

```js
{
  asof: {
    table: 'trades',
    timestamp: 'timestamp',
    timestampType: 'timestamp',
    keys: [{ left: 'symbol', right: 'symbol' }],
    tolerance: '1s',
    filters: [{ column: 'side', op: 'eq', parameter: 'rightSide' }]
  },
  columns: [
    { name: 'event_time', column: 'timestamp', side: 'left' },
    { name: 'symbol', column: 'symbol', side: 'left' },
    { name: 'price', column: 'price', side: 'left' },
    { name: 'previous_time', column: 'timestamp', side: 'right' },
    { name: 'previous_price', column: 'price', side: 'right' }
  ]
}
```

Declare `rightSide` and its probe. Top-level filters select the left series;
`asof.filters` selects the right series. A filter contains a column, one of
eq/ne/lt/lte/gt/gte, and a declared parameter.

The left window and filters apply before its timestamp sort. The right series
retains earlier history and is bounded by the exclusive end. Both explicitly
sort native timestamps; the source does not mark unsorted rows as ordered.
At least one join key is required.

Tolerance is a native duration such as 50T, 1s, 5m or 1h. Unmatched rows retain
native NULLs. A buy-to-preceding-sell report over executions describes executed
trades; use an actual quote table for bid/ask analysis.

## Exact values

| Parameter type | Accepted meaning |
| --- | --- |
| string / symbol | UTF-8 text, optional lengths and enum |
| boolean | Boolean or exact query strings `true` / `false` |
| integer | Integral value within the safe JavaScript integer range |
| long | Exact integer text or a safe numeric input; native range excludes its NULL sentinel |
| number | Finite DOUBLE input; reviewed decimal text is used in the SQL cast |
| decimal | String only, precision 1–76 and scale, exact decimal checks |
| timestamp | UTC ISO text, up to six fractional digits |
| timestamp_ns | UTC ISO text, up to nine fractional digits |

Native results retain SQL NULL as JSON `null` and BOOLEAN as a Boolean.
LONG, DECIMAL and other numbers retain the original response text. Unquoted
numeric tokens are read using JSON source context before JavaScript double
conversion. Timestamps retain their microsecond or nanosecond text. Strings
retain empty text. Arrays retain JSON text with original numeric lexemes.

BINARY, RECORD and LONG128 are refused because this HTTP projection cannot
preserve their required representation; review an explicit text projection.
Counts and timestamp-index metadata are interpreted separately from source
values. Large reported counts remain decimal strings.

## Preview and full capture

A preview uses one native request with a row sentinel and total count. It
returns `rows`, `columnTypes`, `reportedCount` and `truncated`. Defaults are
100 rows / 1 MiB; hard bounds are 100,000 rows / 32 MiB.

```js
const input = {
  from: '2026-10-12T07:30:00.000000Z',
  to: '2026-10-12T07:32:00.000000Z',
  symbol: 'BTC-USDT'
};
const preview = await opened.source.query('executions', input);

const capture = await opened.source.capture('executions', input, {
  directory: '/absolute/private-captures/edition-001',
  maxRows: 1000000,
  maxBytes: 67108864,
  maxRowBytes: 1048576,
  timeoutMs: 120000,
  includeNativeCsv: true
});
```

The full canonical edition is one native JSON response with
`quoteLargeNum=true` and `count=true`. HTTP completion, UTF-8, schema, rows,
byte limits and original numeric tokens are checked. The parsed row count must
equal the native count. A server result cap produces a failed capture.

Files stream into exclusive private partial files and are synced before rename.
The completed manifest appears only after the canonical files finish.

```js
{
  manifest: { /* original binding, native counts, types and hashes */ },
  directory: '/absolute/private-captures/edition-001',
  files: {
    json: { path: 'response.json', bytes: 123, sha256: '...' },
    ndjson: { path: 'rows.ndjson', bytes: 123, sha256: '...' },
    csv: { path: 'data.csv', bytes: 123, sha256: '...' },
    manifest: { path: 'capture.json', bytes: 123, sha256: '...' },
    nativeCsv: { path: 'native.csv', bytes: 123, sha256: '...' }
  }
}
```

The numbers above illustrate the shape. Actual entries contain measured bytes
and SHA-256; paths are relative to the returned private directory.

| File | Purpose |
| --- | --- |
| request.json | Fixed query, inputs, source hash, options and connection references |
| status.json | Retained RUNNING, COMPLETE, FAILED or CANCELLED state |
| response.json | Exact complete native JSON body |
| rows.ndjson | Typed rows with exact source numeric and timestamp text |
| data.csv | Canonical CSV derived from the same JSON response |
| native.csv | Optional separate native `/exp` response |
| capture.json | Native counts, per-column NULL/value counts, hashes and lineage |

Canonical CSV quotes every non-NULL text value, including empty text; NULL is
unquoted empty. Records use CRLF. NDJSON is the unambiguous source for consumers
whose CSV readers collapse NULL and empty text.

Optional `/exp` is a second database observation. Its exact bytes, quote-aware
NULL/empty interpretation and ordered-value/count comparisons are retained.
It has no count footer. The capture does not assume that two requests share
one snapshot; canonical completeness comes from the JSON response.

`maxBytes` bounds each data representation independently. Budget up to three
times it for JSON, NDJSON and canonical CSV, or four times with native CSV,
plus manifests and any original publisher export. Named-field NDJSON expansion
and each retained row are explicitly bounded. Full defaults are 1,000,000 rows,
64 MiB per file, 1 MiB per row and at least 120 seconds.

## Reopen and operational recovery

A completed capture can reopen without connecting to the source:

```js
import { readQuestDbCapture } from './questdb/source.mjs';
const retained = await readQuestDbCapture(
  '/absolute/private-captures/edition-001'
);
```

This checks retained sizes and hashes. Calling `source.capture` with the same
completed directory additionally checks the exact source/query/input/
connection/extraction binding.

A started incomplete directory remains intact. Use a new directory for a new
native attempt. Do not concatenate result pages from separate executions.
Retained partial responses remain diagnostic material.

Pass an AbortSignal to discovery, query, capture or extraction. Source close
aborts owned requests and waits for their callers. Concurrent work obeys the
configured capacity. Timeout, cancellation, schema change, row/byte caps,
authorization and rate limits have separate codes; native Retry-After is
retained. The source never automatically issues a second query after an
uncertain response.

For a backup, close the workspace and copy the whole private source, captures
and publisher directories, preserving modes and original files. Reopen uses
their original identifiers and hashes. Workbench capture downloads and
comparisons consume retained files.

## Original publisher

```js
import { openQuestDbPublisher } from './questdb/publisher/model.mjs';
const publisher = await openQuestDbPublisher({
  directory: '/absolute/private-publisher',
  create: true,
  sourceFile: '/absolute/source.json',
  targetDirectory: '/absolute/private-dataset-versions',
  environment: process.env
});
```

On reopen, omit `create` and use the same directory and environment. Creation
binds the original source file and separate versioned dataset target.

This is a trusted source adapter for `openSourceDatasetPublisher`. Review,
publication, version history, buyer preparation and recurrence use the original
state machine and schedule.

The plan contract is:

```js
{
  title: 'Reviewed executions',
  sourceHash: 'hash returned by publisher.source()',
  query: 'executions',
  input: {
    from: '2026-10-12T07:30:00.000000Z',
    to: '2026-10-12T07:32:00.000000Z',
    symbol: 'BTC-USDT'
  },
  dataset: {
    name: 'trade_executions',
    columns: {
      event_time: { type: 'string', nullable: false },
      symbol: { type: 'string', nullable: false },
      price: { type: 'string', nullable: false },
      amount: { type: 'string', nullable: false }
    },
    filters: ['symbol'],
    sorts: ['event_time'],
    maxCellChars: 65536,
    defaultLimit: 50,
    maxLimit: 250,
    maxPageBytes: 921600
  },
  extraction: {
    maxRows: 1000000,
    maxBytes: 67108864,
    maxRowBytes: 1048576,
    timeoutMs: 120000,
    includeNativeCsv: false
  }
}
```

The publisher completes a native capture first, then streams those exact
NDJSON rows into its exclusive CSV candidate writer and validates the dataset.
Its extraction result binds that capture. Publication and buyers do not
execute the source again.

Use dataset string columns for exact LONG, DECIMAL and timestamp text. A
numeric dataset column is accepted only if conversion preserves the original
decimal value and integral values remain safe. Native query filters and
aggregations can operate numerically before the textual edition is retained.

QuestDB dataset plans select the original loader's explicit
`nullEncoding: 'unquoted-empty'` option. Unquoted empty is NULL; quoted empty
remains the empty string. The canonical row encoder and retained dataset
configuration preserve that distinction through publication, reopen and the
buyer response. Existing CSV sources keep their prior default interpretation.

A recurring policy invokes the original next complete extraction. Each edition
retains source/query/input/capture identity, with the existing schema and
row-count review. It does not silently advance a saved fixed time window.

## Primary sources

- [Native REST interface](https://questdb.com/docs/connect/compatibility/rest-api/)
- [SAMPLE BY](https://questdb.com/docs/query/sql/sample-by/)
- [ASOF JOIN](https://questdb.com/docs/query/sql/asof-join/)
- [Metadata functions](https://questdb.com/docs/query/functions/meta/)
- [Demo dataset descriptions](https://questdb.com/docs/demo/)
- [10.0.1 native JSON serializer](https://github.com/questdb/questdb/blob/10.0.1/core/src/main/java/io/questdb/cutlass/http/processors/JsonQueryProcessorState.java)
- [10.0.1 native CSV serializer](https://github.com/questdb/questdb/blob/10.0.1/core/src/main/java/io/questdb/cutlass/http/processors/ExportQueryProcessor.java)

Manifests retain the actual selected server build. The demo's real OKX
executions are distinct from its generated FX tables; preserve that provenance
when preparing a merchant example.

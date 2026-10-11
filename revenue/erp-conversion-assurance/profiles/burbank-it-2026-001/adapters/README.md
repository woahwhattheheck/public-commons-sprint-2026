# Burbank native source adapters

These modules join the maintained ERP conversion operator. They acquire original
source records and prepare native GL columns; the existing conversion engine
continues to compare source and target populations and retain reviewer decisions.

## Runtime and source closure

Use Node 22 or newer with `JSON.parse` source-context support. Python 3 is required
only for WADL inspection. No npm packages or browser installation are required.
Optional RFP page extraction uses the Linux `pdftotext` executable. The operator can
start and the workbook catalogs can materialize without a PDF extractor.

The distributable closure is `common.mjs`, `arcgis.mjs`, `oracle-ebs.mjs`, `wadl.py`,
`oracle-gl.mjs`, `oracle-gl-contract.json`, `materialize-reference.mjs`,
`source-acquisition.json`, `cli.mjs`, and this README. Downloaded source documents,
worksheet bodies, tenant WADLs, captured records, logs and credentials are separate
private runtime inputs. The acquisition manifest contains public source locations
and document identities.

## Original requirement and planning catalogs

```sh
node materialize-reference.mjs --reference /absolute/private/reference
```

This uses the observed public worksheet-preview route in `source-acquisition.json`
and produces the seven reference JSON files plus `SOURCE_PINS.json`. Every source
page is retained with its URL, response hash, worksheet and native row number.
Worksheet values, response cells, source zeroes and continuation rows remain
unchanged. The four attachment identities come from the actual public document
index. The tool does not infer an original XLSX download endpoint.

To reuse retained pages without another network request:

```sh
node materialize-reference.mjs --reference /absolute/private/reference \
  --cache /absolute/retained/native-previews --offline
```

`--rfp /absolute/original.pdf` adds the selected RFP engineering pages using
`pdftotext`. Without it, `engineering-pages.json` is an empty optional source.
`--inspect-only` constructs the full catalog in memory without writing a duplicate.
An existing pin manifest makes the default operation verify its seven existing
files. `--overwrite` explicitly replaces a materialized reference revision and
writes new pins; create a new reference directory when retaining prior projects.
Source pins describe exact materialized bytes, so a different extraction format
can produce new pins while all original worksheet cells remain the same.

The reviewed source population is 977 numbered requirements, six continuation
rows, 23 interfaces, four staffing sheets and five price sheets. Native acceptance
codes are Y/Y-WC/N/I and phases 1/2/X. The RFP narrative's Y-ND spelling remains a
visible source discrepancy. Original XLSX files can be uploaded into the operator
for its separate respondent-cell overlay; public previews do not contain the
original workbook ZIP members, formulas or formatting.

## Native City ArcGIS extraction

`captureArcGis()` in `arcgis.mjs` accepts an exact numeric MapServer/FeatureServer
layer URL, explicit filter/fields and a capture directory. The supplied default is
the City's published **Pavement Condition 2025** layer:

<https://mobilegis.burbankca.gov/burgis/rest/services/Planning/Core_Transportation/MapServer/4>

```js
import { captureArcGis } from './arcgis.mjs';
const capture = await captureArcGis({
  directory: '/absolute/private/pavement-capture',
  where: '1=1', fields: '*', pageSize: 200,
  onProgress: event => console.log(event)
});
```

The adapter reads the native field/OID schema, captures the full matching ID census,
requests bounded ID batches, verifies each returned identity set, and captures a
final ID census. Transfer-limit responses split the original batch without losing
accepted pages. Cancellation, network errors and interrupted disk writes retain
checkpoints. Calling the same selection again resumes accepted pages. A projection
failure can resume from the already retained final census without repeating source
network requests.

Outputs are `capture.json`, native JSON response bodies and receipts,
`records.csv`, and `records.jsonl.gz`. Geometry remains in the native responses;
the CSV uses selected scalar attributes. Raw responses larger than 64 KiB are
gzip-compressed with their original decompressed SHA retained. Original JSON number
tokens, including 64-bit IDs, become exact strings in projections. JSONL retains
nulls, original source identity and page hashes; CSV represents null with an empty
field. A start/end matching ID census does not establish a transaction snapshot;
the manifest records that source-window limitation and each capture time.

`projectCaptureCsv({directory,columns})` creates another explicit projection from a
verified completed capture. `reopenCapture(directory)` verifies retained bodies and
projection hashes. A live writer owns `.capture-lock.json`; `recoverCaptureLock()`
recovers it only after that process has exited on the same host.

The implemented source journey captured and reopened the actual 2,742 City pavement
features across 14 pages, retaining 84 scalar columns and native geometry. The
source and target comparison remains an operation of the shared ERP operator.

## Oracle EBS 12.2 connection

`inspectEbsWadl({wadlFile})` returns actual resource names, endpoints, methods,
query parameters, declared response media types and schema-include locations from
the selected tenant WADL. It uses the standard XML parser, reports external schema
references and performs no implicit include downloads. `downloadEbsWadl()` can fetch
an explicitly supplied HTTPS WADL URL under the configured origin and account.

The native endpoint is deployment-specific. The City's ERP identification does not
establish a deployed GL REST alias. Select the resource returned by the actual
WADL. The documented open-interface example is `RA_INTERFACE_LINES_ALL/`; views can
be GET-only while tables can advertise additional methods. This adapter invokes GET.

```js
import { inspectEbsWadl, captureEbsInterface } from './oracle-ebs.mjs';
const available = await inspectEbsWadl({wadlFile: '/private/tenant.wadl'});
// Select one available.resources entry and its original column/record contract.
const capture = await captureEbsInterface({
  directory: '/private/extraction-001', wadlFile: '/private/tenant.wadl',
  approvedOrigin: configuredOrigin,
  resourcePath: selectedResource.path,
  recordKey: selectedNativeRecordElement,
  select: selectedNativeColumns, keyFields: selectedUniqueKeyColumns,
  sort: approvedNativeSortExpression, filter: approvedNativeFilter,
  context: configuredEbsContext,
  credentials: {usernameEnv: 'ERP_SOURCE_USER', passwordEnv: 'ERP_SOURCE_PASSWORD'},
  pageSize: 200, onProgress: event => console.log(event)
});
```

EBS context keys are `ctx_responsibility`, `ctx_respapplication`,
`ctx_securitygroup`, `ctx_nlslanguage`, and `ctx_orgid`; only the selected WADL's
declared parameters are sent. `select`, `filter`, `sort`, `offset` and `limit` use
the native GET query contract. The adapter validates the actual
`OutputParameters.Summary` Offset/GetCount/TotalCount and the selected
`Result.Output.<record-element>` records. It enforces progressing pages, stable
population counts, native unique identities and complete scalar projection.
The sort expression comes from the approved tenant contract; the adapter does not
guess its syntax. `endpointOverride` is an explicit reverse-proxy selection under
the approved origin and is retained alongside the WADL's declared endpoint.

Credentials resolve only from named environment variables at request time.
Authorization values are not written to receipts or manifests. HTTPS redirects are
not followed. Cancellation and restart use the same retained-page protocol as GIS.
`reopenEbsCapture()` additionally verifies the selected WADL bytes. Row-count and
identity checks document paging consistency, not a transactional Oracle snapshot.

## Exact GL_INTERFACE preparation

`oracle-gl-contract.json` contains the 133 native column definitions, nine required
columns, internal NULL fields and source-name discrepancies from the EBS 12.2 guide.
The operator supplies the actual source mapping and approved chart/lookup values:

```js
import { prepareGlInterface } from './oracle-gl.mjs';
const prepared = await prepareGlInterface({
  directory: '/private/gl-preparation-001',
  sourceRows: selectedOriginalRecords,
  source: {file: selectedSourceFile, sha256: selectedSourceSha256},
  mapping: nativeColumnToSourceColumn,
  defaults: approvedTenantDefaults,
  enabledSegments: approvedEnabledSegmentColumns,
  approvedLookups: selectedTenantLookupValues,
  dateFormat: 'YYYY-MM-DD', textLengthSemantics: 'characters'
});
```

Values remain exact text. Defaults do not supply a fictitious ledger, chart, source,
currency, budget or user; STATUS NEW is the sole native preparation default.
The adapter checks required fields, exact NUMBER syntax/precision, selected length
semantics, dates, approved lookup membership, B/E conditional fields, native account
selection, conversion fields, VAT fields and internal NULL columns. Enabled account
segments can have gaps and retain leading zeroes. When both segments and a code
combination ID are supplied, Oracle's segment precedence is reported. Both debit
and credit values are allowed in one row, as the native guide specifies.

Date representation is explicitly `YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, or
`preserve` for an independently configured native loader format. Character length
can use characters or UTF-8 bytes to match the approved database/loader. The
materializer does not treat these selections as discovered tenant configuration.

Outputs are `preparation.json`, `gl-interface.csv`, and `gl-interface.jsonl.gz`.
The JSONL retains each original source row, exact mapped values, record hash and
all row-level issues. The manifest includes complete issue counts, the first 200
examples and exact decimal amount summaries by ledger/currency/balance type.
`review_required` denotes structural or supplied-lookup errors; `prepared` denotes
completion of those checks. It does not assert that data was loaded, Journal Import
completed, or journals were posted. The CSV is an adapter-generated native-column
file for the selected loading procedure, not a universal Oracle upload template.

## CLI and integration

```sh
node cli.mjs arcgis --config /private/arcgis.json
node cli.mjs ebs-inspect --config /private/wadl-selection.json
node cli.mjs ebs-download-wadl --config /private/wadl-download.json
node cli.mjs ebs-capture --config /private/ebs-extraction.json
node cli.mjs gl-prepare --config /private/gl-mapping.json --source-jsonl /private/export.jsonl
node cli.mjs reopen --directory /private/capture-or-preparation
node cli.mjs recover-lock --directory /private/interrupted-capture
```

CLI configuration keys are the same as the callable functions. SIGINT/SIGTERM abort
the active operation and allow its retained checkpoint to finish. Progress goes to
stderr; stdout returns the completed status and artifact locations. The conversion
operator can register the resulting CSV and native manifest in the existing
interface/trial workflow, then compare, review and deliver using its original APIs.

## Primary technical references

- [City Purchasing and PlanetBids](https://www.burbankca.gov/web/financial-services/purchasing)
- [Published document index](https://craxy.ai/find-rfps/cmuzd85nn00gmzr09q8d4cq4c)
- [Esri layer-query contract](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/)
- [EBS 12.2 open-interface REST requests](https://docs.oracle.com/cd/E26401_01/doc.122/e20927/T511473T669558.htm)
- [EBS 12.2 WADL, context and paging](https://docs.oracle.com/cd/E26401_01/doc.122/e20927/T511473T516919.htm)
- [EBS 12.2 GL_INTERFACE and Journal Import](https://docs.oracle.com/cd/E26401_01/doc.122/e48748/T312864T451269.htm)

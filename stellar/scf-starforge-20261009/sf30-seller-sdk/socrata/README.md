# Socrata dataset workspace

A local operator application for taking a real Socrata dataset through source
inspection, retained paged capture, explicit typed mapping, native dataset query,
merchant configuration, and portable handover.

The browser and CLI use the same `openSocrataWorkspace` backend. Dataset admission,
filters, ranges, sorting, projection, cursors and seller configuration use the
original [SF30 dataset engine](../DATASET_API.md). Source pages and editions remain
available for review and recovery.

## Start the operator

Use the repository's supported Node runtime:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  workspace --directory /srv/starforge/housing-source --port 0
~~~

Open the printed session URL on the same computer. It includes the session
capability in the URL fragment; the browser removes that fragment and retains the
capability in session storage for that local origin. The listener binds only
`127.0.0.1`. Ctrl+C closes the listener and the original workspace.

The source API token is a startup credential. Set `SOCRATA_APP_TOKEN` in the
operator's environment, or choose an existing environment variable:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  workspace --directory /srv/starforge/housing-source \
  --app-token-env MUNICIPAL_DATA_APP_TOKEN
~~~

SODA 3 queries require authentication or an application token. The source
credential is passed to the backend at startup and is absent from the source
configuration, public workspace state and portable package. The separate browser
session capability authorizes local workspace operations.

## Complete the source-to-customer workflow

### 1. Inspect the actual provider source

In **Source**, enter the provider domain and dataset ID. Select the actual capture
protocol, an explicit where expression, a stable order and provider page size.
**Save source and inspect** retains the configuration and reads the provider
metadata. The field table shows source names and declared provider types.

For the original NYC Housing Preservation and Development source:

| Setting | Value |
| --- | --- |
| Domain | `data.cityofnewyork.us` |
| Dataset ID | `hg8x-zxpr` |
| Dataset | Affordable Housing Production by Building |
| Where | `borough='Queens'` |
| Source ordering | `project_id,building_id,bbl` |
| Default provider page size | `1000` |

New ordered captures append `:id` as a stable tie-breaker. An imported original
capture preserves the order actually recorded in its manifest and source pages.

The provider publishes **building-in-project records**. Preserve that row scope;
a row is not automatically a unique building. The original Queens capture
contains 1,342 rows. Its complete retained pages can be imported directly using
the original capture manifest.

The **Search the provider catalog** section returns the actual catalog result for
the entered phrase and domain. Review its dataset ID and provider before saving
a source configuration.

### 2. Capture, pause and resume the original pages

**Start capture** creates the retained capture. **Fetch next page** advances one
provider page. The row count, expected count, page count, original byte count and
next offset are shown together.

**Run remaining pages** repeatedly calls the same backend's
`capture.advance({pages:1})`. **Pause after current page** lets the current request
finish and keeps its bytes before stopping subsequent page requests.
**Resume and run** continues that same capture.

A provider revision change is visible in the capture state. Review its original
details before choosing a new capture. The workspace does not automatically
repeat a mutation after a lost response; refresh its retained state to see what
completed.

To continue from source already captured by another operator, use **Import an
existing source capture** with the local manifest path. The importer accepts
`stellar-forge.socrata-capture.v1`, including its ordered page paths and hashes.
Keep the original manifest and referenced pages available on the workspace
computer. The importer verifies their bytes and keeps the recorded source query.

### 3. Map the dataset explicitly

In **Mapping & editions**, add the source fields to expose. Newly added columns
start as strings; type, null policy, nullable output and query capabilities stay
visible for every column.

The original HPD source supports this practical mapping:

| Source field | Output type | Suggested null rule | Use |
| --- | --- | --- | --- |
| `project_id` | string | Empty becomes null | Exact source identifier |
| `building_id` | string | Empty becomes null | Exact source identifier |
| `bbl` | string | Empty becomes null | Preserve identifier text |
| `project_name` | string | Empty becomes null | Human-readable project name |
| `project_start_date` | string | Empty becomes null | Preserve source timestamp semantics |
| `project_completion_date` | string | Empty becomes null | Preserve source timestamp semantics |
| `borough` | string | Empty becomes null | Equality filter |
| `reporting_construction_type` | string | Empty becomes null | Equality filter |
| `all_counted_units` | integer | Empty becomes null | Explicit numeric range and sort |
| `total_units` | integer | Empty becomes null | Explicit numeric range and sort |
| `latitude_internal` | string | Empty becomes null | Exact source decimal text |
| `longitude_internal` | string | Empty becomes null | Exact source decimal text |
| `house_number` | string | Empty becomes null | Preserve address text |
| `street_name` | string | Empty becomes null | Preserve address text |

For this mapping, check nullable output on each selected field. Source numeric
literals can remain exact strings; conversion occurs only when an integer or
number output is explicitly chosen. Native integers must be JavaScript-safe
integers. Native numbers are finite IEEE-754 values. Keep larger identifiers,
leading zero codes and exact decimal values as strings.

Null choices are explicit:

- **Empty becomes null** maps null/empty source values to nullable output. It
  intentionally merges empty text and null in the native CSV representation.
- **Reject null** rejects values that cannot populate a non-nullable field.
- **Literal JSON text** encodes the original value as JSON text. It requires
  `type:"string"` and `nullable:false`.

A Socrata floating timestamp has no timezone. Keeping the original timestamp text
avoids adding an assumed UTC conversion. Native string sorting is code-unit
ordering; it does not parse dates or infer a locale.

ID columns refer to **output names**, as do filters, ranges and sorts. Leave
identity columns empty until the actual data proves the intended key is unique
and non-null. With no identity columns, edition changes use exact row-content
multiset additions and removals. Explicit identity columns enable keyed change
review; duplicate or null keys produce a mapping error.

Configure up to eight fields for each native query capability. The shared query
parameter ceiling also applies:

~~~text
3 + filters + 4 × ranges + (sorts ? 1 : 0) <= 32
~~~

**Download saved mapping** preserves the exact reviewed columns, null policies and
capability order as a JSON file. After inspecting a new capture, **Load mapping
JSON** brings that same mapping into the editor. Review it and save it for the new
capture; this makes successive edition comparisons use the same transformation.

Choose **Save mapping**, then **Build retained edition** after capture completes.
Review the edition's changes and choose **Use this edition**. Query preview and
merchant preparation use the selected retained edition.

### 4. Preview the original dataset behavior

**Query preview** exposes only the mapped query capabilities. Add typed equality
or range conditions, select sort order, choose output fields, and set a page
limit. Additional native query parameters can be entered directly.

For a mapping that enables the indicated capabilities:

~~~text
where_borough=Queens&gte_all_counted_units=10&sort=-all_counted_units&fields=project_id,building_id,all_counted_units&limit=25
~~~

Conditions combine with AND. Empty equality selects null only on nullable output.
String equality is case-sensitive and does not trim source values. Nullable
values do not match range conditions.

The result shows the original `rows`, `fields`, `dataset` and `page` data.
**Next page** copies the native cursor unchanged and retains the original query
conditions, projection and ordering. Editing the query requires a new preview
before continuing its pages.

The complete native result remains available under **Native result and
continuation**. **Load saved query** restores the last successful selection for
the active edition into the form, with its cursor removed for a complete replay.
Review its parameters and choose **Run query preview**. The exact last accepted
page and continuation remain in the retained workspace record. This local preview helps the operator inspect the exact edition
before preparing the customer-facing seller.

### 5. Prepare the original seller

In **Merchant**, enter the actual public HTTPS origin, dataset route and public
payment terms:

`scheme:"exact"`, `network`, `asset`, `amount`, `payTo`,
`maxTimeoutSeconds`.

`amount` is a positive integer string in atomic units. Use the actual network,
asset and recipient supported by the existing seller deployment.

**Prepare merchant configuration** calls the original seller compiler for the
active dataset edition. The retained configuration is included as
`seller.json` in export. The merchant's existing verification, settlement and
facilitator configuration continue to control paid operation.

Use the original [seller operating instructions](../README.md) and
[dataset publication instructions](../DATASET_API.md#publish-through-the-original-seller)
with the exported dataset and seller files. Those instructions cover the
original health, offers, docs and OpenAPI routes and the existing native paid
runtime.

### 6. Deliver and reopen the complete package

**Export current package** retains:

- `starforge-socrata.json.gz`: the complete portable workspace package.
- `dataset.csv` and `dataset.json`: the selected native dataset.
- `source.json`: original source provenance.
- `query.json`: the initial replay of the last successful selection, the exact
  last accepted page request, its native continuation, snapshot and capabilities.
- `README.md`: the receiving instructions.
- `seller.json` when merchant terms were configured.

The file list shows exact names, byte counts and SHA-256 hashes. Downloads require
the same local operator session. Each download is read through the backend's
original export lookup.

To reopen, copy the complete portable package to the receiving computer and
start a workspace with a new, empty directory. In **Export & recovery**, enter
the local `starforge-socrata.json.gz` path and choose **Import package into empty
workspace**. The backend also accepts the plain JSON equivalent.

Review the recovered source, capture, mapping and active edition. Run the same
native query and inspect the recovered merchant configuration. Companion
CSV/configuration files can be used directly with the original seller; the
portable package keeps the full source and workspace history available.

## Command-line operation

The browser and CLI expose the same backend actions. Use a UTF-8 JSON payload file
for complete mappings or merchant terms:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  action source.configure --directory /srv/starforge/housing-source \
  --json '{"domain":"data.cityofnewyork.us","datasetId":"hg8x-zxpr","protocol":"soda2.1","where":"borough='\''Queens'\''","order":"project_id,building_id,bbl","pageSize":1000}'

node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  action source.inspect --directory /srv/starforge/housing-source

node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  action capture.start --directory /srv/starforge/housing-source

node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  action capture.advance --directory /srv/starforge/housing-source \
  --json '{"pages":1}'

node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  action capture.pause --directory /srv/starforge/housing-source

node stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/cli.mjs \
  status --directory /srv/starforge/housing-source
~~~

A separate CLI command opens the directory as an operator. Stop the browser
workspace before using a second process against that same workspace directory.

The complete action payloads are:

| Action | Payload |
| --- | --- |
| `source.configure` | `{domain,datasetId,protocol,where,order,pageSize}` |
| `source.inspect` | `{}` |
| `source.search` | `{query,domain}` |
| `capture.start` | `{}` |
| `capture.advance` | `{pages:1}` |
| `capture.pause`, `capture.resume` | `{}` |
| `capture.import` | `{manifestPath}` |
| `mapping.save` | `{name,idColumns,columns,filters,ranges,sorts,pageSize,maxPageSize}` |
| `edition.build` | `{}` |
| `edition.activate` | `{editionId}` |
| `dataset.query` | `{query:{limit:"50",...}}` |
| `merchant.configure` | `{origin,path,payment:{scheme,network,asset,amount,payTo,maxTimeoutSeconds}}` |
| `package.export` | `{}` |
| `package.import` | `{packagePath}` |

Each mapping column is
`{source,name,type,nullable,nullPolicy}`.
All action results print as JSON. If an action reports a conflict or an interrupted
provider request, read the retained state before choosing the next action.

## Programmatic and transport interfaces

~~~js
import {openSocrataWorkspace} from './workspace.mjs';

const workspace = await openSocrataWorkspace({
  directory: '/srv/starforge/housing-source',
  appToken: process.env.SOCRATA_APP_TOKEN
});
try {
  const before = await workspace.state();
  const {state, result} = await workspace.act('capture.advance', {pages: 1});
} finally {
  await workspace.close();
}
~~~

The browser server is also importable without CLI side effects:

~~~js
import {startSocrataWorkspace} from './server.mjs';

const app = await startSocrataWorkspace({
  directory: '/srv/starforge/housing-source',
  port: 0
});
// app.origin, app.url; keep the session URL private.
await app.close();
~~~

The transport exposes:

- `GET /api/state` → the original public workspace state.
- `POST /api/action` with `{action,payload}` → `{state,result}`.
- `GET /api/exports/:exportId/:filename` → a retained export file resolved by
  `workspace.readExport(exportId,filename)`.

Every API request requires the local bearer session capability. Host and Origin
must match the printed local origin. Responses use no-store headers and a
restrictive content policy. The browser renders provider and dataset values as
text. Source credentials are startup-only; arbitrary browsing or remote file
paths do not become implicit source imports.

## Provider references

- [Original NYC HPD dataset](https://data.cityofnewyork.us/Housing-Development/Affordable-Housing-Production-by-Building/hg8x-zxpr)
- [SODA query and SODA 3 pagination contract](https://dev.socrata.com/docs/queries/)
- [Ordered SODA paging](https://dev.socrata.com/docs/paging.html)
- [Socrata floating timestamps](https://dev.socrata.com/docs/datatypes/floating_timestamp)
- [Original SF30 dataset types, query semantics and seller handover](../DATASET_API.md)

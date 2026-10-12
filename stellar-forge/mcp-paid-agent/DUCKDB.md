# DuckDB customer and agent workspace

Use the original DuckDB customer workspace from its browser and an MCP client.
Both work with the same received source files, immutable dataset editions, active
views, saved SQL recipes and complete exports. The existing Python service owns
the warehouse. The maintained native buyer MCP supplies the agent connection.

This guide covers installed Applications, host registration, source review and
import, exact query parameters, complete CSV/Parquet delivery, edition comparison,
portable receiving, and continuation after a lost response. For the original
Python installation and browser controls, see
[DuckDB dataset workspace](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/DUCKDB.md).
For the existing wallet, spending ledger and native MCP directory, see
[Native buyer workspace](NATIVE_WORKSPACE.md).

## Prepare the existing workspace

Keep these original resources together:

| Resource | Use |
| --- | --- |
| Complete selected Node runtime | Contains the maintained native buyer, DuckDB adapter, current CLI and Applications support. |
| Original initialized native buyer MCP directory | Contains native-workspace.json and connects the existing SF88 buyer, inbox and ledger. |
| Running DuckDB customer service | Opens the original private customer directory containing warehouse.duckdb. |
| Retained source reports and their complete delivery files | Supply the exact received dataset/SF100 data-room inputs for mapping and import. |
| Private DuckDB connection JSON | Assigns local aliases to the original customer directory and exact source reports. |
| Existing MCP host access configuration | Supplies MCP_ACCESS_TOKEN, or the original OAuth configuration, outside model arguments. |

Use the current Python package for the existing customer directory. Its original
DuckDBOperator exposes a persistent workspace ID and writes that ID in the private
duckdb-launch.json. The launch schema remains
stellar-forge.duckdb-operator-launch.v1. The workspace ID survives a service restart;
the local browser capability rotates with that service.

If the original service is already running from this release, keep it. To start
that same workspace through its installed Python environment:

```bash
/absolute/private/duckdb-venv/bin/python -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-warehouse serve --port 0
```

The existing **DuckDB dataset workspace** Python Application also starts this
service. Its original owner remains responsible for Stop and reopen.

If no native buyer MCP directory exists yet, use the initialization steps in
[NATIVE_WORKSPACE.md](NATIVE_WORKSPACE.md) around the existing SF88 buyer. This
retains the original payer and ledger. An existing native directory can be used
directly; the current native CLI serves its own current native instance even if
an older generated operator.mjs still references a previous source checkout.

## Declare the original reports

Create a private registration with a workspace alias and original source aliases.
The database value is the absolute **customer directory**, containing
warehouse.duckdb and duckdb-launch.json. It is not a database filename or URL.

The following command computes the SHA-256 from the actual unchanged source
report and creates one registration without replacing an existing file:

```bash
node --input-type=module - \
  /absolute/private/source-delivery-report.json \
  /absolute/private/customer-warehouse \
  /absolute/private/duckdb-connection.json <<'NODE'
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

const [reportPath, database, output] = process.argv.slice(2);
const raw = await readFile(reportPath);
const description = {
  name: 'customer',
  database,
  sources: [{
    name: 'arcgis_delivery',
    reportPath,
    sha256: createHash('sha256').update(raw).digest('hex'),
  }],
};
await writeFile(output, JSON.stringify(description, null, 2) + '\n', {
  flag: 'wx', mode: 0o600,
});
NODE
```

The source report is the original delivery.native result, its unchanged supported
Python bridge, or the unchanged scan of a finalized original SF100 data room.
The original browser guide explains how to retain each report. Keep the complete
source delivery at the report's recorded private paths through review and import.

Registration verifies the current original service, persistent workspace ID,
complete report bytes, retained manifest and source binding. Every source alias
has its own report digest. Host registration can include up to 256 source aliases,
and the native inspector accepts a report up to its 8 MiB limit. The connection
JSON itself is limited to 256 KiB.

The same registration can be repeated. A different source selection belongs to
a new named registration pointing to the same customer directory. This lets a
new report join that existing warehouse while retaining earlier source aliases,
editions, recipes and history. Reuse the original report bytes for an existing
alias; reformatting JSON changes its byte identity.

Only the host receives report paths and the original browser capability. MCP
requests use aliases, source digests and saved native IDs.

## Open from installed Applications

1. Select the complete READY Node runtime and choose
   **Applications → New application → DuckDB customer and agent**.
2. Select the existing **Native buyer MCP workspace** and the private
   **DuckDB connection JSON**. Choose **Agent port 0** for an available MCP port.
   The original DuckDB browser keeps its separately running port.
3. Supply the existing MCP access configuration through the host environment or
   **Private environment JSON**. The usual bearer setting is MCP_ACCESS_TOKEN.
4. Choose **Review application**, then **Save application**. Review checks the
   running original service and exact source reports, and retains the selected
   runtime, native manifest, original directories and connection-file digest.
5. Choose **Review start**, then **Start reviewed application**.
   **Open application** opens the actual original DuckDB browser. The retained
   operation also includes the agent MCP endpoint and native buyer console.

Start compares the original persistent workspace ID and exact connection JSON
before registering the host alias. It then serves the current native buyer
instance. A mutable warehouse or rotating browser launch file is not used as an
immutable Applications input fingerprint; ordinary saved queries, new editions
and a same-workspace Python restart remain usable.

The private startup record is
stellar-forge.duckdb-agent-workspace-startup.v1. It identifies the original native
directory, connection-file digest, customer workspace ID, browser URL, current
MCP endpoint and buyer console. The managed observer accepts only this original
startup from the selected command. It does not derive a URL from a requested port.

**Stop** closes the managed MCP connection and its native adapter work. The
separately owned Python DuckDB service remains available in its own Application.
A later reviewed start attaches to that same customer workspace. Applications
coordinates managed MCP launches by the original native MCP directory.

### Start directly from maintained source

Use the complete source selected by the installed runtime:

```bash
node /absolute/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  duckdb-register --dir /absolute/private/native-mcp \
  --description /absolute/private/duckdb-connection.json

node /absolute/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  serve --dir /absolute/private/native-mcp \
  --duckdb-description /absolute/private/duckdb-connection.json --port 0
```

The separate register command returns the verified original binding. The serve
command also performs registration, so it can be used directly with the same
description. Applications additionally supplies
--duckdb-description-sha256 and --duckdb-workspace-id from its actual review.

The command prints one compact JSON startup line containing the original browser
URL and current /mcp endpoint. Keep that host output private. Use the existing
MCP client's host access configuration for /mcp; the DuckDB browser capability
and MCP bearer token serve their respective original applications.

The maintained installed command is **mcp-native**. No additional launcher,
database engine or command alias is required.

## Connect the agent to saved customer work

Use the original **sf43_discover_review_and_pay** tool. Its DuckDB action joins
the same native customer service:

```json
{
  "action": "duckdb",
  "duckdbOperation": "workspaces"
}
```

Choose the registered alias from result.workspaces. Then inspect the warehouse:

```json
{
  "action": "duckdb",
  "duckdbWorkspace": "customer",
  "duckdbOperation": "state"
}
```

Results use the stellar-forge.mcp-native-duckdb.v1 envelope. The original
operation payload is in result. State gives the original warehouse identity and
current view selections. Source, edition, recipe, export and operation catalogs
remain separately pageable.

For direct local invocation, put that argument object in a private JSON file:

```bash
node /absolute/source/stellar-forge/mcp-paid-agent/native-workspace-cli.mjs \
  call --dir /absolute/private/native-mcp \
  --input /absolute/private/duckdb-request.json
```

The local call file contains the argument object itself. A remote MCP client
places that object in the arguments of its ordinary tools/call request for
sf43_discover_review_and_pay.

## Review, import and select source editions

Page **sources**, retaining each alias and exact sha256. Use **inspect-source**
with duckdbRequest.source to inspect the complete original delivery and its
default_columns. The displayed sample is a preview; the row count and mapping
inspection cover the complete retained source.

To create **review**, supply:

| Field | Original value |
| --- | --- |
| source | The registered source alias. |
| source_sha256 | That alias's exact report digest from sources. |
| columns | Every source field, each with source, name, type and nullable. Begin with the original inspector's complete default_columns. |
| keys | Mapped SQL column names that uniquely identify records, or an empty array when no stable key is available. |

Review every source field. Preserve identifier strings, exact decimal precision,
time semantics and original JSON geometry fields. The original mapper requires
one mapping entry per source field; selected keys must be non-null and unique
across the complete edition.

The original supported types are VARCHAR, BOOLEAN, BIGINT, HUGEINT, DOUBLE,
DATE, TIMESTAMP, TIMESTAMPTZ, JSON and DECIMAL(p,s). The browser guide explains
the source-specific defaults and precision limits. sf_row retains original row
order and is reserved.

Call **import** with the returned review_id. Repeating the same reviewed import
reopens its immutable original edition. A different source or reviewed mapping
produces a separate edition.

Use **activate** to select an edition under a view name. Supply name, edition_id
and the current expected_revision. Revision 0 creates a previously unused view;
an existing view requires its actual current revision. Read **views** or **state**
first. If a response is lost, inspect the current view before repeating an update.

## Save useful SQL and preserve exact values

Read all current view bindings before a query or export. Preserve each view's
name, edition_id and revision in the original order returned by the native
service. Supply that complete array as expected_views. If using the paged views
catalog, assemble every page; a partial first page is not a complete selection.

The retained ArcGIS receiving example includes customer_current with the original
object_id, GEOID, municipality and modelled annual nitrogen delivery fields.
This SQL produces a useful customer table from that original selection:

```sql
SELECT object_id, GEOID, municipality,
       delivery_lb_n_year, after_delivery_lb_n_year
FROM customer_current
WHERE delivery_lb_n_year >= ?
ORDER BY object_id
```

These annual delivery values retain their original source model meaning. Select
the actual fields and units from your reviewed edition for another delivery.

Save the recipe with **save-query**, using a new descriptive name such as
ArcGISMunicipalityDelivery, that SQL, parameters_text set to "[0.00]", and
expected_revision 0 only when the name is new. The return value includes the
original query_id and revision. Use **saved-query** or the paged **queries**
catalog before updating an existing recipe.

**query** executes a preview using sql, parameters_text, the complete
expected_views, and max_rows from 1 to 100. The result reports truncated when
additional rows exist. The display limit is separate from the saved SQL. A LIMIT
inside SQL becomes part of the delivered result, including its complete export.

parameters_text is a JSON array or object encoded as text. The adapter sends its
numeric tokens unchanged to Python. For example, "[9007199254740993]" retains
that integer; do not first convert it to a JavaScript Number. SQL output uses the
original native typed value encoding. Unsafe raw metadata integers are represented
as an object with encoding "json-integer" and the exact text value.

For exact money, ratios and source decimals, use the original reviewed DECIMAL
or JSON representation. Keep query_columns, stored columns and column_encodings
from a completed export together; these explain any lossless storage
representation chosen by the native Parquet writer.

## Deliver the complete result

**export** executes the saved original recipe into full Parquet and CSV files.
Its request contains:

```javascript
const exportArguments = {
  action: 'duckdb',
  duckdbWorkspace: 'customer',
  duckdbOperation: 'export',
  duckdbRequest: {
    request_id: retainedRequestId,
    query_id: savedRecipe.query_id,
    expected_revision: savedRecipe.revision,
    expected_views: allCurrentViews,
  },
};
```

Use the actual recipe and complete views returned by the native service.
retainedRequestId is one newly generated 32-character lowercase hexadecimal ID
for this intended export. Retain it before calling. A later different result
gets its own ID; continuation of this export keeps this original ID.

The complete operation retains the exact saved SQL, parameters, recipe revision
and selected editions. Use **export-read** to reopen its export_id and full file
manifest. A completed query delivery includes its full result.parquet,
result.csv, request and execution records, and native manifest. The actual
returned file list is authoritative.

Download every desired file through **file** using the completed manifest:

```javascript
const fileArguments = {
  action: 'duckdb',
  duckdbWorkspace: 'customer',
  duckdbOperation: 'file',
  duckdbRequest: {
    export_id: delivery.export_id,
    filename: member.name,
    sha256: member.sha256,
    byteOffset: 0,
    maxBytes: 65536,
  },
};
```

The existing saved-file reader returns base64 data in ranges of at most 64 KiB.
Append the decoded bytes at the original returned offset and continue with
nextByteOffset until the original reader reports completion. Verify the completed
byte count and SHA-256 against that same member. Use the exact nested filename
when the original manifest declares one. Ranged reads consume saved files and
do not rerun the query.

A successful preview is not a substitute for the complete export. The finished
CSV/Parquet records and manifest carry full result row counts, selected source
editions, query identity, SQL types and file hashes.

## Compare a later source and keep earlier results

Expose the later original report through a reviewed host registration for the
same customer directory. Inspect, review and import it with compatible unique
keys. **compare** accepts before_id, after_id, optional keys and max_rows up to
100. It returns complete added/removed/changed totals and a labeled change preview.

Read both source scopes and the structural column changes alongside those totals.
The original comparison uses common columns with identical SQL types. A wider
source selection or a changed source model can explain differences that are not
record corrections.

After reviewing the comparison, activate the candidate edition under the existing
view name with its actual expected_revision. The saved recipe remains available.
A new export retains the newly selected source binding while earlier editions
and exports keep their original records.

The browser can perform the same actions. Reopen current view and recipe
revisions after another browser or agent changes them.

## Source files and portable workspace receiving

Use **source-handoff** with a stable request_id and edition_id to materialize
that edition's complete original received files. This consumes the files embedded
in the imported edition. Reopen the finished record through export-read and
download its complete manifest with file, including nested SF100 page paths.

Use **handoff** with one stable request_id to prepare the original portable
warehouse. Its complete files include warehouse.duckdb, handoff-request.json and
handoff.json. The warehouse retains imported editions, complete embedded source
files, reviews, views and recipes. Its original export history retains the
separate export directory locators; transfer each desired existing CSV/Parquet
export's own full file list as well.

Receive all files at their declared paths in a private destination and verify
their full logical byte counts and SHA-256 values. Sparse storage may reduce
physical disk allocation without changing any logical database byte. Preserve
the original hash of the complete database.

Install the same complete Python package on the receiving host and open that
received directory using the original DuckDB Application. Reopen its editions
and recipes before producing any new export. Prepare a host-local registration
there if an agent connection is wanted. The receiving host uses its own original
launch descriptor and access configuration.

## Continue an interrupted operation

An export or handoff may complete after a client loses its response. Retain the
original request_id and use **operation** to inspect it. **operations** pages the
existing journal.

- If COMPLETE, open the retained export and download its existing files.
- If the original request is retained and incomplete, call **resume** with that
  same request_id. The native service continues its own operation.
- If a view or saved recipe changed before a new operation was accepted, inspect
  the current native record and review the intended selection before another call.
- If the service is unavailable, reopen the same Python workspace and retry the
  inspection. Its persistent workspace ID remains the connection identity.

For source review/import, reuse the exact original review to recover the same
edition. For view and recipe updates, read their current records after an
uncertain response; their revision check prevents overwriting another user's
change. The adapter reports MCP_DUCKDB_REPLY_UNCERTAIN_INSPECT_ORIGINAL_OPERATION
for a write whose response could not be established.

## Operation reference

All operation-specific fields belong inside duckdbRequest.

| Operation | Required fields and purpose |
| --- | --- |
| workspaces | No selected alias required; list original host registrations. |
| state | Read the original selected warehouse identity and current views. |
| sources | offset/limit optional; page registered exact-hash source aliases. |
| inspect-source | source; inspect the complete retained delivery and mapping. |
| review | source, source_sha256, columns, keys; retain checked source mapping. |
| reviews / review-read | Page saved reviews, or read review_id. |
| import | review_id; import/reopen the immutable native edition. |
| editions / edition | Page with limit/before, or read edition_id. |
| views | Page complete current view selections using offset/limit. |
| activate | name, edition_id, expected_revision; select a view edition. |
| queries / saved-query | Page recipes, or read query_id. |
| save-query | name, sql, expected_revision; optional parameters_text. |
| query | sql, expected_views; optional parameters_text and max_rows. |
| compare | before_id, after_id; optional keys and max_rows. |
| exports / export-read | Page completed exports, or read export_id. |
| export | request_id, query_id, expected_revision, expected_views; full CSV/Parquet. |
| source-handoff | request_id, edition_id; original embedded source files. |
| handoff / handoffs | Create with request_id, or page original handoff records. |
| operations / operation | Page retained requests, or read request_id. |
| resume | request_id; continue that exact existing native operation. |
| file | export_id, filename, sha256; optional byteOffset/maxBytes. |

Offset catalogs default to 25 items and accept at most 100. Follow next_offset
until null. Editions use their original next_before sequence cursor. Source
aliases follow their declared registration; edition/query/review identifiers
are 64 lowercase hexadecimal characters, while operation request IDs and
persistent workspace IDs are 32 lowercase hexadecimal characters.

## Resolve configuration changes

| Observation | Resolution |
| --- | --- |
| MCP_DUCKDB_IDENTITY_SERVICE_REQUIRED | Start the same original warehouse from the complete current Python source that exposes persistent identity. |
| MCP_DUCKDB_WORKSPACE_ID_CHANGED | Check the selected original customer directory and service. Review the intended persistent identity before registration. |
| MCP_NATIVE_INPUT_CHANGED or APPLICATION_DUCKDB_INPUT_CHANGED | Reopen the actual connection JSON and source selection, then review/save/start that intended configuration. |
| MCP_DUCKDB_ORIGINAL_REPORT_CHANGED | Restore/select the exact retained report bytes and complete original delivery, or register the newly intended source under a new alias. |
| MCP_DUCKDB_SERVICE_UNAVAILABLE | Reopen the existing Python owner and inspect the same workspace again. |
| Original view/query revision conflict | Read current views or the saved query, review the intended change, and use its actual revision. |
| MCP_DUCKDB_RESULT_TOO_LARGE_USE_SMALLER_PAGE_OR_FILE | Reduce the catalog/preview page or retrieve the complete saved export through ranged file reads. |
| MCP_DUCKDB_REPLY_UNCERTAIN_INSPECT_ORIGINAL_OPERATION | Read the same saved request or current view/recipe before continuing. |

The customer service, original buyer, and their maintained storage and revision
rules remain the operating authority throughout this workflow.

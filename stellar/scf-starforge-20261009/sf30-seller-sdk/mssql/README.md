# SQL Server merchant and authoring workspace

This component turns selected SQL Server tables and views into paid HTTP data products through the maintained Starforge seller. It includes a schema browser, typed endpoint editor, private live preview, immutable merchant packages, generated customer client, merchant start/stop and retained release reopening.

The implementation uses the original SF30 scalar and exact-decimal validators, public offer compiler, seller, operations console and customer exporter. Its authoring and package lifecycle are derived from the maintained MySQL workspace. SQL Server parsing, metadata, parameters, connection handling and output encoding are native to this component.

## Run the complete workflow

Requires Node 22.16 or newer and SQL Server 2016 or newer. Install the pinned runtime declared in this directory, or select its maintained distribution runtime:

~~~sh
npm install --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/mssql
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs init --directory /private/sqlserver-merchant
~~~

Edit the new source.json with the existing server, port, database, SELECT-only user and password environment name. Set that environment in the launching host. The profile carries a reference such as STARFORGE_MSSQL_PASSWORD; the actual password never enters the source package or browser.

The generated merchant plan contains visibly incomplete demonstration payment terms. Replace them with the merchant's existing public HTTPS origin, native network, asset, payTo and price. The original seller compiler validates those choices.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs describe --source /private/sqlserver-merchant/source.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs preflight --source /private/sqlserver-merchant/source.json
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs workspace \
  --source /private/sqlserver-merchant/source.json \
  --state /private/sqlserver-workspace --port 8441
~~~

Open the printed local URL. The browser reads the actual schema-qualified catalog. Select a table or view, its projected columns, one to four projected ordering columns, filters, public request method and price. Each filter has a source-derived type and an explicit public example. Preview the native query, review the public contract, then prepare a named release.

The prepared package retains source.json, service.json, merchant-plan.json, openapi.json, its source-relative CA when configured, the original generated client and a manifest of exact bytes. The browser reopens packages, starts their original merchant, stops the selected run and exports a customer-only client archive. A changed source profile or table schema invalidates the prior review. Reusing an existing release ID reopens its matching package; different choices require a new release.

The browser's endpoint selection, edit recovery and typed filter controls follow the maintained database workspace. Existing packages remain available after server restart. Start/stop uses the original SF30 draining and availability facilities.

The equivalent terminal workflow is:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs query \
  --source /private/sqlserver-merchant/source.json --query catalog \
  --input /private/sqlserver-merchant/input.json --output /private/catalog-result.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs prepare \
  --source /private/sqlserver-merchant/source.json \
  --plan /private/sqlserver-merchant/merchant-plan.json \
  --directory /private/sqlserver-release

node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs verify --directory /private/sqlserver-release
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs run \
  --directory /private/sqlserver-release --port 8423 --operations-port 8424 \
  --facilitator https://your-existing-facilitator.example
~~~

Choose the existing facilitator through the normal seller setup. Without that option the maintained seller starts in CHALLENGE_ONLY mode. Native payment, settlement, price validation, buyer governance and availability remain in their original components.

## Define a native query

A source contains 1–64 named SELECT queries. The same scalar declarations used by the other SF30 database products validate public input before payment.

~~~json
{
  "sql": "SELECT [id], [amount], [created_at] FROM [dbo].[orders] WHERE [id]>@after_id",
  "parameters": {
    "after_id": {"type":"integer","minimum":"0","default":"0"}
  },
  "parameterOrder": ["after_id"],
  "columns": ["id","amount","created_at"],
  "orderBy": [{"column":"id","direction":"ASC"}],
  "maxRows": 100,
  "maxBytes": 65536,
  "timeoutMs": 5000
}
~~~

Every named @parameter must be declared and every declaration used. Strings and quoted identifiers are preserved by the SQL Server lexer. The source accepts one derived SELECT, with explicit output order. Express joins and nested SELECTs in that statement; statements beginning with WITH, procedure execution, variable batches and SELECT INTO are outside this read-query interface.

Use a unique final ordering key when equal sort values must retain a deterministic order. The selected native order applies both before TOP and to the returned result. A response that sees its extra native row reports truncated:true. Customers can supply an explicitly declared cursor field, such as after_id, to continue the product's query.

Public inputs never become SQL text. Validated integer and decimal values travel as NVARCHAR parameters and are converted to their declared native SQL types on the server. Decimal declarations select at most 38 total digits and reject precision that SQL Server would otherwise round. Declare maxScale and maxIntegerDigits to match the intended database field. Boolean and approximate-number parameters use native bit and float binding.

## Retain original values

Preflight uses sys.dm_exec_describe_first_result_set with the actual statement and parameter declarations. The original reader must be permitted to execute that SELECT. Returned columns must match the configured names and order, and unsupported result types fail before serving a product.

The source refreshes this metadata for each query. Original type, precision, scale, byte width, collation and nullability accompany the result. SQL Server renders values before the driver can round them:

| Native value | Customer representation |
| --- | --- |
| Integer, bigint, decimal, numeric, bit | Exact server decimal text |
| money, smallmoney | Text preserving all four fractional digits |
| float, real | SQL Server style 3 round-trip text |
| Date/time and datetimeoffset | Server ISO text preserving native fractional precision and offset |
| Character, uniqueidentifier, XML | Server Unicode text |
| binary, varbinary, image, rowversion | A base64 object derived from complete native hexadecimal text |
| SQL NULL | JSON null |

Every conversion specifies an explicit target length. Long text and binary conversion use max. CLR/spatial/hierarchyid and sql_variant values require an explicit supported projection in the private SELECT. Metadata remains the authority for aliases of native system types.

Response rows and encoded bytes are checked together. The server first suppresses oversized selected native values and marks the row, then the source rejects that whole response. Abort and timeout cancel the native Request, including pool acquisition. Shutdown cancels owned requests and closes its own pool.

## Connection and database operation

The default TLS mode is verify-full, with server certificate validation and an optional retained CA file. local-plaintext is limited to an explicitly configured loopback host for a local development database. SQL Server authentication uses the selected SQL user and existing password environment reference.

Use a dedicated SELECT-only database principal. ApplicationIntent ReadOnly requests native read routing; it does not grant or restrict SQL permissions. The private SELECT filter also rejects mutation/batch operations, while the actual database remains responsible for authorization. Reads use the database's normal single-statement isolation. They do not promise a cross-request snapshot.

The example seed is an operator-run SQL script for a disposable database. It contains a bigint beyond JavaScript's safe integer range, a 38-digit decimal and a seven-digit datetimeoffset. It is never run by the merchant, configuration loader, browser or package preparation.

## Source interfaces

- createMssqlQuerySource: named native queries, original seller routes, metadata, status and shutdown.
- readMssqlSourceFile / openMssqlSourceFile: original profile validation and private host connection.
- inspectMssqlCatalog: actual schema-qualified tables, views, columns and primary-key markings.
- compileMssqlMerchantPlan / prepareMssqlSeller / verifyPreparedMssqlSeller: public contract and complete retained package.
- startMssqlSeller: original SF30 merchant and operations lifecycle.
- createMssqlWorkspace / startMssqlMerchantWorkspace: complete private authoring and receiving browser.

Private SQL, database identity and credentials are excluded from the generated public offer/client. Share the customer archive from the browser for customer integration; use the complete prepared directory for an authorized receiving merchant host.

## Maintained protocol references

- [node-mssql v12.7.4](https://github.com/tediousjs/node-mssql/releases/tag/v12.7.4) and [driver API](https://tediousjs.github.io/node-mssql/).
- [Microsoft result-set metadata function](https://learn.microsoft.com/en-us/sql/relational-databases/system-dynamic-management-objects/sys-dm-exec-describe-first-result-set-transact-sql?view=sql-server-ver17).
- [Microsoft CAST and CONVERT](https://learn.microsoft.com/en-us/sql/t-sql/functions/cast-and-convert-transact-sql?view=sql-server-ver17).
- [Microsoft Node.js connection guidance](https://learn.microsoft.com/en-us/sql/connect/node-js/step-3-proof-of-concept-connecting-to-sql-using-node-js?view=sql-server-ver17).

## Retained seller releases and installed distribution

The maintained merchant distribution includes `starforge mssql` and
`starforge mssql-workspace`. Its `mssql` runtime profile installs the original
pinned `mssql@12.7.4` dependency and the existing runtime doctor checks it.

A prepared directory enters the same SF82 release store as other merchant sources:

```sh
node sf82-seller-pilot/release-cli.mjs init --store /absolute/path/release-store
node sf82-seller-pilot/release-cli.mjs stage --store /absolute/path/release-store --id catalog-v1 --mssql-package /absolute/path/prepared
node sf82-seller-pilot/release-cli.mjs inspect --store /absolute/path/release-store --id catalog-v1
```

Use the existing release CLI to activate, run, compare, stop, and roll back that
retained source. Staging captures the approved query definitions, connection
profile, certificate, public terms, generated customer client, and exact package
bytes. It resolves credentials only when the original SQL Server seller starts.
The existing SF82 child owns the process handshake, readiness, shutdown, and
recovery. Source execution and payment continue through the original SF30 routes.


## Run native receiving in one command

Use the host's existing SQL Server configuration, completed merchant plan, and
typed query input with the pinned runtime installed. The receiving command uses
the same source and original SF82 release owner as the browser and operator CLI:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/mssql/cli.mjs receive \
  --source /private/sqlserver-merchant/source.json \
  --plan /private/sqlserver-merchant/merchant-plan.json \
  --query catalog --input /private/sqlserver-merchant/input.json \
  --table '[dbo].[catalog]' --directory /private/sqlserver-receiving
```

The command first prepares one immutable copy of the approved source and public
contract. It then reads the actual catalog and selected table metadata, runs the
typed query, and retains its native version, column types and exact values. The
same package enters a new SF82 store through init, stage, inspect, list, compare,
and activate. After moving its own generated authoring package, receiving reopens
the retained release and executes the query again. It starts the original owned
SF82 child, checks the generated customer's selected contract with an unpaid
request to the loopback merchant, reads the original 402 payment requirement, and
closes that merchant through its original release owner.

The receiving runtime uses the original SF82 platform contract. Linux requires
`flock` from util-linux; the command acquires the original release lease before
connecting to SQL Server. Windows and other platforms use the existing exclusive
owner-directory and process-liveness path. The original release manager owns child
startup and termination on each platform. A Linux client can also connect to an
existing Windows SQL Server through its approved host profile. On Windows, use
native paths beneath the merchant host's existing private directory.

The source and merchant plan select the database and public contract. `--table`
adds inspection of one actual table or view. `--route` selects the public route
when multiple routes bind the chosen query. Each run needs a new private output
directory with an existing parent. The selected query's original time, row and
encoded-byte limits apply. Database contents remain live between the two reads;
receiving compares their contract and retains each result separately.

The output directory contains the complete merchant package, generated customer
client, retained release store, input, catalog, query results, merchant response
and `receiving.json`. Its summary records the actual Node, pinned driver, SQL
Server version, loaded source file hashes, package and release identity, completed
stages, and native process shutdown. The CLI emits the summary and exits with a
nonzero status on a failed stage, retaining earlier outputs for the original
operator to continue troubleshooting. Keep the whole directory on the authorized
merchant host; the generated `client` subdirectory is the customer deliverable.

This operation runs the merchant in its original `CHALLENGE_ONLY` mode. Existing
facilitator and buyer flows remain available through normal seller startup.


## Managed Applications and the same merchant workspace

The SQL Server entry in Applications starts this original workspace. It binds the
saved application to the workspace UUID, source-profile bytes, source-relative CA,
selected environment and original runtime package. Its startup reader verifies
the private connection record against the live authenticated listener. Source
and workspace changes remain visible at Review and Start.

Initialize the private workspace once before selecting it in Applications:

~~~sh
starforge mssql-workspace init \
  --source /private/sqlserver-merchant/source.json \
  --state /private/sqlserver-workspace
starforge mssql-workspace inspect \
  --source /private/sqlserver-merchant/source.json \
  --state /private/sqlserver-workspace
~~~

The result contains its workspaceId. Existing authoring workspaces acquire that
identity on their first normal launch with this source; their prepared releases
remain in place. The identity file is operator/workspace.json. The currently
running original listener writes operator/connection.json with mode 0600 and
removes its own connection record when it closes.

In Applications choose **SQL Server data products**, select the initialized
state directory and original source JSON, and supply the private environment
file containing the source's named password variable. Select the existing SF82
store when the merchant host will stage releases. Review, Save, Connect, Review
Start, Start and Open use the maintained Applications workflow. A fixed local port
keeps the same browser origin across restarts; the host connection file also
tracks a newly allocated port automatically.

This authoring owner uses Linux and util-linux flock, matching its original
release-preparation lock. A Linux client can connect to the existing Windows SQL
Server host. The earlier native mssql receive command retains its original
cross-platform SF82 contract.

The browser's **Saved workspace** section reopens complete reviews, original
operation results and transfers after restart. Review, preview, preparation and
export save an operation UUID before sending. A lost reply leaves the exact
request in browser storage; **Retry saved operation** returns its original
retained outcome. Another browser tab cannot replace that pending request.
Reviews retain their original expiry, source profile, schema and choices.
Preparing an already committed matching package reopens that original package.

## Reopen the same operator after interruption

Start the saved Application again, or restart `mssql-workspace` with the same
`--source` and `--state` paths. The owner acquires the existing workspace lease
before reopening its retained identity and work records. If the process stopped
between publishing a record and removing that record's staging link, the owner
completes that publication with the original bytes.

Workspace identity, review IDs, operation UUIDs and completed export records stay
the same. The browser and merchant tools can replay the original operation ID
and exact request body; an existing completed result reopens through the same
owner. Private input-file validation continues to apply to source files and
incoming packages.

## Attach merchant tools to the original owner

The source contribution registers both the SQL Server Application and the
mssql-workspaces merchant provider. Its setup, metadata and runtime remain here
in the SQL Server component. Inspect the installed registration with:

~~~sh
starforge registrations --source mssql
starforge merchant-providers inspect mssql-workspaces
~~~

Create a private connection JSON using the actual workspaceId returned above:

~~~json
{
  "schema": "stellar-forge.mssql-workspace-connection.v1",
  "workspaces": {
    "author": {
      "label": "SQL Server merchant",
      "workspaceId": "<workspaceId from the author workspace>",
      "consoleUrlFile": "/private/sqlserver-workspace/operator/connection.json"
    },
    "receiver": {
      "label": "SQL Server receiving workspace",
      "workspaceId": "<workspaceId from the receiving workspace>",
      "consoleUrlFile": "/private/sqlserver-receiver/operator/connection.json",
      "deliveries": {
        "incoming": {
          "directory": "/private/sqlserver-managed-receiving/merchant"
        }
      }
    }
  }
}
~~~

Use the original receiving workspace's own init result for its UUID. Every alias
pins one actual owner. consoleUrlFile may also select the original
Applications application-url.json; the reader validates its command, native
identity and live listener. Delivery aliases select existing host-owned private
receiving paths. An optional manifestSha256 fixes a delivery to one exact export.

Save the connection with mode 0600 under a private directory. The setup file is:

~~~json
{
  "directory": "/private/sqlserver-merchant-host",
  "connection": "/private/sqlserver-workspaces.json",
  "name": "SQL Server merchant"
}
~~~

~~~sh
starforge mssql-agent init --options /private/sqlserver-setup.json
starforge mssql-agent serve \
  --config /private/sqlserver-merchant-host/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

The existing merchant host reads its bearer token from the selected environment
variable and keeps its normal OAuth and operator-console options. Setup creates
an original SF82 store at the returned releaseStore path unless an existing store
was supplied in the setup JSON. Select that same store in the author Application
or its --release-store launch option. Repeating unchanged setup reopens its
original configuration.

The MCP attachment reads the same private URL file on each operation and checks
the live workspace, instance and profile before forwarding. The existing SQL
Server browser owns database queries and merchant processes. The merchant host
closes its attachment by draining accepted calls; Applications controls the
original workspace's process lifecycle.

| Operation | Original receiving behavior |
| --- | --- |
| merchant_mssql_workspaces / status | Select a host-declared alias and its exact workspace UUID. |
| merchant_mssql_catalog | Read the actual native catalog or selected schema-qualified table/view. |
| merchant_mssql_review / reviews / review_load | Compile actual columns, filters, ordering and prices; reopen the original choices. |
| merchant_mssql_preview | Execute the approved native query once and retain its exact result under the supplied operation UUID. |
| merchant_mssql_operations / operation | Page original requests and reopen their committed results, including native query output. |
| merchant_mssql_prepare / releases / release | Prepare and verify the complete original source and customer client. |
| merchant_mssql_stage | Stage into the same configured SF82 store; its existing tools handle compare, activate, run and settlement. |
| merchant_mssql_start / stop | Start the selected original seller or drain its exact current run ID. |
| merchant_mssql_export / exports | Retain and reopen a complete merchant or customer transfer. |
| merchant_mssql_export_manifest / export_file / export_file_release | Read original manifest-bound files through the maintained retained-file reader. |
| merchant_mssql_receive | Adopt the complete merchant from one host-declared receiving alias under the original release lease. |

Every scoped call carries workspace and workspaceId. Review, preview, prepare,
export and receive also carry a version-4 operationId. Repeat the same UUID and
unchanged input after a lost reply. The owner checks the retained request before
performing work and returns a committed result before opening another query.
A UUID used for different choices reports a conflict.

A direct host operator can use the same source-owned client without opening
another merchant host:

~~~sh
starforge mssql-agent call \
  --connection /private/sqlserver-workspaces.json \
  --tool merchant_mssql_reviews --input /private/selected-workspace.json
~~~

Here selected-workspace.json contains the same workspace alias and actual UUID.
The original tool catalog supplies each operation's complete input schema.

## Complete merchant and customer receiving

**Retain complete merchant** in the browser, or merchant_mssql_export with
kind merchant, captures the original workspace choices, complete prepared
package, optional CA and all generated client files. The immutable
Mssql_Transfer_Manifest.json records every path, byte count and SHA256.

**Retain customer files**, or kind customer, captures the original public
OpenAPI and the five generated client files. The customer can install and use
those original files directly. The existing browser client archive remains
available for an immediate single-file download.

Use the retained export ID and manifest SHA256 from the browser or merchant tool:

~~~sh
starforge mssql-download inspect \
  --url http://127.0.0.1:3211 \
  --workspace author --workspace-id ACTUAL_WORKSPACE_UUID \
  --export-id ACTUAL_EXPORT_UUID --token-env MCP_ACCESS_TOKEN

starforge mssql-download receive \
  --url http://127.0.0.1:3211 \
  --workspace author --workspace-id ACTUAL_WORKSPACE_UUID \
  --export-id ACTUAL_EXPORT_UUID \
  --expected-manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --directory /private/sqlserver-managed-receiving/merchant \
  --token-env MCP_ACCESS_TOKEN
~~~

Repeat the same selection and directory to resume. The original downloader
retains its private checkpoint and completed files, validates each byte and
digest, and reopens the original file at the saved offset when a read handle
expires or the workspace restarts. A transfer's file handles are scoped to that
exact export. The transfer stays available after the reader closes.

Select the corresponding receiving alias with merchant_mssql_receive and the
same expected manifest SHA256. The receiver verifies every transfer file,
the native package manifest and the original workspace choices before adopting
the release. It takes the original per-release lock and atomically publishes
the prepared directory. A matching existing release reopens; a different
original package under that release ID is rejected. Approved source connection
references and original public terms travel with the prepared package.

## One complete managed receiving operation

The installed mssql-managed-receive command attaches to the two already running
SQL Server workspaces and their existing merchant host. Supply the actual
approved choices from merchant_mssql_review_load's choices object in a private
JSON file. Preserve the source fingerprint and exact native payment terms.

The following receiving options use the aliases configured above:

~~~json
{
  "schema": "stellar-forge.mssql-managed-receiving.v1",
  "directory": "/private/sqlserver-managed-receiving",
  "connection": "/private/sqlserver-workspaces.json",
  "workspace": "author",
  "receiver": {
    "workspace": "receiver",
    "delivery": "incoming"
  },
  "choices": "/private/sqlserver-approved-choices.json",
  "mcpUrl": "http://127.0.0.1:3211",
  "tokenEnv": "MCP_ACCESS_TOKEN",
  "storeReleaseId": "catalog-managed-v1"
}
~~~

~~~sh
starforge mssql-managed-receive \
  --options /private/sqlserver-managed-receiving.json
~~~

The one original operation:

1. Verifies both actual browser owners and the merchant tool's selected listener.
2. Reads the native SQL Server catalog and reviews the approved source choices.
3. Executes the actual typed query through MCP. Its temporary loopback transport
   discards one completed preview reply; the original UUID then reopens the
   identical retained query result.
4. Prepares and reopens the original package, then stages it in the configured
   SF82 store.
5. Downloads every original merchant file and every customer file through the
   maintained resumable downloader.
6. Receives the complete merchant into the second original workspace and verifies
   its unchanged package, plan and choices.
7. Imports the downloaded original client, checks its bound OpenAPI and payment
   terms, starts the selected original merchant, and reads its actual unpaid 402
   contract. A merchant started by this operation is drained through its original
   run ID; an existing matching owner continues serving.

The private receiving directory contains the stable intent and operation UUIDs,
native catalog/version, reviewed choices, exact query result, response-loss
record, complete merchant and customer files, SF82 stage, received release,
customer response and receiving.json. Repeating unchanged options continues that
same operation and its original files. A failed stage records its exact source
error and preserves completed work. The source's original native query limits
and original review lifetime apply.

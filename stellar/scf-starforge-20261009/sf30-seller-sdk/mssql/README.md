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

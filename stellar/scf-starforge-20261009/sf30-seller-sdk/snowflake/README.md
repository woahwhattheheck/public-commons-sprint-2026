# Snowflake retained data workspace

Capture a declared read against an existing Snowflake account, retain its
complete original SQL API result, compare and review precise editions, and stage
the existing SQLite merchant/SF82 release. Customer reads use the reviewed
retained edition.

## Open the workspace

Requires the existing Node 22.16+ Linux runtime with native node:sqlite and flock.
Source capture and local operations use Node built-ins and existing Stellar
Forge modules. Native settlement uses the existing SF30 packages and configured
facilitator.

~~~sh
starforge snowflake serve --directory /private/snowflake-workspace
starforge snowflake-workspace --directory /private/snowflake-workspace
~~~

The installed command help, nine exported interfaces and original browser assets
are registered together in `distribution/contributions/snowflake.json`.
Inspect the same source-owned registration used by the pinned builder:

~~~sh
starforge registrations --source snowflake
starforge registrations --command snowflake-workspace
~~~

From source:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/snowflake/cli.mjs \
  serve --directory /private/snowflake-workspace
~~~

Open the printed private URL. The server binds 127.0.0.1; its fragment capability
becomes a same-origin request header. Source configuration, operation history,
original bytes, reviews and release operations require that capability. Keep the
command open; shutdown drains its owned source operations and closes its original
release/customer console.

Use **Source & capture** to author the connection context and named read queries.
The host provides the account URL and bearer through the environment variable
names in the configuration. Use the exact existing warehouse, database, schema
and role. Configure the existing OAuth, key-pair JWT or programmatic access token
on the host before capture. The workspace uses the selected existing account and
warehouse.

## Declare the source

This is an authoring example. Replace the table, context, columns and parameter
values with the selected existing source.

~~~json
{
  "schema": "stellar-forge.snowflake-source.v1",
  "label": "Reviewed account observations",
  "accountUrlEnv": "SF30_SNOWFLAKE_ACCOUNT",
  "tokenEnv": "SF30_SNOWFLAKE_TOKEN",
  "tokenType": "OAUTH",
  "context": {
    "warehouse": "EXISTING_WAREHOUSE",
    "database": "EXISTING_DATABASE",
    "schema": "EXISTING_SCHEMA",
    "role": "EXISTING_READ_ROLE"
  },
  "queries": {
    "observations": {
      "sql": "SELECT \"ID\", \"OBSERVED_AT\", \"AMOUNT\" FROM \"OBSERVATIONS\" WHERE \"ID\" = $id AND \"AMOUNT\" >= $minimum",
      "columns": ["ID", "OBSERVED_AT", "AMOUNT"],
      "keyColumns": ["ID"],
      "parameters": {
        "id": {"type": "string", "maxLength": 128},
        "minimum": {"type": "decimal", "precision": 38, "scale": 8}
      },
      "maxRows": 250000,
      "maxResultBytes": 268435456,
      "timeoutSeconds": 300
    }
  },
  "requestTimeoutMs": 30000,
  "maxPartitionBytes": 33554432,
  "pollIntervalMs": 1000
}
~~~

The account variable contains the existing HTTPS origin ending in
snowflakecomputing.com or snowflakecomputing.cn. The token variable contains the
host-held bearer. Configuration and exports contain their environment names.

Named $parameters are compiled with the original SF30 scalar and exact-decimal
binder. The original read is wrapped in an exact quoted column projection and a
maxRows + 1 limit. An oversized result is rejected while its observed original
response remains retained. Declare uppercase names for unquoted Snowflake output
aliases, or explicitly quote lowercase aliases in the read SQL.

Bindings use native FIXED integer strings, REAL finite-number strings, BOOLEAN
strings and TEXT values. Decimal input is a JSON string, remains text and is
explicitly cast to NUMBER(precision, scale), up to 38 digits. Declare nullable
parameters for SQL null. SQL literals and comments retain their text; only
declared parameter tokens are replaced.

Complete original result bodies and metadata are retained. Native values remain
strings or JSON null through capture and receiving. The derived SQLite records
table uses TEXT columns and SQL NULL. Empty strings, timestamps, VARIANT text,
large integers and exact decimals remain distinct and retain their original
representations.

## Original request and recovery

Capture creates a private journal entry before dispatch and prints the exact
request ID to stderr. The native POST uses that UUID with async=true. A returned
statement handle is retained; status and missing partitions use the same handle.

If the first POST outcome is uncertain, resume uses the same request UUID, body
and retry=true according to the native SQL API protocol. A received remote
operation with no known handle remains an imported operation.

Each complete decoded response is stored by SHA-256 and length before the
operation references it. Completion requires all ordered partitions, the exact
native row count and the declared total byte/row budgets. An unfinished receiving
stream cannot complete its edition. When the final partition and stream closure
are retained, reopening completes locally.

Provider 429/503 cooldown and Retry-After are retained. Explicit resume retries
the original operation after the selected credential or cached-result access is
restored. Cancellation addresses the existing statement and records the actual
native cancellation response. A missing statement remains a distinct state.

Use Operations to inspect the original request, body, context, handle and
paginated response observations. The Snowflake caller explicitly retains original
JSON error bodies for compilation/query failures; ordinary upstream callers keep
their existing behavior. The CLI exposes the same operation:

~~~sh
starforge snowflake source-save --directory /private/snowflake-workspace --source /private/source.json
starforge snowflake capture --directory /private/snowflake-workspace --query observations --input /private/arguments.json
starforge snowflake status --directory /private/snowflake-workspace --request-id ORIGINAL_UUID
starforge snowflake resume --directory /private/snowflake-workspace --request-id ORIGINAL_UUID
starforge snowflake cancel --directory /private/snowflake-workspace --request-id ORIGINAL_UUID
~~~

The original transport enforces compressed-wire and decoded body budgets, strict
origin handling and request lifetimes. Snowflake requests native 16 MB result
chunks; the default 32 MiB response cap leaves room for metadata. Operators may
declare up to 64 MiB per partition and 1 GiB per complete result. Larger captures
retain their original operation and rejection. Result-cache retention and account
query charges remain governed by the selected Snowflake account.

## Review, compare and publish

Edition identity uses the original account origin, request ID/body hash,
source/query declaration, native statement, metadata, output encoding and
complete ordered partition hashes. Receiving the same original result in a fresh
workspace preserves the edition ID. Local receipt kind, observation sequence
and receiving validation state remain local metadata.

Edition paging and comparisons use native SQLite. Declared unique keys identify
added, removed, updated and unchanged rows. Duplicate keys are reported.
Without keys, row multiset comparison preserves duplicate multiplicity.
Column metadata changes remain visible alongside data changes.

Record the reviewer, decision and reason for the exact edition. Merchant
preparation uses that accepted edition and the original SQLite workbench draft
contract:

~~~json
{
  "merchant": {
    "name": "Reviewed observations",
    "origin": "https://your-existing-merchant.example",
    "network": "stellar:testnet",
    "asset": "YOUR_CONFIGURED_ASSET",
    "payTo": "YOUR_EXISTING_RECEIVING_ADDRESS",
    "maxTimeoutSeconds": 60
  },
  "queries": [{
    "name": "observation",
    "method": "GET",
    "path": "/observations",
    "sql": "SELECT \"ID\", \"OBSERVED_AT\", \"AMOUNT\" FROM records WHERE \"ID\" = $id",
    "columns": ["ID", "OBSERVED_AT", "AMOUNT"],
    "parameters": {"id": {"type": "string", "maxLength": 128}},
    "publicInput": {"id": "DELIBERATE_PUBLIC_EXAMPLE"},
    "maxRows": 1000,
    "maxBytes": 917504,
    "timeoutMs": 1000,
    "description": "Reviewed original observations",
    "amount": "YOUR_ATOMIC_PRICE"
  }]
}
~~~

Set the actual origin, receiving terms, price and deliberately public input.
The original workbench inspects the native read queries and produces its existing
merchant files. SF82 stages its native SQLite backup, original service, offers
and handlers under the same retained publication ID.

The SQLite file also contains the exact original partition BLOBs, their hashes,
source declaration, original request and edition manifest. Those originals
travel with the native backup used by the existing release system.

~~~sh
starforge snowflake review --directory /private/snowflake-workspace --edition EDITION_ID \
  --decision ACCEPTED --actor REVIEWER --note "Actual review decision"
starforge snowflake prepare --directory /private/snowflake-workspace --edition EDITION_ID \
  --draft /private/merchant-draft.json --publication-id ORIGINAL_PUBLICATION_UUID
starforge snowflake console --directory /private/snowflake-workspace
~~~

The original SF82 console owns selection, activation, seller startup, rollback,
configured facilitator, native receiving and customer exports:

~~~sh
starforge releases status --store /private/snowflake-workspace/release-store
starforge releases console --store /private/snowflake-workspace/release-store
~~~

## Complete transfer and cloud delivery

Export writes a create-only private folder containing receiving.json,
edition.json and every original partition with exact length/SHA descriptors.
Use the CLI for files on a host, or select the whole folder in the browser.
Browser transfers verify and store partitions individually; selecting the same
manifest resumes its existing intake.

~~~sh
starforge snowflake export --directory /private/snowflake-workspace \
  --edition EDITION_ID --out /private/exports/original-run
starforge snowflake receive --directory /private/receiving-workspace \
  --manifest /private/exports/original-run/receiving.json
~~~

Add --cloud-scope /private/actual-cloud-scope.json to export the existing
stellar-forge.coinmetrics-cloud-input.v1 contract as cloud-delivery.json.
Supply the actual label, supported family, market, frequency, UTC start/exclusive
end, source description and entitlement. The browser provides the same optional
JSON field.

The manifest selects transport retained-snowflake, format snowflake-json,
the exact statementHandle and partition on every original file, and a complete
ordered snowflake-query coverage family. The existing DuckDB cloud-delivery
import/intake owns native inspection, selection, publication and recovery.

## Programmatic modules

- declaration.mjs: compileSnowflakeSource, compileSnowflakeQueries, statementBody.
- source.mjs: createSnowflakeOperations, inspectSnowflakePartition.
- store.mjs: openSnowflakeStore, snowflakeEditionId.
- edition.mjs: originalRows, materializeSnowflakeEdition, pageSnowflakeEdition,
  compareSnowflakeEditions, exportSnowflakeOriginals, readSnowflakeReceiving.
- workspace.mjs: openSnowflakeWorkspace.
- server.mjs: startSnowflakeWorkspace.
- publisher.mjs: prepareSnowflakeMerchant, openSnowflakeReleaseConsole.
- transfer.mjs: createSnowflakeTransfers, validateSnowflakeReceivingManifest.
- cloud-delivery.mjs: snowflakeCloudDeliveryManifest.

## Native protocol references

- [SQL API introduction](https://docs.snowflake.com/en/developer-guide/sql-api/intro)
- [Submitting and retrying requests](https://docs.snowflake.com/en/developer-guide/sql-api/submitting-requests)
- [Result partitions and response handling](https://docs.snowflake.com/en/developer-guide/sql-api/handling-responses)
- [SQL API reference](https://docs.snowflake.com/en/developer-guide/sql-api/reference)
- [Identifier case and quoting](https://docs.snowflake.com/en/sql-reference/identifiers-syntax)
- [CLIENT_RESULT_CHUNK_SIZE](https://docs.snowflake.com/en/sql-reference/parameters#client-result-chunk-size)
- [Native chunk size behavior](https://docs.snowflake.com/en/release-notes/bcr-bundles/2026_04/bcr-2319)

MIT; included in the original Stellar Forge distribution.

## Continue a saved merchant publication

The Merchant release page lists retained publications after restart. **Open publication** restores the exact edition, merchant terms, runtime and publication identity. The form shows saved values and offers **Resume saved publication** or **Reopen prepared release**. **New publication from these terms** creates an editable draft with a new identity while preserving the original publication.

The command line uses the same retained request:

```sh
starforge snowflake publication --directory /private/snowflake --publication-id SAVED_UUID
starforge snowflake resume-publication --directory /private/snowflake --publication-id SAVED_UUID
```

Continuation keeps the original accepted review binding and resumes the original SQLite workbench and SF82 release. The edition's current review must still be accepted. Saving another accepted review of the same immutable edition does not create a new publication. A running publication rejects a different request under the same identity.

## Managed application and complete receiving

[Snowflake in Applications](MANAGED.md) explains initialization, Review/Save/Start/Open/Stop, original workspace and source identity, and complete installed receiving through the native SQLite merchant and SF82 release. The source-owned provider is declared by the existing Snowflake contribution. The receiving program retains the same application, edition and publication through restart.

## Merchant agent operations and complete receiving

The source-owned [Snowflake merchant provider](merchant/README.md) connects this original browser and native writer to the shared authenticated Merchant MCP host. Its typed client and CLI operate source/capture/review/publication histories, resume original partition uploads, and download every selected original merchant file plus the native SQLite snapshot. The complete receiving command reopens the delivered edition through the original customer workspace and SF82 console.

Use `starforge merchant-snowflake --help` for operator commands, or `starforge merchant providers inspect snowflake-workspaces` for the original installed provider declaration. The existing workspace UUID and publication IDs remain the durable identities throughout managed and merchant operation.

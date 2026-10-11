# ClickHouse merchant

Expose an approved ClickHouse query through the original Stellar Forge merchant and deliver its result with the original customer client. This adapter provides native database preflight, typed request admission, exact text results, bounded analytical queries, a retained merchant folder, and the existing seller operations console. It uses Node's existing SF30 HTTP transport; no ClickHouse JavaScript driver is required.

The payment path is the maintained SF30 seller and native x402 SDK. The input rules, public offer compiler, customer SDK exporter, seller lifecycle and operations UI are reused from the original implementations. This folder adds the ClickHouse source adapter and its onboarding commands.

## Connect an existing analytical source

Use a dedicated database account with `SELECT` on the approved tables or views. Keep field/row authorization in those views and account grants. A caller-selected account filter is a query parameter, not an authenticated tenant identity. For customer-specific data, use the existing application's authorization or an appropriately restricted source view.

For example, the database administrator can grant an existing merchant principal access to one approved view:

```sql
GRANT SELECT ON analytics.approved_transfers TO merchant_user;
```

The adapter sends fixed `SELECT` wrappers using ClickHouse's HTTP interface. ClickHouse automatically applies `readonly=2` to ordinary non-POST HTTP requests when the account has no stricter setting. That mode still permits settings changes and some other commands; the database grants remain the access boundary. See [ClickHouse query permissions](https://clickhouse.com/docs/concepts/features/configuration/settings/permissions-for-queries).

Make the three environment variables named in the private source configuration available through the host's existing secret setup. `endpointEnv` resolves to the HTTPS ClickHouse HTTP endpoint, ending in `/`; an existing reverse-proxy prefix is supported. Credentials use `X-ClickHouse-User` and `X-ClickHouse-Key` headers, and the database uses `X-ClickHouse-Database`. Credentials never enter buyer requests, public offers, generated clients, source inspection or response errors. The ClickHouse server and its own operator logs retain their normal database behavior.

For a local database, set `allowLocal: true` and use an explicitly selected `http://127.0.0.1:PORT/`, `http://localhost:PORT/` or IPv6 loopback endpoint. HTTPS uses Node's normal certificate verification. No caller can choose the upstream endpoint or headers.

The [example source](examples/source.json) and [merchant plan](examples/merchant-plan.json) are usable starting documents. The optional [seed SQL](examples/seed.sql) creates a small in-memory demonstration dataset. Its rows are demonstration data; they are not Goldsky exports or chain transactions. Run it only in the selected local demonstration database. Replace the conspicuous demonstration payment identifiers in the plan with the actual complete terms before a customer deployment.

## Declare the product query

A source is `stellar-forge.clickhouse-source.v1`. Each named query supplies trusted SQL, explicit projected column names, parameter declarations, row/byte/deadline limits and a `probe` object. The probe provides actual valid values for startup metadata preflight. It stays in the private source file.

SQL templates use the shared SF30 `$name` parameter notation. The adapter translates each declared parameter into a native ClickHouse `{name:Type}` placeholder. Values travel separately as native `param_name` HTTP parameters, with ClickHouse Escaped serialization followed by URL encoding. SQL literals, comments and heredocs are retained. Every declared parameter must appear in the template, and undeclared placeholders or multiple statements are rejected. Alias projected columns to simple unique identifiers when source columns use spaces or punctuation. ClickHouse parses the actual query during preflight; the template linter is not a SQL sandbox.

| Input declaration | Native parameter | Contract |
| --- | --- | --- |
| `string` | `String` | Original length bounds and enum; valid Unicode; NUL rejected. Tabs, newlines, quotes and backslashes survive the native escaped-parameter encoding. |
| `integer` | `Int64` | Canonical signed 64-bit decimal text, or a safe integer JSON number. Use text for values outside JavaScript's safe integer range. |
| `number` | `Float64` | Finite JavaScript number, or original numeric text; ordinary binary floating-point conversion applies. |
| `boolean` | `Bool` | JSON booleans or the original `"true"` / `"false"` strings. |
| `decimal` | `Decimal(precision, scale)` | Exact decimal string; explicit precision 1–76 and scale 0–precision. Integer overflow or excess nonzero fractional digits are rejected before payment. Trailing fractional zeroes may be accepted without changing value. |
| Any type with `nullable: true` | `Nullable(...)` | JSON null is distinct from a literal string. The original default and enum rules still apply. |

The original exact-decimal validator enforces minimum, maximum and numeric enum comparisons without converting through JavaScript numbers. A `Decimal(20, 0)` parameter with bounds `0` and `18446744073709551615` can represent a full UInt64 cursor; the example uses this for `after_record_id`. Use `Decimal(p, p)` when no nonzero integer digits are permitted.

There may be 1–64 named queries, 1–64 projected columns and up to 48 parameters per query. The original transport's **8,192-character encoded URL budget** covers SQL, settings and all parameter values together. Admission checks that actual encoded request before payment. Very large SQL templates or long encoded values must be reduced to fit this transport contract.

The example uses a two-part `(ledger, record_id)` cursor and a stable ordering. For the next page, pass both values from the same last delivered row. This preserves later records within that ledger. Keep the other filters unchanged. Each call reads the current database; separate calls do not share a frozen snapshot. An immutable source view or retained dataset product is appropriate when the application requires frozen pagination.

## Prepare, inspect and start

Run these commands from `stellar/scf-starforge-20261009/sf30-seller-sdk` in the installed original source/runtime:

```sh
node clickhouse/prepare.mjs \
  --source /private/clickhouse-draft/source.json \
  --plan /private/clickhouse-draft/merchant-plan.json \
  --directory /private/clickhouse-ready

node clickhouse/start.mjs --directory /private/clickhouse-ready --inspect

node clickhouse/start.mjs --directory /private/clickhouse-ready \
  --port 8423 --operations-port 8424
```

Preparation is offline and creates a new private directory. It retains `source.json`, the reviewed `merchant-plan.json`, the original `service.json` and `bindings.json`, plus the original exported `openapi.json` and complete `client/` folder. Files use owner-only permissions. The source's credentials remain environment references. Move the entire folder and supply the same named environment variables on the destination host.

An `INCOMPLETE` marker remains if the process is interrupted before preparation finishes; the launcher refuses that partial folder. Prepare again into a new directory from the retained source and plan. Existing destinations are never overwritten. For an intentional query or price change, prepare a new directory, review it, then switch the existing operator-managed launch configuration.

`--inspect` authenticates to the actual database, obtains its version, and runs each query with `LIMIT 0` and its private probe. It prints actual native column types, the public parameter contract and configured limits, then closes. Every normal start performs this same schema preflight before opening the seller. During delivery, a changed native result schema is rejected with `QUERY_SCHEMA_CHANGED`.

The default launch serves the original HTTP 402 challenges. Enable the maintained payment path using the original installed x402 dependencies and your configured facilitator:

```sh
node clickhouse/start.mjs --directory /private/clickhouse-ready \
  --facilitator https://facilitator.example
```

The original seller binds to loopback for the host's existing HTTPS ingress. Startup prints the merchant URL, API docs, OpenAPI, health/readiness and operations URLs. `--no-operations` omits the operations listener. `--availability-dir` retains the original availability controls; `--max-in-flight` and `--drain-grace-ms` configure the original seller's lifecycle. SIGINT/SIGTERM drain that lifecycle and close the source. An explicitly selected local facilitator can use `--allow-local-facilitator` with an HTTP URL on `127.0.0.1`.

## Deliver through the existing buyer

Give the customer the generated `client/` folder and public API specification. Keep the source SQL and database credentials with the merchant. The exported module supports the original SF88 Node Buyer and its existing operator workspace; see [the maintained Node buyer guide](../../sf88-operator-buyer-cli/node/README.md) and the generated client's own README.

```js
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSellerClient } from './client/seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: '/opt/starforge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  stateDirectory: '/private/customer/buyer-state',
  operatorProfile: '/private/customer/operator-profile.json',
});
const client = createSellerClient({ buyer });
const result = await client.call('transfers', {
  body: { account: 'merchant-demo', after_ledger: '0', after_record_id: '0', minimum_amount: '0' },
}, { intentId: 'transfer-page-001', maxAtomic: '10000', acceptIndex: 0 });
const page = await result.json();
console.log(page.rows);
```

Use the actual configured public route, accepted payment option and an independent customer cap. The original buyer owns approval, durable reservation, signing, response saving and financial finalization. The ClickHouse adapter adds none of those mechanisms. The generated client also exports `buildRequest` for the maintained SF31 transport or another existing buyer integration.

Successful query responses use `stellar-forge.clickhouse-result.v1`: ordered `columns`, actual `columnTypes`, object `rows`, `rowCount`, `truncated`, `valueEncoding: "clickhouse-text"`, `nullEncoding: "json-null"` and `snapshot: "single-request"`. **Every non-null cell is a string**, including booleans, integers, decimals, timestamps and composite values. SQL null is JSON null. Decode a column according to its native type when your application needs a typed value; do not turn large integers or exact amounts into JavaScript numbers.

ClickHouse's `JSONCompactStrings` representation can spell SQL NULL as a printable string. The adapter requests an independent native `isNull` flag for each projected column in the same statement, then removes those private flags from the response. A literal `"ᴺᵁᴸᴸ"` or `"\\N"` therefore stays a string. Invalid UTF-8 output is refused by the original strict transport; project arbitrary binary data explicitly with ClickHouse `hex` or `base64` when that is the approved API contract.

## Query cost and operational behavior

| Limit | Default / allowed range | Enforcement |
| --- | --- | --- |
| Query `maxRows` | 100 / 1–1,000 | Native `LIMIT maxRows + 1`; one sentinel determines `truncated`. |
| Query `maxBytes` | 512 KiB / 1–896 KiB | Native result-byte setting, bounded transport and final JSON-byte check. Oversized results fail; no clipped successful JSON. |
| Query `timeoutMs` | 1,500 ms / 50–30,000 ms | Original HTTP deadline plus native `max_execution_time`. |
| Source `maxInFlight` | 8 / 1–64 | Source admission and original transport capacity. |
| Source `maxThreads` | 2 / 1–8 | Native per-query parallelism. |
| Source `maxMemoryBytes` | 256 MiB / 1 MiB–2 GiB | Native per-query memory setting. |
| Source `maxRowsToRead` | 1,000,000 / 1–1,000,000,000 | Native scan-row setting and final native statistics check. |
| Source `maxBytesToRead` | 64 MiB / 1 KiB–2 GiB | Native scan-byte setting and final native statistics check. |

The adapter requests `wait_end_of_query=1` and validates the complete JSON response, including native column metadata. It forces result, read and timeout overflow modes to `throw`, so its imposed limits do not inherit a profile's partial-result `break` mode. Native scan statistics are required and compared with the source budget; a completed block that exceeds it is refused with `QUERY_SCAN_LIMIT`. This check cannot undo work already performed by the database. Query limits can be checked in blocks or at cooperative execution points; configure the account's resource profile for its actual workload. If the account restricts setting changes, permit these specific settings in that existing profile before startup.

`cancel_http_readonly_queries_on_client_close=1` requests native cancellation when the original transport closes a read request. The source also cancels active HTTP lifetimes during close and waits for those local operations to finish. There is no automatic query retry or query queue. Public errors distinguish invalid input (422), source capacity (429), request timeout (504), and unavailable/invalid database delivery (503), without exposing native SQL error bodies.

Primary protocol references: [HTTP parameters, headers and response behavior](https://clickhouse.com/docs/concepts/features/interfaces/http), [JSONCompactStrings](https://clickhouse.com/docs/reference/formats/JSON/JSONCompactStrings), [disconnect cancellation](https://clickhouse.com/docs/reference/settings/session-settings/other#cancel_http_readonly_queries_on_client_close), and [settings for read-only clients](https://clickhouse.com/docs/clickstack/managing/production).

## Existing Goldsky customer workflow

[Goldsky Turbo supports ClickHouse sinks](https://docs.goldsky.com/turbo-pipelines/quickstart). A customer who already owns or is entitled to the relevant sink can expose an approved downstream view with this adapter: confirm the actual view and distribution rights, supply the merchant's SELECT account, choose the exact public query/terms, prepare the merchant, and hand over the generated client. This uses the customer's database endpoint and does not require another ingestion engine or a change to an existing commercial offer.

## Native integration exercised

The complete local flow used official ClickHouse **26.8.24.9**, original SF30/SF31, native x402 **2.28.0**, and the original generated client. Actual database output preserved UInt64 `18446744073709551615`, ledger `9007199254740993`, amount `123456789012345678901234567890.1234567`, microsecond timestamps, escaped Unicode, SQL null, a literal null marker, and `Decimal(4,4)`. Composite pagination retained the remaining row in the same ledger; the prepared source reopened with matching output.

The native merchant/buyer exercise made one unsigned request and one signed-envelope retry through an explicitly controlled local facilitator, delivered HTTP 200 with the exact database result, and rejected excess decimal scale before additional verification or settlement. The facilitator deliberately returned `LOCAL_ACCEPTANCE_NO_CHAIN`; the original buyer correctly classified its financial outcome as `PAYMENT_OUTCOME_UNKNOWN` / `INVALID_TRANSACTION_HASH`. This validates the database/merchant/buyer integration without claiming a blockchain transfer. The retained real testnet payment journey elsewhere in Stellar Forge remains the chain-payment evidence.

# OpenSearch merchant and search workspace

Turn an existing OpenSearch index into a paid search product using the maintained Stellar Forge seller, payment runtime, operations console and customer SDK. The merchant declares the indices, fields, native query and price. Customers supply only the declared typed parameters.

One customer call runs one point-in-time search and gathers its pages before the original seller releases the result. The same source powers the [search workspace](workspace/README.md), where the operator keeps query drafts, captures retained editions, compares documents, exports results and prepares a merchant folder. Source credentials stay in the host environment.

Agent hosts can use [merchant MCP](../../../../stellar-forge/mcp-merchant-operator/OPENSEARCH_WORKSPACE.md) to author and inspect queries, maintain relevance judgments, recover original operations and deliver retained result/report/customer files. Its private connection file selects the existing source, plan and workspace; the installed toolkit includes the same operator.

## Requirements

Use Node.js **22.16 or newer** with JSON.parse source-context support, and an existing **OpenSearch 3.3 or newer** cluster. The adapter uses native HTTP and Node TLS; it needs no OpenSearch client package. Paid delivery uses the original installed x402 packages and configured facilitator.

OpenSearch 3.3 introduced the PIT-only `_shard_doc` sort. This source explicitly adds `_index` and `_shard_doc` after the merchant's business ordering. The tuple disambiguates documents across indices and shards. Startup checks the actual distribution and version.

Supply an account with access to the declared indices, mappings, field capabilities, search, PIT creation, search and deletion of its own PITs. Keep customer-specific data access in the existing application's authorization and OpenSearch roles. A customer-selected filter is an input value; it is not an authenticated tenant identity.

## Prepare and start

Copy [source.json](examples/source.json) and [merchant-plan.json](examples/merchant-plan.json) into your private working folder. Set the environment variables named by the source through the host's existing credential setup.

`endpointEnv` resolves to an HTTPS endpoint ending in `/`. A configured reverse-proxy prefix is supported. Choose one explicit authentication declaration:

| Declaration | Environment references |
| --- | --- |
| `{"type":"basic","userEnv":"OPENSEARCH_USER","passwordEnv":"OPENSEARCH_PASSWORD"}` | Existing username/password |
| `{"type":"bearer","tokenEnv":"OPENSEARCH_TOKEN"}` | Existing bearer token |
| `{"type":"none"}` | Explicit anonymous access to the selected endpoint |

For a local development cluster, select `allowLocal:true` and an HTTP endpoint on `127.0.0.1`, `localhost` or `::1`. HTTPS uses ordinary certificate verification. Caller requests cannot change the endpoint or credentials.

Replace the example payment identifiers and public origin with complete merchant terms. From `stellar/scf-starforge-20261009/sf30-seller-sdk`:

~~~sh
node opensearch/prepare.mjs \
  --source /private/search-draft/source.json \
  --plan /private/search-draft/merchant-plan.json \
  --directory /private/search-ready

node opensearch/start.mjs --directory /private/search-ready --inspect

node opensearch/start.mjs --directory /private/search-ready \
  --port 8423 --operations-port 8424 \
  --facilitator https://your-facilitator.example
~~~

Preparation is offline. It creates a private source/plan, the original `service.json` and bindings, public OpenAPI and the complete generated `client/`. Existing directories are never overwritten. An `INCOMPLETE` marker prevents starting interrupted preparation. Prepare a deliberate query/price revision in a new folder and switch it through the existing release process.

`--inspect` reads the actual cluster version, field capabilities and stored-source projection mappings, then runs every named query's private probe as a native zero-row search. The probe checks successful shards and native timeout status using the same read permission as customer search. Normal startup performs this same preflight before opening the seller. Startup prints the original seller, docs and operations URLs. `--no-operations`, `--max-in-flight`, `--drain-grace-ms` and `--availability-dir` use the existing merchant lifecycle.

With no facilitator, the service advertises the original HTTP 402 challenges. Supply the configured facilitator for the maintained verify → query → settle → delivery flow.

## Declare the native search

The private source schema is `stellar-forge.opensearch-source.v1`. Each named query supplies exact index/alias names, a Query DSL object, typed parameters, projected source fields, business sort, limits and a private probe.

A parameter is a complete JSON value placeholder: `{"$param":"term"}`. Field names, query operators, ordering and indices are fixed by the merchant. Input strings are never substituted into JSON text. Undeclared or invalid inputs fail admission before the native payment path.

~~~json
{
  "indices": ["merchant-products"],
  "query": {
    "bool": {
      "must": [{"match": {"title": {"$param": "term"}}}],
      "filter": [{"term": {"available": {"$param": "available"}}}]
    }
  },
  "parameters": {
    "term": {"type": "string", "minLength": 1, "maxLength": 200},
    "available": {"type": "boolean", "default": true}
  },
  "fields": ["sku", "title", "price_cents", "available", "updated_at"],
  "sort": [{"updated_at": "desc"}],
  "pageSize": 100,
  "maxHits": 1000,
  "maxBytes": 917504,
  "timeoutMs": 15000,
  "probe": {"term": "pump", "available": true}
}
~~~

The shared SF30 scalar contract supports strings, signed 64-bit integers, finite numbers, booleans, enums, defaults, nullability and appropriate bounds. Use decimal text for integer inputs beyond JavaScript's safe range; their exact native numeric tokens are written to OpenSearch. General `number` inputs retain ordinary binary floating-point semantics.

Each projected field must have one mapped type across the selected indices. Business sort fields must be aggregatable. Missing/conflicting mappings prevent startup, and changed mappings during delivery fail the query through the original seller cancellation path. The adapter reads native mappings separately to reject disabled `_source`, mapping aliases, multi-fields and fields pruned from stored source. Use original source field names for projection; a sortable multi-field such as `title.keyword` can remain a business sort field while `title` is projected. The pinned mapping contract includes resolved index membership.

The merchant-plan schema is `stellar-forge.opensearch-merchant-plan.v1`. It uses the original public `publicOrigin`, `payment` or `paymentOptions` and `routes` shape. Each route supplies `id`, fixed `path`, GET/POST `method`, named `query`, `serviceName`, `description`, `parameterDescriptions` and public `example`. The [complete example](examples/merchant-plan.json) is ready to adapt. The existing compiler owns route collisions, public origins, Bazaar schemas and payment metadata.

## Customer delivery

Give the customer the public OpenAPI and generated `client/`. The original Node Buyer owns signing, approval, durable reservations and saved-response recovery:

~~~js
import { fileURLToPath } from 'node:url';
import { Buyer } from '@tokenjunkielabs/starforge-merchant/buyer/node';
import { createSellerClient } from './client/seller-client.mjs';

const buyer = new Buyer({
  runtimeDirectory: fileURLToPath(new URL('../', import.meta.resolve('@tokenjunkielabs/starforge-merchant/buyer/node'))),
  stateDirectory: '/private/customer/buyer-state',
  operatorProfile: '/private/customer/operator-profile.json',
});
const client = createSellerClient({ buyer });
const response = await client.call('product_search', {
  body: { term: 'pump', available: true },
}, { intentId: 'product-search-001', maxAtomic: '10000', acceptIndex: 0 });
response.raiseForStatus();
const result = await response.json();
console.log(result.hitCount, result.total, result.hits);
~~~

Use the configured route, accepted option and independent customer cap. One customer call receives the whole configured search; internal pages do not initiate separate payments. Reopening retained output uses the original buyer recovery flow.

The response schema is `stellar-forge.opensearch-result.v1`:

| Field | Meaning |
| --- | --- |
| `query`, `fields`, `fieldTypes` | Named product and original mapping contract |
| `source` | Native server version and cluster UUID fingerprint, preserving source identity across endpoint changes |
| `hits` | Projected `_source`, `_index`, `_id`, `_score`, native sort and exact-integer pointers |
| `hitCount` | Documents delivered |
| `total.value`, `total.relation` | Native exact count (`eq`) or lower bound (`gte`) |
| `truncated` | Matches exceed the configured product hit limit |
| `pages`, `snapshot` | Native page count and `point-in-time` isolation |
| `capturedAt` | Time result collection completed |
| `numberEncoding` | `unsafe-integer-decimal-text` |
| `snapshotReleased` | Native deletion of this PIT was confirmed |

A document's identity is the pair `[_index,_id]`. Equal IDs in different indices remain separate documents.

### Exact long values

Native unsafe integer tokens become decimal strings in customer results. Each hit's `exactIntegerPaths` lists JSON pointers relative to that hit identifying which values were native numbers. For example, `"/_source/ledger"` identifies a numeric ledger value, and `"/sort/0"` identifies a preserved native long sort value.

Ordinary strings receive no pointer. Internal `search_after` requests write the preserved tokens as JSON numbers. Workspace JSON exports retain strings and pointers; CSV presents their text. Native floating-point fields retain ordinary numeric semantics.

## Snapshot and operational behavior

PIT creation and search explicitly refuse partial results. The source requires every shard to succeed and rejects timeouts, early termination, duplicate cursors, changing totals or incomplete page sequences.

A configured product hit limit is represented separately: an extra native hit establishes `truncated:true`, and the first `maxHits` records are delivered. `track_total_hits` uses that same threshold plus one and preserves the native `eq`/`gte` relation. Both accumulated content and the final JSON response are checked against the byte limit.

Only the owned PIT is deleted. If release cannot be confirmed, `snapshotReleased:false` is retained, the snapshot has a short native expiry, and source status counts the pending release. Shutdown makes one release retry. This adapter does not automatically replay searches, payments or uncertain responses.

| Setting | Default | Allowed |
| --- | --- | --- |
| Named queries | — | 1–64 |
| Projected fields | — | 1–128 |
| Business sort fields | 0 | 0–8 |
| Page size | 100 | 1–1,000 |
| Product hit limit | 1,000 | 1–10,000 |
| Final result bytes | 896 KiB | 1–896 KiB |
| Whole search deadline | 15 s | 100 ms–30 s |
| Concurrent searches | 8 | 1–64 |

Native timeout enforcement and existing account resource settings determine how quickly the cluster can stop its own work after disconnection. The source cancels local HTTP requests and drains through the original seller lifecycle.

## Embedding

`readOpenSearchSourceFile(path)` validates configuration offline. `createOpenSearchQuerySource(config,{env})` performs native preflight and exposes `query(name,input,{signal})`, `route`, `describe`, `inspect`, `status` and `close`. Always close a source when finished.

`prepareOpenSearchSeller({sourceFile,planFile,directory})` exports the original customer bundle. `startOpenSearchSeller({directory,...})` starts the original seller and operations console.

## Primary protocol sources

- [PIT create/delete and permissions](https://docs.opensearch.org/latest/api-reference/search-apis/point-in-time-api/)
- [Native search](https://docs.opensearch.org/latest/api-reference/search-apis/search/)
- [Field capabilities](https://docs.opensearch.org/latest/api-reference/search-apis/field-caps/)
- [Stored-source mappings](https://docs.opensearch.org/latest/mappings/metadata-fields/source/)
- [Source fields and mapped fields](https://docs.opensearch.org/latest/search-plugins/searching-data/retrieve-specific-fields/)
- [PIT pagination](https://docs.opensearch.org/latest/search-plugins/searching-data/paginate/)
- [Sortable index metadata](https://docs.opensearch.org/latest/mappings/metadata-fields/index-metadata/)
- [Original shard/doc sort and native pagination cases](https://github.com/opensearch-project/OpenSearch/pull/18924)

The SCF distribution already includes the complete seller family. SF30 and SF88 remain the payment and buyer implementations.

# Valyu merchant and research workspace

This merchant connects a provider-controlled Valyu account to the maintained SF30 seller and SF88 customer workspace. It advertises one JSON operation, uses the original native x402 payment flow, performs one Valyu search, and delivers its operational record plus content the configured source agreement permits the customer to retain. The customer desk organizes queries, reviews the native purchase, collects the original saved response, annotates results, compares editions, exports the selection, and recovers the retained workspace.

The commercial deliverable is implementation and operation of this workflow in the customer's provider account. Valyu's standard platform agreement excludes resale or sublicensing of outputs. Use the account owner's actual source agreement for content delivery. See the [platform service agreement](https://www.valyu.ai/valyu-platform-service-agreement) and [acceptable use policy](https://www.valyu.ai/valyu-acceptable-use-policy).

## Integration contract

| Component | Contract |
| --- | --- |
| Merchant route | POST /research/search |
| Generated client operation | valyuSearch |
| Provider target | POST https://api.valyu.ai/v1/search |
| Provider authentication | Server-held x-api-key from provider.apiKeyEnv |
| Native payment | Original SF30 offer, native facilitator and exact Stellar requirements |
| Saved customer purchase | Original SF88 operation and exact response bytes |
| Private operations | Original Seller operations desk, traffic history and upstream snapshot |
| Delivery schema | stellar-forge.valyu-search-delivery.v1 |

Source filters are JSON request data. They cannot choose an egress URL, credential, or server delivery profile. The adapter uses the original SF30 buffered upstream transport, resolves the fixed provider hostname to public addresses, shares the native request's cancellation signal and makes one provider attempt.

The current source contract is [Valyu Search](https://docs.valyu.ai/api-reference/endpoint/search). Pinned implementation references are the official Python [request implementation](https://github.com/valyuAI/valyu-py/blob/b735d8df4f612b603a61cd0613807d3f89bc814f/valyu/api.py) and [response types](https://github.com/valyuAI/valyu-py/blob/b735d8df4f612b603a61cd0613807d3f89bc814f/valyu/types/response.py).

## Configure

Use Node 22 or later and the existing repository's native x402 dependencies. Run the following commands from stellar/scf-starforge-20261009/sf30-seller-sdk.

Create merchant-input.json with the account owner's public HTTPS origin, verified asset and recipient, native route fee, and provider policy. Replace the uppercase payment placeholders with the actual deployment values.

~~~json
{
  "publicOrigin": "https://research.example.com",
  "serviceName": "Valyu Research",
  "payment": {
    "scheme": "exact",
    "network": "stellar:testnet",
    "asset": "REPLACE_WITH_VERIFIED_SEP41_ASSET",
    "payTo": "REPLACE_WITH_VERIFIED_MERCHANT_RECIPIENT",
    "amount": "10000",
    "maxTimeoutSeconds": 60
  },
  "provider": {
    "apiKeyEnv": "VALYU_API_KEY",
    "defaults": {
      "search_type": "web",
      "max_num_results": 2,
      "included_sources": ["developers.stellar.org"],
      "url_only": true,
      "response_length": "short"
    },
    "limits": {
      "maxNumResults": 20,
      "maxPriceCPM": 30,
      "maxQueryBytes": 16000,
      "maxSources": 100
    },
    "timeoutMs": 60000,
    "maxRequestBytes": 65536,
    "maxResponseBytes": 8388608,
    "maxInFlight": 16,
    "deliveryProfile": {
      "schema": "stellar-forge.valyu-delivery-profile.v1",
      "id": "references-only",
      "mode": "handles-only",
      "agreementReference": null,
      "profileValidUntil": null,
      "retentionMode": "references",
      "contentValidUntil": null,
      "sources": [],
      "sourceUrlPrefixes": {}
    }
  }
}
~~~

For multiple accepted assets or networks, replace payment with paymentOptions, an ordered array of complete original payment objects. Each option retains its network, asset, recipient, amount and timeout together. The customer selects the corresponding original accept index and atomic cap.

~~~sh
node valyu/merchant-cli.mjs compile --input merchant-input.json --out seller-service.json
node valyu/merchant-cli.mjs inspect --config seller-service.json
~~~

Compile creates a new private file and refuses to overwrite an existing configuration. Inspect prints the public policy and native offer. Credential values stay in the server environment. Recompile after changing provider limits so the generated request schema and application admission agree.

There are two independent prices:

- payment.amount is the fixed merchant route fee, a positive decimal string in atomic Stellar asset units.
- request.max_price is Valyu's positive numeric CPM ceiling. provider.limits.maxPriceCPM is the merchant's permitted upper bound for that request field.
- provider.usage.totalDeductionDollars in each delivered record is the returned upstream charge. The saved native operation records the customer payment separately.

The adapter does not convert CPM into an atomic fee. The default merchant ceiling of 30 CPM is an explicit policy setting. The default 20-result limit can represent an account-approved allowance up to 100; enable that higher limit only for the corresponding account configuration. See the current Search contract and [pricing documentation](https://docs.valyu.ai/pricing).

## Run the original seller

A preview uses the real SF30 payment challenge and developer explorer:

~~~sh
node valyu/merchant-cli.mjs serve --config seller-service.json
~~~

The startup record contains the local seller URL, mode, operations URL, readiness endpoint, OpenAPI endpoint and generated customer module URL. Default listeners are 127.0.0.1:8423 and 127.0.0.1:8424. The original CHALLENGE_ONLY mode needs no Valyu key.

For the live route, make the existing Valyu credential available to the service process through its configured environment reference, then supply the actual native facilitator URL:

~~~sh
node valyu/merchant-cli.mjs serve --config seller-service.json \
  --facilitator https://facilitator.example.com \
  --history-dir /absolute/private/valyu-traffic \
  --availability-dir /absolute/private/valyu-availability
~~~

Publish the seller through the operator's HTTPS reverse proxy at publicOrigin. Keep the operations listener private. Both preview and live startup reuse startSellerService and startSellerOperations. Graceful shutdown drains the original seller, checkpoints operations history and closes provider work.

Existing deployments can load application.mjs through the original operations launcher. VALYU_MERCHANT_CONFIG identifies the same compiled configuration supplied to --config:

~~~sh
VALYU_MERCHANT_CONFIG=/absolute/private/seller-service.json \
node operations/launch.mjs --operations-port 8424 \
  --history-dir /absolute/private/valyu-traffic -- \
  --config /absolute/private/seller-service.json \
  --handlers /absolute/source/sf30-seller-sdk/valyu/application.mjs \
  --facilitator https://facilitator.example.com
~~~

The dedicated merchant launcher additionally attaches provider counters at the original operations /api/upstreams endpoint. These measure attempts, accepted responses and provider failures. Completed native payments remain in original seller traffic and customer operation records.

Trusted hosts can import startValyuMerchant({config, port, operationsPort, facilitatorUrl, historyDirectory, availabilityDirectory}) from merchant-cli.mjs. It returns {session, operations, adapter, provider, close}. A host-owned nativeFactory can replace facilitatorUrl when the host already composes the original facilitator. CLI flags include --max-in-flight, --drain-grace-ms and explicit --allow-local-facilitator for the existing local development transport.

## Customer desk

The running seller exposes /_seller/docs, /_seller/openapi.json and /_seller/client/seller-client.mjs. The generated operationId is valyuSearch.

Initialize the customer desk with that original generated client, the existing SF88 operator profile, and the same public provider object used by the merchant:

~~~sh
node valyu/run.mjs init --state-root /absolute/private/valyu-research \
  --seller-client /absolute/private/seller-client.mjs \
  --operator-profile /absolute/private/operator-profile.json \
  --operator-directory /absolute/private/original-buyer \
  --provider-config /absolute/private/provider.json
node valyu/run.mjs serve --settings /absolute/private/valyu-research/settings.json
~~~

provider.json contains the provider object from seller-service.json. Use the settings path returned by init. The industrial desk keeps the query, provider ceiling, native purchase review, collected response, annotations and immutable editions together. node valyu/run.mjs --help lists CLI counterparts for requesting, preparing, reviewing, executing, collecting, comparing, exporting and backing up the workspace.

The original generated-client request is:

~~~js
client.request('valyuSearch', { body: input }, {
  intentId: 'valyu-' + query.id,
  maxAtomic,
  acceptIndex,
  paymentFlow: 'authorization',
});
~~~

maxAtomic and acceptIndex control the native customer payment. They do not override the provider account or delivery profile.

## Search options

normalizeValyuRequest(input, {defaults, limits}) validates and freezes the exact normalized snake_case JSON request. Unknown fields fail admission before the paid application executes.

| Field | Validation |
| --- | --- |
| query | Nonblank Unicode text within maxQueryBytes |
| search_type | all, web, proprietary, news |
| max_num_results | Integer from 1 through merchant maxNumResults |
| max_price | Positive finite number within maxPriceCPM |
| relevance_threshold | Number from 0 through 1 |
| is_tool_call | Boolean |
| included_sources | Domains, URLs, provider/dataset names, collections, web or documented presets |
| excluded_sources | Domains, URLs, provider/dataset names, collections or web |
| country_code | Provider-supported code, normalized uppercase |
| response_length | short, medium, large, max or positive integer character limit |
| source_biases | Domain/path keys with integer values from -5 through 5, or null |
| instructions | Nonblank text, at most 500 characters |
| category | Supported legacy text, at most 500 characters |
| start_date, end_date | YYYY-MM-DD; timezone ISO timestamps when historical_cache is true |
| historical_cache | Boolean |
| historical_cache_strict | off, prefer, only; original provider semantics |
| fast_mode | Boolean; incompatible with proprietary search |
| url_only | Boolean; requires web or news |
| include_abstracts | Boolean |

Start dates cannot follow end dates. maxSources bounds source arrays and bias entries. The configured request byte cap is at most 64 KiB. Native and provider byte limits are checked against one another at launch.

## Delivery and source permissions

Projection occurs in adapter.mjs before the successful response enters the original SF30 resource handler. SF88's saved response, editions and backups therefore contain only the projected delivery.

The default handles-only profile retains the customer-authored request, provider transaction ID, numerical usage, actual HTTP status, separate error-present and warning-count signals, original response SHA-256, and generated occurrence handles. Each withheld occurrence has exactly occurrenceId and contentDisposition. The handle identifies a position in one hashed upstream response.

Current AUP Section 7 treats restricted partner content, citations and metadata as transient. The standard documents also defer open-access and web caching to the applicable documentation. A request-only or timed content grant therefore yields handles in this immutable workflow.

An existing durable source grant can be configured as:

~~~json
{
  "schema": "stellar-forge.valyu-delivery-profile.v1",
  "id": "customer-agreement-1",
  "mode": "licensed-sources",
  "agreementReference": "NONSECRET_REFERENCE_TO_EXISTING_AGREEMENT",
  "profileValidUntil": null,
  "retentionMode": "durable",
  "contentValidUntil": null,
  "sources": ["web"],
  "sourceUrlPrefixes": {
    "web": ["https://developers.stellar.org/docs/"]
  }
}
~~~

This example describes configuration shape; use source names and URL scopes actually covered by the account owner's agreement. The agreement must cover the complete retained result, including metadata and structured fields. The authenticated Valyu [datasource catalog](https://docs.valyu.ai/api-reference/openapi.json) supplies datasource identifiers and provider/license metadata for that account join.

sources contains exact source names without wildcards. Web results commonly use the broad source label web. sourceUrlPrefixes narrows each listed source to canonical returned URL origins and path boundaries. Web or news rows without an explicit URL scope are withheld. Other source names can also be narrowed by URL scope. The projector checks the returned row, not the customer's included_sources filter.

profileValidUntil gates new durable deliveries under that profile. It does not expire already retained bytes. contentValidUntil is a content-retention expiry: whenever set, raw content is withheld. Request and cache modes also yield handles. Only a current durable profile with no content expiry can retain its permitted rows.

The delivered envelope is:

~~~text
schema: stellar-forge.valyu-search-delivery.v1
request: normalized customer request
receivedAt: capture timestamp
provider:
  txId, success, httpStatus, upstreamSha256
  errorPresent, warningCount
  usage: totalDeductionDollars, totalCharacters, resultCount
delivery:
  profileId, mode, agreementReference, retentionMode
  validUntil: null
  profileValidUntil, retainedResultCount, withheldResultCount
results:
  { occurrenceId, contentDisposition: "withheld" }
  or
  { occurrenceId, contentDisposition: "durable", result: complete provider row }
warnings: local operational codes
~~~

Authorized content preserves the full native union: text, an object, or an array of objects, plus citations, metadata and future fields. upstreamSha256 hashes the complete original provider bytes before projection. SF88 separately hashes its exact saved delivery bytes.

assertValyuDelivery(value, {profile, request, upstreamSha256}) is the shared persistence validator. It checks the closed operational envelope, occurrence positions, counts, warning codes, withheld-row field limits and durable retention semantics. A supplied trusted profile additionally verifies exact source and returned-URL scope. The research and workspace layers use this assertion before retained export.

## Outcomes and resource bounds

| Provider outcome | Native merchant behavior |
| --- | --- |
| HTTP 200 or 206, success:true | Validate, project and preserve actual status through native success |
| Successful empty result | Successful zero-result operational record |
| Success with warning | errorPresent, warningCount and local warning code |
| success:false, including HTTP 200/206 | Sanitized 502 with original status, transaction ID and hash |
| Authentication or provider payment failure | Original transport's sanitized 502 |
| HTTP 429 or 503 | Original failure status and valid Retry-After |
| Other provider request failure | Original sanitized failure semantics |
| Redirect, invalid UTF-8/JSON, excess bytes or invalid result fields | Failure before native settlement |

The original buffered transport enforces compressed and decoded byte limits. The default response cap is 8 MiB; configuration supports the native maximum of 16 MiB. Complete permitted results are preserved within the chosen bound. Timeout and cancellation abort the single provider attempt.

Provider charges and customer settlement have separate lifecycles. The account may incur a provider charge before a later customer transport failure. Reconcile its upstream transaction with the original native saved operation.

Use original seller readiness, operations history, native purchase inspection and response collection for the specific operation. The durable workflow unit is the customer's query, original purchase, permitted delivery and curated edition.

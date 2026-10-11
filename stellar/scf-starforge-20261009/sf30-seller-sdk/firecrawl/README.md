# Firecrawl research provider and customer workspace

This module turns an explicitly priced Firecrawl search or page read into an original Stellar Forge seller operation, then carries the customer's exact request and retained response through research review, collection editions, export and recovery. It uses the maintained SF30 seller/upstream adapter, SF88 Buyer and the original encrypted workspace recovery engine.

The operator interface is a private, neutral research desk. It keeps saved requests, source groups, provider metadata, working notes, comparison results and frozen handovers in one workspace. Preparing a customer request retains its original buyer intent. Execution stays with the existing buyer terminal and its selected operator.

## Operations

| Customer operation | Merchant route | Firecrawl source | Retained result |
| --- | --- | --- | --- |
| `firecrawl-search` | `POST /research/search` | `POST /v2/search` | Original web, news and image groups, URLs, descriptions, dates and metadata |
| `firecrawl-search-content` | `POST /research/search-content` | `POST /v2/search` with fixed Markdown/link scraping | Search groups plus exact returned page content |
| `firecrawl-read` | `POST /research/read` | `POST /v2/scrape` | One selected public page, its Markdown, links and metadata |

Search supports query, result limit, web/news/images, mutually exclusive include/exclude hostname lists, location, two-letter country, time filter and highlights. The result limit is **per selected source**. Defaults allow ten results per source, three sources, a 60-second source timeout, a 1 MiB response and four concurrent requests per upstream binding. The provider can lower those limits.

The request contract fixes `domainTools:false`. Content operations use `formats:["markdown","links"]` and `onlyMainContent:true`. A customer cannot supply arbitrary source credentials, custom backend headers, another upstream origin or an alternate payment flow through these request bodies. Page reads accept an ordinary public HTTP(S) URL; IP literals, credential-bearing URLs, private hostnames, fragments and custom ports are refused by the product contract.

The exact current parameter meanings come from Firecrawl's [search reference](https://docs.firecrawl.dev/api-reference/endpoint/search), [search guide](https://docs.firecrawl.dev/features/search) and [scrape reference](https://docs.firecrawl.dev/api-reference/endpoint/scrape).

## Install with the maintained runtime

Keep this directory at:

```text
stellar/scf-starforge-20261009/sf30-seller-sdk/firecrawl/
```

Use the original repository runtime and dependency setup. The exercised runtime was Node 24.19.0 with the original x402 packages at 2.28.0 and Stellar SDK 16.3.1. The customer store uses Node's built-in SQLite module; the original buyer and recovery commands also use their existing Python/runtime dependencies.

A separate checkout can select an existing complete runtime through `FIRECRAWL_RUNTIME_ROOT`, pointing to its `stellar/scf-starforge-20261009` directory. This is a runtime source reference; the product does not install or copy the SDK.

The configured-workspace join requires the matching maintained `node/workspace.mjs`, `python/bridge.mjs` and `queue.mjs`. The native exercise adopted their exact released versions at `b9d838838cfc75bd3a920a1c304b13da4963f2e4`. Use a coherent repository revision rather than combining a new Node client with an older bridge.

From the repository root:

```sh
SCF_ROOT="$(pwd)/stellar/scf-starforge-20261009"
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" --help
```

## Provider configuration and startup

Copy `example-product.json` to the provider's private configuration directory. Replace its demo asset, recipient and prices with the provider's reviewed payment terms. Set `publicOrigin` to the actual merchant's HTTPS origin when generating customer offers. The three prices are atomic units of the selected asset; they are separate from Firecrawl credits.

For an existing Firecrawl service account, select:

```json
{
  "mode": "account",
  "apiKeyEnv": "FIRECRAWL_API_KEY"
}
```

The provider's service manager supplies the named environment variable. The adapter forms the Authorization header in memory; the product JSON contains only the variable name. The shipped public-starter mode follows the current documented starter contract and was used for the real source exercise. Standard service keys and Firecrawl platform keys have different product contracts; see [Firecrawl for platforms](https://docs.firecrawl.dev/firecrawl-for-platforms).

Compile into a new private output directory:

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" compile \
  --product /srv/firecrawl/config/product.json \
  --out /srv/firecrawl/config/compiled-001
```

The command retains the exact product JSON, original seller-service configuration and original upstream bindings. It does not contact Firecrawl.

A challenge-only preview uses the actual original seller's offers and developer portal:

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" preview \
  --product /srv/firecrawl/config/product.json \
  --port 8423
```

To compose the original seller and operations/history UI, use its maintained launcher and this module's explicit handler exports:

```sh
export FIRECRAWL_PRODUCT_CONFIG=/srv/firecrawl/config/compiled-001/product.json

node "$SCF_ROOT/sf30-seller-sdk/operations/launch.mjs" \
  --history-dir /srv/firecrawl/history \
  -- \
  --config /srv/firecrawl/config/compiled-001/seller-service.json \
  --handlers "$SCF_ROOT/sf30-seller-sdk/firecrawl/application.mjs" \
  --facilitator https://YOUR-SELECTED-FACILITATOR \
  --availability-dir /srv/firecrawl/availability \
  --port 8423
```

The facilitator URL is selected by the provider. The example token is a replacement point, not a deployed service. Omitting `--facilitator` selects the original challenge-only mode. Both original listeners bind to loopback; use the provider's existing HTTPS ingress for the merchant origin.

The Firecrawl-specific application is the handler entry point. Launching only the compiled generic upstream bindings would omit this product's request transformation and admission contract. The original seller runs admission before authorization and settlement; invalid requests do not consume a source call.

For embedding in an existing service, `createProduct(product)` returns `config`, `handlers`, `snapshot()` and `close()`. Pass `config` and `handlers` to the maintained `startSellerService`. Close the original seller after its work drains, then close the product. The standalone `preview` command already performs both steps.

## Retain the merchant's generated customer client

Use the original SF30 developer portal or `developer/client-export.mjs` to export a client from the merchant's actual saved OpenAPI document. The same API used in the native exercise is:

```js
import {exportSellerClient} from
  './stellar/scf-starforge-20261009/sf30-seller-sdk/developer/client-export.mjs';

await exportSellerClient({
  openapi: '/srv/firecrawl/merchant-openapi.json',
  out: '/srv/firecrawl/new-generated-client'
});
```

The original exporter writes its standalone client, TypeScript declarations, exact OpenAPI source, package metadata and README. Initialization retains the client bytes and their SHA inside the customer workspace.

## Customer initialization

Create or select the existing [SF88 operator workspace](../../sf88-operator-buyer-cli/README.md) for the merchant's actual network, asset, recipient and payment flow. Its per-request cap and original total/daily policy still apply. Put that operator below the new canonical private customer root so complete recovery can retain it.

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" init \
  --state-root /srv/firecrawl-customer \
  --operator-directory /srv/firecrawl-customer/operator \
  --seller-client /srv/firecrawl/new-generated-client/seller-client.mjs

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" serve \
  --settings /srv/firecrawl-customer/settings.json \
  --port 8430
```

Initialization can use a private root that already contains that operator. It creates customer filenames once and does not replace existing settings, research, buyer, client or profile files. The retained profile contains selected original configuration references; operator key custody remains in the original workspace.

Open the local URL printed by `serve`. Its fragment token selects the private desk. The browser removes that fragment from the visible URL and retains the token only in its session storage. API calls require the token and matching host/origin.

### Request, prepare, execute and collect

The browser supports exact query planning, saving, duplication into a new request, preparation, inspection and reading an existing outcome. It does not have a payment-execution endpoint. The original buyer terminal performs execution using the reviewed saved request.

A request file has this shape:

```json
{
  "title": "Primary Stellar documentation",
  "operation": "firecrawl-search-content",
  "input": {
    "query": "Stellar smart contracts documentation",
    "limit": 1,
    "sources": ["web"],
    "includeDomains": ["developers.stellar.org"]
  }
}
```

CLI equivalents:

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" request \
  --settings /srv/firecrawl-customer/settings.json \
  --input /srv/firecrawl-customer/request.json

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" prepare \
  --settings /srv/firecrawl-customer/settings.json \
  --id QUERY_ID --revision 1 --max-atomic 30000 --accept 0

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" review \
  --settings /srv/firecrawl-customer/settings.json --id QUERY_ID

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" execute \
  --settings /srv/firecrawl-customer/settings.json --id QUERY_ID

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" collect \
  --settings /srv/firecrawl-customer/settings.json --id QUERY_ID
```

Choose the cap and payment-option index against the installed merchant's real offer. Preparation records the exact body, ordinary headers, endpoint, client source identity, operator workspace and cap under one stable intent. Once preparation starts, its inputs are immutable. A retry of interrupted preparation must match the same selection; it opens an already retained original intent where appropriate.

`inspect` and `collect` reconcile that original operation. They do not start another purchase. A native result enters the research store only when the original buyer reports a saved response and verifies its bytes. Request/body/config identities and the native delivery/accounting result remain attached.

## Research review and frozen handover

Open a retained request to inspect its web, news and image groups. Returned images are represented by their source links; the desk does not fetch them automatically. Markdown and original metadata are displayed as text.

Select sources, write notes and tags, then add the retained responses to a collection. These are independent records:

| Record | What changes | What remains retained |
| --- | --- | --- |
| Draft request | Title and exact query options under revision control | The current request revision |
| Captured response | A later explicit response may become the request's current capture | Every retained response's exact bytes and SHA |
| Source annotation | Selection, note and tags under revision control | Its current revision in each frozen edition |
| Collection | Title, brief and response membership | Previous frozen editions |
| Frozen edition | Create a new edition for later changes | Exact queries, response bytes, source selection, notes and identities |

Collection freeze checks both the collection revision and a selection digest that includes source annotations. Concurrent selection changes require a fresh review; they cannot silently change the accepted handover. Later working notes do not rewrite an earlier edition.

Exports:

- **JSON** is the complete frozen collection. `responseBase64` retains each original response byte-for-byte, beside its SHA, query, provenance and annotations.
- **HTML** is a standalone readable handover of selected sources and notes. Source text is escaped; it is not executed as HTML.
- **CSV** contains selected source rows and notes with spreadsheet formula escaping.

The comparison view matches source occurrences within their result group and identifies added, removed and changed title, description, date or content. It compares the two saved provider responses; it makes no fresh search.

### Provider observation intake

An operator may also import its already retained actual Firecrawl source response. This records `PROVIDER_OBSERVATION` and its source provenance, independently of buyer accounting.

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" import-observation \
  --settings /srv/firecrawl-customer/settings.json --id QUERY_ID \
  --response /srv/firecrawl-customer/intake/response.json \
  --request /srv/firecrawl-customer/intake/source-request.json \
  --provenance /srv/firecrawl-customer/intake/capture.json
```

The source request must equal this product's exact transformed request. Provenance includes `url`, `status:200`, `capturedAt`, response `sha256` and `requestSha256`. The importer verifies those hashes and the expected Firecrawl endpoint. It cannot overwrite a query whose buyer preparation has begun, including when preparation races with input-file reads.

## Complete original recovery

The recovery selection includes the original operator, buyer records, research database, actual settings, generated client and profile below the canonical customer root. The original software/runtime remains an installed dependency.

Stop writers to the customer workspace, then inspect the exact original selection:

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" backup-review \
  --settings /srv/firecrawl-customer/settings.json

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" backup \
  --settings /srv/firecrawl-customer/settings.json \
  --out /srv/firecrawl-recovery/archive-001 --quiesced \
  --pass-env SF88_BACKUP_PASSPHRASE
```

Supply the passphrase through the original private process environment. The command checkpoints and closes the research database before invoking the maintained recovery engine. Retain the returned record SHA separately with the archive.

```sh
node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" verify \
  --bundle /srv/firecrawl-recovery/archive-001 \
  --record-sha RETURNED_RECORD_SHA --pass-env SF88_BACKUP_PASSPHRASE

node "$SCF_ROOT/sf30-seller-sdk/firecrawl/run.mjs" restore \
  --bundle /srv/firecrawl-recovery/archive-001 \
  --record-sha RETURNED_RECORD_SHA --pass-env SF88_BACKUP_PASSPHRASE
```

Restore uses the original canonical location and refuses populated receiving state. It does not substitute another destination into signed records. Reopen the restored `settings.json`, inspect the original intent and collect its existing result before deciding on any further acquisition.

## Failure handling and operational limits

Input and mapping changes invalidate their current selection. Stale query, annotation or collection writes are refused with a conflict. A prepared request keeps its body and operator binding across process restarts.

Exports are staged, fsynced and published create-only in the selected private destination. Interrupted writing cannot leave a partial final export that looks complete. If publication succeeds but the following directory sync fails, the command reports the already published path, byte count and SHA with `PUBLISHED_DURABILITY_UNCONFIRMED`.

Source responses are bounded before retention. A frozen collection is bounded to 64 MiB of encoded content. Page lists are paginated and collection membership reads metadata instead of reparsing all response bodies. Native request and service shutdown remain under the original buyer/seller controllers.

Firecrawl source credits and Stellar customer payment are separate accounts. Current Firecrawl documentation describes its existing Base x402 route; this module is a provider-operated Stellar integration proposal. Partnership and account terms remain with the provider's actual agreement.

## Validation and source

[Source and completed validation](SOURCE_AND_VALIDATION.md) records the exact primary contracts, maintained engine join and completed native/customer/recovery exercise. The implementation does not ship private operator state, response bodies, credentials or browser captures into this source directory.

# OpenAlex merchant and operator

Expose selected OpenAlex metadata operations through the original SF30 seller, export its generated client, and deliver complete research editions through the [SF88 research workspace](../../sf88-operator-buyer-cli/research/README.md).

The operator chooses the provider account, shared request budget, products, and complete payment options. The provider handler preserves the selected OpenAlex request, response bytes, source URL, and returned credit headers. The research workspace retains successive pages, review decisions, comparisons, reports, CSVs, and bibliographies.

## Runtime and account setup

Run commands from `stellar/scf-starforge-20261009` using the existing project runtime and dependencies. Proxy-backed operation uses the explicit Node HTTPS Agent `proxyEnv` option, available in Node 22.21+ and 24.5+. Direct-network use follows the existing SF30 runtime requirements. [Node Agent proxy support](https://nodejs.org/download/release/latest-v24.x/docs/api/http.html#built-in-proxy-support)

OpenAlex accepts an API key in the Authorization header. Store the key in the process environment and put only its environment-variable name in the merchant configuration. An anonymous account can be configured by omitting `apiKeyEnv`. Obtain and inspect the account's current quota in [OpenAlex API settings](https://openalex.org/settings/api). [Authentication and response headers](https://help.openalex.org/api/authentication/)

Use one stable `provider.account` label and the same `--budget-dir` for every local process sharing that OpenAlex account. Keep the budget directory, original buyer profiles, and retained operations outside the repository.

## Configure the products

Create a regular UTF-8 JSON file named `merchant.json`. This example declares one paged works product. Replace the public origin, provider label, budget, and payment terms with the operator's actual choices.

~~~json
{
  "schema": "stellar-forge.openalex-merchant.v1",
  "title": "Research metadata",
  "publicOrigin": "https://research.example.com",
  "provider": {
    "account": "research-account",
    "apiKeyEnv": "OPENALEX_API_KEY"
  },
  "budget": {
    "creditsPerDay": 1000,
    "requestsPerSecond": 5
  },
  "timeoutMs": 30000,
  "maxResponseBytes": 16777216,
  "products": [
    {
      "id": "researchWorks",
      "path": "/research/works",
      "entity": "works",
      "kind": "list",
      "requireFilter": true,
      "description": "A page of works matching the selected research query",
      "paymentOptions": [
        {
          "scheme": "exact",
          "network": "stellar:testnet",
          "amount": "REPLACE_WITH_POSITIVE_INTEGER_BASE_UNITS",
          "asset": "REPLACE_WITH_SELECTED_SEP41_ASSET",
          "payTo": "REPLACE_WITH_MERCHANT_RECIPIENT",
          "maxTimeoutSeconds": 300
        }
      ],
      "example": {
        "search.title_and_abstract": "greenhouse AND \"heat pump\"",
        "per_page": "100",
        "cursor": "*",
        "select": "id,doi,title,display_name,publication_year,publication_date,type,language,cited_by_count,authorships,primary_location,open_access,topics,keywords,funders,awards,biblio,is_retracted,updated_date"
      }
    }
  ]
}
~~~

The uppercase payment values are required substitutions. The native seller accepts one to sixteen complete options. Preserve each option's scheme, network, asset, recipient, amount, and timeout together:

| Field | Meaning |
| --- | --- |
| `scheme` | `exact`, using the existing verified SF30 payment flow. |
| `network` | Explicit `stellar:testnet` or `stellar:pubnet`. |
| `amount` | A positive integer string in the selected asset's base units, within the Soroban signed i128 range. |
| `asset` | The selected SEP-41 asset used by the original native payment integration. |
| `payTo` | The merchant's chosen recipient. |
| `maxTimeoutSeconds` | Integer from 1 to 86,400. |
| `extra` | Optional metadata accepted by the original SF30 payment schema. |

The seller price is chosen by the operator. OpenAlex credit usage is a separate provider-account expense; the code retains both in their respective native records.

A configuration supports up to 32 fixed product paths. Each product selects an entity from works, authors, institutions, sources, topics, funders, publishers, or awards. Use `kind: "list"` for paged or grouped metadata and `kind: "entity"` for a selected OpenAlex ID. An entity product requires an `id` in its example and may accept `select`. Each product needs its own unique ID and fixed path.

For list products, `requireFilter: true` requires a filter or search. The public origin is an HTTPS origin without a path. The provider origin is fixed to `https://api.openalex.org`.

## Review and export the exact merchant

~~~bash
node sf30-seller-sdk/openalex/cli.mjs review \
  --config /private/openalex/merchant.json

node sf30-seller-sdk/openalex/cli.mjs export \
  --config /private/openalex/merchant.json \
  --out /private/openalex/export-v1
~~~

The review prints the compiled product routes, complete payment choices, provider identity, input hash, and budget. Export retains:

| File | Purpose |
| --- | --- |
| `merchant.json` | The compiled configuration with defaults made explicit. |
| `review.json` | Operator-readable products, source settings, and payment options. |
| `seller-openapi.json` | Original seller OpenAPI document for the configured products. |
| `client/seller-client.mjs` and declaration/package files | Original generated buyer client and its complete product contract. |
| `export-plan.json`, `manifest.json` | Export identity and file hashes, including the original client-export identity. |

Repeating the export into the same directory resumes the same merchant revision. A different configuration uses a different destination; retained export bytes are checked before reuse. Give the generated client and relevant public product information to the researcher using the SF88 workspace.

## Start the native seller and operator service

Use the existing facilitator that corresponds to the merchant's selected network and asset:

~~~bash
node sf30-seller-sdk/openalex/cli.mjs serve \
  --config /private/openalex/merchant.json \
  --budget-dir /private/openalex/budget \
  --port 8432 \
  --operations-port 8433 \
  --facilitator https://facilitator.example.com \
  --availability-dir /private/openalex/availability \
  --history-dir /private/openalex/operator-history
~~~

Replace the facilitator URL with the actual configured service. The command prints the merchant and optional operations URLs, source state, mode, and configuration identity. The existing native seller owns payment verification and settlement; the OpenAlex application supplies the selected metadata response.

For an explicitly configured local facilitator, use its `http://127.0.0.1:PORT` URL with `--allow-local-facilitator`. Without a facilitator the service exposes the original CHALLENGE_ONLY mode. Use the printed mode when handing a service to a buyer.

SIGINT and SIGTERM close the seller, optional operator service, and source; in-flight source work is drained before closing its HTTPS Agent and budget handle.

## Deliver a research edition

The researcher first saves a query in the [workspace](../../sf88-operator-buyer-cli/research/README.md). The operator can gather that query directly through the same source configuration:

~~~bash
node sf30-seller-sdk/openalex/cli.mjs gather \
  --config /private/openalex/merchant.json \
  --budget-dir /private/openalex/budget \
  --workspace /private/research \
  --query-id greenhouse-heat-pump \
  --edition-id greenhouse-2026-10-11 \
  --product researchWorks
~~~

This creates or reopens the named edition at the saved query's current revision and label, then follows the provider cursor chain. Progress records go to stderr; the final edition, query, coverage, and budget snapshot go to stdout. When creating a custom-labelled edition first, use the research CLI's `gather --edition-id` route to preserve that label.

The optional `--max-pages N` can be used for an operator-selected page limit. Omitting it allows the complete cursor walk. Reopening an edition preserves its stored pages and next request. The final empty terminal page is part of the edition's coverage record.

For paid customer retrieval, the researcher runs the workspace's `gather` with the original buyer profile, exported client, and selected product. The same workspace also receives already saved provider pages or original buyer results, and exports a complete portable edition.

## Query contract

| Operation | Accepted query fields |
| --- | --- |
| List | `filter`, `search`, supported scoped/exact search fields, `sort`, `group_by`, `select`, `cursor`, `page`, `per_page`, `corpus`. |
| Entity | `id`, `select`. |

The supported scoped search fields are `search.title`, `search.title_and_abstract`, and `search.title_abstract_keywords`, with their `.exact` variants; `search.exact` is also accepted. Scoped search applies to works. Saved research editions accept record lists and manage their own cursor sequence.

Page size is 1–100. Choose cursor paging or numbered paging for a request; numbered paging is limited to 10,000 results. Grouped requests cannot combine `select`, and their grouped output has a different response shape from a research edition's record list. Include `id` in every selected-field request. The URL, including its encoded query, must fit the provider's 4,094-byte request limit. [Paging](https://help.openalex.org/api/paging/) · [Field selection](https://help.openalex.org/api/selecting-fields/) · [Search and long Boolean queries](https://help.openalex.org/api/searching/)

The configured product exposes only its selected entity and the listed parameter names. Source requests preserve the exact selected values. The source handler uses the maintained SF30 timeout, response-size, DNS, redirect, and transport handling.

## Provider credits and retained budget

Current published pricing, reviewed 2026-10-11:

| Provider metadata request | Estimated credits used by this adapter | Published provider cost |
| --- | --- | --- |
| A single entity by ID | 0 | Free |
| List/filter or a non-search group | 1 | USD 0.10 per 1,000 calls |
| Search, including a search-filter request | 10 | USD 1.00 per 1,000 calls |

OpenAlex describes a credit as USD 0.0001. Its free signed-in allowance is currently USD 1.00 per day and anonymous access USD 0.10 per day. The operator's selected local ceiling can be lower than the account allowance. Consult the current account and [official example costs](https://help.openalex.org/access/example-costs/) when setting the configuration.

Before dispatch, the budget reserves estimated credits under the shared account label. On response it records the provider's credit header or reported cost when supplied, then the reservation estimate when an attempted request has no cost metadata. A request known not to have been dispatched records zero provider usage.

The ledger retains reservation identity, settled calls and credits, observed provider remaining capacity, reset time, and rate-limit delays. A reserved in-flight request survives a process loss in the local ledger. Keep that ledger during runtime recovery so another process sees the same account state.

A 429 response contributes its retry timing to the shared provider state. OpenAlex's quota headers report its account budget, remaining credits, request cost, and reset interval; activity outside this local merchant can affect those values. [Authentication and quota headers](https://help.openalex.org/api/authentication/)

## Response and handover contents

A successful application response preserves the original provider JSON bytes. The source records the request URL without a provider key, retrieval time, body SHA-256, byte length, reservation, and observed cost. Available quota headers and content type are allowed through to the merchant response; the application adds the provider name, source URL, and source hash.

The complete customer handover consists of the configured product contract and client, the research query and edition, the exact saved page responses, review decisions, report and bibliographies, plus the original buyer results attached to paid pages. The research export's manifest records each exported file hash.

Keep the operator's key and private account/runtime files in the service environment. Publish the intended public client and edition deliverables from their prepared export directories.

## Metadata license and research interpretation

OpenAlex publishes its metadata under CC0, including for commercial use. Linked full-text articles, PDFs, and repository files keep their own content licenses. [Access and pricing](https://help.openalex.org/access/pricing/) · [Full-text licenses](https://help.openalex.org/access/fulltext/)

A research edition fixes the received metadata and review history. The report's author, institution, topic, funder, source, and year tables describe that retained cohort; memberships may overlap. Review actual paper content and its stated conditions when translating the literature into an engineering assumption.

Related source documentation: [OpenAlex API](https://help.openalex.org/api/) · [Work attributes](https://help.openalex.org/data/works/attributes/) · [Authorships](https://help.openalex.org/data/authorships/) · [Research workspace guide](../../sf88-operator-buyer-cli/research/README.md).

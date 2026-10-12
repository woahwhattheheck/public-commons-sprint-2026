# Linkup search and sourced answers over the native Stellar merchant

This integration exposes two complete research products through the original
SF30 merchant, native x402 Stellar facilitator and SF88 Node buyer. The merchant
uses its existing Linkup API account. The customer reviews one fixed merchant
offer, approves its original native payment, saves the complete response and
reopens that same purchase as JSON or a portable reading report.

| Merchant operation | Public request | Fixed Linkup request | Saved response |
| --- | --- | --- | --- |
| `linkup-search`, `POST /research/linkup/search` | Query and optional filters | `depth: "standard"`, `outputType: "searchResults"`, `includeImages: false` | Original ranked text results, URLs, excerpts and provider fields |
| `linkup-answer`, `POST /research/linkup/answer` | Query and optional filters | `depth: "standard"`, `outputType: "sourcedAnswer"`, `includeImages: false`, `includeInlineCitations: true` | Original answer text, inline citations, ordered sources and provider fields |

Both products call the same documented `POST https://api.linkup.so/v1/search`.
The underlying API returns complete JSON. The two operation IDs distinguish the
customer's chosen output and independently configured merchant price.

## Source contract

The request and output definitions are pinned to the official
[Linkup TypeScript SDK, commit 832dbecf](https://github.com/LinkupPlatform/linkup-js-sdk/tree/832dbecf81f0728dc9e00cdf9f4355a625e219d5)
and the first-party [search overview](https://docs.linkup.so/pages/documentation/endpoints/search/overview)
and [API reference](https://docs.linkup.so/pages/documentation/endpoints/search/reference),
reviewed on 2026-10-11. `src/linkup-client.ts` maps the SDK query to the API's
`q` field and sends a server-held bearer token.

The public merchant body accepts these fields only:

| Field | Merchant admission |
| --- | --- |
| `query` | Required nonblank string, at most 8,000 UTF-8 bytes; original text retained |
| `includeDomains`, `excludeDomains` | Optional arrays of at most 100 nonblank domain strings, at most 512 UTF-8 bytes each, without ASCII spaces or control characters |
| `fromDate`, `toDate` | Optional valid `YYYY-MM-DD` dates from 1970 onward; when both are present, the start precedes the end |
| `maxResults` | Optional integer from 1 through 100, for either output product |

Those limits belong to this merchant. Other valid Linkup SDK options require a
separately configured product with its own reviewed terms. The client cannot
choose an upstream URL, credential, depth, output type, price or payment flow.
The transformed provider request is at most 65,536 bytes. Its fixed fields are:

```json
{
  "q": "How do Stellar smart contracts work?",
  "depth": "standard",
  "outputType": "sourcedAnswer",
  "includeImages": false,
  "includeInlineCitations": true,
  "includeDomains": ["developers.stellar.org"],
  "maxResults": 5
}
```

The search-results route omits `includeInlineCitations` and selects
`outputType: "searchResults"`. Source order, text, unknown provider fields and
inline citation text survive the JSON response contract and the customer
reader. Optional favicon fields are retained. The merchant serializes the
validated JSON through its original response encoder; the purchased response
file preserves the exact merchant bytes. It does not promise the provider's
original whitespace or JSON key formatting.

## Configure the merchant

Use the current maintained distribution with Node 22+, Python 3.11+ for the
original buyer, and the documented native SDK dependency versions. The existing
[facilitator installation](../native-facilitator/README.md#install-and-configure)
and [merchant deployment](../sf82-seller-pilot/README.md) remain the host setup.

Copy `examples/linkup-search-service.json` to a private operator directory. For
each route, replace `UNVERIFIED_DEMO_ASSET`, `UNVERIFIED_DEMO_RECIPIENT`, the demo
network if appropriate, and the sample atomic amount with the actual approved
asset contract, recipient, network and price. Set a stable `publicOrigin` to the
deployed HTTPS merchant origin. Review each generated offer from that origin.
The sample cannot serve as an agreed payable deployment configuration.

The two offers explicitly use `extra.paymentFlow: "authorization"`. Configure
the existing native facilitator for those exact assets, recipients and amounts,
with `payments.paymentFlows: ["authorization"]`. Keep its existing source
accounts, key environment, RPC policy and shared signing-account ownership.

Copy `examples/linkup-search-upstreams.json` only when private operational
limits need changing. Both bindings keep the exact HTTPS Linkup origin, `/v1/search`,
POST, JSON response, empty forwarded request-header/query lists, and the
`LINKUP_AUTHORIZATION` environment reference. The product owns that reference:
it derives the bearer header from the merchant's `LINKUP_API_KEY` without changing
the process environment or returning the key. The configured private binding
path may be supplied in `LINKUP_SEARCH_UPSTREAMS`.

Load the existing Linkup key and facilitator key through the host's normal
secret environment. Start the original self-facilitated merchant with the
provided trusted handler module:

```sh
node stellar/scf-starforge-20261009/native-facilitator/cli.mjs \
  --seller /srv/private/linkup/seller.json \
  --config /srv/private/linkup/facilitator.json \
  --handlers /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/examples/linkup-search-handlers.mjs \
  --port 8423
```

Here `/srv/starforge/source` means the installed source root selected by the
operator. `LINKUP_API_KEY` contains only the actual API key; the module constructs
`Bearer <key>` internally. Client-provided Authorization and payment headers are
never forwarded to Linkup. Credentials and request bodies belong in the private
host environment and private request/result stores.

The default binding allows eight upstream requests per handler, a 60-second
provider deadline and a 1 MiB decoded response. The service allows 65 seconds
for its handler and 90 seconds for a request. Native settlement concurrency
continues to follow the configured facilitator accounts and original service
admission. Set host/proxy timeouts to cover the selected request deadline.

## Payment and provider failure behavior

The original merchant validates the fixed JSON request before payment handling.
An unsigned valid request receives the original 402 offer. After native
authorization verification, the handler makes one Linkup request. The response
contract requires HTTP 200, JSON and the selected complete result shape before
the original authorization flow can settle. An invalid provider result, timeout,
redirect, provider payment response or interrupted response follows the original
upstream failure path. The API key stays in that one merchant request.

The merchant and buyer keep provider output delivery distinct from native payment
state. A connection can fail after a valid resource and payment have been
prepared or settled. Inspect the original saved attempt, response capture and
native payment observation before selecting further work. Recovering an
existing buyer intent reads its retained result; it never issues a new provider
request or payment. An explicit new query uses a new reviewed intent.

The Linkup API account can incur provider usage when a request is made even if a
later merchant settlement or customer delivery fails. Include that exposure in
the merchant's price and operating process. This integration does not add an
automatic provider retry, payment retry or cache that could change the selected
research result.

## Export the original customer handover

Use the existing seller release console's **Client exports** operation or its
`--client-exports` option to save the original generated client from the running
merchant's own OpenAPI document. The complete
[SF82 client handover](../sf82-seller-pilot/CLIENT_HANDOVER.md) retains the exact
offer/source identity, generated files, export history and receiving steps.
Its `seller-client.mjs`, manifest and typed methods describe the two actual
deployed products. The Linkup buyer consumes this same generated client.

The buyer operator retains its own wallet, SF36 spending policy, original ledger,
approved transport and private evidence. Use an existing
[native operator workspace](../sf88-operator-buyer-cli/node/WORKSPACE.md), or the
original configured operator profile. The merchant never receives the buyer's
wallet key. Set a customer atomic ceiling independently of the offered amount.

Save the intended query and optional filters as a private JSON file; the example
`examples/linkup-query.json` supplies its shape. Prepare one permanent intent:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/examples/linkup-search.mjs prepare \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/linkup-customer --workspace /srv/private/buyer-operator \
  --client /srv/private/received-linkup-client/seller-client.mjs \
  --request-file /srv/private/linkup-query.json --view answer \
  --intent research-answer-001 --max-atomic 10000 --accept 0
```

Replace the sample ceiling and offer index with the reviewed values. `--view
search` chooses the ranked-results operation. To use an existing configured
operator profile, supply `--profile /srv/private/operator-profile.json` instead
of `--workspace`. Preparation retains the exact request body, selected route,
terms, response destination and request deadline. It does not send a purchase.

Review and execute the same intent from the controlling terminal:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/examples/linkup-search.mjs review \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/linkup-customer --intent research-answer-001

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/examples/linkup-search.mjs execute \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/linkup-customer --intent research-answer-001 \
  --raw /srv/private/research-answer-001.response.json \
  --out /srv/private/research-answer-001.report.json \
  --html /srv/private/research-answer-001.html
```

The original native operator displays its exact approval statement. Only that
approval starts the saved attempt. Files selected by `--raw`, `--out` and `--html`
must be new paths; existing outputs are preserved. The raw file contains the
original verified response. The JSON report joins native state with the full
provider result, and the portable HTML shows the answer, ordered sources,
filtering, byte count and response hash. It uses no remote assets, escapes
provider text, and keeps source links as the original HTTP(S) URLs.

After a terminal interruption, application restart or lost printed response,
use the same state directory and intent with `inspect`, then `recover`:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/node/examples/linkup-search.mjs recover \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/linkup-customer --intent research-answer-001 \
  --out /srv/private/research-answer-001.recovered.json \
  --html /srv/private/research-answer-001.recovered.html
```

Recovery checks the same native result and saved file identity before reading
the research data. It also works after the merchant has stopped. Preserve the
original operator and application directories through the maintained
[workspace recovery](../sf88-operator-buyer-cli/node/RECOVERY.md) workflow.

## Pricing and operating handover

The first-party [pricing page](https://docs.linkup.so/pages/documentation/platform/pricing),
reviewed on 2026-10-11, lists standard search results at USD 0.005 per request
and a standard sourced answer at USD 0.006. It lists Linkup's existing x402 route
at the same parameter-based cost with a USD 0.01 minimum. Its
[x402 documentation](https://docs.linkup.so/pages/documentation/platform/x402)
describes USDC on Base. This adapter uses the existing API-key interface and
adds the operator's separately configured Stellar merchant route; Linkup's
existing account, API billing and Base route remain their current services.

Choose the actual atomic merchant amount using the configured asset's decimals,
current API account plan and expected deployment, payment and support costs. For
an asset with seven decimals, `10000` represents `0.001` asset units; that sample
alone does not cover a USD 0.006 provider call if one unit is worth USD 1. The
example deliberately leaves network/asset/recipient and commercial pricing for
the operator's explicit configuration.

A useful receiving handover includes the configured HTTPS merchant and exact
offer, API account ownership, native facilitator and signing-account ownership,
generated client export, independent buyer setup, one selected search and answer,
retained result/recovery instructions, provider usage expectations and the
named support owner. Agree one endpoint/environment and acceptance observations
before deployment. Extra production infrastructure or ongoing support has its
own explicit scope.

## Implementation map

| Existing component | Linkup contribution |
| --- | --- |
| SF30 request admission and upstream handler | `linkup-search.mjs` fixes and validates the provider request; original networking, timeout, cancellation, response contract and availability remain active |
| Native facilitator and resource server | Original SDK authorization verification, resource completion and settlement |
| Seller service and client export | Two configured products, actual OpenAPI offers and original generated client |
| SF88 Node Buyer | Original private operator/profile, reviewed request, terminal consent, permanent attempt and verified saved response |
| Linkup buyer example | Explicit prepare/review/execute/recover stages and portable reading report for the same saved output |

The local joined journey uses the original native SDK and payment components
with controlled Linkup contract and RPC/Horizon responses. Deployment acceptance
then uses the operator's actual configured Linkup account, HTTPS merchant, asset,
wallet and facilitator and retains those original results through the same path.

## Research questions, source analysis and dossier handover

Completed search and sourced-answer purchases can enter the existing research dossier with their exact original request/response bytes, ordered source records and native purchase identity. The receiving guide covers source selections, analyst notes, findings, revision comparison, reports, portable receiving and original customer-workspace backup: [Linkup research dossiers](../sf88-operator-buyer-cli/node/examples/LINKUP_DOSSIERS.md).

# CoinGecko provider and market operator

This product connects a provider-controlled additional Stellar route to the original Starforge seller and buyer components. The same local workspace retains five families of request definitions, original HTTP sources, explicit purchases, exact market comparisons, reviewer notes, and a portable operating handover.

It uses **SF61** to compile the OpenAPI declaration, **SF30** to serve the resulting routes, **SF88** for its existing retained inbox and execution lifecycle, and **SF31** for the original buyer and exact resource binding. This directory contains the provider adapter and operator product. The native settlement, signing, budgets, attempt recording, and recovery remain in those original modules.

## Start the operator

Use Node 24 or later in the original installed Starforge runtime. Start from the repository root:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs serve \
      --state /absolute/private/coingecko-market --port 8417 \
      --config /absolute/private/operator-config.json

Open the emitted loopback URL. Without configured buyer profiles, the workspace still supports request authoring, original-source intake, unsigned discovery, examples, research, provider-plan compilation, and handovers. A native checkout selects an existing configured buyer.

An operator configuration names the existing private configuration and workspace:

    {
      "buyerProfiles": [{
        "id": "merchant-testnet",
        "name": "Existing Stellar testnet operator",
        "network": "stellar:testnet",
        "configPath": "/absolute/original/buyer-config.json",
        "workspacePath": "/absolute/original/buyer-workspace"
      }]
    }

Keep the original buyer's configuration, signer, ledger, evidence, transport settings, and workspace bindings together. The browser receives profile identifiers and names; it does not take signer keys. Existing native configuration and capability checks still govern each operation.

One server owns a state directory. Multiple operators use its browser interface and retained revisions. Stop that server before a separate mutating CLI command against the same directory. Read-only `status` and `list` can inspect the retained database. The server binds to loopback and checks Host, Origin, and the custom write header. It has no login form or session-token setup.

The exact original native package versions and source manifests are listed in [runtime-dependencies.json](runtime-dependencies.json). The maintained runtime is the normal installation path. When using a separately unpacked source handover, place dependencies in an ancestor of **all** the original source modules. A `node_modules` directory only inside this partner folder will not satisfy imports made by sibling SF30, SF61, or SF88 modules.

## Build a complete collection

Import [collection.example.json](collection.example.json) from Collections to start with one definition from each family. These are editable request definitions, with no observations or implied current prices.

| Family | Native data path | Meaning |
| --- | --- | --- |
| Coin prices | `/simple/price` | Coin IDs, names, or symbols and selected quote currencies |
| Onchain token prices | `/onchain/simple/networks/{network}/token_price/{addresses}` | Original token addresses on the selected data network |
| Search pools | `/onchain/search/pools` | Explicit search, filters, included entities, and page |
| Trending pools | `/onchain/networks/{network}/trending_pools` | Explicit data network, duration, included entities, and page |
| Token details | `/onchain/networks/{network}/tokens/{address}` | Original token details and optional top-pool composition |

The request editor preserves path and query fields separately. It displays the native vendor URL and the additional merchant URL derived from the project's merchant origin and prefix. A collection retains its selected request order. Exporting and importing a collection preserves that order and its definitions; stable request references survive a complete project restore.

The endpoint contracts implement the documented lookup priority `ids > names > symbols`, the symbol limit for `include_tokens=all`, the distinct price-change parameter names for coin and onchain requests, and the required `include=top_pools` when token composition is selected. They retain the data network independently of the payment network.

The vendor documentation allows up to 515 coin IDs in a request. The original SF30 merchant request-target limit is 2,048 characters. The editor preserves a longer vendor definition and shows a notice when its merchant URL exceeds that native limit. Create explicit smaller merchant requests when needed. The adapter does not silently split one purchase or remove selected IDs.

The raw vendor Bazaar description is retained unchanged. In the observed native descriptions, some enum fields are represented as `type: "enum"` without values. The separate endpoint contract supplies the documented duration values `5m`, `1h`, `6h`, and `24h`, and the token include value `top_pools`. It does not rewrite an original challenge to make that challenge appear different.

## Retain and inspect original sources

Sources can come from an unsigned native GET, an imported original HTTP response, a completed original buyer operation, or an explicitly extracted provider Bazaar example. Each capture retains its request and version, source basis, observation time, HTTP status, selected headers, exact body bytes when available, original challenge, file hashes, and derived rows.

An unsigned collection probe makes one GET for each explicitly selected request. There is no polling loop, implicit pagination, payment, or retry hidden in this operation. Progress is retained as each source completes. Cancellation and resume work on the remaining requests. A response whose headers were obtained but whose body failed remains a visible original observation with its transport error.

To import a captured response metadata file, select its request and provide the original file. A metadata record may contain:

    {
      "url": "https://pro-api.coingecko.com/api/v3/x402/simple/price?ids=bitcoin&vs_currencies=usd",
      "method": "GET",
      "status": 402,
      "headers": {"payment-required": "ORIGINAL_BASE64_HEADER"},
      "observed_at": "ORIGINAL_OBSERVATION_TIME",
      "body_sha256": "ORIGINAL_BODY_SHA256",
      "bytes": 84
    }

If the metadata refers to a separate body file, also select that original body. Its byte count and hash must match. Without it, the source remains explicitly metadata-only; the application does not manufacture a response body. A standalone response JSON and a separate original headers JSON are also accepted.

An original challenge's advertised resource can differ from the exact requested URL. Both remain visible. In the observed vendor coin-price challenge, the advertised URL omitted the request query. The original SF31 exact-resource check is preserved. A provider's additional SF30 route materializes the complete requested URL, including query, before native checkout.

Use **Extract Bazaar example** to inspect the provider's own example bytes inside a retained challenge. The resulting source is labelled `provider_bazaar_example`. It is a sample from that source, with its original values and identities; it is not a market observation taken at the workspace's current time.

Original files remain downloadable. Full row inspection shows the source fragment and field pointers, including nulls, relationships, and original numeric representations.

## Research and comparisons

Create a named snapshot from selected captures, at most one response per request. A snapshot pins its source selection, request versions, exact rows, and hashes. It does not fetch new data.

Compare two saved snapshots to inspect new, resolved, changed, and unchanged rows. Rows are matched by stable request reference and native entity identity. Included entities join by their native `type` and `id`; token identity also carries its data network and original address. Distinct duplicate identities retain their source pointer rather than overwriting one another.

Prices, market caps, volumes, reserves, atomic amounts, and source timestamps are preserved as source strings. Decimal differences use integer coefficients and decimal scales. They are never converted through JavaScript floating-point arithmetic. A formatting-only change such as `1.00` to `1.0` is shown separately from a numerical change. Missing fields, explicit null, and zero remain distinct.

An omitted requested token address is visible as missing. An unverified market cap can remain null. When the request permits a market-cap/FDV fallback, that ambiguity stays labelled. Requested-token reserves and full pool reserves have different labels. Relationship changes, including the ordered top-pool membership, are part of the comparison.

Named notes can refer to a request, source, row, snapshot, or comparison. Notes retain status, assignee, author, text, and versions. Concurrent changes return an actual 409 conflict with the current record; the operator can inspect and reapply the retained draft. The workspace never treats a note as proof of a native settlement or a current market value.

## Prepare, execute, and recover a native purchase

Set the project merchant origin and prefix, then discover the additional merchant routes. For each selected collection request, choose its current exact merchant challenge and one original payment option. The selected option index and original ordered terms are preserved.

Checkout first creates a retained operation and performs the original SF88 **intake** in a fresh child process. The initial job is queued in phase `intake`. When the original inbox has retained the request, configuration, signer binding, budget ticket, and reviewed terms, the workspace exposes its prepared review. Intake itself does not execute a payment.

The explicit Execute action then invokes the original inbox worker. Its existing attempt record is authoritative. Each item retains the native queue state, attempt, outcome, errors, evidence references, process exit, and downloaded original files. A response becomes a research capture only when the original native writer reports `SAVED` and its retained bytes match the original SHA and byte count.

Use the job's returned `canExecute`, `canCancel`, `canResume`, and `canRecover` capabilities. Those controls describe the current original operation. Cancel aborts the active worker or cancels an unattempted original item. Resume handles remaining work without an original attempt. Recover invokes the original recovery path and reads its resulting records; it does not create a replacement purchase.

Reopening the server marks an interrupted job for inspection. It does not restart a paid attempt automatically. A complete handover restores paid jobs as historical records with their original status visible. Restoring a project never opens its old native inbox or adopts a live budget ledger.

The public vendor challenges currently advertise Base and Solana choices. They remain visible in their original order. This product's original SF88 buyer is the Stellar buyer; it does not present those vendor options as executable Stellar payments. The additional provider-controlled route supplies its own explicit Stellar terms.

## Deploy the provider's additional route

A provider plan chooses the public origin, route prefix, endpoint families, and one to sixteen ordered original Stellar requirements. Optional per-family requirements override the default while retaining their order. These are the provider's actual terms and settlement account.

Create a plan from an owner-controlled challenge rather than hand-transcribing addresses or amounts. For example, a trusted local preparation script can read the selected original requirements and write a plan:

    import {readFileSync,writeFileSync} from 'node:fs';
    const original = JSON.parse(readFileSync('provider-owned-challenge.json','utf8'));
    const accepts = original.accepts.filter(option =>
      option.scheme === 'exact' && option.network === 'stellar:testnet');
    const plan = {
      name: 'Provider market service',
      publicOrigin: 'https://market.provider.example',
      pathPrefix: '/api/v3/stellar',
      endpointIds: ['simple-price','token-prices','search-pools','trending-pools','token-data'],
      accepts,
      endpointAccepts: {},
      upstream: {
        origin: 'https://pro-api.coingecko.com',
        basePath: '/api/v3',
        apiKeyEnv: 'COINGECKO_PRO_API_KEY'
      }
    };
    writeFileSync('PLAN.json',JSON.stringify(plan,null,2)+'\n',{flag:'wx'});

The example origin is a project placeholder. Choose the provider's real controlled origin and correct network. The original SF61/SF30 compiler validates the requirements, routes, and input schemas.

Compile and review without an endpoint request or payment:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs \
      provider compile --plan PLAN.json --out NEW_DEPLOYMENT.json

Launch using the existing facilitator:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs \
      provider serve --plan PLAN.json --port 8423 \
      --facilitator https://facilitator.provider.example \
      --data-module /absolute/provider/market-data.mjs

The provider's trusted module exports `resolveData({endpoint,request,context,signal})`. It returns a standard Response or `{status,headers,body}`, where body is the exact JSON bytes or text. The adapter retains those bytes and propagates the native cancellation signal. Do not parse a response through floating point and then stringify it to serve prices.

When no callback is supplied, the adapter calls the plan's licensed upstream using the named API-key environment variable. The plan stores the environment variable's name, never its value. Query validation and the configured upstream check run in the original prepayment admission path. HTTP status and relevant content/cache headers are retained; redirects and payment-on-payment upstream routes are not followed.

Without a native facilitator factory, the original seller runs in its actual `CHALLENGE_ONLY` mode. A challenge-only server is useful for source discovery and configuration review; it does not represent a settled transaction.

Commercial use of a provider API and redistribution are governed by that provider's applicable agreement. This product is designed for a provider-operated additional route or an independently licensed deployment with the necessary rights. A compiled plan or exported source package does not itself grant API data rights.

## Handover and restart

Export a named complete handover from Handover. It contains the project configuration, all original source files and hashes, request and note versions, saved comparisons, original native summaries and retained outputs, operator history, and the runnable source closure. Repeated exports do not recursively include previous archives. Their history remains visible; an older archive payload may be marked unavailable after restore.

The source files and archive can include private research and operational records. The live signer, active native ledger, and existing buyer workspace remain outside the portable handover.

Restore through the UI into a **separate project**, or use the same CLI:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs restore \
      --state /absolute/private/new-market --file HANDOVER.json.gz \
      --name 'Restored research' --actor 'Named operator'

The compressed restore limit is 64 MiB and the expanded limit is 256 MiB. An individual source upload is limited to 15,000,000 bytes. Every retained source and packaged runtime file is hash-checked before restore.

Extract the included source into a new directory:

    node stellar/scf-starforge-20261009/partners/coingecko-stellar-market/cli.mjs \
      unpack-source --file HANDOVER.json.gz --out /absolute/new-source

Reattach a currently configured original buyer profile only when preparing a new operation in the restored project. Historical jobs retain their original request and outcome, and cannot silently become executable jobs.

## Programmatic and native entry points

`workspace/server.mjs` exports `startMarketWorkspace({directory,port,buyerProfiles,fetchImpl})`. `provider.mjs` exports `prepareCoinGeckoProduct`, `createCoinGeckoHandlers`, and `startCoinGeckoService`. Trusted runtime injection is for the deployment owner; it is not an arbitrary code upload route in the browser.

Run `cli.mjs --help` for the full command list. The same retained model supports project creation, requests, collection imports, original source imports, Bazaar extraction, unsigned probes, native checkout/actions, snapshots, comparison, notes, export, and restore. Commands return structured JSON containing the actual operation ID and project revision.

API writes carry `actor`, `opId`, and the expected project `revision`; mutable item changes also carry `version`. An exact repeated operation returns its retained result. Reusing an operation ID with a different body returns a conflict. Collection and source lists support search and pagination up to 100 records per page, with exact total counts. A background job's current progress is retained without appending a full copy of the job for every transient update; its original source and attempt history remain intact.

## Original references

- [CoinGecko x402 integration](https://docs.coingecko.com/ai-integration/x402)
- [Coin prices](https://docs.coingecko.com/reference/simple-price)
- [Onchain token prices](https://docs.coingecko.com/reference/onchain-simple-price)
- [Search pools](https://docs.coingecko.com/reference/search-pools)
- [Trending pools](https://docs.coingecko.com/reference/trending-pools-network)
- [Token details](https://docs.coingecko.com/reference/token-data-contract-address)
- [CoinGecko commercial and custom licences](https://support.coingecko.com/hc/en-us/articles/16760512207257-What-Are-the-Differences-Between-Commercial-and-Custom-Licenses)
- [Original SF61 importer](../../sf61-openapi-seller-import/README.md)
- [Original SF30 seller](../../sf30-seller-sdk/README.md)
- [Original SF88 buyer operator](../../sf88-operator-buyer-cli/README.md)

MIT; preserve the repository's original licence and module authorship.

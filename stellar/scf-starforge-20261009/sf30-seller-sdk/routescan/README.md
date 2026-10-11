# Routescan gas-data merchant

Operate a Stellar-priced merchant for Routescan's original gas-price aggregation responses. The operator selects the provider network and chain, aggregation intervals, date-range ceiling, upstream quota and each product's native payment terms. The customer selects dates and, for a series, its aggregation interval.

This package composes the existing SF30 seller, HTTP upstream handler, native factory, operations interface and original generated customer package. A persistent project connects provider selection, retained source results and customer handover. The complementary workspace calls this same API.

## Original provider contract

Primary sources reviewed 2026-10-11:

- [Stats API](https://routescan.io/docs/api/stats)
- [Official OpenAPI](https://api.routescan.io/v2/documentation/json)
- [API conventions](https://routescan.io/docs/api/conventions)
- [Rate limits](https://routescan.io/docs/plans-and-limits/rate-limits)
- [API keys and pricing](https://routescan.io/docs/plans-and-limits/api-keys-and-pricing)

| Operation | Original route after `/v2/network/{network}/evm/{chainId}` | Customer query | Successful original shape |
| --- | --- | --- | --- |
| `series` | `/aggregations/avg-gas-price` | `dateFrom`, `dateTo`, `unit` | Array of arrays of strings |
| `total` | `/aggregations/avg-gas-price/tot` | `dateFrom`, `dateTo` | Object containing a string `value` |

Both operations also accept optional ecosystem, includedChainIds and excludedChainIds filters. The included/excluded lists use the first-party comma-separated wire representation, for example `43114,73772`; pass these as strings through the original HTTP query/compiler/client path. The operator controls the path's network and chain selection, including an explicit `all` chain choice. Absent filters remain absent in the request and generated example.

The series `unit` is a time aggregation interval: second, minute, hour or day, restricted further by the merchant's configuration. The total endpoint applies its date filters at day granularity. Both original response structures and their string values are preserved. The published schema does not establish a gas denomination; consumers should retain the original value labels and strings.

The provider origin and operation paths are fixed. A source result records the selected network, chain, exact timezone-bearing date strings, aggregation interval, original source URL, response bytes, byte count and SHA-256. Successful source response headers expose its URL, SHA-256 and Routescan attribution. An optional key is read from an operator-selected environment variable and sent in the provider's `apikey` header.

## Configure and save

Use the original SF30 dependencies, Node 24 and Linux `flock`. The source's explicit Node HTTPS Agent honors the host's proxy environment through the original SF30 exchange; this supports the managed cloud runtime's egress route. Its agent closes after source operations drain. Run these commands from `sf30-seller-sdk`.

~~~bash
node routescan/cli.mjs inspect --config routescan/merchant.example.json
node routescan/cli.mjs init --project /srv/routescan-project --config /srv/routescan-merchant.json
node routescan/cli.mjs status --project /srv/routescan-project
~~~

Copy the example to the operator-owned configuration file and select the following values.

| Configuration | Operator choice |
| --- | --- |
| `publicOrigin` | Customer-facing HTTPS origin |
| `provider.network`, `provider.chainId` | mainnet or testnet and one numeric string chain ID; the operator can explicitly select all |
| `provider.account` | Stable provider-account label shared by quota users |
| `provider.apiKeyEnv` | Optional environment variable containing the provider key |
| `quota.requestsPerSecond`, `quota.callsPerDay` | Quota matching the selected provider plan |
| `units`, `maxRangeDays` | Allowed aggregation intervals and date-range ceiling |
| `products[].path`, `operation` | Unique customer route and series or total operation |
| `products[].paymentOptions` | Original SF30 network, asset, amount, recipient and timeout |
| `products[].example` | Source-compatible date selection for the original client package |

The example uses the original project's explicit demo asset and recipient placeholders. Enter the intended native recipient, asset, network and amount and configure the deployment's facilitator before serving paid requests. Payment amounts retain the protocol's exact string representation. Provider keys remain in the deployment environment; saved input and customer exports contain the environment-variable name.

The original offer and seller-route compilers validate payment terms, metadata and request schemas. Every authoring edit supplies the revision the operator reviewed.

~~~bash
node routescan/cli.mjs save --project /srv/routescan-project --config /srv/routescan-merchant.json --revision 1
~~~

A changed input produces the next revision and input SHA-256. Identical input returns the existing revision. If another editor advanced the project, reopen its current input before applying an edit. Immutable revision files support operator history.

## Fetch and reopen source results

Use a stable operation ID for a real provider preview.

~~~bash
node routescan/cli.mjs preview --project /srv/routescan-project --product gasSeries --input routescan/request.example.json --revision 1 --id gas-october-08
node routescan/cli.mjs result --project /srv/routescan-project --id gas-october-08
node routescan/cli.mjs result --project /srv/routescan-project --id gas-october-08 --out /srv/customer-delivery/gas-october-08.json
~~~

The output file is created exclusively at a new path. The retained result contains the exact original body, status, headers, source selection, request hash and response hash. JSON parsing validates the documented response structure while delivery keeps the original byte string.

After a process restart, reopen the result by ID or call `preview` with the same ID, request and reviewed revision. A completed result returns its existing bytes and completion timestamp. An operation that retained its request but lost completion stays `STARTED`; its selection remains available and a deliberate new operation uses a new ID. Failed responses remain available with their retained status and body.

The project records the request before dispatch and writes completion atomically with the original body. Private directories use mode 0700 and state files use 0600. Linux advisory locks protect authoring and quota mutations across processes. Use durable local storage in an operating deployment.

## Shared quota and admission

The example uses the documented keyless limits of 2 requests per second and 10,000 requests per day. Configure the actual plan limits for a registered or paid account.

All source callers using one provider account should share a quota directory and the same account label. The ledger durably reserves every attempt before dispatch, spaces requests evenly, and counts dispatches over a rolling 24-hour window. Minute buckets conservatively retain an attempt until the end of its minute, making the local policy usable without assuming the provider's daily reset boundary.

Native admission checks the retained quota before entering the original payment path. Dispatch then reserves its own slot atomically across processes. An actual upstream 429 records a cooldown from Retry-After; an unspecified interval uses 60 seconds. The ledger exposes the next permitted time and retained call counts. Interrupted or unsuccessful upstream attempts keep their reserved usage through restart.

Use one shared local volume for cooperating processes. For separate machines, route provider dispatch through one quota-owning merchant process or supply a shared atomic quota service before scaling callers horizontally. The local ledger represents this merchant's retained dispatches and configured policy.

## Serve original merchant and operations

Start the original challenge-only seller and operator interface for configuration review:

~~~bash
node routescan/cli.mjs serve --config /srv/routescan-merchant.json --port 8423 --operations-port 8424
~~~

For paid service, supply the deployment's original native facilitator and shared quota volume:

~~~bash
node routescan/cli.mjs serve --config /srv/routescan-merchant.json --quota-directory /srv/routescan-project/quota --facilitator https://facilitator.example.org --port 8423 --operations-port 8424 --availability-directory /srv/routescan-availability --history-directory /srv/routescan-operations-history
~~~

Replace the example facilitator with the configured endpoint. The explicit `--allow-local-facilitator` option permits the original local runtime at http://127.0.0.1. Seller and operations listeners bind to loopback. Expose the customer endpoint through the deployment's HTTPS boundary and operations through the operator's authorized surface.

Native startup composes the original HTTPFacilitatorClient, createNativeSellerServer, startSellerService and startSellerOperations. Those components perform native admission, verification, settlement, response delivery, availability and request lifecycle. SIGINT and SIGTERM drain the seller and close its source ledger and operations listener.

## Prepare original customer package

~~~bash
node routescan/cli.mjs export --project /srv/routescan-project --revision 1 --id gas-release-1
~~~

The export freezes the reviewed input and writes merchant.json, review.json, seller-openapi.json and the original generated client directory. That package includes JavaScript, declarations, metadata, the original OpenAPI, its export receipt and client/README.md with buyer invocation instructions. The complementary customer workspace keeps the original Node/Python buyer result and payment receipt.

Reopening an export ID returns the existing release. An interrupted export fills missing members using the original deterministic generator, compares retained members byte-for-byte and completes the original client export receipt. The final manifest identifies the input revision and original file hashes.

## Workspace API

~~~js
import { openProject } from './routescan/project.mjs';
import { compileRoutescanMerchant, merchantReview } from './routescan/config.mjs';

const project = await openProject('/srv/routescan-project');
const current = await project.read();
const review = merchantReview(compileRoutescanMerchant(current.input));
const results = await project.listPreviews();
const releases = await project.listExports();
// Keep the project open while its controller handles operator actions.
~~~

| Action | API |
| --- | --- |
| Open project | `openProject(directory, { env, quotaDirectory })` |
| Load or edit | `read()`, `save({ input, expectedRevision })` |
| Review history | `history()`, `readRevision(revision)` |
| Fetch source | `preview({ product, request, expectedRevision, id, signal })` |
| Reopen source | `readPreview(id)`; bodyBase64 contains the original bytes |
| Browse source results | `listPreviews()`; metadata includes the original request and response hash |
| Prepare or reopen release | `export({ expectedRevision, id })`, `readExport(id)` |
| Browse releases | `listExports()` |
| Close project | `close()`; waits for its provider operations |
| Provider runtime | `createRoutescanSource(compiled, { quotaDirectory, env })`, then `request(product, request, { signal })` |
| Native merchant | `startRoutescanMerchant(compiled, { nativeFactory, quotaDirectory, port, operationsPort, ... })` |

The controller owns navigation and the original Node/Python buyer calls. Keep preview and export IDs when reopening, show the original source value strings and selected time interval, and pass the reviewed revision on edits and operations. A changed source selection gets a new operation ID. This gives the operator and customer one provider implementation, one native payment path and the same retained source result.

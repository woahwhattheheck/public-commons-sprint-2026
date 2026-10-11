# OpenCage merchant and customer workbench

A complete geocoding product inside the maintained Starforge seller and buyer source. Prepare explicit forward or reverse inputs, retain the provider response, review candidate locations, operate the original merchant release, and hand the customer a reproducible CSV/GeoJSON delivery.

The component is in `sf30-seller-sdk/opencage/`. Its CLI is `cli.mjs`; its public API is `index.mjs`. The browser is a private loopback application with an industrial monochrome layout.

## Product workflow

1. Initialize one private workspace from a geocoding plan and explicit merchant payment terms.
2. Review the product, query and native options. Dispatch one provider request under a stable request ID, or import its exact existing HTTP observation.
3. Inspect every candidate in the original order. Save a decision against the exact response SHA-256 and current decision revision.
4. Prepare a customer delivery containing the original response, licenses, all candidates, the selected geometry and the complete source/decision join.
5. Prepare the original SF61 seller package. Review its request and payment changes through SF82, select the release and start the original seller.
6. Consume a completed original SF88 buyer operation through `recover()`, then reopen and export the same customer result.

The source plan remains immutable within a workspace. Edited payment terms create a separate merchant package and release; earlier packages, requests, decisions and deliveries remain available.

## Installation and first use

Use the maintained Starforge merchant distribution, or the public repository with its existing dependencies installed. The operator uses the original Linux `flock` workspace lease and original Node private-file primitives. Node 22 is the native execution target.

The installed distribution exposes `starforge opencage-workbench` for the same CLI and `@tokenjunkielabs/starforge-merchant/seller/opencage` for the application API. The provider, configuration, merchant, customer, workspace and server modules also have corresponding `/seller/opencage/MODULE` exports.

From `stellar/scf-starforge-20261009/`:

```sh
node sf30-seller-sdk/opencage/cli.mjs examples --out /absolute/private/geocoding-inputs
```

Edit `plan.json` and `terms.json` in that directory. The example terms use explicit demonstration asset/recipient markers. Enter the merchant's actual HTTPS origin and the complete intended payment alternatives before a production release. Amounts are atomic integer strings and remain unchanged through the original compiler and release comparison.

Supply the named key through the process environment, then initialize and open:

```sh
node sf30-seller-sdk/opencage/cli.mjs init \
  --workspace /absolute/private/geocoding-work \
  --plan /absolute/private/geocoding-inputs/plan.json \
  --terms /absolute/private/geocoding-inputs/terms.json

node sf30-seller-sdk/opencage/cli.mjs serve \
  --workspace /absolute/private/geocoding-work
```

Open the printed loopback URL. Its fragment contains the private operator token; the page consumes the fragment and removes it from the address bar. The API uses that token, exact same-origin writes and a restrictive content policy. The key is never entered in the browser or written into prepared requests, seller packages or delivery metadata.

The operator can read retained output while its provider key is absent. Source dispatch reads the configured environment variable immediately before the request. Restart the operator and its owned seller after changing its process environment.

## Source plan

`examples/plan.json` provides two products:

| Product | Method and path | Source mode |
| --- | --- | --- |
| Address candidates | GET /geocode/forward | Forward |
| Coordinate address | GET /geocode/reverse | Reverse |

Each product selects its allowed native options and explicit defaults. The example asks the provider not to record the query with `no_record=1`. An unsupported or duplicate parameter is rejected before dispatch. Bounds and coordinate inputs are validated against their native coordinate order; reverse products reject forward-only options.

`minIntervalMs` is a local source-instance interval. It does not replace the provider's account-wide limits. `timeoutMs` and `maxResponseBytes` use the original upstream request bounds. One source instance dispatches one request at a time; the application records local admission refusals as such.

### Native semantics

OpenCage uses GET with `q` and a private query-parameter key. Forward bounds are longitude/latitude pairs; reverse queries and proximity use latitude/longitude. Responses use WGS84. Successful responses can contain zero candidates. Result order expresses relevance; confidence expresses spatial precision. Rate data can be absent on subscriptions. The workbench preserves returned licenses and native fields. [Official API contract](https://opencagedata.com/api) · [Provider terms](https://opencagedata.com/terms).

The provider's published test keys return a fixed documented location, with a special empty-result query. A run using those keys retains that documented behavior and labels its source accordingly in the native-use record. Production requests use the operator's account and exact plan.

## Retained requests and decisions

Every request ID has one immutable `request.json` containing the source plan hash, terms hash, product, normalized native query and merchant preview URL. The actual provider endpoint is stored separately. No credential parameter is retained.

A capture records its application status, native provider status, dispatch metadata, exact body and timestamps. The complete capture directory is published atomically after its files are durable. If a process ends after dispatch but before that publication, the request remains available for reconciliation. Reopening that ID does not automatically repeat the provider call.

A decision names the exact response hash and a zero-based native candidate index. It also carries an explicit expected revision and a note. Changes append to the retained decision history. A stale browser tab receives a conflict instead of overwriting a newer choice. Clearing a choice adds a new unselected decision revision.

```sh
node sf30-seller-sdk/opencage/cli.mjs capture \
  --workspace /absolute/private/geocoding-work \
  --id first-address --product forward \
  --query '{"q":"Münster, Germany","countrycode":"de","limit":"5"}'

node sf30-seller-sdk/opencage/cli.mjs inspect \
  --workspace /absolute/private/geocoding-work --id first-address
```

After reviewing the returned candidates, use the exact hash and revision from `inspect`:

```sh
node sf30-seller-sdk/opencage/cli.mjs select \
  --workspace /absolute/private/geocoding-work --id first-address \
  --response-sha256 RESPONSE_SHA256 --index 0 --revision 0 \
  --note 'Operator reviewed this location against the customer input'

node sf30-seller-sdk/opencage/cli.mjs export \
  --workspace /absolute/private/geocoding-work --id first-address \
  --response-sha256 RESPONSE_SHA256 --revision 1
```

Use `--index none` to clear a prior selection. Zero-result responses can be delivered with their complete original response and an empty candidate set.

Read-only CLI `list`, `inspect`, `release-status` and `release-diff` can inspect the same retained workspace while its browser operator owns the write lease. Browser actions are serialized through that writer. CLI mutation commands use the same lease and source paths.

## Import an existing native HTTP observation

The observation describes the real source request without its key, the native status and safe response headers, exact response bytes/hash, and original start/finish timestamps:

```json
{
  "schema": "stellar-forge.opencage-http-observation.v1",
  "request": {
    "method": "GET",
    "endpoint": "https://api.opencagedata.com/geocode/v1/json",
    "query": {"q": "51.952659,7.632473", "no_record": "1"}
  },
  "response": {
    "status": 200,
    "headers": {"content-type": "application/json; charset=utf-8"}
  },
  "startedAt": "2026-10-11T00:00:00.000Z",
  "finishedAt": "2026-10-11T00:00:01.000Z",
  "bodySha256": "EXACT_RESPONSE_SHA256",
  "bodyBytes": 1234
}
```

Replace the example times, hash and size with the retained source values. The importer checks all fields against the requested product/query and original response. Recovering an already attempted request also requires that observation's `requestSha256` to equal the retained request file's hash.

```sh
node sf30-seller-sdk/opencage/cli.mjs import-response \
  --workspace /absolute/private/geocoding-work --id retained-coordinate \
  --product reverse --query '{"q":"51.952659,7.632473"}' \
  --observation /absolute/native-observation.json \
  --response /absolute/native-response.json
```

The browser offers the same import operation using two local files. Original imported observation bytes are retained with the resulting capture.

## Customer delivery

Each completed delivery contains:

| File | Content |
| --- | --- |
| response.json | Unchanged native response bytes |
| request.json | Saved product, source identity and exact normalized inputs |
| decision.json | Complete response-bound decision history |
| licenses.json | Returned data licenses |
| candidates.jsonl | Every native candidate, retaining native fields and order |
| candidates.csv | Flat location projection with original candidate indices |
| candidates.geojson | Every candidate as a WGS84 point |
| selected.csv / selected.geojson | The explicitly selected candidate, or an empty selection |
| delivery.json | Source, hash, semantics and projection conventions |
| source/* | Original capture or original buyer-result records |
| manifest.json | Exact delivery inventory and identity |

GeoJSON coordinates are longitude,latitude. Text cells that could be evaluated as spreadsheet formulas receive an apostrophe in CSV; original strings remain unchanged in `response.json`. Missing projected properties are empty CSV cells and null in GeoJSON, while the native response preserves their original absence.

Reopening verifies the manifest, response, source attachment hashes, decision join, and every generated CSV/GeoJSON byte. A completed delivery is independent of a later source request or later decision revision.

```sh
node sf30-seller-sdk/opencage/cli.mjs read --delivery /absolute/private/delivery-directory
node sf30-seller-sdk/opencage/cli.mjs serve --delivery /absolute/private/delivery-directory
```

The latter opens a customer view of the original response and saved decision.

## Original seller package and release

In the Merchant release view:

1. Edit the payment terms JSON and prepare a package.
2. Inspect the generated OpenAPI, offers, bindings and client SDK.
3. Stage a release ID, optionally selecting the original facilitator URL.
4. Review SF82's exact request/payment changes.
5. Activate that reviewed generation, then start the original seller.

The package includes `spec.json`, `selections.json`, `bindings.json`, original offers and seller-service configuration, generated OpenAPI/SDK and the provider source binding. Staging emits a private immutable ESM handler entry tied to the installed provider source hashes. SF82 pins that entry and preserves its original startup, runtime record, stop, restart and rollback behavior.

```sh
node sf30-seller-sdk/opencage/cli.mjs package \
  --workspace /absolute/private/geocoding-work

node sf30-seller-sdk/opencage/cli.mjs stage \
  --workspace /absolute/private/geocoding-work \
  --package-id PREPARED_PACKAGE_ID --release geocoding-v1

node sf30-seller-sdk/opencage/cli.mjs release-diff \
  --workspace /absolute/private/geocoding-work --after geocoding-v1

node sf30-seller-sdk/opencage/cli.mjs activate \
  --workspace /absolute/private/geocoding-work --release geocoding-v1 --generation 0

node sf30-seller-sdk/opencage/cli.mjs start \
  --workspace /absolute/private/geocoding-work --generation 1
```

The foreground start remains responsible for its original seller. Ctrl-C drains and closes that owned runtime. The browser's Stop action closes its own original release session. Selecting a different release is visible separately from the currently running release, so the operator can review and perform the restart deliberately.

Prepared external packages can be imported with `stage --package /absolute/package-directory`. The importer verifies the source plan, original compilation and bundle identity before adding it to the workspace's package catalog.

### Provider and commerce outcomes

The component preserves the original SF30 upstream mapping:

| Native provider status | Operator outcome | Original application behavior |
| --- | --- | --- |
| 200 with candidates | CANDIDATES | Native JSON |
| 200 with no candidates | NO_RESULTS | Native JSON with an empty result set |
| 401 | AUTH_REQUIRED | Original upstream authentication failure |
| 402 | QUOTA_EXCEEDED | Original upstream payment-required error mapped to application 502 |
| 403 | DISABLED_OR_IP_DENIED | Original upstream authentication failure |
| 429 | RATE_LIMITED | Original 429 and valid Retry-After |
| 503 | PROVIDER_UNAVAILABLE | Original 503 and valid Retry-After |

The seller's own 402 challenge stays under the native commerce engine. Source captures keep both native provider status and application status visible. The existing upstream transport controls redirects, public DNS, TLS, cancellation and response bounds. A malformed native success response is retained as an additional source artifact while the application records a contract failure.

## Original SF88 buyer adoption

`GeocodeDelivery.fromOperation()` calls the original operation's `recover()`, verifies its saved configuration hash, checks the actual HTTPS origin/product path/query, reads the original retained result bytes and checks the result's response hash. The original buyer operation controls approval, signing, settlement and recovery.

```sh
node sf30-seller-sdk/opencage/cli.mjs consume-buyer \
  --buyer-config /absolute/private/buyer.json --intent ORIGINAL_INTENT_ID \
  --plan /absolute/private/geocoding-inputs/plan.json --product reverse \
  --origin https://locations.example --out /absolute/private/customer-delivery

node sf30-seller-sdk/opencage/cli.mjs adopt-buyer \
  --workspace /absolute/private/geocoding-work \
  --buyer-config /absolute/private/buyer.json --intent ORIGINAL_INTENT_ID \
  --id customer-location --product reverse
```

Use `--package-id` with `adopt-buyer` when its actual merchant origin belongs to a later prepared package. The original buyer request and result remain attached to the geocoding capture.

An immutable HTTPS copy of a completed public result can also be consumed through the original Buyer response-file path. Pin its actual resource URL, response SHA, byte count and returned content type in the original buyer configuration. That customer retrieval retains its own HTTPS resource provenance alongside the original provider result.

## Public application API

```js
import { GeocodeWorkspace, GeocodeDelivery, createGeocodeServer } from './index.mjs';

const workspace = await GeocodeWorkspace.open('/absolute/private/workspace');
const source = await workspace.capture({
  id: 'reviewed-location',
  productId: 'reverse',
  input: { q: '51.952659,7.632473' },
});
const saved = await workspace.select({
  id: source.request.id,
  responseSha256: source.responseSha256,
  index: 0,
  expectedRevision: source.decision.revision,
  note: 'Reviewed against the customer input',
});
const output = await workspace.export({
  id: saved.request.id,
  responseSha256: saved.responseSha256,
  expectedRevision: saved.decision.revision,
});
const reopened = await GeocodeDelivery.open(output.directory);
await workspace.close();
```

Application callers should use a `finally` block to close a workspace or server they own. A server closes its workspace after accepted actions drain. Source files and all original results remain available for the next session.

## Original dependencies

The component composes these existing maintained surfaces:

- SF30 `upstream.mjs` and `upstream-handler.mjs` for provider HTTP and cancellation.
- SF61 `importOpenApi` and `createSellerServiceConfig` for the original merchant contract.
- SF30 developer-portal and client generator for the customer SDK.
- SF82 release store, comparison, selection and original foreground seller.
- SF88 Node private storage, Buyer and BuyerResult.
- Merchant fleet gateway's original kernel workspace lease.
- Existing public Twelve Data `files.mjs` for atomic, verified portable bundles.

The provider implementation is authored from the public API contract. Public source and examples contain no private commercial product implementation.

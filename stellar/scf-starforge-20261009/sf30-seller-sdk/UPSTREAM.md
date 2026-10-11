# Sell an existing API without rewriting its backend

This launcher connects **the original SF30 seller service** to the shared
[`upstream-handler.mjs`](./upstream-handler.mjs). Merchant-owned JSON selects a
backend operation and its permitted inputs. The existing server still owns
route matching, payment challenges, verification, cancellation and settlement.
There is no second payment implementation and no public proxy endpoint.

An API owner supplies two small files: its ordinary seller configuration and
its upstream bindings. Existing OpenAPI-derived `offer` routes work too; the
launcher does not replace their descriptions, schemas or payment terms.

The optional `responseContract` binding connects an operation's original
OpenAPI success status, JSON media type and result schema to the actual backend
delivery path. A mismatch returns a sanitized failure before the seller's native
post-handler settlement call. The existing importer now exports these runnable
bindings directly; see [response contract setup](../sf61-openapi-seller-import/RESPONSE_CONTRACTS.md).

## Start the complete local example

Use Node 22+ in the full repository checkout. The challenge-only example needs
no package installation, wallet, credentials or external provider.

In one terminal, run the included **fictional** dataset backend:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/examples/upstream-backend.mjs"
```

In another terminal, validate and launch the original seller:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/upstream-serve.mjs" \
  --config "$S/examples/upstream-service.json" \
  --upstreams "$S/examples/upstreams.json" \
  --allow-loopback-upstream --check

node "$S/upstream-serve.mjs" \
  --config "$S/examples/upstream-service.json" \
  --upstreams "$S/examples/upstreams.json" \
  --allow-loopback-upstream
```

The startup JSON contains the actual listener, health and offers URLs. The
seller binds to `127.0.0.1:8423`; the example backend uses port 8425.
`--port 0` selects an available seller port. Both JSON paths resolve from the
current working directory, not from one another.

```sh
curl http://127.0.0.1:8423/_seller/health
curl -i 'http://127.0.0.1:8423/dataset?region=north'
```

The second request returns the original **402 challenge**, not dataset rows.
With no facilitator configured, the original seller never calls an upstream
handler. The example's asset and recipient are deliberately unverified local
markers, not payable Stellar accounts or assets.

`--check` reads both configurations, resolves required environment variables,
and uses the original offer compiler plus handler/method/path checks without listening,
resolving DNS, invoking an upstream or initializing a facilitator. It does not
prove backend availability, account ownership or payable asset validity.

## Seller-side concurrency and shutdown

The existing `upstream-serve.mjs` accepts `--max-in-flight 64` and
`--drain-grace-ms 60000` just like the static seller. This independent
seller cap covers the entire original request/verification/handler/settlement
path, whereas each binding's existing `maxInFlight` bounds that specific
merchant backend only. When the seller is saturated it returns an immediate
503 with Retry-After before payment processing; the backend is not invoked.
`/_seller/health` shows the live counters, and `/_seller/ready` reports
whether new work is accepted. During SIGTERM, existing responses drain for
at most the operator-set grace, with forced connection closure and nonzero exit
if the deadline is exceeded. A terminated or uncertain settlement is never
retried by the wrapper. Keep merchant operations idempotent and reconcile
original receipts before retrying any paid operation.

## Configure a merchant backend

Keep the normal `stellar-forge.seller-service.v1` route. Replace its static
`response` with a `handler` name, for example `"handler": "merchantSearch"`.
Declare that exact name in a separate bindings file:

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "bindings": {
    "merchantSearch": {
      "origin": "https://api.merchant.example",
      "path": "/v1/search",
      "method": "POST",
      "query": {"language": "lang"},
      "requestHeaders": ["accept-language"],
      "headerEnv": {"Authorization": "MERCHANT_BACKEND_AUTH"},
      "responseHeaders": ["etag", "content-language"],
      "responseMode": "json",
      "timeoutMs": 10000,
      "maxResponseBytes": 1048576,
      "maxInFlight": 16
    }
  }
}
```

The seller route in this example must itself declare JSON `POST`. GET, HEAD
and JSON POST are supported; omitted binding `method` means GET. A binding
reused by several routes must match every route's method and required path
parameters. Unused bindings, missing names, unknown fields and conflicting
methods fail at startup rather than silently selecting a different operation.

`origin` is one canonical HTTPS origin on port 443: no path, credentials, query,
fragment, IP literal or internal hostname. The absolute backend `path` may
contain whole named segments, such as `/v1/items/:itemId`. Those names must
exist in the original seller route, such as `/items/:itemId`. Values are read
from the original validated `pathParams` and encoded as individual segments;
URLs, dot traversal, slashes and encoded-slash inputs cannot select a new host
or escape the configured path. A fixed public hostname is resolved at socket
creation using the original SF31 public-address policy. All answers must pass;
one copied address is supplied to the shared transport's socket lookup.
Normal TLS certificate and hostname verification remain enabled.

For a backend on the **same machine**, `http://127.0.0.1:PORT` is also supported
with `--allow-loopback-upstream`. That explicit flag does not enable other
private addresses or make the seller externally reachable. A merchant can
therefore keep its API bound locally and expose only the existing seller's
operator-managed HTTPS reverse proxy.

## Inputs and credentials

`query` may be an array of unchanged names or an input-to-upstream name map.
Repeated values and their request order are preserved. The shared handler
**rejects undeclared query parameters**, rather than dropping them or accepting
an arbitrary backend URL. Request bodies remain JSON values; POST reserializes
the parsed original body and does not preserve its raw wire whitespace.

Only explicitly listed ordinary `requestHeaders` are forwarded. Buyer
Authorization, Cookie, API-key, payment, routing, forwarding and hop-by-hop
headers cannot be selected. Backend credentials come only from `headerEnv`:
its values are environment variable **names**, never embedded secret values.
Each referenced variable must contain the full header value expected by the
backend, such as a Bearer authorization value. Inject it through the deployment
secret mechanism before launch; do not commit it or paste it into Slack.

This launcher snapshots environment credentials at startup. Restart it after
rotation. The shared handler's separate programmatic API also supports a
synchronous server-owned header factory for integrations needing live rotation.
Compiled binding objects contain credential values and must not be serialized
or logged. The launcher prints counts and its local service URLs only.

## Run the existing API with live operations

The original operations dashboard works with this upstream-backed seller too. Instead of
starting `upstream-serve.mjs` directly, select its maintained entrypoint with
`--upstream` on the existing operations launcher. From the repository root,
after starting the fictional backend described above:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" --upstream --operations-port 0 -- \
  --config "$S/examples/upstream-service.json" \
  --upstreams "$S/examples/upstreams.json" \
  --allow-loopback-upstream --port 0
```

Startup prints **both** actual loopback listener URLs, the original seller health
and offers URLs, and an operations snapshot URL. Open the operations URL and
call the seller's `/dataset?region=north` route to inspect original 402 traffic.
The upstream dataset is not released in challenge-only mode, so the example
does not execute the backend handler or send payment. On shutdown, both seller
and operations listeners close. `--operations-port` belongs *before* `--`;
seller/upstream flags belong after it. With no `--upstream`, the launcher
continues to call the unchanged static/handler `serve.mjs`.

Merchant deployments use the same flags and original `--facilitator` configuration
as above. The operations server binds only to `127.0.0.1`, must not be exposed
through the public seller reverse proxy, and exports request-outcome metadata
only, not private backend credentials or payment evidence. For routing/export
details, see [operations/README.md](./operations/README.md).

## Enable the existing payment runtime

Replace the example's asset, recipient, network and atomic-unit amount with
verified merchant terms. Set the ordinary seller config's `publicOrigin` to
the HTTPS origin actually served by the merchant's reverse proxy. Use the
original SF30 SDK setup described in [README.md](./README.md), then add the
configured facilitator to the same command:

```sh
node "$S/upstream-serve.mjs" \
  --config /private/merchant-seller.json \
  --upstreams /private/merchant-upstreams.json \
  --facilitator https://merchant-facilitator.example/facilitator
```

The launcher constructs the same original `HTTPFacilitatorClient` and
`createNativeSellerServer` used by `serve.mjs`. A local facilitator has a
separate `--allow-local-facilitator` flag; it is not enabled by the upstream
flag. No wallet, signing key, settlement retry or new approval mechanism is
introduced here. Authentication and payment outcomes are the original native
runtime's responsibility.

The application path is:

```
original seller route → native payment gate → shared upstream handler
                     → original cancellation or settlement → response release
```

The handler buffers and validates the complete permitted response before
returning it to the original seller. The seller controls whether it can be
released after its native payment processing; the adapter does not bypass that
step. JSON preserves the decoded response bytes after UTF-8/JSON validation.
`responseMode: "bytes"` permits binary payloads instead. The shared transport
handles identity, gzip, deflate and Brotli while enforcing both wire and decoded
size limits. Limits here cannot exceed the original seller's 1 MiB response
ceiling. Safe response metadata is opt-in; cookies, internal headers and
backend payment headers are not passed through.

## Failure and side-effect contract

There is one backend invocation and **no automatic redirect or retry** per
handler call. Timeouts include connection and body handling. Shared per-binding
capacity limits return a failure rather than unbounded parallel backend work.
Malformed, truncated, oversized, unsupported or failed responses return the
shared handler's structured error, not the backend's private error body. The
existing SF30 cancellation/failure path consumes those non-success results.

**Backend execution and settlement are not an atomic database transaction.**
The upstream can finish a POST before the subsequent payment/delivery step
fails. This adapter cannot undo that work, promise a refund for every native
settlement flow, or prevent a buyer making a second separate request. Use GET,
HEAD or read-only/stateless POST queries first. A mutating backend needs its
own authenticated idempotency/business-transaction design; do not rely on
HTTP payment verification as a rollback mechanism. The original application
context has no abort signal, so an upstream call may continue until its own
deadline after the buyer disconnects.

## Programmatic composition and focused execution

```js
import { readSellerConfig, startSellerService } from './serve.mjs';
import { readUpstreamBindings, compileUpstreamBindings,
  validateUpstreamService, createUpstreamHandlers } from './upstream.mjs';

const config = await readSellerConfig('/private/seller.json');
const bindings = await readUpstreamBindings('/private/upstreams.json');
validateUpstreamService(config, compileUpstreamBindings(bindings));
const handlers = createUpstreamHandlers(bindings);
const service = await startSellerService({config, handlers, port: 8423});
// Supply the existing operator-native nativeFactory to enable payment processing.
```

Custom prepayment admission stays with the original embedding application;
the JSON launcher never reuses an upstream handler as an admission hook.
Static routes and the maintained original config reader are preserved. The original resource adapter imports the existing pure SF25 schema validator
directly instead of loading the catalog-storage reexport. Its validation and
payment logic are unchanged. `serve.mjs`, SF61 and the shared handler are
otherwise reused without copies.

```sh
node --test "$S/test/upstream.test.mjs"
node "$S/upstream-acceptance.mjs"
```

The binding check uses an actual local HTTP backend plus the shared handler,
not a replacement HTTP implementation. It covers named/repeated inputs,
credential isolation, native method binding, private DNS rejection and failure
recovery. The transport owner's acceptance exercises the same shared transport.
These local checks do not claim an external merchant API request or a Stellar
network payment. One actual merchant endpoint and its original native payment
flow remain the merchant onboarding exercise, not a new test framework.

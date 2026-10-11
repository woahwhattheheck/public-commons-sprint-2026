# Sell SSE and NDJSON from the original merchant service

Serve a finite event or record stream through the same merchant route, native
Stellar payment terms, backend credentials and buyer spending decision used by
the existing JSON seller. The stream has one fixed route price. Its records do
not create additional payments.

The merchant chooses the payment flow in the original offer. With the default
authorization flow, the seller completes and validates the generated stream in
a private spool, settles once through the native SDK, and then transfers the
completed bytes. With the native Stellar **upfront** flow explicitly advertised
as `payment.extra.paymentFlow: "upfront"`, the SDK settles before invoking the
application and the seller can forward records as they arrive. Upfront payment
can therefore remain charged when the application subsequently fails or the
buyer disconnects. Buyers review and explicitly permit that flow in their
original operator configuration.

Both flows use the existing exact payment implementation. The complete response
keeps the original payment receipt. A failed stream keeps its payment result
and partial delivery distinguishable so the operator can inspect the same
attempt before deciding how to recover.

For a complete existing-API product, [EXA_ANSWER.md](EXA_ANSWER.md) composes an
operator-priced research-answer merchant, private Exa API credentials, fixed
source request policy and the original retained buyer citation workflow.

## Run the working HTTP example

The included backend samples its own running process. Each observation contains
the current UTC time, uptime and actual process memory counters. It emits a
finite SSE or NDJSON response and stops its producer when the downstream
connection closes.

From a checkout, start that existing-API development source:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/examples/streaming-backend.mjs"
```

It prints its loopback origin and health URL. The default port is 8425;
`--port 0` chooses an available port. If you choose another port, put the printed
origin in both bindings in a private copy of `streaming-upstreams.json`.

Open the original seller and operations console using the supplied route and
upstream files:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" --upstream --operations-port 0 -- \
  --config "$S/examples/streaming-service.json" \
  --upstreams "$S/examples/streaming-upstreams.json" \
  --allow-loopback-upstream --port 0
```

This starts the existing challenge-only service. Open its printed developer
page to inspect both offers and their distinct payment flows. A challenge
request does not invoke the backend. The example uses visibly nonpayable asset
and recipient markers; configure the real network, asset contract, merchant
recipient and facilitator in your private seller files to enable payments.

For a native merchant, append the original `--facilitator HTTPS_URL` argument
after the separator. The existing optional SDK installation and facilitator
setup are described in [the seller guide](README.md#enable-the-native-x402-runtime).
The ordinary `upstream-serve.mjs`, embedded upstream application, native merchant
launcher and operations listener consume these same bindings.

| Merchant route | Backend operation | Flow in the example | Output |
| --- | --- | --- | --- |
| `GET /metrics/events?count=8&intervalMs=250` | `GET /v1/metrics/events` | Explicit upfront | SSE telemetry events, then a complete event |
| `POST /metrics/records` with `{"count":8,"intervalMs":250}` | `POST /v1/metrics/records` | Default authorization | NDJSON sample records, then a complete record |

The example's `count` controls observations; its final complete item is an
additional record. `GET /health` on the backend exposes actual request, active,
sample, completed and cancelled counts for the running development process.
The static `outputExample` values in the offer illustrate a record's shape;
the backend produces each response from current process observations.

## Configure an existing streaming API

Keep your original seller route and handler name. In the original
`stellar-forge.seller-upstreams.v1` file, select `responseMode: "sse"` or
`responseMode: "ndjson"` and add the optional `stream` limits:

The route's original `definition` also declares `responseFormat: "sse"` or
`"ndjson"`. Its payment-required offer and generated OpenAPI resource then
advertise the actual streaming media type. The Bazaar output example describes
one JSON record. Existing routes retain the original JSON default. An imported
offer supplies the corresponding `resource.mimeType` directly; mismatched
seller and upstream formats fail during configuration preparation.

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "bindings": {
    "observations": {
      "origin": "https://api.merchant.example",
      "path": "/v1/observations",
      "method": "GET",
      "query": ["region"],
      "headerEnv": {"Authorization": "MERCHANT_BACKEND_AUTH"},
      "responseHeaders": ["content-language"],
      "responseMode": "sse",
      "timeoutMs": 10000,
      "maxInFlight": 16,
      "stream": {
        "maxBytes": 67108864,
        "maxDurationMs": 60000,
        "idleTimeoutMs": 10000
      },
      "availability": {"failureThreshold": 3, "resetAfterMs": 30000}
    }
  }
}
```

Use the existing `headerEnv` or OAuth client-credentials facilities for private
backend credentials. Input names, repeated query values, JSON request bodies,
path parameters, allowed request and response headers, public DNS checks and
TLS verification follow the original [upstream guide](UPSTREAM.md). The client
cannot supply a new backend origin or credential provider. A streaming request
uses one connection to the configured operation and follows no redirects.

`responseMode` determines the expected media type. SSE requires
`text/event-stream`; NDJSON accepts `application/x-ndjson` or
`application/ndjson` from the backend and publishes `application/x-ndjson` to
the buyer. An advertised charset must be UTF-8. The source transport accepts
identity, gzip, deflate and Brotli encoding, removes transport encoding, and
passes the original decompressed bytes to the seller's stream validator.
Payment, hop-by-hop and backend credential headers remain owned by their
original components.

Streaming success requires HTTP 200. Redirects, unexpected media types,
unsupported encodings, incomplete HTTP bodies and upstream errors produce the
existing sanitized backend failure path. Valid `Retry-After` for original
429/503 responses remains available. OAuth invalidates the credential rejected
by a 401 using the existing provider; the adapter does not retry the operation.

Streaming is a response-body mode. HEAD, buffered shared-response caching,
stored idempotent response replay and whole-document JSON response contracts
remain separate existing modes and cannot be combined with a streaming binding.
For record-level processing, use the original buyer's streaming capture and
consumer API; it validates records while preserving the original byte capture.

## Limits, capacity and cancellation

| Setting | Default | Meaning |
| --- | ---: | --- |
| `timeoutMs` | 10,000 ms | Original credential resolution and response-header deadline |
| `stream.maxBytes` | 64 MiB | Maximum encoded wire bytes and decompressed source bytes |
| `stream.maxDurationMs` | 60,000 ms | Maximum source connection lifetime |
| `stream.idleTimeoutMs` | 10,000 ms | Maximum wait for the next requested source chunk |
| `maxInFlight` | 16 | Backend requests still producing or waiting to finish |

`stream.maxBytes` accepts 1 byte through 1 GiB. The seller's global stream byte
limit can impose a smaller cap. `maxDurationMs` accepts up to one hour and
`idleTimeoutMs` up to five minutes. Set the existing seller
`handlerTimeoutMs` to cover complete generation in authorization mode, and
`requestTimeoutMs` and graceful-drain deadline to fit the actual product. A
shorter seller, reverse-proxy or buyer deadline can end the stream first.

The transport never buffers the entire response in memory. Its Node readable
pipeline and the seller's writer propagate backpressure. Compression buffers
and the next source chunk remain bounded by the native stream pipeline; the
authorization flow's completed payload resides in the seller's private spool.
An idle deadline measures an outstanding read, so time deliberately spent
waiting for a downstream consumer is not treated as another backend read.
The overall source deadline still applies during downstream backpressure.

The backend capacity slot stays held after response headers are received. A
source failure releases it immediately; successful completion is committed by
the seller's final `close()` after validation and delivery. Natural EOF closes
the physical backend connection immediately while preserving the final record
validation result. A cancelled buyer, seller drain or abandoned response
destroys the same backend connection and decompression pipeline. A response
object that is never iterated can still be closed and releases its resources.

The existing availability controller similarly retains a recovery trial until
the source reaches its terminal result. HTTP 200 headers alone cannot clear a
failure streak. Diagnostics contain format, limits, counts, byte totals and
sanitized outcomes; they retain no backend URL, credential, query or record
contents. Existing operations snapshots show these fields on the same
upstream binding.

## Embed the same source

Existing applications can use `createUpstreamHandlers()` or
`createUpstreamApplication()` with the JSON format above. Trusted local code
can also use the original `createUpstreamHandler()` with
`responseType: "sse"` or `"ndjson"` and the same `stream` settings. Server
credentials, allowed input headers and the source origin remain operator
configuration.

The handler returns the seller's stream response contract:

```js
{
  status: 200,
  headers: { "content-type": "text/event-stream; charset=utf-8" },
  stream: {
    format: "sse",
    body: originalAsyncByteSource,
    maxBytes: 67108864,
    maxDurationMs: 60000,
    idleTimeoutMs: 10000,
    close: async reason => { /* close the original source */ }
  }
}
```

`body` is an async iterable of `Uint8Array` chunks. A streaming response has
no separate response `body` value. The original seller owns validation,
payment-flow selection, private capture where needed and buyer delivery.
Source `close()` is idempotent and safe before iteration, during delivery, and
after natural completion. Keep application cancellation connected to the
original handler context's `signal`.

For a source produced directly by local application code, the exported
`streamingResponse()` helper creates that same response object. This complete
handler samples its actual running process; place the module at the repository
root and register `telemetryRecords` with the existing seller application:

```js
import { setTimeout as delay } from 'node:timers/promises';
import { streamingResponse } from './stellar/scf-starforge-20261009/sf30-seller-sdk/embedded/index.mjs';

export function telemetryRecords({ signal }) {
  const cancellation = new AbortController();
  const sourceSignal = AbortSignal.any([signal, cancellation.signal]);
  return streamingResponse({
    format: 'ndjson',
    maxBytes: 1048576,
    maxDurationMs: 10000,
    idleTimeoutMs: 5000,
    body: (async function* () {
      for (let sequence = 1; sequence <= 8; sequence++) {
        if (sequence > 1) await delay(250, undefined, { signal: sourceSignal });
        sourceSignal.throwIfAborted();
        yield Buffer.from(JSON.stringify({
          sequence, observedAt: new Date().toISOString(),
          residentBytes: process.memoryUsage().rss
        }) + '\n');
      }
    })(),
    close(reason) { cancellation.abort(reason); }
  });
}
```

Declare the same `responseFormat: "ndjson"` on its original route. The default
authorization flow captures this complete resource before settlement. Selecting
the original explicit upfront terms lets the seller deliver its records live.
The helper does not change that route's native payment flow.
The original `seller/embedded` package entry exports the same helper with
`SellerResponseStream`, `SellerStreamingResponseOptions` and
`SellerStreamingResponse` types for application authors.

The upstream transport requires no new dependency. Native payment uses the
installed original x402 packages; the buyer integration keeps the existing
spending ledger, native receipt and exact partial or complete capture together.
For the current buyer options, see the
[Node customer API](../sf88-operator-buyer-cli/node/README.md) and
[operator buyer workspace](../sf88-operator-buyer-cli/README.md).

## Export the merchant's customer client

The existing developer page exports this merchant's original OpenAPI and
standalone typed customer client. Streaming operations keep their actual
resource MIME type. Build the request with the original operation ID and an
explicit spending ceiling; add `paymentFlow: 'upfront'` only for the selected
upfront offer. The generated client defaults to authorization and rejects a
different selected flow before making a request.

Compose its existing delegation with the installed Node buyer's stream capture:

```js
import { createSellerClient } from './seller-client.mjs';

const api = createSellerClient({
  buyer: {
    call: request => configuredBuyer.call(request, {
      responseFile: {
        maxBytes: 67108864,
        timeoutMs: 120000,
        stream: { format: 'sse', maxRecordBytes: 1048576, maxRecords: 100000 }
      }
    })
  }
});

const outcome = await api.call('telemetry-events', {
  query: { count: '8', intervalMs: '250' }
}, {
  intentId: yourStableIntentId,
  maxAtomic: yourExplicitAtomicCeiling,
  paymentFlow: 'upfront',
  signal: yourAbortController.signal
});
```

`configuredBuyer` retains its original private output location, spending ledger,
native signer and approval policy. Use the matching `ndjson` capture and default
authorization flow for the second example. The generated client invokes that
buyer once and returns the same result. Its typed output comes from the buyer;
the merchant's sample record does not create an inferred result contract.

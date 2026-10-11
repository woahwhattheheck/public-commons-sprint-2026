# Connect an existing API to an SF30 seller

`upstream-handler.mjs` supplies the application half of the existing seller runtime: an operator-owned HTTP API becomes an SF30 handler without another payment server or a backend rewrite. It uses Node 22+ built-ins only. The original [seller service](./README.md) still compiles the offer, verifies the payment, invokes the handler, and controls settlement and delivery.

## Use the existing handler entrypoint

Keep a trusted local `application.mjs` beside your seller config. Import this module from its actual checkout path:

```js
import { createUpstreamHandler } from './upstream-handler.mjs';

export const weather = createUpstreamHandler({
  baseUrl: process.env.WEATHER_API_ORIGIN,
  path: '/v1/forecast',
  method: 'GET',
  query: { city: 'q', days: 'days' },
  headers: () => {
    const key = process.env.WEATHER_API_KEY;
    if (!key) throw new Error('Missing upstream credential');
    return { Authorization: `Bearer ${key}` };
  },
  requestHeaders: ['accept-language'],
  timeoutMs: 10000,
  maxResponseBytes: 1048576,
  maxInFlight: 16,
});
```

In the existing service JSON, bind the intended route with `"handler": "weather"` instead of `response`. Retain its original verified payment terms and public resource identity. Start it with the existing CLI:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /absolute/path/seller.json --handlers application.mjs
```

Without `--facilitator`, this serves payment challenges only and makes **no upstream application request**. For a deployed payment-enabled service, use the original [native runtime instructions](./README.md#enable-the-native-x402-runtime) and your configured facilitator. Neither this module nor the example provisions a wallet, approves a price, or establishes a real settlement. The environment values belong to the merchant; no API key goes in the service JSON or repository.

The import path in the snippet assumes `application.mjs` is beside this module. Adjust only that import when your config/application directory is elsewhere. The CLI resolves `--handlers` relative to the **config file**, not the shell directory. A separate declarative bindings/launcher integration can call the same factory; do not create a second forwarding implementation.

## Interface

`createUpstreamHandler(options)` returns an async function for the original SF30 `{method, url, pathParams, headers, body}` application context. It returns the original `{status, headers, body}` result shape. `handler.snapshot()` provides a frozen copy of aggregate counters.

| Option | Default | Contract |
| --- | --- | --- |
| `baseUrl` | Required | Trusted, operator-configured HTTPS base URL; a path prefix is preserved. No user info, query or fragment. |
| `path` | Required | Fixed upstream path, optionally whole `:name` segments from native `pathParams`. It cannot be supplied as a buyer URL. |
| `method` | `GET` | Exactly `GET`, `HEAD`, `DELETE` or JSON `POST`, `PUT`, `PATCH`; must equal the incoming operation. |
| `query` | `[]` | Allowed input names, or an input-to-upstream-name object. Unknown names return 400; repeated values and their order survive. |
| `headers` | `{}` | Trusted server headers or a **synchronous**, no-argument function returning them. The function can read rotated environment credentials. |
| `requestHeaders` | `[]` | Explicit noncredential request headers to forward. Server headers take precedence. |
| `responseHeaders` | Content type/language | Explicit response header names. Payment, credential and hop-by-hop headers cannot be exposed. Connection-nominated fields are also stripped. |
| `responseType` | `json` | `json` validates media type, UTF-8 and JSON, retaining decoded bytes. `bytes` permits binary content. |
| `timeoutMs` | `10000` | Total request/response deadline; integer 1–120000. |
| `maxRequestBytes` | 1 MiB | Serialized JSON request limit; integer 1–16 MiB. |
| `maxResponseBytes` | 1 MiB | Separate compressed-wire and decoded-content limits; integer 1–16 MiB. Keep within the outer seller's response limit. |
| `maxInFlight` | `16` | Per-handler concurrent upstream requests; integer 1–256. Excess requests return 503 immediately, with no queue. |
| `allowLocal` | `false` | Explicit development-only HTTP to loopback. It does not disable HTTPS certificate verification. |
| `lookup` | Node resolver | Optional trusted Node-style DNS lookup callback. Passed to socket creation unchanged; can enforce the deployment's public-IP policy. |
| `onResult` | Absent | Best-effort completion callback, with status, method, duration, byte count and safe error code only. |

Unknown options and invalid static configuration throw during construction. An unavailable credential factory returns `503 UPSTREAM_CONFIGURATION_UNAVAILABLE` without making an upstream request.

For example, base `https://api.example/v2`, path `/records/:id`, and native `pathParams.id = 'Clé 1'` produce `/v2/records/Cl%C3%A9%201`. Slashes, percent escapes, controls and dot traversal in parameter values are rejected. Dynamic public routes still need the existing [OpenAPI importer](../sf61-openapi-seller-import/README.md) and its imported offer/path schema; this handler does not relax those contracts.

POST, PUT and PATCH forward the parsed JSON value, including explicit `null`, by serializing it once. This preserves JSON meaning, **not the original incoming whitespace/member formatting or raw-body signature**. GET, HEAD and DELETE have no request body. Multipart, arbitrary request streams, range responses and WebSockets are not supported.

## Delivery and failure semantics

The existing SF30 resource server owns the sequence: native verification → upstream handler → validate/buffer output → native settlement → release successful content. An upstream failure returns a nonpayment error status, entering the original cancellation path instead of settling a successful application result. The handler must not be used as an independently exposed free proxy.

Successful JSON and binary responses are buffered; gzip, deflate and Brotli are decoded before delivery. Both wire and decoded limits are enforced while reading. `HEAD`, 204 and 205 return an empty body. The original seller sets the final content length, cache policy and payment response headers. Upstream cookies, credentials, payment headers and private error bodies are not passed through.

| Condition | Handler result |
| --- | --- |
| Invalid method, parameters, query or JSON request | 400 `UPSTREAM_REQUEST_INVALID`; no request |
| Capacity exhausted / credential unavailable | 503; no request |
| Deadline exceeded | 504 `UPSTREAM_TIMEOUT` |
| Upstream redirect or nested 402 | 502; no redirect, secondary payment or retry |
| Upstream 401/403 | 502 `UPSTREAM_AUTH_FAILED`; private error body withheld |
| Other upstream 4xx/5xx | Original status, sanitized error; valid `Retry-After` retained for 429/503 |
| Invalid media type/JSON, unsupported encoding, partial or oversized body | 502; no partial successful content |
| Network/TLS failure | 502 `UPSTREAM_UNAVAILABLE` |

There is exactly one upstream request per invocation. No automatic retry is attempted, including after a timed-out PUT, PATCH, DELETE or POST. A fresh connection is used each time, trading connection-pool efficiency for a simple per-operation lifetime. Timeout and error paths destroy the request and body streams.

**Do not use settlement failure as a transaction rollback for a mutating backend.** POST, PUT, PATCH or DELETE can complete an upstream side effect before settlement or delivery fails; the handler cannot undo it. Retain the backend's own explicit business-idempotency design and reconciliation for mutations. The original SDK determines cancellation/settlement behavior; this module neither promises refunds nor changes an already executed backend operation.

## Operator trust and diagnostics

Upstream configuration is trusted local code. A configured HTTPS host may intentionally be a private backend; this is **not** a public-DNS allowlist or a DNS-pinning transport for untrusted discovered URLs. Never build `baseUrl`, static credentials or path configuration directly from buyer input. Use the deployment's egress policy for network restrictions. Normal Node HTTPS certificate verification remains enabled.

A declarative public-origin launcher can supply `lookup(hostname, options, callback)` from its existing resolver. The callback must honor Node's `options.all`: return an address/family array when true, otherwise the single address and family. Passing it directly to socket creation allows that resolver to return only addresses it has actually validated while retaining the original URL host for Host/TLS identity. This module does not itself resolve, re-resolve, or assert the callback's IP classification. The same total deadline covers a resolver that never completes; no TLS bypass or connection fallback is added.

The module does not retain URLs, credentials or application bodies in its diagnostics. `snapshot()` counts started/completed/in-flight upstream requests, failures, timeouts and successful decoded response bytes; preflight/capacity/configuration rejections are excluded from those started-request counters. `onResult` runs after completion and cannot alter delivery, even if it throws. It is not a payment or revenue ledger. Successful upstream content is delivered as configured, **not secret-scanned**: the backend must not echo its own credentials or private internal fields.

## Execute the shipped check

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/upstream-acceptance.mjs
```

One real loopback HTTP run exercises four groups: path/query/header isolation, credential rotation and trusted socket lookup; JSON POST/null, HEAD and gzip delivery; failed/redirected/malformed/partial/oversized responses without retries; deadline/concurrency recovery and content-free metrics. On Node 22.16.0 it completed 16 upstream requests with all four groups passing. No npm install, external API, GitHub Actions or payment is involved. This runner checks the application transport; it does not stand in for the existing native SDK integration or a real merchant settlement.

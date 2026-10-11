# Embed a Starforge seller in an existing application

The embedded seller mounts the maintained SF30 merchant engine in a Node HTTP,
Connect or Express application. The application keeps its listener, authentication,
free endpoints and framework. The original seller compiler, request adapter,
native x402 server and lifecycle operate the configured paid routes.

The module exports `createEmbeddedSeller` and `getEmbeddedRequestContext` from
`embedded/index.mjs`. The maintained merchant distribution exposes the same module
as `@tokenjunkielabs/starforge-merchant/seller/embedded`. Its adjacent `index.d.mts`
provides TypeScript declarations. Node 22.16 or later is required; embedding adds
no framework or payment dependency. Use the existing application's Express version.

## Run the supplied Node application

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/embedded/example-node.mjs
```

The startup line gives one local address. `/health` is the existing free application,
`/api/dataset` returns the original example's HTTP 402 challenge, and
`/_seller/docs` opens the original seller explorer. The example imports the
maintained example product and uses its development payment markers. Its advertised
resource is `https://merchant.example/api/dataset`; the incoming Host header never
changes that resource or its terms. Stop the process to drain the merchant and then
close the application's listener.

## Connect the original native facilitator

Supply the existing original facilitator client to the maintained native factory.
Keep its configured keys, payment policy and network in that original component.

```js
import { createEmbeddedSeller, getEmbeddedRequestContext } from
  '@tokenjunkielabs/starforge-merchant/seller/embedded';
import { createNativeSellerServer } from
  '@tokenjunkielabs/starforge-merchant/seller/native';

const seller = await createEmbeddedSeller({
  routes: [{
    id: 'insights',
    offer: originalCompiledOffer,
    admit: async request => {
      const account = getEmbeddedRequestContext().account;
      return existingReadinessCheck(account, request);
    },
    handler: async request => {
      const account = getEmbeddedRequestContext().account;
      return existingInsightsHandler(account, request);
    },
  }],
  nativeFactory: compiled => createNativeSellerServer(compiled, {
    facilitatorClient: existingFacilitatorClient,
  }),
  contextFromRequest: req => ({ account: req.account }),
  maxInFlight: 32,
  drainGraceMs: 60000,
});
```

`offer` is the original complete Bazaar/x402 offer. Alternatively, use a route's
`definition` with its trusted full `url` and the original SF30 payment declaration.
Exactly one of `offer` and `definition` belongs on each route. The same compiler
enforces original method, path, ordered payment options, amount and schema rules.
An application that already called `compileSellerRoutes` can supply its `compiled`
result instead of `routes`. `nativeFactory` receives that exact compiled object.

The application handler receives the original `{method, url, query, body,
pathParams, headers, signal, deadlineEpochMillis}`. Return its normal SF30
`{status, headers, body}` response. Admission and application execution retain
their original timeout, cancellation and settlement behavior. The application
does not call `verify` or `settle` a second time. Put a billable upstream operation
only inside the original handler; use admission for readiness and entitlement checks.

## Mount in Express or Connect

```js
app.use(existingAuthentication); // Attach the account without consuming JSON.
app.use(seller.middleware);
app.use(express.json());
app.use(existingApplicationRoutes);
```

The middleware consumes configured paid paths and passes unrelated requests to
`next()`. A configured path with the wrong HTTP method receives the original 405
and `Allow` header, keeping a later free route from accidentally handling that
paid resource. Existing authenticated API-key routes can finish under their
existing application policy before this mount; retain one chosen execution path
for each request. The seller's paid handler calls the same existing application
operation only after native verification.
Native-equivalent case, encoded-path and trailing-slash aliases also stay owned:
the original adapter either accepts the exact path or returns its normal error,
even when a later framework route uses more permissive matching.

Mount the seller before any JSON, form, raw or text body parser for its routes.
The original adapter reads `IncomingMessage` itself. If a parser has already
consumed a JSON request, the seller returns `400 SELLER_BODY_ALREADY_CONSUMED`.
It never reconstructs request bytes from a framework's parsed object.

Express mount paths are supported. For example, `app.use('/api', seller.middleware)`
can handle an offer whose full path is `/api/insights`: selection and native
dispatch use Express's complete `originalUrl`, including its query. The middleware
restores `req.url` after its owned dispatch. Preserve `originalUrl` through prior
middleware. To expose the original explorer with a mounted API, also mount
`app.use('/_seller', seller.middleware)`, or use one application-level mount.

`contextFromRequest` synchronously selects the host values that existing admission
and application code need. Authentication can finish asynchronously in preceding
middleware. `getEmbeddedRequestContext()` returns that request's selected value
across its asynchronous work and returns `undefined` outside an embedded request.
Contexts use Node's `AsyncLocalStorage`; they are excluded from health and offer
responses. Return a fresh object when mutable values must be isolated.

## Use a plain Node listener

```js
const server = createServer(async (req, res) => {
  if (await seller.handle(req, res)) return;
  existingApplicationHandler(req, res);
});
```

`handle` resolves `true` after it consumes the request and `false` when the host
should continue. Await it before dispatching to another handler. A Node host can
omit `originalUrl`; the incoming `url` is then used directly. The caller owns
listener binding, TLS/proxy configuration, HTTP parsing timeouts and process signals.

## Operate and drain the merchant

The existing documentation assets, generated OpenAPI and customer-client downloads
are available under `/_seller`. `/_seller/offers`, `/_seller/health` and
`/_seller/ready` expose original offers, current request lifetime and merchant
admission state. These paths stay outside the paid request capacity limit.
`documentation: false` leaves the reserved namespace to the host; paid resources
cannot be declared there. Use one documentation-enabled seller per host namespace.
Dynamic resource paths need a fixed first segment, such as `/api/:id`, so a
parameter cannot select the reserved documentation namespace.

```js
await seller.close();               // Stop and drain only this merchant.
await existingFacilitator.drain();   // If this application owns that facilitator.
server.close();                     // Close the host when its own work is ready.
```

`close()` immediately stops new paid admission, returning `503 SELLER_DRAINING`
for later resource requests. It reuses the original SF30 lifecycle and retains
each slot until both the HTTP response and original dispatch finish. Concurrent
free endpoints and the host listener continue serving. Calls to `close()` share
the same result; `snapshot()` remains available throughout shutdown.

If `drainGraceMs` expires, the original lifecycle reports
`SELLER_DRAIN_DEADLINE_EXCEEDED`. Only outstanding merchant responses are destroyed;
the host listener is retained. Node may close a connection carrying an interrupted
paid response, so any other pipelined requests on that same connection can also
end. Original pending native work remains reflected in the lifecycle/request
snapshot. Reconcile its original outcome before deciding on a payment retry.
When shutting down the entire application, close its listener even if merchant
draining reports an error, and retain that original error for the operator. The
supplied Node example implements this error path as well as ordinary shutdown.

The options `maxRequestBytes`, `maxResponseBytes`, `admissionTimeoutMs`,
`handlerTimeoutMs` and `requestTimeoutMs` pass to the original resource adapter.
`maxInFlight` and `drainGraceMs` pass to its original lifecycle. Their existing
validation and defaults apply unchanged.

## Integration references

- [Original resource adapter and callable API](../README.md)
- [Original request lifetime](../REQUEST_LIFETIME.md)
- [Original handler lifecycle](../HANDLER_LIFECYCLE.md)
- [Express middleware and mount paths](https://expressjs.com/en/guide/using-middleware/)
- [Node asynchronous request context](https://nodejs.org/api/async_context.html)

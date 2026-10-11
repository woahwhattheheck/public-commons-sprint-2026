# Keep backend outages out of payment verification

The existing SF30 upstream launcher can check backend availability before entering
the original native payment adapter. Repeated failed backend calls open a
per-binding circuit. New requests receive HTTP 429 with `Retry-After` from the
existing admission stage, without calling the native verifier or backend. After
the configured interval, one original backend call decides recovery.

This uses the same seller configuration, application handler, native x402 SDK,
cancellation path and operations listener. There are no periodic probes,
background requests, automatic retries or separate payment services. Node 22+;
the ordinary challenge-only setup needs no npm dependencies.

## Enable it on an existing binding

Add `availability` to a binding in your private `seller-upstreams.v1` JSON:

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "bindings": {
    "merchantSearch": {
      "origin": "https://api.merchant.example",
      "path": "/v1/search",
      "query": ["q"],
      "headerEnv": {"Authorization": "MERCHANT_BACKEND_AUTH"},
      "maxInFlight": 16,
      "availability": {
        "failureThreshold": 3,
        "resetAfterMs": 30000,
        "maxResetAfterMs": 300000
      }
    }
  }
}
```

Keep the original seller route's `handler: "merchantSearch"` and payment terms.
No manually named admission export is needed for availability. The launcher
derives a separate in-memory configuration and composes the check through the
original `admit` hook. A route using `validateInput: true` retains the original
schema admission first. Omitting `availability` preserves existing behavior.

Validate, then use the maintained operations launcher:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/upstream-serve.mjs" --config /private/seller.json \
  --upstreams /private/upstreams.json --check

node "$S/operations/launch.mjs" --upstream --operations-port 8424 -- \
  --config /private/seller.json --upstreams /private/upstreams.json \
  --facilitator https://merchant-facilitator.example/facilitator
```

Use the existing facilitator configuration and verified merchant terms described
in [UPSTREAM.md](UPSTREAM.md). Startup prints the ordinary seller and operations
URLs. In challenge-only mode the original seller returns 402 before admission
and never invokes the backend; those challenges do not establish backend health.

## Failure and recovery

| State | Next original request |
| --- | --- |
| `CLOSED` | May enter native verification; capacity is still checked. This state alone does not prove backend health. |
| `OPEN` | Admission returns 429 and a retry interval before native verification. |
| `RECOVERY_READY` | Cooldown elapsed; the next application call may try the original backend. No timer sends it. |
| `RECOVERY_IN_FLIGHT` | One recovery call is active; new admissions return 429. |

`failureThreshold` counts consecutive completed backend availability failures,
not ordinary caller mistakes. It accepts integers 1–100, default 3. Network
failures, timeouts, malformed/incomplete responses, backend authentication
failures, backend HTTP 429 and backend HTTP 5xx count. An ordinary backend 4xx
shows that it responded and clears the streak; the original failure response
still follows native cancellation. Invalid local inputs and local capacity
rejection do not count as backend outages.

`resetAfterMs` is 100–3,600,000 ms, default 30,000. A failed recovery doubles that
interval up to `maxResetAfterMs`, which must be at least `resetAfterMs` and at most
3,600,000 ms. The default maximum is 300,000 ms, or the configured initial interval
if higher. Successful recovery resets the interval. These are operator-owned
circuit intervals; the backend response's original `Retry-After` stays on that
response and is not interpreted as a new scheduling command.

Routes sharing a binding share capacity and circuit state. Separate bindings are
independent. A successful call already in flight when the circuit opens cannot
close it; only the designated recovery call can. Availability is observed before
native settlement, so recovery does not establish any payment outcome.

Admission is **not a capacity reservation**. Several callers can pass a check
before individual native verification completes. The handler rechecks and allows
only one recovery backend call. A caller losing that race follows the original
application's 503/cancellation path. The adapter does not promise that every race
is rejected before verification, reverse a prior settlement or retry an uncertain
POST. Mutating backends still need their own idempotency/business transactions.

## Operate the same dashboard

The original operations page adds a **Backend availability** table: binding name,
state, current capacity, backend failures, availability admission rejections,
recovery calls, retry interval and last handler HTTP status. `Unobserved` means
the controller has no recorded result. Existing route traffic and recent outcomes
stay in the same view.

`GET /api/upstreams` on the private operations listener returns
`stellar-forge.seller-upstream-availability.v1`. The ordinary `/api/snapshot` and
JSON export also include it as `upstreams`. Non-upstream sellers have no extra
field and `/api/upstreams` returns 404. Existing loopback binding, Host/Origin
checks, read-only methods and response policy apply.

No backend origin, path, request parameters, credentials or payloads enter this
view. State and counters live in process memory. Restart begins a new observation
period; it does not establish recovery. For a persistent failure, use the binding
name to inspect its private configuration, credential injection, original backend
logs and error class. Correct the backend, then let the next explicit request
after cooldown exercise the same route. There is no reset or replay button.

## Embed without the CLI

```js
import { readSellerConfig, startSellerService } from './serve.mjs';
import { readUpstreamBindings, createUpstreamApplication } from './upstream.mjs';

const config = await readSellerConfig('/private/seller.json');
const bindings = await readUpstreamBindings('/private/upstreams.json');
const application = createUpstreamApplication(config, bindings);
const session = await startSellerService({
  config: application.config,
  handlers: application.handlers,
  nativeFactory: yourExistingNativeFactory,
});
session.upstreamSnapshot = application.snapshot;
// Original startSellerOperations(session) now includes backend availability.
```

`createUpstreamHandlers()` remains available. Protected handlers expose
`.admit(context)` and `.snapshot().availability`; embeddings must wire `.admit`
into their original seller route for rejection before verification.
`protectUpstream()` preserves the wrapped handler's admission decision and
`.idempotency` interface so original application controls compose.

The focused `upstream-readiness-acceptance.mjs` journey uses the original seller,
HTTP backend handler, operations listener and native x402 2.28.0 SDK on loopback.
Its explicit in-process facilitator returns controlled outcomes; no wallet,
real payment, external service or on-chain transaction is used. Run only when
this availability behavior needs verification, with the original optional SDK
packages installed as described in the seller README.

MIT. Original contracts: [admission](ADMISSION.md),
[upstream handler](UPSTREAM_HANDLER.md), [operations](operations/README.md),
and [native factory](native-factory.mjs).

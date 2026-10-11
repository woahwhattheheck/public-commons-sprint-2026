# Durable merchant POST operations

The original SF30 upstream launcher can protect a merchant POST against duplicate
backend execution. Each request carries a merchant-issued operation ticket bound
to its exact request. SQLite claims the operation before opening the backend
request and retains the result across restarts. The existing native x402
verification, handler, cancellation and settlement remain the payment path.

Requires Node **22.13+** or 24 with built-in `node:sqlite`, an existing private
local directory and the merchant's existing backend. No additional npm package,
wallet implementation or hosted CI is needed. Issuance, status and recovery make
no network request or payment.

## Configure the existing seller

Add `idempotency` to an original upstream binding:

```json
{
  "schema": "stellar-forge.seller-upstreams.v1",
  "bindings": {
    "createOrder": {
      "origin": "https://api.merchant.example",
      "path": "/v1/orders",
      "method": "POST",
      "headerEnv": {"Authorization": "MERCHANT_BACKEND_AUTH"},
      "responseMode": "json",
      "idempotency": {
        "scope": "merchant-a-orders-v1",
        "stateDir": "/private/merchant/operations",
        "keyEnv": "MERCHANT_OPERATION_KEY",
        "admission": "admitCreateOrder",
        "requestHeader": "x-merchant-operation",
        "backendHeader": "idempotency-key",
        "maxEntries": 10000,
        "maxStoredBytes": 268435456,
        "maxTicketSeconds": 86400,
        "waitMs": 15000
      }
    }
  }
}
```

On the corresponding original seller route use `handler:"createOrder"` and
`admit:"admitCreateOrder"`. For an actual imported SF61 offer, also set
`validateInput:true`. The original SF30 configured admission then runs the
existing SF89 request-schema validation and the operation-ticket admission.
Retain the real original offer, public origin, price, asset, recipient and
facilitator configuration. Ordinary definition routes may use the ticket
admission without claiming an imported schema.

The launcher rejects an idempotent binding whose seller route omits or changes
its configured admission. Admission names and state directories must be distinct
across bindings. Other upstream routes keep their existing behavior.

The state directory must already exist, have mode `0700`, use a canonical
absolute path without symlinks, and reside on the same machine's local filesystem.
The database is `0600`, with WAL and `synchronous=FULL`. Do not place it on NFS.
`maxStoredBytes` bounds retained response payloads plus reserved in-flight payload
capacity; SQLite metadata and WAL overhead are additional. The existing upstream
response-size limit applies to each response. There is no automatic record expiry
or deletion, because removing a completed identity could make a reissued ticket
execute the backend again.

`keyEnv` names a merchant-provisioned **32-byte hexadecimal HMAC key** in the
existing deployment environment; JSON contains only the variable name. It is an
operation-ticket key, not a wallet key. Backend credentials use existing
`headerEnv`. The ticket and backend idempotency headers are server-owned: neither
may appear in forwarded or credential header mappings.

`scope` identifies one merchant/backend tenant and operation contract version.
Preserve it across restarts and routine credential rotations. Different backend
tenants or operation meanings need distinct scopes; retain the previous state.
Rotating the ticket key invalidates outstanding tickets, but reissuing for the
same scope/subject/id preserves the durable operation identity.

Use the original launcher and operations commands in [UPSTREAM.md](UPSTREAM.md).
`--check` reads and validates configuration without opening SQLite or networking.
Challenge-only SF30 never enters the application or ticket admission and never
claims a backend operation.

The original upstream launcher now uses `createUpstreamApplication()` to compose
the configured ticket admission with optional `availability`. It clones the
seller config, installs the composed admission under an internal export, and
preserves `validateInput:true`. In a custom embedding, pass both its returned
`config` and `handlers` to the original `startSellerService()`; attach its
`snapshot` as the session's `upstreamSnapshot` for the existing operations view.
The lower-level `createUpstreamHandlers()` still exports the configured admission
name for original `serve.mjs` integrations.

Availability runs before ticket admission, so an open or saturated binding can
reject a replay as well as a new operation. Once admitted, replay and coalesced
waiters do not count as new backend calls or heal an open circuit. The original
handler reports only the actual invocation's transport outcome to availability;
that private metadata is not persisted or sent over HTTP. A configured original
`responseContract` also applies to imported recovery responses and completed
replay. A contract mismatch returns a controlled failure without re-executing
the merchant mutation.

## Issue one exact operation

Prepare a private `0600` request file using the real source URL, actual named path
values, forwarded ordinary headers and JSON body:

```json
{
  "method": "POST",
  "url": "https://merchant.example/orders",
  "pathParams": {},
  "headers": {},
  "body": {"sku": "item-17", "quantity": 2}
}
```

Run the offline issuer with an explicit operation ID, opaque customer reference,
and real future expiry within `maxTicketSeconds`. Replace the example expiry:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/upstream-operation.mjs issue \
  --upstreams /private/merchant/upstreams.json --binding createOrder \
  --request /private/merchant/order-request.json --id order-17 --subject customer-42 \
  --expires 2026-10-12T12:00:00Z --out /private/merchant/order-ticket.json
```

The output file is create-only `0600` under an existing private directory. The
command prints the operation key, request hash, expiry and file path; it does not
print the bearer ticket or merchant key. The file's `ticket` is the exact value
for the configured `x-merchant-operation` request header. Deliver it through the
merchant's existing authenticated customer channel. This tooling sends nothing.

The HMAC authenticates the merchant-issued capability, its scope, opaque subject,
operation ID, request hash and expiry. Possession is bearer authority to name the
exact backend operation; it does not independently identify the HTTP caller or
Stellar payer. Retain the merchant's original identity admission when required.
The native x402 gate independently governs each request.

The request hash binds the source URL, mapped backend URL and query order, method,
permitted forwarded header values, and canonical JSON body bytes. Object keys
are sorted recursively once; **those same bytes** are sent to the backend.
Array order and values matter. Raw JSON whitespace and object-key order do not
create distinct operations. A changed request under the same operation identity
conflicts even if the merchant issues a second valid ticket for it. The ticket
is not forwarded upstream; the transport sends only the stable `sf30_...` backend
key through the configured backend header, alongside original backend credentials.

Existing native HTTP clients can carry the ticket as an ordinary merchant header.
The programmatic SF31 client supports ordinary request headers; the narrower
SF88 configuration currently admits only Content-Type/Accept and does not yet
provide an operation-ticket field. Do not place a ticket in a URL or reinterpret
it as `PAYMENT-SIGNATURE`.

## Execution and recovery

| State or event | Behavior |
| --- | --- |
| Missing, invalid, expired or mismatched ticket | Rejected during admission before native verification. |
| First native-approved operation | Transactional claim, then one original upstream request. |
| Concurrent matching duplicate | Waits for the original stored result across local processes; no second backend call. A cancelled waiter leaves the original call running. |
| Completed operation | Replays original status, permitted headers and bytes without contacting the backend. |
| Capacity refusal before dispatch | Persists `RETRY_READY`; a later independently admitted request may try. |
| Timeout, abort or incomplete response after dispatch | Persists `UNCERTAIN`; a restart never silently repeats the POST. |
| Process loss after claim | Retains `IN_FLIGHT` for explicit crashed-process recovery. |
| Accepted upstream outcome, including a normalized HTTP error | Persists `COMPLETE` before returning. This means an observed outcome, not business success or payment. |

The original transport consumes application `context.signal` and closes its
socket and decoder on cancellation. The executing request owns the attempt; its
interruption may leave all duplicates with one uncertain outcome. A duplicate's
own cancelled wait does not cancel the original request. Waiting is limited by
`waitMs`; original seller admission/handler deadlines remain authoritative.

**Backend operation idempotency and payment idempotency are separate.** Replayed
and concurrent requests still pass through original native x402 verification and
settlement. This feature cannot promise one charge across separately approved
paid requests, undo a charge, or authorize a free retry of a lost payment response.
Preserve the original buyer operation and payment evidence during recovery.

Inspect the actual operation key emitted at issuance:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/upstream-operation.mjs status \
  --upstreams /private/merchant/upstreams.json --binding createOrder \
  --operation-key ACTUAL_64_HEX_OPERATION_KEY
```

Status returns state, request hash, attempt, generation, timestamps, response hash
and recovery reference. It does not print request content, ticket or response
body. Recovery requires those exact current identifiers and a source reference
to the merchant backend record:

- `complete` imports the actual backend response found through the merchant's
  order lookup/support path. The private JSON response file contains `status`,
  allowed `headers`, and exactly one of `body` or `bodyBase64`. Base64 preserves
  exact binary or JSON bytes. The imported result becomes available for replay.
- `retry` permits one later backend attempt under the same key and request hash.
  Use the backend's actual lookup/idempotency contract to establish that this
  decision is valid. Recording it performs no request; the later original native
  operation still requires ticket admission and payment verification.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/upstream-operation.mjs recover \
  --upstreams /private/merchant/upstreams.json --binding createOrder \
  --operation-key ACTUAL_64_HEX_OPERATION_KEY --generation ACTUAL_GENERATION \
  --request-hash ACTUAL_64_HEX_REQUEST_HASH --action complete \
  --reference merchant-order-lookup-17 --response /private/merchant/recovered-response.json
```

A newer generation, completed result or live owner process prevents recovery
from overwriting concurrent work. Crashed Linux process recovery stores the
stable hostname hash separately from the boot identity and process start time.
It requires the same host and compares both boot and start identity before
treating a matching PID as a live owner. A reused PID or a prior boot therefore
cannot impersonate the old process; explicit reconciliation still requires the
actual backend reference and current operation generation.
An unsupported process-identity environment cannot guess that an in-flight owner
is dead; an explicit `UNCERTAIN` record can still be reconciled. The SQLite audit
table records each claim, result and recovery transition.

## Run the durable merchant example

`examples/idempotent-orders-backend.mjs` is an actual loopback order application:
POST inserts a durable SQLite order transaction, the same backend key and body
return the original order, and changed content under that key returns 409.
It is a local example business, not a real customer or payment simulator.

1. Create two private directories: one for the example backend, one for adapter
   operation state. Supply `MERCHANT_BACKEND_AUTH` and `MERCHANT_OPERATION_KEY`
   using the local environment; do not put their values in source or output.
2. Start `node examples/idempotent-orders-backend.mjs --state-dir /private/example/backend --port 8426`
   from this SF30 directory. It prints its actual URL and persisted order count.
3. Use the binding above with origin `http://127.0.0.1:8426`, stateDir pointing at
   the adapter directory, and the existing `--allow-loopback-upstream` flag on
   the original upstream launcher/operation commands. Route the existing seller
   POST to `/v1/orders` with original payment terms and `admitCreateOrder`.
4. Issue a real local operation ticket from the exact request. In a merchant
   embedding, call the original `createUpstreamHandlers()` handler with that
   context; in the native seller, the original payment gate calls it only after
   verification. Reusing the operation returns the same persisted order ID.
5. Backend authenticated GET `/v1/orders` reports the persisted count. GET
   `/v1/operations/sf30_OPERATION_KEY` returns an import-ready response envelope
   for a real committed order; save that actual response privately for recovery.

Programmatic entrypoints for integrations and the example:

```js
import {createUpstreamHandlers} from './upstream.mjs';
import {startOrderBackend} from './examples/idempotent-orders-backend.mjs';

// These are trusted merchant-side calls. Expose only the original SF30 payment gate.
const handlers = createUpstreamHandlers(originalBindings, {allowLoopback:true});
const handler = handlers.createOrder;
const issued = handler.idempotency.issue(originalContext,
  {id:'order-17',subject:'customer-42',expiresAt:Date.now()+60000});
const context = {...originalContext, headers:{...originalContext.headers,
  'x-merchant-operation':issued.ticket}};
await handler.admit(context);             // true or original nonpayment rejection
const response = await handler(context); // backend operation only, not a payment claim
const state = await handler.idempotency.inspect(issued.operationKey);
await handler.idempotency.close();        // after the embedding has stopped requests
```

The public handler signature is unchanged. `.snapshot()` adds in-memory operation
counts; `.idempotency` exposes offline issue/status/recovery/close. Source lives in
the original upstream product: durable engine, JSON compiler, CLI and merchant
example. Existing SF30 lifecycle, SF89, SF98 delivery and payment modules are
reused without copied implementations.

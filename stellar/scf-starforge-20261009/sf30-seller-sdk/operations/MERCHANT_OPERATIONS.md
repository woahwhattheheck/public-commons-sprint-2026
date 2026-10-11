# Merchant operation recovery in the original seller console

The original SF30 operations listener can browse the running upstream seller's
durable merchant operations and reconcile an uncertain result. It uses the same
bound handlers, private SQLite ledger and `.idempotency.recover()` as the original
merchant CLI. There is no second operation database, ticket issuer or payment
engine. Node 22.13+ or 24 is required for the original SQLite ledger.

## Start with the merchant's existing configuration

Configure the original POST binding and matching admission in
[IDEMPOTENCY.md](../IDEMPOTENCY.md). Keep its private state directory, operation
scope, key environment variable, source URL and native payment terms unchanged.
Launch the original upstream seller with its operations listener:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" --upstream --operation-controls --operations-port 8424 -- \
  --config /private/merchant/seller.json \
  --upstreams /private/merchant/upstreams.json \
  --facilitator https://YOUR_EXISTING_FACILITATOR
```

Use the merchant's actual facilitator URL and original native runtime setup.
Existing options after `--` still go unchanged to `upstream-serve.mjs`. For the
maintained loopback order example, use its actual backend origin and add
`--allow-loopback-upstream` after `--`. Without a facilitator, the original seller
runs challenge-only; it does not execute a paid backend operation. An existing
ledger can still be inspected and explicitly reconciled in that mode.

The second startup line now includes these URLs:

| Field | Use |
| --- | --- |
| `operations` | Original traffic, usage history and exports. |
| `merchantOperations` | Browse merchant operation states and history. |
| `operationControl` | Open the merchant page with its private recovery capability; `null` unless enabled. |

Open the complete **private `operationControl` URL** to reconcile operations. Its
fragment contains a fresh random token for this listener. The page removes the
fragment from the address bar and keeps it in that tab's memory. Refreshing the
browser tab or restarting the listener requires reopening the private startup
URL. Keep that URL in the merchant's private operator environment; a normal link
from the traffic page opens the read-only view.

Omit `--operation-controls` for a fully read-only operations listener. Enabling
controls requires an attached original upstream binding with idempotency. The
original traffic, history, fulfillment and export endpoints remain read-only
with either setting.

## Browse and reconcile

Choose the original binding. Counts show all stored states in that binding;
the state filter and **Older operations** browse at most 25 metadata records at
a time. **Newest** refreshes the live view. Records retain their original
operation identity; pagination does not copy or expire them. Concurrent updates
can move a row toward the newest page, so refresh before deciding an outcome.
An exact 64-character operation key opens its current record directly.

Select a row to see the exact operation key, backend idempotency key, request
hash, attempt, generation, timestamps, stored response hash and backend reference.
The history below it reads the original ledger audit table, including each claim,
outcome and recovery transition. Response bodies, tickets, credentials and private
filesystem paths are absent from list/detail/history responses. Backend references
are operator data, so use a lookup or incident identifier rather than copying a
customer payload into that field.

For an `UNCERTAIN` operation, use the displayed **backend operation key** with
the merchant's actual lookup or support interface. Then choose one of two actions:

| Backend finding | Console action | Result |
| --- | --- | --- |
| The backend completed this exact operation and has its actual response. | Select **The backend completed this operation**, choose its JSON response record, enter the backend reference and confirm the displayed generation. | Original recovery saves `COMPLETE`; a later original request can replay the stored result. |
| The backend's actual lookup and idempotency contract establish that a later execution is appropriate. | Select **The backend confirms a later execution is appropriate**, enter the backend reference and confirm the displayed generation. | Original recovery saves `RETRY_READY`; only a later original request can execute it. |

The response file contains `status`, `headers` and exactly one of `body` or
`bodyBase64`. `bodyBase64` preserves the original bytes. The console accepts up
to 2 MiB of JSON input; the original binding's response-byte limit still applies
after decoding. The shared original CLI/console parser accepts the same envelope.
The original handler enforces its exposed-header allowlist and configured
`responseContract`; importing a response cannot bypass those checks.

Recovery sends the exact current operation key, request hash and generation back
to the original ledger. A newer generation or completed result rejects a stale
decision. The page reloads the current state and never resubmits automatically.
If the connection ends before the recovery response arrives, refresh the record
to determine whether the change committed before recording another decision.

`IN_FLIGHT` records can also be opened, but original recovery accepts them only
when the recorded process is no longer active on the same host. The stable host,
boot identity and process-start checks remain in the original ledger. The console
does not offer a force control that bypasses a live owner. `COMPLETE` and
`RETRY_READY` have no recovery action.

**Merchant operation recovery is separate from payment settlement.** Importing a
result or allowing a later request makes no backend request, issues no ticket,
and performs no signing, verification or settlement. Every separately approved
paid request continues through the original payment path. Retain the buyer's
original payment evidence and use the existing payment recovery workflow when
that is the problem being resolved.

## Use the maintained order backend's actual result

The [existing merchant example](../IDEMPOTENCY.md#run-the-durable-merchant-example)
creates actual SQLite orders. Its authenticated
`GET /v1/operations/sf30_OPERATION_KEY` returns the response of the stored order,
with the original exposed content type and exact response bytes in `bodyBase64`.
Save that JSON privately and select it in the console. The lookup HTTP response
retains its own private cache policy, while the exported envelope contains only
headers the original binding permits for replay.

The console does not fetch a backend on your behalf or guess whether a failed
connection committed. A completed order may exist despite an interrupted response;
the actual lookup determines which action applies. An ordinary successful
operation is already `COMPLETE` and needs no recovery.

## Compose in the existing merchant launcher

The maintained `upstream-serve.mjs` already attaches the control capability to its
session. A custom merchant launcher using the original application factory can
attach it in the same way:

```js
const application = createUpstreamApplication(sellerConfig, upstreamBindings, options);
const session = await startSellerService({
  config: application.config, handlers: application.handlers,
  // Preserve the merchant's existing nativeFactory, lifecycle and other options.
});
session.upstreamSnapshot = application.snapshot;
session.operationControl = application.operationControl;
const operations = await startSellerOperations(session, { operationControls: true });
// Send only to the merchant's private local operator output.
console.log(operations.operationControlUrl);
```

`operationControl.bindings` contains only binding name, method, scope and response
limit. Its `list(binding, options)`, `inspect(binding, operationKey)`,
`audit(binding, operationKey, options)` and `recover(binding, options)` call the
existing bound handler. Do not expose this capability on the advertised seller
origin. The operations listener drains pending control work during close and
leaves original seller/handler ownership with the existing launcher.

## Local API contract

All routes use the existing operations listener's loopback Host, Origin and
browser request protections. Write access additionally requires an exact allowed
local `Origin`, `Content-Type: application/json` and
`x-merchant-operation-token` from that listener's private URL. The token is never
returned by an API response. It authorizes local merchant operation recovery,
not a payment or a ticket issuance.

| Endpoint | Method and fields |
| --- | --- |
| `/api/merchant-operations` | `GET` / `HEAD`: available bindings, control mode and upload limit. |
| `/api/merchant-operations/list` | `GET` / `HEAD`: required `binding`; optional `state`, opaque `cursor`, `limit` from 1 to 100. Returns metadata records, whole-binding state totals and `nextCursor`. |
| `/api/merchant-operations/detail` | `GET` / `HEAD`: required `binding`, exact `operationKey`; optional audit `after` sequence. Returns current metadata, up to 100 audit events and `nextAfter`. |
| `/api/merchant-operations/recover` | `POST`: `binding`, `operationKey`, `requestHash`, `expectedGeneration`, `action`, `reference`, and `response` for `complete` only. Returns the original ledger's resulting record. |

Unknown or duplicate query fields are rejected. Neither read nor write routes
accept arbitrary state directories, handler modules, backend URLs or ticket keys.
Recovery errors return controlled codes without private path or credential data.

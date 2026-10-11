# Merchant delivery recovery

The existing private `/fulfillment` screen reads the same original SF98 outbox used by the native seller. It now includes every retained event, state and route filters, cursor pagination, exact order/event detail, and selected-event recovery. An old exhausted notification remains visible even when newer successful events fill the recent summary.

## Start and use

Start the original merchant launcher or approved-file checkout as before. Its JSON startup output now contains `fulfillmentControl` (merchant launcher) or `deliveryControl` (checkout). Open that private local URL to enable recovery; the ordinary `/fulfillment` URL stays read only. The control value lives in a URL fragment and is not sent in a GET request or returned by the public status endpoint. Restarting the listener rotates it.

1. Open **Needs attention** and select the actual order or full event identity.
2. Repair the merchant receiver or its configured credentials.
3. Click **Requeue notification**. The exact delivery revision is checked under the original kernel lease before appending the native REQUEUE state.
4. The original delivery worker sends the same recorded notification. This screen follows its state to **Receiver accepted**; check the merchant application for the purchased resource.

When the delivery workspace is composed by the host, its injected `deliveryRecovery` callback pauses and awaits only its owned worker, uses the same pinned receiver profile, performs original maintenance, and resumes that worker. A standalone operations listener can requeue while the native delivery lease is free. An independently running worker keeps its lease; its original operator pauses and resumes it. The screen never invokes a payment or another purchase.

`Download event JSON` exports the selected current event and revision. The summary JSON and metrics retain their existing interfaces. Delivery acceptance and final merchant resource fulfillment are shown as separate states because the receiver determines what acknowledgment means.

## Composition API

`startSellerOperations(session, {deliveryOutbox, deliveryControls:true, deliveryRecovery})` returns `deliveryControlUrl` along with its original listener, observer and close function. The optional recovery callback receives `{id, expectedRevision}` and must operate on the same original outbox. `startCheckout` forwards this callback.

The shared `sf98-merchant-delivery/delivery-recovery.mjs` exports:

- `deliveryRevision(row)`: SHA-256 of the original event ID and exact native state.
- `inspectDelivery(outbox, id)`: original row and current revision.
- `requeueDelivery(outbox, {id, expectedRevision, lease?})`: rechecks the exact original EXHAUSTED state and invokes the original outbox requeue. A supplied original lease is validated against the same outbox; otherwise the helper acquires and releases it. This lets existing receiver-workspace batch maintenance compose the helper without nested lease acquisition.

The listener uses its existing loopback Host/origin policy and an additional per-process capability for recovery. POST `/api/delivery/requeue` requires the exact same-origin `Origin`, `x-delivery-control`, and a JSON object with only `id` and `expectedRevision`. Successful recovery returns the original event/revision transition; stale revisions receive409. The browser never receives receiver secrets, wallet material or payment headers.

GET `/api/delivery/events` accepts `state` (attention/all/native state), `routeId`, `cursor` (last original event ID) and `limit` (1–100). The cursor follows original append order even when a previously displayed event changes state. GET `/api/delivery/event?id=...` returns the selected event and revision; `/api/delivery/control` reports availability without the capability value.

## Native journey

The existing `sf101-merchant-receiver/checkout.journey.mjs` now carries its one original purchase through actual rejected signed HTTP deliveries, native exhaustion, private revision-guarded recovery, successful receiver acknowledgment, and the exact original file/download/restart flow. Only the retry clock advances to reach each native due time; signed requests use current timestamps and the original HMAC receiver. The existing controlled local facilitator remains explicit in the journey output.

An optional installed Playwright runtime exercises that same journey through the rendered fulfillment page instead of the direct operator POST:

```bash
SF98_BROWSER_MODULE=/absolute/path/to/playwright \
SF98_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
SF98_JOURNEY_OUTPUT=/private/recovery-capture \
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.journey.mjs
```

The browser path uses the actual local listener and control link, captures desktop and390px layouts, requeues with the real UI, and observes the same notification becoming accepted. It adds no browser dependency to the merchant runtime.

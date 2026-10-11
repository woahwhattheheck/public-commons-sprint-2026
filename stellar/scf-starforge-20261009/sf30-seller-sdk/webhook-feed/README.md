# Webhook event feed merchant

Turn authenticated source events into a paid, resumable data product using the original Starforge seller. The complete workflow is:

1. Configure an incoming source and its existing Standard Webhooks signing secret.
2. Receive its original JSON body and commit its delivery identity and content together.
3. Select source IDs, event types, and explicit output fields for each merchant feed.
4. Save exact payment terms and prepare the normal SF30 seller service and handler files.
5. Serve paid cursor pages through the existing x402 payment engine.
6. Receive those pages in the original SF88 event-feed buyer, save the exact responses, and resume from the committed cursor.
7. Inspect, export, back up, reopen, and apply an explicit event-body retention boundary.

## Start the operator workspace

Use Node 24+ for native SQLite and JSON source context. The parser checks source-context support before accepting events and preserves unsafe integer literals exactly. The ingestion, storage, workspace and snapshots use Node standard-library modules. Native x402 serving uses the existing merchant package dependencies.

    starforge webhook-feed init --state /private/event-merchant
    starforge webhook-feed workspace --state /private/event-merchant

Open the complete private workspace URL printed by the command. The workspace provides Sources, Feeds, Events, Deployment, and Continuity views. All listeners bind to 127.0.0.1. Keep the operator listener private; publish the receiver's webhook paths and the seller's paid paths through your existing HTTPS reverse proxy.

The workspace saves source and feed definitions in the same event database. Each edit includes the reviewed revision, so a stale editor cannot overwrite a concurrent change. Pausing a source stops new deliveries. Pausing or revising a feed causes an existing merchant listener to return the appropriate admission response until the operator prepares its new revision.

The CLI provides the same operating workflow. Run:

    starforge webhook-feed --help

Direct source use is also available:

    node stellar/scf-starforge-20261009/sf30-seller-sdk/webhook-feed/cli.mjs --help

## Configure a real event source

A source definition names an environment variable containing the source provider's existing signing secret. The database stores the variable name. The receiving process reads its value when verifying a request.

    {
      "id": "inventory",
      "label": "Inventory change events",
      "secretEnv": "INVENTORY_WEBHOOK_SECRET",
      "typePointer": "/type",
      "occurredAtPointer": "/timestamp",
      "enabled": true,
      "maxEventBytes": 65536,
      "toleranceSeconds": 300
    }

Save it with the workspace, or:

    starforge webhook-feed source --state /private/event-merchant --json source.json
    starforge webhook-feed receiver --state /private/event-merchant --port 8491

Configure the originating service's endpoint to deliver to your HTTPS route that forwards to:

    POST http://127.0.0.1:8491/webhooks/inventory

The receiver implements [Standard Webhooks v1 HMAC signatures](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md), following the [official JavaScript reference contract](https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts):

| Header | Meaning |
| --- | --- |
| webhook-id | Original provider event/delivery ID |
| webhook-timestamp | Signing time in integer Unix seconds |
| webhook-signature | Space-separated versioned signatures, including v1,BASE64_HMAC |

The signed message is the exact UTF-8 header ID, a dot, the exact timestamp header, another dot, and the original body bytes. The key is the decoded base64 secret, with an optional whsec_ prefix. The receiver accepts a matching v1 HMAC using a constant-time comparison and checks the configured clock tolerance. It validates the signature before parsing JSON.

Use providers that implement this signature contract or an existing trusted adapter that emits it. Provider-specific signature schemes retain their own native verification requirements.

An event type must exist at the configured JSON pointer. The optional event timestamp must be an ISO timestamp with a timezone. Source IDs are local routing identities; the provider's event ID stays unchanged inside that source.

## Publish selected data

A feed explicitly selects which source fields become customer data:

    {
      "id": "stock",
      "label": "Stock changes",
      "description": "Committed inventory changes with SKU and available quantity.",
      "sourceIds": ["inventory"],
      "types": ["inventory.changed"],
      "projection": [
        {"name": "sku", "pointer": "/data/sku"},
        {"name": "quantity", "pointer": "/data/quantity"},
        {"name": "warehouse", "pointer": "/data/warehouse"}
      ],
      "enabled": true,
      "defaultPageSize": 50,
      "maxPageSize": 100,
      "maxPageBytes": 1048576
    }

Empty types includes every type from the selected sources. Output names are flat keys; pointers follow JSON Pointer escaping. Missing selected fields are omitted. The whole original body remains private. The operator can inspect it and retain it in private snapshots.

Unsafe integer literals outside JavaScript's exact integer range are preserved as JSON strings containing their original numeric spelling. Ordinary safe integer quantities remain JSON numbers. The exact raw source body is retained independently of parsed projection values.

Save and inspect a feed:

    starforge webhook-feed feed --state /private/event-merchant --json feed.json
    starforge webhook-feed preview --state /private/event-merchant --feed stock --limit 5

For an edit, pass the latest definition's revision with --expected-revision. A feed revision is a lowercase SHA-256 over its normalized definition and the selected sources' event-type/time mapping. Ingestion, exact retries, and secret rotation preserve the revision. Projection, filter, or event mapping changes create a different effective revision.

## Use the original merchant payment engine

Create a merchant plan with the actual selected asset, receiving address, amount and network. A plan may give each feed either one payment object or the original paymentOptions array.

    {
      "schema": "stellar-forge.webhook-feed-merchant.v1",
      "publicOrigin": "https://events.example.com",
      "feeds": [{
        "feedId": "stock",
        "payment": {
          "scheme": "exact",
          "network": "stellar:testnet",
          "amount": "1000",
          "asset": "ACTUAL_STELLAR_ASSET_CONTRACT",
          "payTo": "ACTUAL_MERCHANT_RECEIVING_ADDRESS",
          "maxTimeoutSeconds": 300
        }
      }]
    }

The illustrative asset/address values must be replaced with the merchant's actual terms.

    starforge webhook-feed plan --state /private/event-merchant --json merchant-plan.json
    starforge webhook-feed prepare --state /private/event-merchant --out /private/stock-release-v1

The create-only release directory contains:

| File | Use |
| --- | --- |
| seller-service.json | Normal SF30 service configuration, one priced route per feed |
| handlers.mjs | Normal handler/admission exports pinned to exact feed revisions |
| merchant-plan.json | Original selected merchant terms |
| release.json | Store/feed identities, file sizes and SHA-256 values |

The generated handler module reads the existing event store path from STARFORGE_WEBHOOK_STATE. It composes with the installed @tokenjunkielabs/starforge-merchant/seller/webhook-feed module and the normal SF30 serve --config/--handlers interface.

Alternatively, launch the integrated operator service:

    starforge webhook-feed run --state /private/event-merchant \
      --facilitator https://YOUR_EXISTING_FACILITATOR \
      --receiver-port 8491 --merchant-port 8492 --workspace-port 8493

The merchant listener serves GET /feeds/stock and its original /_seller/offers, /_seller/docs and /_seller/openapi.json endpoints. The facilitator uses the original @x402/core and Starforge native factory. Embedding applications can pass their existing nativeFactory to startWebhookFeedMerchant.

Without a facilitator, the original seller advertises payment challenges. Admission validates input, cursor availability and the pinned feed revision before payment verification. If a relevant condition changes before the handler runs, its error follows the original seller's cancellation path.

Requests are priced per page, so select page sizes and buyer execution cadence appropriate to the event workload.

## Buyer page contract

The original SF88 event-feed buyer consumes the merchant route with optional cursor and limit query parameters. The public response has this shape:

    {
      "schema": "stellar-forge.webhook-feed-page.v1",
      "storeId": "32_lowercase_hex_characters",
      "feedId": "stock",
      "feedRevision": "64_lowercase_hex_characters",
      "items": [{
        "sequence": 17,
        "sourceId": "inventory",
        "eventId": "the-original-provider-id",
        "type": "inventory.changed",
        "receivedAt": "2026-10-11T21:00:00.000Z",
        "occurredAt": "2026-10-11T20:59:58.000Z",
        "payload": {"sku": "WIDGET-1", "quantity": 12, "warehouse": "east"},
        "sourceBodySha256": "sha256_of_original_private_body",
        "payloadSha256": "sha256_of_JSON.stringify_payload"
      }],
      "page": {
        "afterSequence": 0,
        "throughSequence": 29,
        "returned": 1,
        "hasMore": false,
        "nextCursor": null,
        "resumeCursor": "opaque_authenticated_cursor"
      }
    }

The first read captures a high-water sequence. Every nextCursor continues the same immutable upper boundary even as new events arrive. Items are strictly increasing, filtered before the page limit, and bounded by both item count and encoded page bytes. A continuation always advances afterSequence to the last returned event.

When the window is exhausted, nextCursor is null and resumeCursor begins after the captured upper boundary. Use it to capture the next window. Do not substitute an event ID for a cursor or advance a cursor before durably accepting the page.

Cursors authenticate the store ID, feed ID, effective feed revision, lower boundary and captured upper boundary. Restoring an older snapshot cannot silently complete a cursor beyond the restored high-water mark. The private cursor key stays in the retained SQLite state.

payloadSha256 describes JSON.stringify(payload) bytes. sourceBodySha256 identifies the retained original event bytes and cannot be recomputed from a selected projection. The receiving buyer retains the exact paid response and its own response digest.

| Response | Recovery |
| --- | --- |
| 409 FEED_CHANGED | Review the current merchant/feed definition and explicitly begin the new revision |
| 410 CURSOR_EXPIRED | Recover the required retained window from the appropriate snapshot or explicitly start at the current retained boundary |
| 422 INVALID_CURSOR | Use the exact cursor from this store and feed |
| 409 EVENT_ID_CONFLICT | Reconcile the originating source's reused event ID; its accepted body remains unchanged |
| 401 signature/timestamp error | Correct the originating signing configuration or clock, then retry the same provider event |
| 409 DEFINITION_CHANGED | Reload the current operator revision and compose the intended edit |

## Delivery and storage behavior

One SQLite transaction records the unique (source ID, provider event ID), its global sequence, original body bytes, extracted event fields and source SHA-256. The HTTP acknowledgement is returned after the commit.

An identical retry returns the original sequence and acceptance time and increments its delivery-attempt count. A reused identity with different bytes returns an explicit conflict. Source revisions are rechecked under the write transaction. SQLite WAL, synchronous FULL and a write timeout coordinate concurrent receiving processes in the same private store.

Feed reads capture definitions, retention boundary, high-water and selected rows in one read transaction. The selected page is produced before the existing merchant engine settles the request. No webhook acceptance creates a payment receipt or digital-file entitlement; those remain the existing seller and fulfillment engines' responsibilities.

## Save and reopen the same feed

Use the Continuity workspace view or:

    starforge webhook-feed snapshot --state /private/event-merchant \
      --out /private/event-snapshot-20261011

The create-only snapshot contains events.sqlite and snapshot.json. Keep both together. The SQLite online backup captures a consistent database with exact store, event, retry, configuration and cursor identities.

Restore into a new directory:

    starforge webhook-feed restore --snapshot /private/event-snapshot-20261011 \
      --state /private/restored-event-merchant
    starforge webhook-feed status --state /private/restored-event-merchant

The restore checks the snapshot identity and exact bytes and refuses an existing destination. The receiving process must still have the source's existing secret environment variable.

Event bodies can be removed through a reviewed boundary:

    starforge webhook-feed retention --state /private/event-merchant \
      --through 12000 --expected-high-watermark 18400

The expected high-water guard rejects a stale retention decision. Original delivery identities and hashes remain after bodies are removed, so retries cannot resurrect old events. Customers behind that boundary get an explicit expired-cursor result. Private snapshot recovery preserves their original cursor identity.

## Integration exports

- @tokenjunkielabs/starforge-merchant/seller/webhook-feed: EventFeedStore, handler/service composition, receiver, and page definitions.
- @tokenjunkielabs/starforge-merchant/seller/webhook-feed/store: standalone ingestion and page store.
- @tokenjunkielabs/starforge-merchant/seller/webhook-feed/merchant: original SF30 merchant composition.
- The original SF88 event-feed buyer owns native purchase intents, received page persistence, subscriber checkpoints, export and reopening.

The source is additive under sf30-seller-sdk/webhook-feed. It reuses the original seller compiler, resource handler, payment factory, admission and cancellation behavior.

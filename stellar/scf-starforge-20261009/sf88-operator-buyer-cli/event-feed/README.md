# Event-feed buyer

Collect an original Starforge webhook feed into a durable local subscription.
The subscription uses the existing SF88 Node buyer for every purchase and keeps
its original operation, review, signer, operator policy and financial journal.

This is the buyer half of
[the signed webhook merchant](../../sf30-seller-sdk/webhook-feed/README.md).
It provides a command line, reusable module, private browser desk and NDJSON
delivery with a matching manifest.

## Start from your existing buyer configuration

Use Node 24 or later with its built-in SQLite support. Supply an original SF88
buyer configuration for the selected merchant feed, including its explicit
asset, recipient, maximum page price, operator and signer. The operation URL is
the HTTPS feed endpoint, without a cursor or limit query parameter. Preserve
any existing network transport profile.

A subscription receives JSON pages of changing content. Its response options
may set maximum bytes, timeout and the application/json media type. A digest
or byte-count pin for a single static response, an operation-specific ticket,
and a file-order reference do not describe a multi-page feed. The original
buyer still reviews and binds the complete URL for each page.

From the Starforge source root:

    node sf88-operator-buyer-cli/event-feed/cli.mjs init \
      --dir /srv/starforge/orders-events \
      --config /srv/starforge/orders-buyer.json \
      --feed orders \
      --id operations-orders \
      --page-size 100

The command creates a private SQLite subscription and a directory for the
original buyer's retained operations. A new subscription without an explicit
starting cursor begins at the merchant's retained origin. Its first received
page pins that lower sequence, which inspect reports as originSequence. This
allows a new subscription to begin after earlier history has been purged.
An explicit starting cursor and every subsequent page keep their exact saved
lower sequence. The default native runtime is the
adjacent SF88 directory. Use --runtime and --buyer-state to select an existing
installed runtime and private operation directory.

Collect the currently available events:

    node sf88-operator-buyer-cli/event-feed/cli.mjs sync \
      --dir /srv/starforge/orders-events

One invocation completes a fixed sequence window. Its first page captures the
merchant's upper sequence; following pages retain that same value. Events
arriving during collection belong to the next invocation. Filters can create
sequence gaps, so the final checkpoint advances to the captured upper
sequence, including a window with no matching events. Each newly requested
page is a separate operation under the existing buyer policy.

An optional --max-pages N ends this invocation after N received pages. Running
sync again continues the saved page sequence. It preserves the original
operation ID whenever a page is already prepared or attempted.

## Use the operator workspace

    node sf88-operator-buyer-cli/event-feed/cli.mjs workspace \
      --dir /srv/starforge/orders-events \
      --port 0

Open the emitted launch address. The server binds to loopback and exchanges
its launch token for an HttpOnly, SameSite cookie. State-changing requests
require the same origin and the current CSRF value. It displays the source,
feed revision, sequence, page references, retained native statuses and projected
event payloads.

The desk can collect a window, recover the current page and export received
events. Progress refreshes while that requested operation is running. The
subscription has no background polling schedule.

## Recovery and continuity

Before preparing an HTTP operation, the subscriber commits its exact page
request and stable intent ID to SQLite. The original SF88 buyer then controls
preparation, execution and its one-attempt marker.

After the original buyer has retained and verified a complete response, one
SQLite transaction saves all of the following:

- The exact response bytes, checksum and original operation reference.
- The projected events and their source/event identities.
- The pinned merchant store and feed-definition revision.
- The next page cursor or completed-window resume cursor.

A restart before that transaction reopens the same original buyer operation.
A restart after it reuses the received page. Concurrent collectors contend for
the original buyer's one-attempt marker and the same database checkpoint.
Each collection invocation pins its initial cycle. If another collector finishes
that cycle, the waiting collector completes that cycle without starting a new
window.

    node sf88-operator-buyer-cli/event-feed/cli.mjs recover \
      --dir /srv/starforge/orders-events

recover reads retained original operations and responses. It does not start a
new request. A complete saved response remains consumable if the parent lost
only its process-exit record; the exact native status and recovered flag remain
attached to the page. Original financial reconciliation continues to use the
existing buyer journal.

| Result | Operator meaning |
| --- | --- |
| CAUGHT_UP | This captured sequence window is complete. |
| PAGE_LIMIT_REACHED | The requested page count was received; the cursor is saved. |
| PREPARED | The original operation is prepared and can be executed by sync. |
| RECOVERY_PENDING | The original attempt has no recoverable response yet. |
| ORIGINAL_ATTEMPT_RECORDED | The original buyer recorded a response or failure; inspect its operation ID and status. |
| FEED_CHANGED / FEED_IDENTITY_CHANGED | The selected merchant feed definition differs from the subscription. |
| CURSOR_EXPIRED | The merchant has purged history required by this cursor. |

For a deliberate move to another feed revision or a later retained starting
point, create a new subscription directory. Keep the earlier subscription and
its delivered events. A merchant-supplied starting cursor can be paired with
its exact lower sequence using --cursor and --after-sequence. The subscriber
checks every received page against that selected starting point.

## Deliver and reopen received events

    node sf88-operator-buyer-cli/event-feed/cli.mjs export \
      --dir /srv/starforge/orders-events \
      --out /srv/deliveries/orders.ndjson

The export writes one event per line plus orders.ndjson.manifest.json. Its
manifest includes the event count, sequence, file checksum and original page
references. It contains the projected event data and source-body digests.
The source-body digest identifies the signed input; payloadSha256 verifies the
actual projected payload using SHA-256 over UTF-8 JSON.stringify(payload).

Each destination is bound to the subscription snapshot selected on its first
export attempt. Repeating the same destination completes or reuses that
snapshot after a lost response or interrupted manifest write. A later
collection cannot silently change the earlier delivery. Select a new
destination to export a newer snapshot. Existing different files are
preserved.

    node sf88-operator-buyer-cli/event-feed/cli.mjs inspect \
      --dir /srv/starforge/orders-events

The original SQLite file retains the complete subscription across reopen.
The original buyer directory retains its payment attempts and responses.
Keep both in the host's existing backup plan.

## Module interface

    import {openSubscription} from './event-feed/index.mjs';

    const subscription = await openSubscription('/srv/starforge/orders-events');
    try {
      const result = await subscription.collect({signal:controller.signal});
      const state = subscription.inspect({limit:50});
      const delivery = await subscription.exportEvents('/srv/deliveries/orders.ndjson');
    } finally {
      subscription.close();
    }

createSubscription accepts the same configuration, paths, feed ID and page
size as the CLI. recover reads the current retained attempt; inspect is
offline; exportEvents uses received event rows. The module imports the original
Buyer only when collection or recovery needs it.

The distribution commands are buyer-event-feed for this CLI and webhook-feed
for the merchant. The module export is ./buyer/event-feed.

## Focused delivery journey

Run node sf88-operator-buyer-cli/event-feed/journey.mjs from the Starforge source root.
This single component journey exercises the real signed-webhook store, fixed-window
pages, buyer transaction/reopen, large integer preservation, source revision changes
and immutable exports. It uses local fixture events and the subscriber's acceptance
method; operational purchases use the original SF88 buyer through sync.

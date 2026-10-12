# Single-merchant settlement delivery and receiving

The existing SF82 release console and merchant MCP host operate the original SF98
delivery workspace for their configured release store. The seller owns payment
handling and its retained settlement journal. This adapter opens that original
journal, destination controls, saved exchanges and verified file reads.

Open the same release store normally:

~~~sh
starforge releases console --store /private/catalog-releases
~~~

The **Settlement delivery** section shows the actual producer release and instance,
payment mode, journal warnings, source receipt count, destination revisions and
worker state. Start the original seller once to initialize its retained delivery
binding. A stopped seller's existing delivery history and saved exchanges remain
available.

**Open destination controls** opens the original SF98 app at the console's
`/delivery/` route. Its own session and origin checks guard enrollment, pause,
synchronization, drain, worker and requeue operations. This mounted app keeps its
original native model and signed transport.

## Connect accounting or fulfillment

Set the receiver's signing value in the environment that runs the release console
or MCP host. Enrollment retains the variable's name. Use the actual HTTPS receiver
URL and allowed host, and choose whether that destination should receive all
existing source history or only future events.

For example, save this descriptor in a private JSON file. Substitute the actual
receiver and the variable already configured on both original endpoints:

~~~json
{
  "id": "accounting",
  "label": "Merchant accounting",
  "url": "https://accounting.example/sf98/accounting-events",
  "allowedHost": "accounting.example",
  "secretEnv": "MERCHANT_ACCOUNTING_SECRET",
  "routeIds": [],
  "networks": [],
  "history": "all"
}
~~~

~~~sh
starforge release-delivery control --store /private/catalog-releases \
  --action enroll --input /private/accounting-destination.json
starforge release-delivery status --store /private/catalog-releases
~~~

Enrollment itself sends no request. Sync copies the selected original event IDs
into that destination's retained journal. **Deliver one cycle** or the original
`drain` action explicitly attempts signed delivery. Accounting and fulfillment
retain their independent outcomes and idempotency behavior.

The original destination UI exposes the current pause revision and each event's
delivery revision. Use those exact values for maintenance. After an uncertain
enrollment or pause response, inspect the existing destination ID and its current
descriptor before another change.

The source remains the existing store's original settlement binding across release
changes. If an original family already decorates SF98, the common producer adopts
that decoration once. Journal warnings remain visible beside the producer.

## Foreground worker and CLI

The complete command is available through both installed and original source
entry points:

~~~sh
starforge release-delivery help
starforge releases delivery help
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs delivery help
~~~

Read status, events and retained exchanges without starting a seller:

~~~sh
starforge release-delivery status --store /private/catalog-releases
starforge release-delivery events --store /private/catalog-releases \
  --id accounting --state EXHAUSTED --offset 0 --limit 50
starforge release-delivery transfers --store /private/catalog-releases --limit 25
starforge release-delivery handoff --store /private/catalog-releases
~~~

`control --action ACTION --input PRIVATE_JSON` forwards the original fields.
Actions are `enroll`, `pause`, `sync`, `drain`, `stop` and `requeue`. Empty settings
use a private file containing `{}`.

For a continuously running original worker use the foreground command:

~~~sh
starforge release-delivery run --store /private/catalog-releases
~~~

Its optional `--input` file supplies the original `limit`, `concurrency`,
`destinationConcurrency`, `timeoutMs` and `pollMs`. Ctrl-C begins original native
send cancellation and closes this command's model and verified reads. `control
--action start` directs the operator to `run`, so a one-shot command cannot report
a worker started and immediately close it.

The browser and MCP hosts own their original worker for their own process
lifetime. They can stop or resume it through the original destination controls.
The existing delivery lease prevents overlapping native sends.

## Capture and recover the exact exchange

Review the source fingerprint in delivery status. Capture it under a deliberate
transfer ID:

~~~sh
starforge release-delivery transfer --store /private/catalog-releases \
  --id accounting-handover-v1 --source-fingerprint SOURCE_SHA256
starforge release-delivery manifest --store /private/catalog-releases \
  --id accounting-handover-v1
~~~

The original exporter retains the native source journal and each destination's
descriptor, source cursor, delivery journal and continuity fingerprints. It
verifies the reviewed source before publishing the exchange.

The same ID and source fingerprint reopen the original retained capture. New
receipts require a new ID for a fresh exchange. The console saves the exact
capture request before POST. If the response is lost, **Resume saved capture**
replays that same body; **Inspect retained ID** reads the completed original
exchange. Creating a different ID preserves other pending requests in the draft.
Download/open the capture draft to carry those requests across browser sessions.

The transfer list and file inspection remain independent of an unavailable live
source. The manifest lists the exact relative native filenames, lengths and
SHA-256 values.

## Download and receive

The browser downloads the original compressed exchange. It streams directly to a
chosen file when the browser supports native file saving. The in-memory fallback
is limited to 128 MiB; the console supplies the native resumable command for
larger exchanges. A stopped browser download can use the same retained ID again.

The native downloader uses the existing merchant retained-file writer, including
its private output lease, byte checkpoints, original SHA-256 validation and
recovery after a connection interruption:

~~~sh
starforge release-delivery download --store /private/catalog-releases \
  --id accounting-handover-v1 --fingerprint EXCHANGE_SHA256 \
  --directory /private/accounting-download
~~~

It can receive the same original files through an existing authenticated MCP host:

~~~sh
starforge release-delivery download --url https://operator.example/mcp \
  --token-env MCP_ACCESS_TOKEN --id accounting-handover-v1 \
  --fingerprint EXCHANGE_SHA256 --directory /private/accounting-download
~~~

The outer download directory retains `delivery-files.json` and `download-state/`.
The exact original receiver layout is isolated in `exchange/`:

~~~text
accounting-download/
  delivery-files.json
  download-state/
  exchange/
    manifest.json
    source/
    destinations/
~~~

The transport header records the existing native file identities. Each original
file remains byte-for-byte intact. The original receiver sees exactly its three
expected top-level entries under `exchange/`.

Reopen the completed download, then receive it into a new private workspace:

~~~sh
starforge release-delivery reopen --directory /private/accounting-download \
  --id accounting-handover-v1 --fingerprint EXCHANGE_SHA256
starforge release-delivery receive --directory /private/accounting-download \
  --id accounting-handover-v1 --fingerprint EXCHANGE_SHA256 \
  --workspace /private/accounting-received
~~~

Receiving calls the original SF98 `receiveDestinationExchange`. It preserves
native histories and cursors and writes the original `received.json`. If its
response was lost, the same target is reopened only when that original receipt
matches the reviewed exchange, retained native fingerprints and exact source/
workspace paths. The existing model reads the received workspace's current state.
An unrelated or incomplete target is preserved and rejected.

The equivalent original receiving command remains available:

~~~sh
starforge delivery-destinations inspect --workspace /private/accounting-download/exchange
starforge delivery-destinations receive --from /private/accounting-download/exchange \
  --workspace /private/another-received --fingerprint EXCHANGE_SHA256
starforge delivery-destinations serve --workspace /private/accounting-received/workspace
~~~

Receiving starts no sender. Set the retained signing environment references in the
receiving host, review its original destination state, then explicitly deliver.

## MCP controls and installed source

The source-owned `delivery` provider selects the host's existing `releaseStore`.
It needs no extra delivery root or fleet declaration. Its runtime loads on use;
its status summary does not open a destination workspace.

| Tool | Original operation |
| --- | --- |
| `merchant_delivery_status` | Producer, source and destination status |
| `merchant_delivery_control` | Original enrollment, maintenance, synchronization and worker actions |
| `merchant_delivery_stop` | Original worker stop, callable while delivery is pending |
| `merchant_delivery_events` | Original event pagination and revisions |
| `merchant_delivery_handoff` | Original workspace handoff |
| `merchant_delivery_transfers` | Immutable retained exchange list |
| `merchant_delivery_transfer` | Reviewed capture or same-ID recovery |
| `merchant_delivery_manifest` | Native file identities and receiving arguments |
| `merchant_delivery_file` | Verified retained byte reads |
| `merchant_delivery_file_release` | Release one owned temporary read |

Host shutdown begins native delivery cancellation before waiting for pending
delivery calls. The original provider lifecycle then drains calls and closes the
same adapter. Failed native cleanup retains its owner for a same-owner retry.

`merchant-provider-delivery.json` owns the provider and downloader exports.
`release-delivery-console.json` owns the CLI, direct-store adapter exports and
browser registration. The release console reads the same nine-route
`release-ui/browser-assets.json` that the installed builder uses. Existing
receiving, customer client, discovery and facilitator entry points remain in that
original asset inventory.

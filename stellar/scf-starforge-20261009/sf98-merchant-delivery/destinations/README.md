# Merchant delivery to several receivers

An original SF98 settlement event can now reach fulfillment, accounting and
operational receivers independently. Each named destination selects its routes
and networks, retains the exact original event, and uses its own original SF98
delivery journal. A receiver's success, retries or exhaustion apply to that
receiver alone.

The original seller creates the authoritative events. This coordinator reads
those records and calls the existing `openOutbox().record()`, `drainOnce()`,
`sendSignedWebhook()` and kernel delivery lease. It retains the original
`eventId`, payment-option fields, recipient digest, wire body, HMAC convention,
retry schedule and receiver idempotency requirement. The settlement and resource
delivery remain the original seller's implementation.

## Start from an existing merchant

Use the installed maintained merchant package, or Node 22.16+ on Linux with
util-linux `flock` and the original source tree. The destination coordinator
needs only Node's standard library and the existing SF98 modules. The seller
continues using its already installed native payment dependencies.

Keep the original seller outbox and destination workspace in separate private
directories owned by the operator, with mode `0700`. The coordinator creates
its files with mode `0600`. The source path and all path ancestors resolve
canonically; symlinked workspaces are rejected. The browser listens on loopback.

```sh
npx --no-install starforge delivery-destinations init \
  --workspace /private/merchant/destinations \
  --source /private/merchant/sf98-outbox

npx --no-install starforge delivery-destinations serve \
  --workspace /private/merchant/destinations --port 8478
```

With a source checkout, replace `npx --no-install starforge delivery-destinations`
with:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/destinations/cli.mjs
```

The server prints its local URL. It opens the existing source and saved receiver
histories. Starting the browser alone does not start a delivery worker. In the
workspace, enroll the intended receivers, copy their matching events, inspect
the result and choose **Deliver due notices** or **Start delivery worker**.

## Enroll each receiver once

Copy [example-receiver.json](./example-receiver.json) to a private operator file,
set its actual endpoint and selections, and provide its real signing key through
the named environment variable in the process that performs delivery. Key values
stay out of the enrollment file, browser and handover. The original signed sender
accepts a key of 32–1024 bytes.

```sh
npx --no-install starforge delivery-destinations enroll \
  --workspace /private/merchant/destinations \
  --file /private/merchant/fulfillment-receiver.json
```

| Field | Meaning |
| --- | --- |
| `id` | Stable lowercase destination ID, up to 48 characters |
| `label` | Operator-facing receiver name |
| `url` | Exact public HTTPS webhook URL, including its path |
| `allowedHost` | The URL's exact hostname |
| `secretEnv` | Existing environment-variable name supplying this receiver's key |
| `routeIds` | Exact original route IDs; an empty array selects every route |
| `networks` | Exact original network strings; an empty array selects every network |
| `history` | Explicit `all` or `new` enrollment choice |

`history: "all"` includes matching original events already present in the source.
`history: "new"` records the current source prefix and includes only subsequent
events. It uses an exact source checkpoint, so a later-arriving event with an
older event timestamp still belongs to the subsequent source sequence.

The endpoint, filters and historical selection are immutable for that destination.
This prevents already accepted events from silently acquiring a different
receiver or different meaning. Enroll a distinct endpoint under a new ID when
adding another system. An exact URL already enrolled is reported with its existing
history; use that original destination. Rotate a receiver key through the same
environment reference and restart the delivery process with the selected value.

Enrollment publishes the complete descriptor and initial cursor atomically. It
does not copy records or perform delivery. New enrollments begin active, ready
for a later explicit sync or delivery operation. Up to 128 named destinations
can share one coordinator workspace.

## Copy and deliver

```sh
# Copy selected original events into every destination's original-format outbox.
npx --no-install starforge delivery-destinations sync \
  --workspace /private/merchant/destinations

# Inspect independent receiver states and source checkpoints.
npx --no-install starforge delivery-destinations status \
  --workspace /private/merchant/destinations

# Deliver due notices to this one receiver through the original signed sender.
npx --no-install starforge delivery-destinations drain \
  --workspace /private/merchant/destinations --id fulfillment \
  --limit 20 --concurrency 2 --timeout-ms 7000
```

`sync` reads the original event journal, applies the frozen destination filters,
and saves exact selected event objects using the original native outbox writer.
It advances that destination's source cursor only after all selected records
have been fsynced. If the process ends after copying a record but before advancing
the cursor, reopening the original outbox uses its existing event-ID deduplication
and completes the same operation.

`drain` synchronizes first and then calls the original drain with the destination's
own lease, endpoint and signing key. Pause stops a destination's delivery;
operators can still synchronize it deliberately. A source-prefix mismatch or
missing previously copied event stops that destination's dispatch and appears
in its current result. Unaffected destinations continue.

The signed wire remains `stellar-forge.sf98.webhook.v1`. Receivers validate
`x-sf98-timestamp + "." + rawBody` with their own HMAC key and atomically deduplicate
the original `idempotency-key`/`eventId` before performing downstream work. A
receiver's HTTP success means it accepted the notice. A retry after an uncertain
send carries the same native identity, so the receiver can recover its own work.
See the [original sender contract](../README.md#deliver-explicitly-not-inside-a-payment-request)
for the complete wire and delivery semantics.

## Run and stop the coordinator

```sh
npx --no-install starforge delivery-destinations run \
  --workspace /private/merchant/destinations \
  --limit 20 --concurrency 2 --destination-concurrency 4 \
  --timeout-ms 7000 --poll-ms 5000

# From another shell or the local browser:
npx --no-install starforge delivery-destinations stop \
  --workspace /private/merchant/destinations
```

The coordinator has one kernel-owned worker identity and each destination keeps
its original independent delivery lease. Several destinations can progress at
once; `destinationConcurrency` controls active destination batches and
`concurrency` controls requests inside each batch. Their product is the maximum
concurrent requests for this coordinator. Both default to conservative operational
values: four destinations and one request per destination.

Each cycle writes durable worker state and the actual per-destination result.
One unavailable receiver, missing key or busy destination is recorded alongside
the other outcomes. Newly enrolled destinations join the next cycle. Ready
backlogs continue without waiting for the normal source-poll interval; future
retries retain the original SF98 backoff and eight-attempt exhaustion policy.

`stop` targets the exact current coordinator run. A different shell writes a
durable stop request for that run; its existing worker observes it and cancels
through the original sender's signal path. SIGINT/SIGTERM perform the same
graceful shutdown for the process that owns the run. A previously written stop
request cannot stop a later run with a different identity. A process lost during
a send reopens the original native journal and receiver idempotency semantics.

The local browser shows actual kernel ownership, including a worker started in
another process. A previous `RUNNING` checkpoint without an active kernel owner
appears as interrupted. Start the worker explicitly to continue. Opening or
closing a separate status client does not stop an existing worker.

## Pause and recover one receiver

```sh
npx --no-install starforge delivery-destinations pause \
  --workspace /private/merchant/destinations --id fulfillment --revision 1

npx --no-install starforge delivery-destinations events \
  --workspace /private/merchant/destinations --id fulfillment --state EXHAUSTED
```

Pause and resume require the destination revision returned by `status`. The
revision changes when that receiver's active/paused setting changes. Copying
events advances the separate source cursor while preserving that configuration
revision.

After repairing the receiver, select an exhausted notice in the browser, or use
its current original delivery revision from `events`:

```sh
npx --no-install starforge delivery-destinations requeue \
  --workspace /private/merchant/destinations --id fulfillment \
  --event ORIGINAL_64_HEX_EVENT_ID --revision 2 \
  --delivery-revision ORIGINAL_64_HEX_DELIVERY_REVISION

npx --no-install starforge delivery-destinations resume \
  --workspace /private/merchant/destinations --id fulfillment --revision 2
```

Recovery calls the maintained `deliveryRevision` and `requeueDelivery` functions.
It compares the exact native delivery state under the same original lease before
rearming that event. A changed state, a currently active sender or an event that
is not exhausted retains the existing native recovery result. Requeue itself
does not send; the next explicit drain or active worker performs delivery.

The existing [single-receiver delivery workspace](../WORKSPACE.md) also operates
on each destination's outbox at `WORKSPACE/destinations/ID`. Keep its own workspace
directory separate and use its existing receiver, maintenance and recovery
controls. The original leases coordinate it with this destination worker.

## Retain and hand over the work

```sh
npx --no-install starforge delivery-destinations handoff \
  --workspace /private/merchant/destinations \
  > /private/merchant/destinations-handoff.json
```

The browser's **Export handover** downloads the same content. It acquires the
registration and original destination leases, retains each receiver descriptor
and cursor, and exports the exact `events.ndjson` and `deliveries.ndjson` text
with byte counts and SHA-256. It preserves full attempt history. The source's
original path, event count and prefix fingerprint identify the authoritative
source that accompanied the export. The report includes signing reference names;
the actual values stay in the delivery environment.

Keep the entire private destination workspace and original seller outbox with
the merchant's existing backup procedure. The handover is an inspection/export
format; ordinary process reopening uses those original directories directly.
Use the existing [SF101 native-outbox backup and restore](../../sf101-merchant-outbox-continuity/README.md)
for the original journals when recovering a host. A lost or reordered source
prefix needs restoration of that original history before delivery continues.
The coordinator does not reinterpret an older journal as current state.

Programmatic consumers can import `openDestinationWorkspace` from the maintained
`@tokenjunkielabs/starforge-merchant/merchant/destinations` export and
`startDestinationsServer` from `.../merchant/destinations-server`. The methods
mirror the CLI: `state`, `enroll`, `sync`, `drain`, `events`, `setPaused`,
`requeue`, `start`, `stop`, `handoff`, and `close`. The optional `environment`
argument accepts the host's existing in-memory environment mapping.

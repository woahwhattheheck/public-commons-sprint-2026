# Merchant delivery recovery

The existing private `/fulfillment` screen reads the same original SF98 outbox used by the native seller. It now includes every retained event, state and route filters, cursor pagination, exact order/event detail, and selected-event recovery. An old exhausted notification remains visible even when newer successful events fill the recent summary.

## Start and use

Start the original merchant launcher or approved-file checkout as before. Its JSON startup output now contains `fulfillmentControl` (merchant launcher) or `deliveryControl` (checkout). Open that private local URL to enable recovery; the ordinary `/fulfillment` URL stays read only. The control value lives in a URL fragment and is not sent in a GET request or returned by the public status endpoint. Restarting the listener rotates it.

1. Open **Needs attention** and select the actual order or full event identity.
2. Repair the merchant receiver or its configured credentials.
3. Click **Requeue notification**. The exact delivery revision is checked under the original kernel lease before appending the native REQUEUE state.
4. The original delivery worker sends the same recorded notification. This screen follows its state to **Receiver accepted**; check the merchant application for the purchased resource.

When the delivery workspace is composed by the host, its original controller pauses and awaits only its owned worker, uses the same pinned receiver profile, performs original maintenance, and resumes that worker if it was running. A standalone operations listener can requeue while the native delivery lease is free. An independently running worker keeps its lease; its original operator pauses and resumes it. The screen never invokes a payment or another purchase.

`Download event JSON` exports the selected current event and revision. The summary JSON and metrics retain their existing interfaces. Delivery acceptance and final merchant resource fulfillment are shown as separate states because the receiver determines what acknowledgment means.

## Connect incident monitoring and receiver repair

Both `operations/merchant-launch.mjs` and `sf101-merchant-receiver/checkout.mjs serve` accept:

```text
--delivery-workspace /private/merchant/receiver-workspace
--incident-state /private/operator/incidents --incident-merchant merchant-a
```

Use distinct private directories for the original outbox, receiver workspace,
incident state, usage history and availability store. Their parents must exist.
The receiver workspace reopens its original profile revisions, maintenance jobs
and worker intent. A new workspace starts paused; a retained running workspace
resumes its pinned receiver through the original worker. Provision the profile's
signing environment in the merchant launcher process. Profiles store only its
environment variable name. Startup prints `receiverWorkspace` on the same private
operations origin at `/delivery-workspace/`.

`--incident-state` attaches an existing original SF93 monitor and requires its
registered merchant ID. Register the exact seller and operations origins,
including their fixed ports, using the original
[incident setup](../../sf93-seller-support-bundle/INCIDENT_OPERATIONS.md#register-and-start).
Enable that merchant's `delivery` policy to monitor its queue. The launcher reads
the original state and does not start another watcher. Keep the existing
`incident-cli.mjs run --state ...` service running. On a planned full restart,
stop the watcher, reopen the merchant on the registered ports, then reopen the
same watcher state. If an address changes, update its original registration.

The fulfillment page then provides this complete operator path:

1. Select an actual incident in **Merchant incidents**. Inspect its failing
   observation, operator ownership, retained capture availability and watch time.
2. Enter the operator's name and repair note, then **Acknowledge incident**.
   The original incident revision guards this action while the watcher runs.
3. Open **Receiver workspace**. It opens another tab so the selected incident and
   private controls remain available. Inspect the original worker, edit and save
   the receiver revision, then use and apply that revision to the owned worker.
4. Return to the incident, choose **Inspect delivery queue**, and select the
   actual exhausted event/order. **Requeue notification** performs the original
   durable maintenance operation with the currently pinned receiver. A running
   owned worker resumes after the repair.
5. Follow the event to **Receiver accepted**, check the merchant's purchased
   resource, and inspect the monitor's **Recovery observed** state. Both histories
   remain available after reopening the same private directories.

Delivery incidents describe aggregate queue conditions; they do not contain an
invented event or order association. Clearing exhaustion can precede receiver
acceptance, because the original notification has left EXHAUSTED and is pending
again. Acknowledgment records ownership; only the original watcher records
observed recovery. Earlier source registrations remain historical. Their records
cannot apply controls to a differently registered merchant. A missing or stale
monitor is shown in its own panel while the original delivery queue remains usable.

Incident filtering covers active, recovered or all retained records, with stable
original-ID pagination and selected-record JSON export. Refresh preserves a repair
note being composed. The last recorded sweep determines observation freshness;
a historical RUNNING field is not presented as current process ownership.

## Composition API

`startSellerOperations(session, {deliveryOutbox, deliveryControls:true, deliveryRecovery})` returns `deliveryControlUrl` along with its original listener, observer and close function. The optional recovery callback receives `{id, expectedRevision}` and must operate on the same original outbox. `startCheckout` forwards this callback.

For the complete same-listener application, pass `deliveryWorkspaceDirectory`
and optional `incidentSource:{directory,merchantId}` instead of an injected
`deliveryRecovery`. The launcher opens the existing `openDeliveryWorkspace` model
against `deliveryOutbox.dir`, mounts its existing handler, and returns
`deliveryWorkspace` and `deliveryWorkspaceUrl`. `deliveryWorkspaceOptions` forwards
the original trusted delivery options for native integration. Closing operations
also closes its owned workspace model and releases its original supervisor lease.
`startCheckout` forwards these options. The merchant launcher's `--check` validates
the directory/registration option syntax without opening either state directory.

The shared `sf98-merchant-delivery/delivery-recovery.mjs` exports:

- `deliveryRevision(row)`: SHA-256 of the original event ID and exact native state.
- `inspectDelivery(outbox, id)`: original row and current revision.
- `requeueDelivery(outbox, {id, expectedRevision, lease?})`: rechecks the exact original EXHAUSTED state and invokes the original outbox requeue. A supplied original lease is validated against the same outbox; otherwise the helper acquires and releases it. This lets existing receiver-workspace batch maintenance compose the helper without nested lease acquisition.

The listener uses its existing loopback Host/origin policy and an additional per-process capability for recovery. POST `/api/delivery/requeue` requires the exact same-origin `Origin`, `x-delivery-control`, and a JSON object with only `id` and `expectedRevision`. Successful recovery returns the original event/revision transition; stale revisions receive409. The browser never receives receiver secrets, wallet material or payment headers.

GET `/api/delivery/events` accepts `state` (attention/all/native state), `routeId`, `cursor` (last original event ID) and `limit` (1–100). The cursor follows original append order even when a previously displayed event changes state. GET `/api/delivery/event?id=...` returns the selected event and revision; `/api/delivery/control` reports availability without the capability value.

GET `/api/delivery/incidents` accepts `state` (active/all/recovered), `cursor`
(original incident UUID) and `limit` (1–100). GET `/api/delivery/incident?id=...`
returns the selected registered merchant incident. POST
`/api/delivery/incident/ack` uses the same private capability/origin requirements
and accepts exactly `{id,expectedRevision,by,notes}`. Its revision is the original
incident's integer revision; delivery requeue retains its separate SHA-256 state
revision. The original SF93 transaction performs the acknowledgment and its
configured notification behavior.

## Native journey

The existing `sf101-merchant-receiver/checkout.journey.mjs` carries its one original purchase through eight rejected signed HTTP deliveries, native exhaustion, an original watcher incident and acknowledgment, receiver profile revision repair, owned worker pause/requeue/resume, successful receiver acceptance, observed incident recovery, and the exact original file/download/restart flow. It also reopens the original merchant, monitor and receiver workspace at the registered addresses and retains the same profile revisions, maintenance result and recovered incident. Only the retry clock advances to reach each native due time; signed requests use current timestamps and the original HMAC receiver. The existing controlled local facilitator remains explicit in the journey output.

An optional installed Playwright runtime exercises that same journey through the rendered fulfillment page instead of the direct operator POST:

```bash
SF98_BROWSER_MODULE=/absolute/path/to/playwright \
SF98_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
SF98_JOURNEY_OUTPUT=/private/recovery-capture \
node stellar/scf-starforge-20261009/sf101-merchant-receiver/checkout.journey.mjs
```

The browser path uses the actual local listener and control link, acknowledges the original incident, repairs the receiver from revision1 to2 in the original workspace UI, captures desktop and390px layouts, requeues with the real UI, and observes the same notification and incident recovering. The output directory also receives `journey.json`. It adds no browser dependency to the merchant runtime.

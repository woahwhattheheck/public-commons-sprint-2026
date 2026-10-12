# Managed merchant settlement delivery

The fleet now connects each original SF82 merchant to the existing SF98 outbox and destination workspace. A successful native settlement produces the original SF98 event once. Accounting, fulfillment and other HTTPS consumers retain independent delivery journals, cursors, retry states and signing environment references.

The browser, foreground fleet CLI and merchant MCP operate the same retained store. The original destination engine performs synchronization, HMAC signing, delivery, pause/resume, maintenance and worker ownership.

## Start from the existing fleet

Use the original fleet bootstrap and declared source aliases described in [BOOTSTRAP.md](BOOTSTRAP.md). Then open its managed workspace:

~~~sh
starforge-merchant merchant-fleet-workspace \
  --releases /private/fleet/fleet-plan.json \
  --release-state /private/fleet \
  --port 8402
~~~

Set each destination’s signing environment variable in the process that starts this workspace. The corresponding HTTPS receiver needs the matching value. The enrollment stores the variable name; operators supply the actual value through the process environment.

Open **Settlement delivery**, select a merchant and release slot, and choose **Open destination controls**. This opens the existing destination application at the same private origin. Its full workflow includes:

- Enroll the HTTPS URL, explicitly allowed host and signing environment reference.
- Choose **all** original history or **new** events from enrollment onward.
- Select original route IDs and networks, or retain the original unfiltered selection.
- Synchronize selected source events, deliver once, or start the original worker.
- Inspect original event and delivery revisions; pause or requeue using the current native revision.
- Export the complete original source and destination workspace for receiving.

The fleet summary shows actual producer ownership, release digest, instance ID, source event count, journal warnings and original worker state. **Refresh delivery** rereads those original records. The mounted destination controls provide the original event pages, settings and retry controls.

A slot initializes its producer binding on its first managed start. Stopped, previously initialized slots remain available for delivery and receiving. Their completed transfers remain inspectable even if the original live source is unavailable.

## Retained ownership and upgrades

Each declared release store owns these private paths:

| Retained path under the release store | Purpose |
| --- | --- |
| settlement-delivery/binding.json | The original source outbox selected by the first managed launch |
| settlement-delivery/producer.json | Current native instance, release digest, mode and retained journal warning |
| settlement-delivery/outbox/ | Default original SF98 source journal |
| settlement-delivery/destinations/ | Original destination descriptors, source binding, independent cursors and worker state |
| settlement-delivery/transfers/TRANSFER_ID/ | Immutable complete original destination exchange |

Original SF82 run.lock and its child-start grant span producer setup. The child applies the SF98 decorator at the original resource-server boundary, after family-specific factory decorators. The parent reads back the private source binding and producer identity before treating that child as ready.

An original family that already decorated its native server, including OData, keeps that exact decorator and source outbox. The common hook subscribes to its existing journal warning path. Other native families receive the original decorator once; native method receivers and public accessors are preserved.

Later releases in the same store append to the same source journal. Blue and green slots are separate original stores, so each preserves its own source and destination cursors. A replacement can receive traffic while pending events from its retired sibling finish delivery. The fleet refuses two simultaneously owned slots that select the same original source journal.

A journal write failure preserves the original settlement result and records a warning code, time and instance. The fleet exposes the retained warning count so the operator can reconcile the affected merchant receipts through its original accounting workflow.

## Foreground CLI

Start the existing foreground release owner:

~~~sh
starforge-merchant fleet-release start \
  --plan /private/fleet/fleet-plan.json \
  --directory /private/fleet
~~~

These are commands inside that foreground session. JSON input preserves quoted text and repeated spaces.

~~~text
delivery-status merchant blue
delivery-control merchant blue enroll {"id":"accounting","label":"Merchant accounting","url":"https://accounting.example/sf98/accounting-events","allowedHost":"accounting.example","secretEnv":"ACCOUNTING_WEBHOOK_SECRET","history":"all","routeIds":[],"networks":["stellar:testnet"]}
delivery-control merchant blue sync {"id":"accounting"}
delivery-control merchant blue drain {"id":"accounting","limit":20,"concurrency":1,"timeoutMs":7000}
delivery-events merchant blue accounting {"state":"ALL","offset":0,"limit":50}
delivery-control merchant blue start {"limit":20,"concurrency":1,"destinationConcurrency":4,"timeoutMs":7000,"pollMs":5000}
delivery-control merchant blue stop {}
delivery-transfers merchant blue
delivery-transfer merchant blue accounting-handoff-1 SOURCE_FINGERPRINT_FROM_STATUS
delivery-manifest merchant blue accounting-handoff-1
~~~

Pause/resume requires the original destination revision. Requeue requires both the destination revision and the selected event’s delivery revision:

~~~text
delivery-control merchant blue pause {"id":"accounting","paused":true,"expectedRevision":1}
delivery-control merchant blue requeue {"id":"accounting","eventId":"EVENT_ID","expectedRevision":2,"expectedDeliveryRevision":"DELIVERY_REVISION"}
~~~

The existing native bounds apply: at most 100 events per drain, 1–16 concurrent sends, 1–16 destination workers, and timeout/poll values of 100–60000 milliseconds. Enrollment supports the original 128 destinations, 100 route filters and 32 network filters. Individual destination leases protect concurrent delivery and maintenance.

## Merchant MCP

Configure the same original fleet directory through the existing init-fleet command, then inspect and start it through merchant_fleet_plan and merchant_fleet_start. [The merchant MCP guide](../../../stellar-forge/mcp-merchant-operator/README.md) covers host configuration and transports.

| Tool | Original operation |
| --- | --- |
| merchant_fleet_delivery_status | Producer, source, destination and worker readback |
| merchant_fleet_delivery_control | Enroll, pause, sync, drain, start, stop and requeue |
| merchant_fleet_delivery_events | Native event pages and maintenance revisions |
| merchant_fleet_delivery_transfers | Retained exchange listing and pagination |
| merchant_fleet_delivery_transfer | Capture or reopen a named original exchange |
| merchant_fleet_delivery_manifest | Exact exchange identity, member bytes, hashes and receiving arguments |
| merchant_fleet_delivery_file | SHA-pinned original member bytes through the retained-file reader |
| merchant_fleet_delivery_file_release | Release an owned temporary member read |

Every call selects a declared tenant and slot. File calls also bind the immutable transfer ID, exchange fingerprint, original member name and SHA-256. Continue reads using readId, offset and the same hashes; the original reader permits chunks up to 196608 bytes. Completed or released reads can reopen the same retained file.

## Portable receiving

The browser’s **Retain delivery transfer** captures the displayed source fingerprint and complete original destination histories under a new ID. After an uncertain response, inspect that ID in the retained list. An existing ID identifies its original capture; later events use a new ID.

**Download delivery package** streams an archive containing the original exchange layout:

~~~text
manifest.json
source/manifest.json
source/events.ndjson
source/deliveries.ndjson
destinations/DESTINATION_ID/manifest.json
destinations/DESTINATION_ID/events.ndjson
destinations/DESTINATION_ID/deliveries.ndjson
~~~

The archive uses the existing SF82 customer archive header encoder. Directory entries retain mode 0700 and files mode 0600. The manifest and all journal members are reread through the original SF98/SF101 inspection and retained-file reader. Native browser file saving streams larger packages; the in-memory browser fallback supports packages up to 128 MiB. The exact original directory and independently readable members also remain available through the CLI and MCP.

From the directory containing the downloaded archive:

~~~sh
mkdir -m 700 delivery-transfer
tar -xzf accounting-handoff-1-delivery.tar.gz -C delivery-transfer
starforge-merchant delivery-destinations inspect \
  --workspace "$PWD/delivery-transfer"
starforge-merchant delivery-destinations receive \
  --workspace "$PWD/received-delivery" \
  --from "$PWD/delivery-transfer" \
  --fingerprint EXACT_EXCHANGE_FINGERPRINT
starforge-merchant delivery-destinations status \
  --workspace "$PWD/received-delivery/workspace"
~~~

The original receiver verifies the complete exchange, relocates its source binding into received-delivery/source, preserves each destination’s descriptors, cursors and outcome history, and returns the native receiving receipt. Supply the named signing environment values on the receiving host and start its original worker explicitly:

~~~sh
starforge-merchant delivery-destinations run \
  --workspace "$PWD/received-delivery/workspace"
~~~

For the original merchant accounting receiver, use its existing signed SF98 accounting endpoint and exact source outbox binding. The SF101 fulfillment receiver uses the same original SF98 event/signature contract. Destination outcomes stay independent: a failure at one receiver remains in that receiver’s own retry history while another may be delivered.

## Shutdown and continuation

Fleet workspace, foreground CLI and merchant MCP all close their owned original destination workers and cancel active transfer reads. Cancellation reaches the original delivery model before the parent waits for HTTP or serialized MCP calls. Native gateway drain and owned merchant shutdown retain their existing ordering.

Reopening the same fleet resumes its original merchant selections and source journals. Destination worker state, enrollment and history remain visible; the operator starts delivery explicitly through the original controls. Named transfers survive source relocation and use the original inspection/receiving lifecycle.

# Paid Research delivery from Python

Use the installed Research client to publish a frozen customer delivery through its configured Stellar merchant, acquire it through the original Buyer Runbook, and receive the complete editable dossier, source workspace and reports. The browser, JavaScript, terminal and Python surfaces use the same native operations.

The native merchant configuration supplies the payment route, asset, amount and recipient binding. The original Buyer supplies its operator, budget, approval and execution. Python retains the complete selected requests and original results so the scientific application can recover an interrupted call or reopen its acquired files.

## Existing sources and setup

This feature extends [ResearchWorkspace](stellar_forge_buyer/research_workspace.py) and the original [Research commerce client](../research-dossiers/customer-commerce/client.mjs). Its native transport is [research-commerce-delivery.mjs](research-commerce-delivery.mjs), which calls the existing complete [operator](../research-dossiers/customer-commerce/operator.mjs) and [archive receiver](../research-dossiers/customer-commerce/archive.mjs).

Use the same installed Python package and full Node source as the current Research workspace. The retained product needs:

- The original private Research connection file and client directory for the seller.
- The receiving Research connection file and its existing Python client directory.
- The merchant and Buyer aliases declared by those hosts' original Commerce configuration.
- The actual saved dossier, frozen customer delivery, revision and optional Europe PMC source selection.
- The existing operator's explicit native budgets, claim environment name and request UUIDs.

Read [the complete product operating guide](../research-dossiers/customer-commerce/OPERATING.md) for host configuration, native checkout selection, Buyer approval, all original HTTP actions and browser operation. A local archive receive and a completed Python call can reopen with the host stopped; the installed Node source remains the parser and native receiver.

~~~python
from stellar_forge_buyer import ResearchWorkspace

with ResearchWorkspace(
    checkout="/absolute/installed/source",
    connection_file="/absolute/private/seller-research-connection.json",
    directory="/absolute/private/python-seller",
) as seller:
    commerce = seller.commerce()
    configuration = commerce.configuration()
    publications = list(commerce.iter_records("publications"))
~~~

Use actual absolute paths for your existing installation. The constructor keeps its original private client identity. A changed server workspace is rejected before an existing live write can be redirected.

The complete typed inputs and result records are in [research_commerce_types.py](stellar_forge_buyer/research_commerce_types.py). The original native camelCase field names are preserved. Atomic monetary values are strings such as the exact values already selected in the original Buyer budget.

## Publish an actual frozen delivery

Start with the full original publication request:

| Field | Selected source |
| --- | --- |
| requestId | This publication's original UUID |
| merchant | A configured seller merchant alias |
| dossierId | The actual native dossier |
| deliveryId | The saved frozen customer delivery |
| revision | That selected source revision |
| title, summary, usage | The description and permitted use for this exact delivery |
| sourceWorkspace | Optional original library, actor and requestId for the complete Europe PMC workspace |

The customer-update client already exposes saved delivery and source records. Preserve those selected IDs and original revision.

~~~python
review = commerce.prepare_publication(
    original_publication_request,
    call_id="customer-paid-publication-review",
    resume=True,
)
native_review = review["result"]["review"]

enrolled = commerce.enroll_publication(
    {
        "id": original_publication_request["requestId"],
        "reviewSha256": native_review["reviewSha256"],
    },
    call_id="customer-paid-publication-enroll",
    resume=True,
)

publication_export = commerce.export(
    "publications",
    original_publication_request["requestId"],
    "publication",
    call_id="customer-paid-publication-export",
    expected_sha256=enrolled["result"]["result"]["publicationSha256"],
    resume=True,
)
publication_file = commerce.exported_file(publication_export)
~~~

Every mutating method returns the complete original operator result: local directory, workspace identity, request hash, original native result and completion. The native view is in its result field. Read-only publication and purchase methods return the original native view directly.

Publication preparation freezes all four reports, reviewed work and complete editable dossier. The optional source workspace travels in full. The original merchant review binds that exact compressed archive and original handover to the configured checkout. Enrollment retains the first order and exact public publication.

The exported publication contains the full public file promise and original native merchant handoff. FileDelivery verifies its complete bytes and hash before yielding the same open descriptor.

## Receive the publication and prepare the Buyer

Open the receiving ResearchWorkspace with its own original connection and client directory:

~~~python
customer = receiver.commerce()

intake = customer.receive_publication_file(
    publication_export["file"]["path"],
    buyer=actual_buyer_alias,
    request_id=original_intake_uuid,
    call_id="customer-paid-intake",
    expected_sha256=publication_export["file"]["sha256"],
    resume=True,
)

current = customer.purchase(original_intake_uuid, refresh=True)
preparation = {
    "id": original_intake_uuid,
    "requestId": original_preparation_uuid,
    "expectedRevision": current["paidFile"]["revision"],
    "totalAtomic": actual_total_atomic_budget,
    "dailyAtomic": actual_daily_atomic_budget,
    "claimEnv": actual_claim_environment_name,
}
prepared = customer.prepare_purchase(
    preparation,
    call_id="customer-paid-prepare",
    resume=True,
)
native_prepared = prepared["result"]["prepared"]
~~~

The public publication bytes are retained inside the durable original request before native intake. If the original file is still present on a repeated call, its full bytes must match. A moved donor can be recovered from the saved request.

Preparation uses the actual refreshed native paid-file revision. It retains the original paid-file review, plan, run, operation, intent, source configuration and prepared hash. Preserve the first complete preparation input when resuming; recovering its call ID reads that original selection before requesting current state.

The claimEnv field names the configured environment variable. Its secret value remains with the existing native operator and is not placed in the request or result.

## Execute, cancel and retrieve

Each native action has its own original request UUID and stable Python call ID. The prepared hash remains the same across that purchase's actions.

~~~python
executed = customer.execute(
    {
        "id": original_intake_uuid,
        "requestId": original_execution_uuid,
        "preparedSha256": native_prepared["preparedSha256"],
    },
    call_id="customer-paid-execute",
    resume=True,
)

retrieved = customer.retrieve(
    {
        "id": original_intake_uuid,
        "requestId": original_retrieval_uuid,
        "preparedSha256": native_prepared["preparedSha256"],
    },
    call_id="customer-paid-retrieve",
    resume=True,
)
~~~

Execute reaches the original Buyer approval and payment process. Use its existing human or configured native approval path. Python preserves the controlling-terminal behavior of the original runtime and never fabricates an approval response.

Native execution can continue after a transport interruption. Read purchase(..., refresh=True) and the original run, paid-file, operation and approval fields. The same native recover_purchase, finalize and reconcile methods expose the existing recovery actions.

Cancellation can run from another thread or process with a separate call ID while execute is awaiting its result. Send the actual original executionId:

~~~python
cancelled = customer.cancel(
    {
        "id": original_intake_uuid,
        "requestId": original_cancellation_uuid,
        "preparedSha256": native_prepared["preparedSha256"],
        "executionId": actual_running_execution_uuid,
    },
    call_id="customer-paid-cancel",
    resume=True,
)
~~~

The new cancellation call reaches the same native execution. The Python client retains per-call locks, and the host releases its original preparation lock before awaiting the active Buyer request.

For an uncertain original native action, use reconcile with id, its own requestId, the actual nativeRequestId and optional nativeId from the existing operation. The source controller and original Buyer determine its status.

## Receive the editable customer project

After the original paid resource is available, receive it through the same native dossier and source receiver:

~~~python
received = customer.receive_dossier(
    {
        "id": original_intake_uuid,
        "requestId": original_receiving_uuid,
        "preparedSha256": native_prepared["preparedSha256"],
        "sourceActor": actual_receiving_source_actor,
    },
    call_id="customer-paid-dossier-receive",
    resume=True,
)
native_receiving = received["result"]["received"]["nativeReceiving"]
updates = receiver.customer_updates(native_receiving["dossierId"])
~~~

Omit sourceActor when no source workspace travels. The original receiving result identifies the saved dossier, frozen delivery, source receiving and revision. Use Customer updates normally to review the complete history or prepare a later correction.

The native operation captures the original Buyer export, downloads its complete archive, checks the purchased promise, receives every original member, and reopens the editable dossier and optional source workspace. Its first completed result remains associated with that purchased delivery after later project work.

## Receive a complete archive locally

Export the acquired archive through the original verified file transport:

~~~python
archive_export = customer.export(
    "purchases", original_intake_uuid, "archive",
    call_id="customer-paid-archive-export",
    expected_sha256=original_publication["archive"]["sha256"],
    resume=True,
)
~~~

The public archive promise contains the exact bytes and SHA-256. Receiving uses those same values and the original handover manifest hash:

~~~python
from stellar_forge_buyer import ResearchWorkspace, ResearchCommerceArchive

with ResearchWorkspace(
    checkout="/absolute/installed/source",
    directory="/absolute/private/local-research-receiving",
) as local:
    result = local.commerce().receive_archive(
        path=archive_export["file"]["path"],
        expected_sha256=original_publication["archive"]["sha256"],
        expected_bytes=original_publication["archive"]["bytes"],
        manifest_sha256=original_publication["delivery"]["manifestSha256"],
        call_id="customer-local-archive",
        resume=True,
    )

delivery = ResearchCommerceArchive(result)
full_report = delivery.handover.report("json").json(limit=64 * 1024 * 1024)
complete_work = delivery.handover.work().json(limit=64 * 1024 * 1024)
with delivery.handover.dossier().open() as original_dossier:
    # The complete original portable dossier is available on this descriptor.
    pass
source_workspace = delivery.handover.source_workspace()
~~~

A local archive receive can omit connection_file. It still executes the original native archive inspector, full file publisher and receiving implementation from the installed source. It is recorded as a durable local mutation with the same interruption and uncertain-outcome handling as other saved calls.

The exact compressed archive and handover members are retained in the native operation directory. Construction of ResearchCommerceArchive verifies the whole archive and every original member through the same original descriptor readers. The complete native manifest, source selection, four reports, work snapshot and dossier are accessible through its handover object.

The compressed archive limit is the original 32 MiB paid-file route. Each uncompressed member keeps its original native per-file limit. The receiver validates the whole expected compressed hash before publishing original frame members.

Repeating receive_archive with the same call ID can omit path and directory. It retains the original selected paths and complete request; completed receiving reopens before consulting its donor. Calling recover with that ID also reopens or continues the same exact operation.

## Saved calls, recovery and explicit replay

| Method | Original behavior |
| --- | --- |
| saved(call_id) | Reads the first completed local reply and verifies retained files |
| recover(call_id) | Continues the same durable attempt or returns that first completed reply |
| operation(call_id) | Inspects the underlying original native operator records |
| recover_purchase(input) | Invokes the original Buyer's selected recovery action |
| replay(call_id, replay_id=...) | Submits the unchanged native request in a distinct durable Python attempt |

~~~python
saved = customer.saved("customer-paid-dossier-receive")
original = customer.recover("customer-paid-dossier-receive")

replayed = customer.replay(
    "customer-paid-dossier-receive",
    replay_id="customer-paid-dossier-receive-after-correction",
)

same_replay = customer.recover("customer-paid-dossier-receive-after-correction")
~~~

The replay ID must differ from its original call ID. It does not replace the native request UUID. A replay may perform the original request's first completed mutation if an earlier process stopped before the native operator retained its request. The complete saved action, input and workspace binding travel into that distinct attempt.

Once an explicit replay completes, reopening its replay ID returns that first saved replay result. Its original native operator and complete response are retained independently, so a moved donor operation does not force a fresh replay.

A completed download or archive receive checks its complete local files before needing a live connection. Full JSON responses are saved through the native file publisher and read with FileDelivery; the subprocess returns a small source-bound file descriptor.

## Installed command interface

The existing Python Research command includes the complete paid-delivery operations. The module entry point is:

~~~sh
python -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed/source \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private/python-research \
  commerce-configuration
~~~

Every command accepts an optional --output for the full retained JSON result. Native writes accept --input, optional --input-sha256, a stable --call-id and --resume. The complete input fields are the same as the JavaScript and browser product.

~~~sh
python -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed/source \
  --connection /absolute/private/research-connection.json \
  --directory /absolute/private/python-research \
  commerce-publication-prepare \
  --input /absolute/private/actual-publication.json \
  --call-id customer-paid-publication-review --resume
~~~

Available operations are listed by --help and [the installed command implementation](stellar_forge_buyer/research_commerce_cli.py):

- Configuration; paged publication and purchase library; full native views; exact file metadata.
- Publication preparation and enrollment; exact publication-file intake.
- Buyer preparation, execution, retrieval, recovery, finalization, cancellation and reconciliation.
- Full editable dossier receiving; complete exports and optional exclusive local copies.
- Saved original calls, same-call resume, explicit replay and underlying operation inspection.
- Full native compressed-archive inspection and local receiving.

For complete publication-file intake, commerce-purchase-receive accepts --publication-file, --buyer, --request-id and optional --publication-sha256. Its --input alternative carries the exact original request object, including base64 of the complete publication.

Use commerce-resume CALL_ID for a saved Python call. The commerce-recover command remains the original native Buyer recovery action and accepts its full input.

~~~sh
python -m stellar_forge_buyer.research_cli \
  --checkout /absolute/installed/source \
  --directory /absolute/private/local-research-receiving \
  commerce-archive-receive \
  --file /absolute/private/research-customer.handover.gz \
  --sha256 ACTUAL_ARCHIVE_SHA256 --bytes ACTUAL_ARCHIVE_BYTES \
  --manifest-sha256 ACTUAL_MANIFEST_SHA256 \
  --call-id customer-local-archive --resume
~~~

The capitalized values identify actual retained source values to supply. The guide does not allocate substitute native IDs, amounts or source data.

## Complete retained two-workspace programme

[examples/research_paid_delivery.py](examples/research_paid_delivery.py) is a runnable complete operating programme over two existing ResearchWorkspace instances. It carries:

1. The actual frozen delivery into original merchant review and enrollment.
2. The entire public publication into original Buyer intake and preparation.
3. The existing approval, execution and full resource retrieval.
4. Complete native editable dossier/source receiving and a separately retained full local archive.
5. An optional actual customer correction from the selected case.
6. Explicit replay of the original receiving request after that later work.
7. Full file and original-call reopening from the retained programme directory.

The private case has schema sf88-research-paid-python-programme/v1 and the following fields:

| Section | Full selected fields |
| --- | --- |
| publication | The original publication request described above |
| buyer | alias, intakeRequestId, prepareRequestId, executeRequestId, retrieveRequestId, receiveRequestId, totalAtomic, dailyAtomic, claimEnv, optional sourceActor |
| correction | Optional original Customer updates action, data, actor, requestId and optional expectedRevision |

The buyer request IDs are distinct original UUIDs selected for those actual native actions. The correction uses the existing customer compiler's actor, action, data and native request ID. Supply the source from the existing programme and customer work.

The programme copies the exact case bytes, retains original phase forms and calls, and freezes the first native paid-file revision used for preparation. A restarted phase checks its saved call before refreshing live data. Its result includes the complete original phase results and all complete local product files.

~~~sh
python /absolute/installed/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/research_paid_delivery.py \
  --checkout /absolute/installed/source \
  --sender-connection /absolute/private/seller-research-connection.json \
  --receiver-connection /absolute/private/customer-research-connection.json \
  --sender-directory /absolute/private/python-seller \
  --receiver-directory /absolute/private/python-customer \
  --directory /absolute/private/original-paid-research-programme \
  --case /absolute/private/actual-paid-research-case.json \
  --stage prepare
~~~

Inspect the exact native review and prepared Buyer plan. Continue that same directory with --stage complete and the original approval flow. The complete stage defaults to a 900-second original client/request window in this example; select a suitable existing runtime window for the actual operation.

After completion, the same programme can omit the source case and connections. Its retained selection, complete files, original call records and first result are reopened before any donor or host is accessed. Keep the original sender and receiver Python client directories with the programme.

The callable run_paid_delivery accepts the existing sender and receiver clients. It borrows both lifetimes, preserves their cancellation ownership and leaves their host workspaces open. It never creates a second merchant process or a competing native Research programme.

## Native lifetime and interruption

Python owns the local subprocess through the existing Runtime and records its actual start, response, interruption and uncertain outcome. Its original cancellation contract remains in force. The native bridge awaits startup/result output, attempts acquired cleanup, and retains failed original close handles for a repeated signal or owning caller.

Closing ResearchWorkspace cancels accepted local calls and waits for their owners. The same host remains available for original operation readback and native cancellation. A failed or interrupted attempt retains the original request before the next action; use its same call ID to recover and its separate replay ID when an actual original native replay is intended.

Keep the existing complete client directories, native operation directories, original publication/archives and received Research workspace in their normal product backup and receiving workflows.

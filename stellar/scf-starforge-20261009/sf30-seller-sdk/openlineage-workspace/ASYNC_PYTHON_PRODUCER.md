# Operate the native asynchronous Python producer

The installed OpenLineage workspace includes a Python async producer that uses the released OpenLineage 1.53.0 AsyncHttpTransport. It keeps the SDK's queue, worker, concurrency, ordering and retry behavior, then matches each actual receiving acknowledgement to the retained original request.

Use this producer when a pipeline needs asynchronous emission and an operator needs to reopen the complete original send after interruption. The existing synchronous Python and Java producers remain available through their current entries. All of them send to the same original workspace endpoint and participate in its saved source and operation history.

## Select the original environment and workspace

Use the prepared Python environment containing the existing pinned requirement:

~~~text
openlineage-python==1.53.0
~~~

The same release already declares attrs, python-dateutil, requests, httpx2 and its remaining runtime dependencies. The async entry introduces no additional Python package. An offline receiver should use the existing selected complete wheel set and interpreter. Installing only the OpenLineage wheel without its declared dependencies does not prepare the environment.

The adapter verifies the installed version and the exact selected async, serialization and RunEvent source files. Its narrow request-observation hooks depend on that implementation. A different patched wheel needs a reviewed source selection before use.

| Selected source | Original Git identity |
| --- | --- |
| OpenLineage 1.53.0 release | 8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe |
| client/python/src/openlineage/client/transport/async_http.py | 1a5c146a45fb71cacdcf858f7e04ae45500bed23 |
| client/python/src/openlineage/client/serde.py | 784dbfc20c6aefe984c131d227759aafcd260507 |
| client/python/src/openlineage/client/run.py | d8110607108afbd6cc3dc88aa910a1cf3090248d |

The publisher documents async configuration at https://openlineage.io/docs/client/python/configuration/ and release 1.53.0 at https://openlineage.io/docs/releases/1_53_0/ . The exact implementation is available under https://github.com/OpenLineage/OpenLineage/tree/8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe/client/python .

Start or select the existing workspace as described in PRODUCERS.md. Keep its operator credential and producer credential in their original private files. The producer credential admits event emission; the operator credential is used separately for source inspection, review and complete workspace export.

The workspace's current connection.json supplies its URL and original workspace UUID. A restart can change the port and server instance. Regenerate the selected connection settings while retaining that workspace UUID.

## Prepare the native settings

The installed command is starforge openlineage native-python-async. A received complete application exposes the same command through node /absolute/application/cli.mjs.

~~~sh
node /absolute/application/cli.mjs native-python-async configure \
  --python /absolute/prepared-python/bin/python \
  --connection /absolute/lineage-project/connection.json \
  --token-file /absolute/private/producer-token \
  --compression gzip \
  --queue-size 64 \
  --concurrency 4 \
  --out /absolute/private/async-openlineage.json
~~~

The new private file contains the SDK's async_http transport configuration, API-key auth and X-OpenLineage-Workspace. It is valid JSON and can also be read as YAML by the publisher's configuration loader. The command prints the selected workspace, queue settings and output path; it keeps the token out of standard output.

When using an already prepared settings file, its transport.type must be async_http. Native timeout, verify, compression and retry remain SDK configuration fields. This entry accepts an HTTP origin with the original api/v1/lineage endpoint. It prevents custom headers from replacing the original operation key or transport authentication/compression fields.

A direct publisher client can consume the same configuration. Per-event durable request and acknowledgement retention described here belongs to the included AsyncWorkspaceProducer wrapper. A pipeline that constructs the unwrapped SDK transport gets the publisher's in-memory queue and statistics.

## Emit complete original event files

Select the original event JSON, JSON array, JSON-lines file, or gzip file. Repeated --input flags preserve the supplied file order. Every original file is retained before its plan is published.

~~~sh
node /absolute/application/cli.mjs native-python-async emit \
  --python /absolute/prepared-python/bin/python \
  --config /absolute/private/async-openlineage.json \
  --directory /absolute/pipeline-delivery \
  --input /absolute/pipeline/original-run-events.jsonl \
  --operation-id customer-pipeline-20261012 \
  --drain-timeout 30
~~~

Use a new private operation directory for a new source selection. Reusing the original directory with the same inputs and operation ID reconciles that exact delivery. The input plan gives every event a stable ID:

~~~text
customer-pipeline-20261012/file-1/event-1
customer-pipeline-20261012/file-1/event-2
~~~

The original filename, file SHA-256, byte count, file index and event index stay attached to each request. The SDK performs actual serialization and gzip compression. Before the request enters its queue, the wrapper atomically preserves the first serialized and compressed bytes. Subsequent native retries and later process resumes use those original bytes and the same Idempotency-Key.

JSON RunEvents are constructed as actual SDK RunEvent objects so the SDK can recognize START and terminal events. The legacy model is selected because it accepts the original explicit schemaURL. Optional absent fields stay absent in the native serialization; the wrapper compares the original and typed native serialization before dispatch. Full custom facets remain present. A field outside that selected RunEvent model produces an explicit input error instead of disappearing. Original file bytes are retained separately from the SDK's normal null/enum serialization.

A Python application can also supply its original native attrs event objects directly:

~~~python
from native_async_producer import AsyncWorkspaceProducer

with AsyncWorkspaceProducer(native_config, "/absolute/pipeline-delivery") as producer:
    producer.emit(
        original_start_event,
        "pipeline/run-42/start",
        original={"sourceReference": "retained pipeline event", "ordinal": 1},
    )
    producer.emit(
        original_complete_event,
        "pipeline/run-42/complete",
        original={"sourceReference": "retained pipeline event", "ordinal": 2},
    )
    drained = producer.wait_for_completion(timeout=30)
    actual_native_counters = producer.get_stats()
~~~

The application supplies its actual events and stable IDs. A queued return has state submitted. A matching saved acknowledgement has state received. Repeating an already acknowledged ID with the same original event returns its retained receipt.

## Interpret ordering and completion correctly

The released async implementation holds a terminal request while its corresponding START is pending. It releases held terminal requests when START succeeds or when START exhausts its retries. If no START is pending, a terminal request can be sent immediately.

This is a conditional ordering guarantee. It does not claim that the receiver accepted START whenever it later accepts COMPLETE, FAIL or ABORT. The retained observations distinguish those outcomes.

The SDK tracks a pending run state by runId plus eventType. Before reusing such a currently pending key for another original event, the wrapper drains the native transport. This preserves repeated original run-state observations without colliding in the SDK's tracking map.

| Observation | Meaning |
| --- | --- |
| emit returns submitted | The original request is retained and was passed to the native queue. |
| native pending > 0 | The SDK still has work in flight, in its queue or waiting behind START. |
| wait_for_completion returns true | The native pending count reached zero. Failed requests can still be present. |
| native failed > 0 | One or more native attempts exhausted their retry path or received a terminal HTTP failure in that process. |
| event state received | A saved HTTP 200 acknowledgement matches the original workspace, operation, actual wire body, decoded gzip identity and revision. |
| complete=true | Every planned event has that matching acknowledgement. |
| unacknowledgedOperations | The original requests remain available for exact recovery; the report does not infer whether an interrupted receiver saved them. |
| unsubmittedOperations | The original plan contains events that had not reached SDK request preparation. |

The command exits 0 when all planned acknowledgements are present. It exits 2 for a completed command whose original delivery still has unacknowledged or unsubmitted events. Input or runtime errors exit 1. SIGINT and SIGTERM retain the original request state and return the corresponding interrupted exit.

The selected drain timeout applies to SDK waiting. The publisher's close method then joins its worker; it is not a hard wall-clock process deadline. A host's existing process controller can still stop the original command, after which the retained plan is the recovery input.

## Recover an interruption or failure

Inspect the original directory:

~~~sh
node /absolute/application/cli.mjs native-python-async status \
  --python /absolute/prepared-python/bin/python \
  --directory /absolute/pipeline-delivery
~~~

The status command validates original file hashes, retained request bodies and saved acknowledgement binding. It returns the complete event list, actual response/failure observations, unsubmitted IDs, unacknowledged IDs and the most recently closed native session.

Resume with the same private directory and the current settings for that original workspace:

~~~sh
node /absolute/application/cli.mjs native-python-async resume \
  --python /absolute/prepared-python/bin/python \
  --config /absolute/private/async-openlineage.json \
  --directory /absolute/pipeline-delivery \
  --drain-timeout 30
~~~

Resume reads the saved original input plan. It skips events with matching saved receipts. It re-emits each remaining original event through the real SDK using the saved first request bytes and original operation ID. A receiver that committed before a lost response returns its original operation result. That replay does not advance the workspace again.

An entirely completed operation returns its retained status without starting another async transport. Its original close and delivery files remain stable.

HTTP 401, 409, 413, retryable 503, native failure and network interruption remain distinct observations. Correct the selected credential or workspace binding before recovery when those observations require it. Corrected source content belongs to a new original operation ID and directory. It must not replace a retained request under an existing ID.

One operating process holds the private directory's original lock. If a library close is interrupted, the same native worker keeps that lock until its actual exit, and calling close again finishes the original shutdown and saved close record. Status remains a read operation. Another native sender cannot acquire that same directory until the first process releases it or exits. A local file lock does not coordinate copies on different computers; portable continuation must be transferred after the original sender has stopped. Receiver idempotency still binds every original request.

## Queue and memory limits

The included configuration starts with a queue of 64 and four concurrent requests. The SDK's public default is 10,000 queued items and 100 concurrent requests; the configuration file carries the actual selection.

The wrapper's admission bound includes terminal requests held outside the SDK's main queue. It waits on the SDK's native pending counter and keeps no second event queue. Admission stops when pending work reaches selected queue size plus selected concurrency.

Each original source file, bounded decoded gzip file and serialized native event is limited to 64 MiB. Queue limits count requests, not bytes. Select lower queue/concurrency values for large event bodies or a constrained host. The complete source file and its parsed event selection also require memory.

The receiver has its own current admission limits and serialized workspace writer, described in PRODUCERS.md. Native 503 responses preserve the request for retry. Queue drain, receiver commit and complete customer delivery are reported separately.

## Export and receive the original producer operation

After the native sender closes, create a complete producer delivery:

~~~sh
node /absolute/application/cli.mjs native-python-async export \
  --python /absolute/prepared-python/bin/python \
  --directory /absolute/pipeline-delivery \
  --out /absolute/delivery/pipeline-producer.zip
~~~

The ZIP contains the complete original input files, plan, retained SDK wire bodies, acknowledgements, failure observations and close/result records, with a manifest of every file's SHA-256 and byte count. The exporter streams those records into a private temporary file, publishes the complete archive atomically and verifies same-output replay.

Only declared producer records enter this archive. The selected token/configuration files stay in their original host custody. Keep those files outside the operation directory as shown in the commands.

Receive the ZIP into a new directory:

~~~sh
node /absolute/application/cli.mjs native-python-async receive \
  --python /absolute/prepared-python/bin/python \
  --input /absolute/delivery/pipeline-producer.zip \
  --directory /absolute/received-pipeline-delivery
~~~

Receiving checks the entire manifest, original paths, individual hashes, request bodies, acknowledgement bindings, workspace ID and operation ID before publishing its records. A small destination-specific intent retains the exact archive before directory creation. Verified files are installed atomically and completion is saved last; repeating the same receive finishes that original archive after an interruption. An unrelated existing destination is rejected. The current receiver limits a ZIP to 2 GiB compressed and decoded, 100,000 members and a 32 MiB manifest. It streams member extraction, rejects undeclared paths and preserves original producer records. Its separate local receiving marker identifies the archive.

A received complete operation can be inspected immediately. An unfinished operation can resume after the original sender is stopped and the receiver selects credentials for that same workspace. The prepared Python runtime and complete application travel through the existing product installation workflow.

## Attach the result to the existing workspace and hand it over

The producer credential performs event emission. The operator then uses the existing workspace review/edition and result.attach operations to bind the complete producer ZIP and result JSON to the actual original run or dataset and selected edition. The existing full workspace export includes these original result objects, every original emitted body and the complete editable application.

Use the original workspace's source downloads and operation journal to reconcile each producer receipt. For every received event, the source ID must equal the retained wire SHA-256, and its original operation must identify the same saved receipt. Gzip decoded hashes must also match. An operator reviewing pending work sees its exact source and failure records.

ASYNC_PRODUCER_RECEIVING.mjs performs this complete operated journey as a continuation of the existing native workspace: actual SDK queue/order, original writer backpressure, real accepted-response loss, failure and exact recovery, full producer export/receive, result attachment, complete workspace export and independent receiving. It uses the selected Python environment and the existing original host/workspace; its source is not a claim that a native run has completed. The standalone entry uses the original POSIX kernel-lease convention from the maintained receiving supervisor. The selected Python supervisor, Node programme and actual SDK child retain the same open file description, so parent exit does not release an active child’s lease.

The original OpenLineage native owner records the actual selected interpreter, wheel set, source revision, workspace, retained results and complete customer package when that continuation runs.


## Run the complete native customer continuation

Use the already received original OpenLineage workspace and its separately selected operator and producer token files. Keep the complete application, the prepared Python 1.53.0 environment and Node 22 or newer together. The native receiving programme uses the existing POSIX process/lease contract.

~~~sh
node /absolute/application/ASYNC_PRODUCER_RECEIVING.mjs \
  --directory /absolute/original-operation/async-continuation \
  --workspace /absolute/original-operation/workspace \
  --python /absolute/prepared-python/bin/python \
  --operator-token-file /absolute/original-operation/private-operator-token \
  --producer-token-file /absolute/original-operation/private-producer-token \
  --source-commit ACTUAL_40_CHARACTER_GIT_COMMIT
~~~

Repeat that same command and directory after interruption. The entry opens the existing workspace, keeps its UUID, retains the original selected source files and saves each completed native phase. Its small Python supervisor holds the original directory lock and passes that same descriptor through Node to every SDK child. Another invocation cannot acquire that operation while an original child still holds it.

The programme retains its actual original loopback origin in async-operation.json and reopens that port on continuation. This preserves the original download journal's endpoint binding, including a partial whole-workspace download. If the port is occupied, reconcile that existing listener before resuming this original command. The received workspace uses its own local server for the final native replay.

An existing receiving owner can call the same full module with its already-open host:

~~~js
const result = await receiveAsyncProducers({
  directory: originalAsyncDirectory,
  python: preparedPython,
  host: existingOriginalHost,
  operatorToken: originalOperatorToken,
  producerToken: originalProducerToken,
  sourceCommit: selectedGitCommit
});
~~~

That caller keeps its original OPENLINEAGE_RECEIVING_LOCK_FD and OPENLINEAGE_RECEIVING_LOCK_ROOT environment, with this async directory under the leased original root. It preserves the original host origin on continuation. The helper closes its own SDK children and received-workspace listener; the original host stays with its caller.

The complete operated path retains these outputs under the selected async directory:

| Output | Complete contents |
| --- | --- |
| async-operation.json | Original workspace/origin, full source selection, exact saved mutation requests, completed phases and last actual error. |
| native-async-receiving.json | Complete native result with every completed phase and original/received artifact paths. |
| upstream/ and original-ordering-events.json | Exact released fixtures and the explicitly authored START/COMPLETE ordering selection. |
| native-failed-start/, native-ordered/, native-interrupted/ | Original input plans, first SDK wire bytes, real HTTP/failure observations, saved acknowledgements and native close state. |
| logs/ | Separate stdout, stderr and actual process result for every native attempt. |
| failed-relay/ and lost-response-relay/ | Actual forwarded response bytes and the original committed HTTP 200 response deliberately withheld during receiving. |
| delivery/ | All three complete producer ZIPs and the full original workspace export, with those ZIPs attached to its actual run and saved edition. |
| received-workspace/ | The independent editable workspace and complete application from that original export. |
| received-producer/ and retained-fault/ | The fully received producer operation, original retained receipt and actual same-request cold replay result. |

The failed-token phase observes real HTTP 401 responses and the SDK's held-terminal release. The interruption phase holds the original writer, observes a new actual HTTP 503 in that attempt, interrupts the original SDK process and resumes its same saved plan. The response-loss phase forwards the actual request to the original receiver, retains its real committed response and drops that response once; it verifies the native retry's original acknowledgement and START-before-terminal journal order. Every later receipt is compared to the receiver's original source bytes and operation result.

Complete customer delivery is recorded only after all producer archives, original run attachments, full workspace export, independent receiving and cold native replay have completed. The same source contains the whole journey; the native owner's returned result identifies its actual execution.

## Complete application source editions

The cumulative async application is version 6 and exports 80 original application files. The four async files are added to the exact 76-file Quality v5 selection. Import retains the original 35-file legacy edition, 40-file version 2, both 48- and 55-file version 3 editions, 66-file Service Levels version 4, and 76-file Quality version 5. Their saved workspace identities, event bytes, policies, assessments, reviews and decisions travel with their selected original application.

The native continuation receives the complete version 6 application with its full editable workspace. The package-level `@tokenjunkielabs/starforge-merchant/seller/openlineage/async-producer` export and the existing CLI select the same launcher; the source inventory includes the Python leaf, launcher, full guide and native continuation.

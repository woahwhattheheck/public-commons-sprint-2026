# SF98 delivery workspace

The delivery workspace gives an operator a private browser interface for the original merchant outbox. It saves immutable receiver revisions, controls the original continuous worker and single-batch drain, exposes event and order details, and retains selected-event repair jobs that another operator can continue after a restart. The same controller also supplies the SF30 fulfillment desk’s delivery recovery callback.

## Start on the merchant host

Use Node 22 or later on Linux with the util-linux `flock` executable available to the process. Retain the complete `sf98-merchant-delivery` component and its existing native modules, including `delivery-recovery.mjs`. The browser assets are loaded alongside `workspace-server.mjs`; keep `workspace.html` and `workspace-app.mjs` beside it when packaging.

Choose a private workspace directory separate from the merchant’s existing SF98 outbox. Both paths must be absolute, canonical directories without symlinks, owned and accessible by the operator process, with no group or world permission bits. Existing parents must be canonical. The model creates either final directory with mode `0700` when absent; workspace records use `0600`. Use the original outbox path so that this interface observes the merchant’s actual settlement-derived events.

Provide the receiver’s existing HMAC signing secret through the service’s private environment configuration before startup. The secret value must contain 32–1024 bytes. For example, a profile can name `SF98_WEBHOOK_SECRET` after that variable has been populated by the merchant’s environment file or secret manager. The form takes the **variable name**, and the value stays in the process. Receiver saves are allowed before the variable is available; native sending requires it.

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf98-merchant-delivery/workspace-server.mjs serve \
  --workspace /srv/merchant/private/delivery-workspace \
  --state /srv/merchant/private/sf98-outbox \
  --port 8462
```

Open the URL printed by the process, normally `http://127.0.0.1:8462/`. The standalone server binds to loopback. It also accepts the matching `localhost` origin. For remote operator access, use the merchant’s existing private access arrangement or mount the handler inside its authenticated operator listener.

One supervisor owns each workspace directory. The existing kernel delivery lease owns all native send and requeue operations on the original outbox. Pause releases the lease held by this workspace’s own operation; an unrelated service retains its native lease until that service releases it.

## Receiver revisions and worker operation

1. Open **Receivers → New receiver**. Enter a recognizable name, the public HTTPS endpoint, its exact allowed hostname, and its secret environment variable name. Configure batch limit, concurrency, polling, and timeout, then save.
2. Choose **Use this revision** to select that exact saved profile for the next worker action and repair. On Overview, inspect its name, revision, environment availability, and hostname.
3. Choose **Run continuously** for the original continuous worker or **Drain one batch** for one native batch. A drain retains a maintenance operation and leaves the workspace’s restart intent paused.
4. Choose **Pause owned work** to save pause intent and stop the operation owned by this workspace. Inspect **Original outbox owner** separately when another service has the original delivery lease.

Saving a receiver creates an immutable revision. It does not change a running worker’s endpoint. Worker actions and repair requests include the profile’s full ID, revision, and SHA-256. The selectors identify the latest revision, the saved restart intent, and the currently running revision; an older pinned receiver remains available by its original reference. Open the saved revision selector to inspect historical values, or open the latest revision to edit.

The form remains intact during the five-second state refresh. A dirty form must be saved or explicitly discarded before another profile can replace it. A save conflict keeps the draft visible and reports the newer revision. Copy any desired changes before discarding the draft and opening the latest revision. Navigation and asynchronous reads carry separate request generations, so a late response cannot replace a newer editor or detail view.

Receiver limits are enforced by the shared model:

| Setting | Accepted value |
| --- | --- |
| Profile name | Nonempty, at most 100 characters |
| URL and allowed hostname | Original public HTTPS destination validation and exact hostname |
| Secret variable name | An uppercase letter followed by 1–64 uppercase letters, digits, or underscores |
| Events per batch | 1–100 |
| Concurrent requests | 1–16 |
| Poll interval | 50–60,000 milliseconds |
| Request timeout | 100–60,000 milliseconds |

The original transport validates every resolved address, pins the selected public address for the HTTPS connection, verifies the original TLS hostname, and rejects redirects and credential-bearing URLs. Its existing authentication, delivery journal, retry schedule, and exhaustion behavior remain the authority for delivery outcomes. `DELIVERED` records receiver HTTP acceptance; downstream order completion is a separate merchant outcome.

## Inspect and repair the original event queue

**Event queue** filters the original states `PENDING`, `RETRY`, `REQUEUE`, `EXHAUSTED`, and `DELIVERED`. Search matches full or partial event IDs, order references, and route IDs. The browser reads 25 rows per page. Selecting an event opens its full event ID, order reference, route, native event time, network, exact atomic amount, digests, latest attempt, HTTP status, next retry, and original JSON record.

For a receiver problem that has already exhausted delivery:

1. Repair and save the receiver configuration as needed. Select the intended saved receiver revision in the repair panel.
2. Inspect the exhausted events, then select them individually or select the exhausted entries on the current page. A repair contains at most 100 distinct full event IDs. The selection retains each original event-and-state SHA-256; it never silently changes to a newer attempt.
3. Review the selected-event list. If refresh finds a changed record, open that event and explicitly use its reviewed current exhausted state, or remove it from the selection. An event that advanced to another state can be removed.
4. Choose whether **Run this receiver after repair** should be enabled, then choose **Repair selected**. With the checkbox clear, requeue completion leaves delivery paused. With it enabled, the signing environment must be available and the saved receiver resumes only after the complete repair permits it.
5. Inspect **Maintenance** for the retained job, per-event outcomes, and any continuation action. Original native ownership is visible on Overview throughout the operation.

The controller serializes repair with other workspace mutations. It saves pause intent, stops owned work, inspects the exact exhausted records, retains the request, and acquires the original native delivery lease. It requeues through the shared recovery helper and publishes an individual receipt after each event. Selected events that changed before admission return `DELIVERY_EVENT_CHANGED_RELOAD`; the worker is already paused at that point, so review the refreshed queue before applying another action.

Maintenance receipts distinguish these cases:

| Receipt outcome | Meaning for the operator |
| --- | --- |
| `REQUEUED` | The selected exhausted record matched, and native recovery rearmed it. |
| `RECONCILED_REQUEUE` | Continuation found the original record already requeued. |
| `ADVANCED_NATIVE_STATE` | Native delivery advanced that event before continuation; its observed state is retained. |
| `CHANGED_EXHAUSTION` | The event is exhausted under a different record hash. Review the new failure before a new repair. This outcome prevents automatic worker resumption. |

Opening Maintenance shows recent operations plus all unfinished repairs, including interrupted repairs older than the recent history window. An open operation remains inspectable by its full job ID. The detail view exposes the original request, profile reference, saved resume policy, completed receipts, and final native result. **Continue repair** uses the same request and its recorded progress. It preserves the original receiver revision and resume choice instead of constructing a new repair from whatever happens to be selected in the current form.

## Restart and handoff

The workspace retains its own profile history, immutable control generations, job requests, per-event receipts, and final results. Restart with the same workspace and outbox paths and the required secret environment:

- `WORKER` intent starts the original worker using its saved receiver revision.
- `PAUSED` intent stays paused.
- An interrupted repair remains a retained operation with an explicit **Continue repair** action.
- If a repair result was published before its eligible worker-resume transition, startup reconciles that saved result and resume intent.

Shutdown waits for owned work and releases the supervisor lease. The standalone process handles `SIGINT` and `SIGTERM`. Keep the outbox and workspace together in the merchant’s ordinary private backup strategy; a workspace is bound to its recorded outbox identity.

**Export handoff** downloads `sf98-operator-handoff.json` with the current control state, receiver revisions, native owner observation, recent maintenance, directory identities, secret variable names, and restart information. Profile configuration and operational event records can contain private merchant details, so share this export through the merchant’s existing operator channel. The signing secret and browser session token are excluded from the export.

If the page shows a directory durability notice, a control generation became visible but its directory synchronization was not acknowledged. Keep the current process and form available while resolving the private filesystem issue. The notice includes the revision, operation fault code, and observation time. A subsequent successfully synchronized control publication clears it.

## Embed the same controller in an operator service

Use one `openDeliveryWorkspace` model instance for the standalone workspace handler and any existing SF30 operations handler. Both interfaces then share the same mutation queue, selected receiver, original native worker, maintenance records, and delivery lease.

```js
import {createServer} from 'node:http';
import {openDeliveryWorkspace} from './sf98-merchant-delivery/workspace-model.mjs';
import {createDeliveryWorkspaceHandler} from './sf98-merchant-delivery/workspace-server.mjs';

const model = await openDeliveryWorkspace({
  directory: '/srv/merchant/private/delivery-workspace',
  outboxDirectory: '/srv/merchant/private/sf98-outbox',
});
const deliveryHandler = await createDeliveryWorkspaceHandler({
  model,
  origins: ['http://127.0.0.1:8462'],
  basePath: '/delivery',
});

// Pass this property to the merchant's existing SF30 operations handler:
const deliveryRecovery = input => model.recoverDelivery(input);
// ...existingOperationsOptions, deliveryRecovery

const server = createServer(async (request, response) => {
  try {
    if (await deliveryHandler(request, response)) return;
    // Dispatch the same listener's other existing operator routes here.
    response.writeHead(404);
    response.end();
  } catch {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  }
});
server.listen(8462, '127.0.0.1');
```

For the SF30 callback, use `deliveryRecovery: input => model.recoverDelivery(input)`. Its input is the original `{id, expectedRevision}` from the fulfillment desk; that expected revision is the native delivery record digest. The model resolves its selected receiver and preserves current worker/pause intent while joining the same durable selected-event maintenance operation. The workspace HTTP actions below use the numeric workspace control revision instead. Keep those two revision domains distinct.

The mounted workspace URL is `/delivery/`; the handler redirects the bare mount path to the trailing slash so that asset and API URLs stay under the mount. Origins and Host headers must match the configured operator origin. Retain the surrounding operator service’s authentication and private access controls. The handler’s in-memory session token is an additional same-origin write control; the standalone listener is intended for a private local operator.

During service shutdown, stop admitting requests, call `deliveryHandler.close()`, drain the listener’s connections, and await `model.close()` once for the shared model. Use `startDeliveryWorkspace({directory, outboxDirectory, port, basePath})` when a dedicated loopback server is sufficient; it returns `{model, server, url, close}` and composes the shutdown procedure.

### HTTP surface

Read `GET api/state` to obtain current state and the in-memory `token`. POST requests use JSON and `x-sf98-session: <token>`. URLs are relative to the workspace mount. Errors contain `{code, message}`; requests are not automatically replayed after conflicts or interrupted responses.

| Method and route | Input or result |
| --- | --- |
| `GET api/state` | Numeric workspace revision, saved intent, profile references, latest profiles, owned/native worker state, recent jobs, optional durability warning, and session token |
| `GET api/events` | Query `state`, `query`, `offset`, `limit` (1–100); returns rows, total, and `nextOffset` |
| `GET api/events/<event-id>` | Full original event and delivery state with its SHA-256 |
| `GET api/profiles/<profile-id>[/<revision>]` | Latest or exact immutable profile, revision history, and environment availability |
| `GET api/jobs/<job-id>` | Original maintenance request, completed receipts, and result |
| `GET api/handoff` | Downloadable operator handoff |
| `POST api/profiles/save` | `{id?, expectedRevision, profile}`; new profile uses revision `0`, existing profile uses its current profile revision |
| `POST api/worker/start` | `{expectedRevision, profileId, profileRevision, profileSha256}` |
| `POST api/worker/pause` | `{expectedRevision}` |
| `POST api/worker/drain` | Same exact receiver input as start |
| `POST api/maintenance/requeue` | Exact receiver input, `events: [{id, sha256}]`, and explicit `resumeWorker` boolean |
| `POST api/maintenance/resume` | `{expectedRevision, jobId}` for an interrupted repair |

For all worker and maintenance POSTs, `expectedRevision` is the numeric current workspace revision. Profile save uses the profile’s own revision. Native sending and selected-event repair remain asynchronous: accepted start/drain/requeue/resume requests return `202` with observable workspace state; inspect the worker and retained job for completion. Pause and profile save return `200`.

## Useful fault recovery

| Fault | Recovery |
| --- | --- |
| `WORKSPACE_CHANGED_RELOAD` | Refresh current state, inspect the current receiver and run intent, and apply the intended action again. |
| `RECEIVER_PROFILE_CHANGED_RELOAD` | Preserve desired draft edits, inspect the latest saved revision, and save against that profile revision. |
| `DELIVERY_EVENT_CHANGED_RELOAD` | Inspect selected records after the worker pause; explicitly select current exhausted hashes before another repair. |
| `RECEIVER_SECRET_ENVIRONMENT_UNAVAILABLE` | Supply the named signing secret to the actual workspace process and restart with the same directories. |
| `SF98_DELIVERY_BUSY` | Inspect the original lease owner and coordinate its existing process. Continue the retained repair after the lease becomes available. |
| `INTERRUPTED_REQUEUE_REQUIRED` | Read the operation again; completion may already have been recorded. |
| `WORKSPACE_SESSION_REQUIRED` | Refresh after a process/session change and review state before applying another action. |
| `PRIVATE_CANONICAL_DIRECTORY_REQUIRED` | Use the existing canonical private directory with mode `0700`; resolve the path and permissions before startup. |
| `WORKSPACE_OUTBOX_IDENTITY_MISMATCH` | Start the retained workspace with its recorded original outbox path. |
| Interrupted action response | Inspect current state and the saved profile or maintenance record before repeating a mutation. |

The frontend uses the shared model’s actual records throughout. Its polling updates status, selection review flags, and retained progress while preserving current form inputs and explicit receiver choices.

# Accepted delivery notices in merchant accounting

This operator pane connects accepted SF98 destination notices to the existing merchant settlement accounting workspace. It keeps each original event identity, the accepted request body identity, the prepared accounting source selection and the resulting original reconciliation together.

Open **/delivery-notices/** on the address printed by the [existing accounting server](../workspace/server.mjs). The pane uses that server, its workspace lifecycle, its selected merchant terms and verification sources, and its original reconciliation runner. The links to the settlement workspace and customer statements return to their existing interfaces.

## Start with the accounting destination

Use the original accounting workspace arguments and add the name of its delivery signing environment when incoming notices should be enabled:

~~~sh
node workspace/server.mjs \
  --workspace /private/accounting-workspace \
  --outbox /private/accounting-destination-outbox \
  --proof-dir /private/sf86-results \
  --terms /private/accounting-terms.json \
  --delivery-secret-env ACCOUNTING_SF98_SECRET
~~~

The named environment is supplied to the server process through the existing secret-management path. The browser shows its name and whether a value is available. It does not receive the secret value.

The configured outbox is the accounting destination's **original native-format event directory**. The retained notice must match the exact full original event in that directory. The backend checks that match when accepting the notice and again when the original accounting capture reads the event.

The fixed incoming endpoint is **POST /sf98/accounting-events**. Configure the original SF98 destination sender with its native signing contract. Where a reverse proxy is used, expose this receiver path while keeping the loopback operator routes private. Operator mutations continue through the accounting server's existing Host, Origin and **X-Workspace-Request: 1** checks.

Incoming signing availability governs acceptance of new notices. Previously accepted notices can still be inspected and captured when that environment is temporarily unavailable.

## Complete an operator review

1. Open **Delivery notices** and check the accounting workspace directory and connected destination outbox.
2. Select an accepted delivery. The pane preserves the original event ID, route, network, method, order reference and atomic amount. Acceptance time is distinct from the time recorded in the original event.
3. Review the selected accounting sources in the settlement workspace. Merchant terms, verification-file selections and the recorded-activity period belong to that original workspace.
4. Return to the notice, enter the operator and capture name, then choose **Capture selected sources**. The browser retains the request ID before sending the mutation.
5. Follow the retained capture's original status. **Open reconciliation** selects its actual run in the settlement workspace. Completed runs also expose their existing offline review and full report JSON downloads.
6. Continue customer work through **Customer statements** and the original accounting review/export surfaces.

A capture reconciles the configured destination outbox and the accounting sources selected when its intent is prepared. The result can include other original events from that outbox; it is not restricted to the selected notice. Atomic amounts are displayed without converting them to decimal token amounts or currency.

The page refreshes while it is visible and live refresh is enabled. Active original runs are checked more frequently. A fresh capture is disabled while the selected notice already has a queued or running reconciliation; that run's status and navigation remain available.

## Recover the original capture

Each browser request retains the event ID, UUID, operator, name and revision in session storage before POST. Recovery storage is scoped to the server-owned accounting workspace directory and destination outbox. Refreshing the page or reopening the same tab reuses that original request.

An accepted prepared capture can also be recovered from **Retained capture history** in a fresh browser. **Review recovery** loads its actual retained UUID, name and actor into browser recovery storage. **Recover same request** submits those same values. The original backend finds an existing accounting run before applying a new-request revision check.

A new capture request is identified by a new UUID. Editing the name or actor while reusing a retained UUID is rejected as a conflict. Prepared source selections remain visible in the capture history.

| Observed state or error | Operator behavior |
| --- | --- |
| The POST response was lost or timed out | Recover the retained UUID. The server returns its original capture or run. |
| STALE_WORKSPACE before acceptance | Refresh the exact notice. When GET confirms that the UUID has no accepted capture, retry the same UUID/name/actor with the current revision after reviewing current sources. |
| RUN_IN_PROGRESS | Keep the prepared request and recover it after the other original accounting run finishes. |
| DELIVERY_CAPTURE_SELECTION_CHANGED | Inspect the retained prepared selection and current accounting sources. Use **Use current selection for a new capture** to keep the old request in history and prepare an explicit new request. |
| NOTICE_SOURCE_CHANGED or EXPECTED_NATIVE_EVENT_CHANGED | Restore or inspect the exact original source event and configured outbox before recovering the same capture. |
| CAPTURE_REQUEST_CONFLICT | Compare the retained UUID, event, name and actor. Recovery uses the original values. |
| Accounting maintenance is active | Open the settlement workspace to complete its existing operating recovery, then recover this same capture request. |
| A run is failed or interrupted | Inspect its original run and source records. A later explicit capture can use the operator's newly reviewed source selection. |

The pane preserves unresolved browser request identity when a response is uncertain. The server retains accepted prepared requests and their original source-selection history, including requests superseded by a later operator-selected capture.

## Receiving the original destination

The original destination CLI includes export, inspect and receive:

~~~sh
starforge delivery-destinations export \
  --workspace /private/destinations --to /private/portable

starforge delivery-destinations inspect --workspace /private/portable

mkdir -m 700 /private/accounting-receiving-parent

# Set DELIVERY_FINGERPRINT to the exact fingerprint returned by inspect.
starforge delivery-destinations receive \
  --workspace /private/accounting-receiving-parent/received \
  --from /private/portable --fingerprint "$DELIVERY_FINGERPRINT"

starforge delivery-destinations status \
  --workspace /private/accounting-receiving-parent/received/workspace
~~~

The receiving target must be absent and its existing parent must have mode 0700. The receiver creates the original source under **received/source** and the original destination coordinator under **received/workspace**. Original journal bytes, destination descriptors, cursors and event identifiers are retained. The transferred state starts without an active worker.

Use the outbox path reported for the intended accounting destination by the received coordinator's status. The source outbox and each routed destination retain their own identities.

The accounting workspace itself uses its existing operating backup and recovery workflow, which preserves accounting runs, notices and customer statements. Existing completed accounting captures retain their original immutable source paths. The destination exchange carries native delivery state; original accounting backup/restore controls the accounting workspace and its retained run history.

After receiving the original native destination directory, point the accounting workspace's outbox argument at that directory. Review its current merchant terms, verification files and period in the existing settlement interface. Accepted-notice capture uses the resulting native source identity and original accounting runner.

## HTTP interface used by the pane

| Method and route | Result or input |
| --- | --- |
| GET /api/delivery-notices?offset=0&limit=50&state=all | Workspace revision, server-owned source directories, signing availability, totals and the current page of accepted notices. The filter also accepts pending or captured. |
| GET /api/delivery-notices/EVENT_ID | The exact accepted notice and newest-first prepared capture history. |
| POST /api/delivery-notices/EVENT_ID/capture | JSON object containing revision, actor, requestId and name. The original capture UUID is reused for recovery. |
| GET /api/runs/RUN_ID/download/review.html | Existing completed reconciliation's offline review. |
| GET /api/runs/RUN_ID/download/report.json | Existing completed reconciliation's full report. |

The original server returns errors as an error code and a human-readable message. Workspace revisions are passed through unchanged. Event identifiers in URLs are encoded; all provider/source strings inserted into the page are escaped or assigned as text.

The notice view includes receivedAt, occurredAt, routeId, method, network, amountAtomic, orderReference, eventSha256 and bodySha256. Its capture history includes requestId, name, actor, createdAt, preparedRevision, sourceSelection, runId, status and the original error/code. The signing object exposes only environment and available.

The backend limits the retained bridge to 10,000 distinct notices and 5,000 prepared capture requests, alongside the original accounting workspace/run limits.

## Files and composition

- **public/index.html** supplies the operator view, notice selection and retained capture controls.
- **public/app.mjs** uses the original same-origin API, existing operator and selected-run preferences, session recovery and visibility-aware refresh.
- **public/style.css** provides a neutral industrial layout with scrollable record tables and a narrow-screen layout.
- **server.mjs** supplies the additive route and static-asset handlers to the original accounting server.
- **workspace.mjs** owns accepted-notice matching, prepared source selection and the original accounting begin/recovery handoff.

The existing [SF98 destination workflow](../../sf98-merchant-delivery/destinations/README.md), [settlement server](../workspace/server.mjs) and [customer statement workspace](../customer-statements/) remain the receiving team's native operating surfaces.

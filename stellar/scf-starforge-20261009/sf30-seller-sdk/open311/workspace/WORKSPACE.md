# Open311 service operations workspace

The workspace turns a jurisdiction's existing GeoReport source into a complete local operations desk. It saves connections and source captures, displays service requests with their original fields and history, assigns follow-up, compares captures, and exports readable customer deliveries or a complete handover.

The interface uses the original Open311 client and the same persistent workspace as the installed CLI. Browser actions and CLI actions reopen the same saved records.

## Open the workspace

From the public Commons checkout, use Node.js 22.13 or later:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/cli.mjs \
  serve --workspace /absolute/private/open311-operations --port 8766
~~~

Open the printed local address in the browser. Keep the selected workspace directory for subsequent launches. The server binds to 127.0.0.1 and serves the browser files without a frontend build or package installation.

Use the same command and directory to reopen existing work. To receive a handover into another destination, stop that server and start the same command with a new empty workspace directory.

The application header identifies the open workspace and its saved revision. **Reload saved state** reads the current original state, including work saved through another supported local entrypoint.

The sidebar selects the active jurisdiction. Its six views are **Requests**, **Review queue**, **Service catalog**, **Capture differences**, **Connections**, and **Export and reopen**.

## 1. Save a jurisdiction connection

Open **Connections → Add connection**.

| Field | Meaning |
| --- | --- |
| Display name | The name operators see in the desk. |
| Connection ID | A stable identity for this saved connection; an empty field generates an ID. |
| GeoReport API base URL | The provider's real API endpoint, including its path prefix. |
| Jurisdiction ID | The provider's original jurisdiction_id, when required. |
| API key environment variable | The name of the variable containing the existing API key in the running service's environment. |
| Discovery URL | The provider’s discovery endpoint when it differs from the default discovery location. |
| API key query parameter | The provider’s parameter name when its existing key uses a name other than the default. |
| HTTP endpoint | Explicitly enable this option when the provider requires HTTP. |
| Response limit | The provider's configured collection limit. The default is 1,000; configure a different documented limit when appropriate. |
| Page / page_size pagination | Enable when this provider supports the pagination extension. |
| Extended attributes | Enable when this provider supports the extended-attribute query. |
| Provider statuses | Comma-separated original status values supported by this connection. |
| Allowed vendor query fields | Comma-separated documented extension names exposed as source-capture inputs. |

The API key field accepts an environment variable name such as CITY_OPEN311_KEY. Set its value in the existing service environment before starting the workspace. Saved connection state contains the variable name.

Original status values remain visible throughout the product. For example, a provider using READY and PROCESSING retains those values. The local review statuses are separate assigned-work fields.

Under **Source attribution for customer reports**, save the source publisher, dataset title, license, license URL, and dataset URL where available. These fields travel with the connection into customer reports.

Save the connection, then capture its catalog or request collection. **Edit** reopens its saved configuration. The connection ID remains fixed when editing. Once a connection has captures, its endpoint and jurisdiction also identify that retained source and are read-only in the editor. **Use settings for a new connection** carries the visible settings into a new connection form for a different endpoint or jurisdiction.

## 2. Capture and inspect the service catalog

Choose a connection and open **Service catalog**.

**Capture service catalog** fetches the provider's service list through the original client and saves that returned source. Subsequent catalog views open the saved capture.

Search by service code, name, group, or description. Each row supports:

- **Inspect**: opens the complete original service object.
- **Requests**: opens the capture form with that exact service code selected.
- **Capture definition**: fetches and saves service metadata when the catalog declares that metadata is available.

**Inspect saved catalog** opens the complete saved capture, including its metadata, decoded source, normalized rows, and original receipt. Use **Download exact source** for the original response bytes.

Service-definition and endpoint-discovery captures remain accessible through **Requests → Capture history for this connection** after the browser is reopened.

## 3. Capture requests from the source

Open **Requests → Capture source**.

Choose the resource:

| Resource | Input |
| --- | --- |
| Request collection | Optional service_code, original status, UTC start/end timestamps, and configured provider extension values. |
| One request | The original service request ID. |
| Request token | The provider's original token. |
| Endpoint discovery | The selected connection's discovery source. |

For request collections, the capture form explains the connection's configured pagination and response limit. Extended attributes appear when enabled for this provider. Documented vendor query fields appear from the connection's allowed field names. When pagination is enabled, **Source page** and **Source page size** select the original provider page to capture; these remain part of the saved query.

**Since** and **Until** are UTC values. The browser converts them to ISO timestamps with the UTC suffix. Until must be at or after Since.

Choose **Capture and save**. The local operation retains the original request ID, source query, capture timestamp, response, and receipt. A request capture becomes selectable in the saved-capture list.

The context line displays the recorded coverage, query, and whether the selection uses a rolling or provider-default date range. Coverage describes the returned source selection. A record absent from a later selection remains available in its prior capture.

Request-token results open as source-reference captures, where their returned identity can be inspected and downloaded. Individual request captures enter the request worklist. Both use their original resource identities. The desk's capture operations read the source through the supported Open311 client.

## 4. Work from a saved request selection

Select a saved capture in **Requests**.

The local filters search saved descriptions, addresses, and request IDs, or select an exact source status and service code. Apply the filters or clear them. The row selector and Previous/Next controls page through that saved result.

The table displays:

- Original request identity and service.
- Original source status.
- Address and description.
- Source update time.
- Current review status, assigned owner, and due date.

Open a request to see its complete description, agency, service code, source timestamps, coordinates, source SHA-256, original object, and available source/media links.

**Original source** downloads the exact original body of the selected capture. **Inspect capture** opens the saved capture object and offers source, complete JSON, and customer-report downloads.

All returned text is rendered as text. Original descriptions and source objects remain readable, including their complete JSON.

## 5. Assign and record follow-up

The request detail contains **Assigned review**:

| Review field | Use |
| --- | --- |
| Review status | New, Assigned, In progress, or Done. |
| Assigned to | Responsible person or team. |
| Due date | The follow-up date. |
| Review note | The finding, owner context, or concrete work to perform. |

Save the review to attach it to the connection and original request ID. Each saved version remains available in review history.

Editing creates a local browser-session draft. Switching requests preserves those drafts. **Reload saved review** reopens the latest saved version and clears that request's local draft.

Before saving an edited review, the desk reads the current saved state and compares the original, current, and edited fields. Fields the operator left unchanged keep the current saved values. If both the saved review and local draft changed the same field differently, a comparison opens with the exact versions. The operator can apply the edited fields or reopen the saved review. The store's expected-revision check still applies to the final write.

**Source history** displays the request's retained occurrences across captures. Open a version to inspect that original source and its hash.

## 6. Use the review queue

Open **Review queue**.

Select the current jurisdiction or all saved connections. Filter by a review status, active work, or overdue work, and search by owner, request identity, or note.

The queue lists the original request, connection, assigned owner, due date, and latest note. Overdue unfinished work appears first.

**Open request** finds the latest saved occurrence of that request across the connection's capture history. It continues to work when the newest filtered capture contains a narrower request selection.

**Download queue CSV** exports the complete current queue selection across its displayed filters.

## 7. Compare source captures

Open **Capture differences** and select two request captures from the current connection.

Choose **Compare captures**. The desk displays counts and complete saved comparison records for:

- Added requests.
- Changed requests and their changed fields.
- Requests absent from the later capture.
- Unchanged requests.

The context line retains whether the source selections are comparable. Read each capture's query and coverage when interpreting an absent record.

Filter the comparison by change type or search its requests. All differences is the initial view; Unchanged has its own selection. Comparison paging covers the full selected comparison.

**Inspect** opens the complete before/after records and exact capture IDs. **Open source request** reopens the appropriate retained request occurrence.

**Comparison JSON** contains the complete returned comparison, its original before/after capture IDs, connection, and workspace identity. **Comparison CSV** exports the current comparison filter across all its pages.

## 8. Deliver a report or complete workspace

Open **Export and reopen**.

### Captured request delivery

Select a saved request capture and download:

| Delivery | Content |
| --- | --- |
| Request worklist · CSV | The selected capture's request worklist. |
| Capture, requests and reviews · JSON | Complete capture delivery with its saved records and reviews. |
| Customer report · HTML | A readable report produced by the original local exporter. |
| Exact original response · JSON | The selected capture's original source body. |

The saved capture defines this export selection. The request table's local search and page selection do not shorten the source package.

### Complete workspace handover

**Download workspace handover** exports the saved connections, captures, source records, reviews, and operation history together.

For receiving:

1. Start the installed serve command with a new empty workspace directory.
2. Open **Export and reopen** in that destination.
3. Select the complete original workspace JSON.
4. Inspect the filename, size, source workspace identity, revision, and available counts.
5. Choose **Receive and reopen**.
6. Reopen the requests, source history, reviews, and original saved operations.

The receiver validates the original bundle through the maintained store. On a successful receive, the header changes to the received workspace's original identity and current revision. Continue using this new destination directory for subsequent launches.

Browser JSON intake accepts files up to 64 MiB. The maintained local receiving command is the operating path for larger original bundles.

## 9. Recover a lost response

Every browser write retains one complete original command before sending:

- Original request ID.
- Original workspace identity.
- Original expected revision.
- Exact endpoint and payload.
- Creation timestamp and later returned outcome.

The desk keeps the command in IndexedDB, with local storage as a fallback. A retained command appears above the workspace.

After a lost response:

1. Choose **Inspect saved outcome**.
2. If the journal contains a saved result, reopen the current workspace state and close the resolved command.
3. If the journal returns an actual absence, choose **Retry original command** to send the same ID and input, or close the absent command.
4. If the service recorded a definitive rejection, inspect its reason, close that rejected command, and prepare corrected input explicitly.

A retry preserves the original expected revision and input. A 409 response remains the original rejected operation; the desk does not replace it with a fresh request ID.

**Download command** preserves the complete original command as JSON. In **Export and reopen**, the command-file input restores that command against its original workspace, including when the browser's local address has changed. Restoring opens the retained-operation panel; inspection and retry remain explicit steps.

The **Recent saved operations** table opens the original journal entries. A request ID can also be entered directly to inspect an older operation beyond the recent list.

Browser review drafts and saved operation state serve different purposes: drafts preserve unfinished review text in that browser session; the workspace journal preserves completed command outcomes.

## Interface and access

The desk uses a neutral industrial layout, native form controls, keyboard navigation, visible focus, a skip link, and text-only rendering of untrusted source fields. Tables scroll on narrower screens, and each main view remains available from the compact navigation.

The local server checks its host and origin. Every browser JSON write supplies Content-Type: application/json and X-Open311-Workspace with the original active workspace identity.

The browser files have no build dependencies:

- workspace/index.html
- workspace/style.css
- workspace/app.mjs

The protocol client, source normalization, persistent store, server, exports, and CLI remain the shared product modules in the parent Open311 directory.

## Browser/API mapping

| Workflow | Local API |
| --- | --- |
| Open saved workspace | GET /api/state |
| Open saved catalog | GET /api/services?connection=ID |
| Open request selection | GET /api/requests?capture=ID&status=&service=&q=&offset=&limit= |
| Open exact occurrence | GET /api/request?capture=ID&id=REQUEST_ID |
| Reopen latest retained request | GET /api/request?connection=ID&id=REQUEST_ID |
| Inspect complete capture | GET /api/capture?id=ID |
| Compare captures | GET /api/diff?before=ID&after=ID |
| Save connection | POST /api/connections |
| Capture source | POST /api/capture |
| Save assigned review | POST /api/reviews |
| Download original or delivery | GET /api/export?kind=source\|csv\|json\|report\|workspace&capture=ID |
| Receive original workspace | POST /api/receive |
| Reconcile original operation | GET /api/operation?requestId=ID |

Every POST carries requestId and expectedRevision alongside its workflow input. Typed errors retain the original error.code, error.message, and optional error.details. The browser keeps uncertain command input available for the original operation's supported recovery.

## 10. Commission the complete local workflow

Run the single commissioning walkthrough on Node 22.13 or newer. It starts the actual operator server in a new private workspace, captures the catalogue and a fixed UTC request window, opens a real request, saves a labelled engineering review, repeats the source capture, and compares the results. It then exercises the typed merchant attachment against the same saved workspace, checks the original source download through the retained chunk reader, exports the customer files and full handover, receives the handover into another new directory, and verifies the original rows, reviews, catalogue, operation history, and exported bytes after a close and reopen.

Save a connection file outside the repository. It can be a flat connection object, or an envelope with separate source queries:

~~~json
{
  "connection": {
    "id": "helsinki-public",
    "name": "Helsinki public feedback",
    "baseUrl": "https://palautteet.hel.fi/public-api/open311-public-service/v1",
    "pagination": false,
    "extendedAttributes": true,
    "responseLimit": 200,
    "statusValues": ["READY", "PROCESSING"],
    "queryExtensions": ["locale"]
  },
  "servicesQuery": {"locale": "en"},
  "requestsQuery": {"extensions": true}
}
~~~

The repository also includes examples/helsinki.commission.json with the complete Helsinki connection, source attribution, and both source queries. Copy that file to the absolute private connection path below, or pass its absolute repository path directly. The separate helsinki.connection.json remains the flat connection profile for the CLI and API.

From the repository root, run:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/commission.mjs \
  --connection /absolute/private/helsinki-connection.json \
  --start 2026-10-08T08:00:00Z \
  --end 2026-10-08T12:00:00Z \
  --output /absolute/private/open311-commission-20261012-001
~~~

The output directory must not exist; its parent must already exist. The walkthrough creates all files with private permissions. Each run uses its own source and receiving directories. It writes one compact journey.json and usable original source, CSV, HTML report, request JSON, difference JSON, complete handover, reopened handover, and merchant host configuration. The merchant exports directory contains the retained source delivery used by the typed client.

The request window must contain at least one actual service request so the review and handover journey can run. An empty source response remains preserved in the newly created source workspace, and journey.json records the precise stopping condition. Source coverage remains attached to every capture. A response at its configured limit remains marked saturated, and its difference result keeps the server's scopeComparable value.

### Use retained original responses

If a captured source must be replayed, append --retained /absolute/private/originals.json to the same command. The input format is:

~~~json
{
  "schema": "commons.open311.retained-source.v1",
  "captures": [
    {
      "raw": {
        "encoding": "base64",
        "body": "EXACT_ORIGINAL_BODY_IN_BASE64",
        "bytes": 0,
        "sha256": "SHA256_OF_EXACT_ORIGINAL_BYTES",
        "complete": true,
        "contentType": "application/json"
      },
      "receipt": {
        "url": "EXACT_ORIGINAL_SOURCE_URL",
        "method": "GET",
        "status": null,
        "headers": null,
        "startedAt": "ORIGINAL_OBSERVATION_START_UTC",
        "observedAt": "ORIGINAL_OBSERVATION_COMPLETE_UTC",
        "provenance": {
          "kind": "ORIGINAL_RETRIEVAL_MECHANISM",
          "reference": "ORIGINAL_RETRIEVAL_RECORD"
        }
      }
    }
  ]
}
~~~

Each entry contains the original body bytes and its actual retrieval metadata. Supply entries for the catalogue and request URL. Replace the documentation placeholders with the complete original values. The original byte count and SHA-256 are checked before any replay. The production protocol client still builds each URL and decodes the supplied original bytes. Its request URL must match a retained entry exactly.

When several original responses share a URL, the walkthrough consumes them in their listed order. A later repeated capture reuses the last original response if no later one was supplied. The source observation time remains unchanged, and replayedAt records the local replay separately. Unknown origin HTTP status and headers remain null; a successful public-URL import includes its actual provenance. The local Response transport status is stored separately as replayTransportStatus. The live API is the default when --retained is omitted.

Every write keeps its original request ID, revision, and payload in pending-operation.json until the server result is known. A lost response is reconciled with that original operation. A server rejection keeps the pending input and error available in the private run directory for inspection. The walkthrough never replaces an uncertain command with a new request ID.

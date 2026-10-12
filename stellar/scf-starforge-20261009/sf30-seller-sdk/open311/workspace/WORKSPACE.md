# Open311 service operations workspace

The workspace turns a jurisdiction's existing GeoReport source into a complete local operations desk. It saves connections and source captures, displays service requests with their original fields and history, assigns follow-up, collects fixed date ranges with retained source refinement, compares selections, and exports readable customer deliveries or a complete handover.

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

The sidebar selects the active jurisdiction. Its seven views are **Requests**, **Source collections**, **Review queue**, **Service catalog**, **Source differences**, **Connections**, and **Export and reopen**.

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

Save the connection, then capture its catalog or request collection. **Edit** reopens its saved configuration. The connection ID remains fixed when editing. Once a connection has captures or a saved collection plan, its endpoint and jurisdiction also identify that retained source and are read-only in the editor. **Use settings for a new connection** carries the visible settings into a new connection form for a different endpoint or jurisdiction.

## 2. Capture and inspect the service catalog

Choose a connection and open **Service catalog**.

**Capture service catalog** fetches the provider's service list through the original client and saves that returned source. Subsequent catalog views open the saved capture.

When the connection declares vendor query fields, **Provider options for catalog and definitions** exposes those fields before capture. The latest saved catalog's exact query supplies their starting values. For Helsinki's English catalog, set its documented `locale` field to `en`. Leave optional fields blank to use the provider's defaults. **Use saved query** restores the saved values. These visible options apply to both the next catalog capture and **Capture definition**; each returned source retains its actual query and receipt.

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

## Collect a complete fixed date range

Open **Source collections** for the selected jurisdiction. A collection saves the full source period, original provider filters, connection settings, and a refinement policy before the first source request. It retains every response and produces one consolidated worklist across the saved windows.

### Save the plan

Choose **New collection**. Enter a useful collection name and the full **Since** and **Until** period in UTC. Until must be later than Since. Select an original service code or source status when the collection should use that filter. Configured vendor fields and extended attributes are available in the same form. Visible provider-filter values begin from the connection's latest saved request query.

A date collection uses its fixed period to select requests. Individual request IDs and provider page controls belong to the single-capture workflow.

Under **Source-window refinement**, choose the policy:

| Setting | Meaning |
| --- | --- |
| Maximum initial window · days | Splits a longer requested period into source windows within the selected allowance. Choose a whole number from 1 to the standard 90-day maximum per query; the default is 90. |
| Minimum refined window · milliseconds | Stops subdivision when a smaller supported source interval is unavailable. A response still at its cap remains visible as a limited window. The default is 1,000 milliseconds. |
| Boundary overlap · milliseconds | Preserves observations near query boundaries. The default is 1,000 milliseconds. A provider documenting start-inclusive/end-exclusive selection can use zero. |
| Query precision · milliseconds | The operator-selected resolution for generated query boundaries. The default is 1,000 milliseconds; minimum window and overlap must be whole multiples of the selected precision. |

Query precision is an operator setting. Choose it from the provider's actual supported behavior and retain that choice with the collection. The [City of Helsinki Open311 API description](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf) gives a 200-record limit and a maximum 90-day query period. Its endpoint-boundary inclusivity is unspecified, so the default plan overlaps boundaries and retains repeated observations. The [GeoReport v2 specification](https://wiki.open311.org/GeoReport_v2/) defines the standard date-filter semantics and default 90-day range.

**Save collection plan** records the plan for later execution. **Save and run** records that same complete plan, then starts its run through a separate retained command. The saved collection identity connects both steps.

### Run, pause, and resume

Select a saved collection and choose **Run collection**. The server processes the whole saved plan and records progress after each original response. Source windows that return the declared limit refine into smaller windows while their parent originals stay attached. Both child intervals must become smaller; a cap hit that cannot be refined at the chosen precision remains **LIMITED**.

The progress view refreshes from the local saved state while the run is active. It shows unique request identities, original captures, pending windows, and windows still at the limit. The detailed counts also show repeated observations, requests with multiple versions, out-of-period rows, records with unspecified source dates, refined windows, and failed source attempts.

| Collection state | Operator meaning |
| --- | --- |
| PLANNED | The connection, fixed scope, and refinement policy are saved. |
| RUNNING | The original run is collecting and retaining source windows. |
| PAUSED | A requested pause took effect after retaining the current response. |
| INTERRUPTED | Saved progress and the source outcome are available for recovery. Inspect the retained error and any resume time. |
| COMPLETE | The saved plan reached its completed outcome; inspect its recorded cap-resolution and source counts. |
| LIMITED | Some windows still reached the cap at the selected minimum or query precision. Their returned rows and original bodies stay available. |

**Pause after current source** sends a separately retained pause command. It reads the latest workspace revision and keeps its own original request ID, input, and returned outcome while the collection's longer run remains retained. The current response is saved before the pause takes effect.

A lost pause response opens **Retained pause request**. Inspect its saved outcome or retry the exact original pause. If the server rejects that pause with an actual revision conflict, **Pause at current revision** explicitly prepares a fresh pause command against the latest saved state and retains its superseded original. It leaves the collection's run command intact.

If an active run is reopened in another browser or after the local process restarts, **Recover original run** retrieves its complete original input from the workspace journal and restores that same command to the browser's retained-operation panel. Inspect or retry that original command to recover its saved work. This also works when the previous browser's command file is unavailable.

For a paused or interrupted result, reconcile the original run outcome shown in the retained-operation panel, then choose **Resume collection**. Resume processes the remaining saved windows using a new retained run command. If the saved source outcome supplies a future resume time, that time appears in the progress view.

**Copy plan settings** opens a new-plan form with the original period, filters, and refinement settings. Use it to prepare another reporting period, a different source filter, or a finer supported query precision while keeping the earlier collection and originals available.

### Inspect the original source windows

The source-window table is paged across the entire saved plan. Each row displays its exact UTC interval, state, returned row count, configured source limit, attempt count, and its relationship to any parent or refined child windows.

- **Window** opens the saved interval, attempts, refinement, and capture metadata.
- **Receipt** opens the retained capture, decoded records, exact query, and original response receipt.
- **Original** downloads that window's exact original body.

Refined parents remain in the table with their original captures. Captured parents, child windows, repeated records, and changed versions remain inspectable after the browser and workspace are reopened.

### Review the combined selection

**Open requests** opens the existing request table with this collection selected. The same selection is available in **Requests → Saved source**.

Each row represents one original request identity within this collection. Its displayed source is the latest retained observation within the selected collection, using the store's deterministic timestamp and capture-ID tie break. The row also reports its observation and retained-version counts. Original source statuses and null service fields remain preserved.

Open a request to inspect its selected capture, complete original object, source hash, and all retained collection observations. **Selected original source** downloads the precise body behind the displayed version. Source history opens an earlier occurrence without replacing its retained original.

When the operator saves a review, the browser includes the selected capture ID and expected source hash. This binds the decision to the version on screen. Review notes, assignees, due dates, and history keep their existing connection/request identity across overlapping windows and subsequent collections.

### Deliver and reopen the collection

The collection's delivery controls export:

| Delivery | Content |
| --- | --- |
| Customer report · HTML | Consolidated requests and reviews with the saved source scope and coverage. |
| Request worklist · CSV | The collection's complete consolidated worklist. |
| Collection and originals · JSON | The saved collection, consolidated request records, reviews, and every member's original capture bytes. |
| Editable workspace handover | The complete workspace, including all connections, captures, original records, collection plans and progress, reviews, and operation history. |

The saved collection defines these exports. Local table filtering and pagination leave the complete delivery selection intact.

Export the full workspace after admitted source operations settle. Receive that handover through **Export and reopen** in a new empty workspace directory. The received desk reopens the original plans, source windows, consolidated worklists, and reviews. An unfinished collection retains its progress for the next supported run after its original operation is reconciled.

## 4. Work from a saved request selection

Select a saved capture or source collection in **Requests → Saved source**.

The local filters search saved descriptions, addresses, and request IDs, or select an exact source status and service code. Apply the filters or clear them. The row selector and Previous/Next controls page through that saved result.

The table displays:

- Original request identity and service.
- Original source status.
- Address and description.
- Source update time.
- Current review status, assigned owner, and due date.

Open a request to see its complete description, agency, service code, source timestamps, coordinates, source SHA-256, original object, and available source/media links.

For a single capture, **Original source** downloads its exact original body. For a collection, **Collection and originals** downloads all retained member originals, and **Open collection** returns to its source windows. **Inspect capture** opens the saved capture object and offers source, complete JSON, and customer-report downloads.

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

## 7. Compare saved source selections

Open **Source differences**. Choose **Saved captures** or **Source collections**, then select the earlier and later source from the current connection.

Choose **Compare sources**. The desk displays counts and complete saved comparison records for:

- Added requests.
- Changed requests and their changed fields.
- Requests absent from the later capture.
- Unchanged requests.

The context line retains whether the source selections are comparable. Read each source's exact query and coverage when interpreting an absent record. Collection absence is compared only for matching fully queried scopes; comparison leaves assigned review status as saved.

Filter the comparison by change type or search its requests. All differences is the initial view; Unchanged has its own selection. Comparison paging covers the full selected comparison.

**Inspect** opens the complete before/after records and exact source IDs. **Open source request** reopens the appropriate retained request occurrence.

**Comparison JSON** contains the complete returned comparison, its original before/after source IDs, source type, connection, and workspace identity. **Comparison CSV** exports the current comparison filter across all its pages.

## 8. Deliver a report or complete workspace

Open **Export and reopen**.

### Saved request delivery

Select a saved request capture or source collection and download:

| Delivery | Content |
| --- | --- |
| Request worklist · CSV | The selected capture or collection's complete request worklist. |
| Sources, requests and reviews · JSON | Complete capture or collection delivery with its saved records and reviews; collection JSON includes all member originals. |
| Customer report · HTML | A readable report produced by the original local exporter. |
| Exact original response · JSON | The selected single capture's original body. For collections, open its retained source windows to download each exact original. |

The selected saved source defines this export selection. The request table's local search and page selection do not shorten the source package.

### Complete workspace handover

**Download workspace handover** exports the saved connections, captures, source records, collection plans and progress, reviews, and operation history together.

A workspace with saved collections uses commons.open311.workspace-export.v2 so receivers must understand and preserve the plans. Workspaces containing only single captures retain the v1 envelope. This operator accepts both versions and sends the complete original bundle to the maintained receiver. Finish or pause an active collection run before exporting the workspace.

For receiving:

1. Start the installed serve command with a new empty workspace directory.
2. Open **Export and reopen** in that destination.
3. Select the complete original workspace JSON.
4. Inspect the filename, size, source workspace identity, revision, and available counts.
5. Choose **Receive and reopen**.
6. Reopen the requests, source windows and history, collection plans and progress, reviews, and original saved operations.

The receiver validates the original bundle through the maintained store. On a successful receive, the header changes to the received workspace's original identity and current revision. Continue using this new destination directory for subsequent launches.

Browser JSON intake accepts files up to 64 MiB. The maintained local receiving command is the operating path for larger original bundles.

## 9. Recover a lost response

Every browser write retains its complete original command before sending:

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

A retry preserves the original expected revision and input. A 409 response remains the original rejected operation. A collection pause rejected for a revision conflict has a separate **Pause at current revision** action that preserves its superseded original while preparing a new current-revision pause.

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
| Open consolidated selection | GET /api/requests?collection=ID&status=&service=&q=&offset=&limit= |
| Open exact occurrence | GET /api/request?capture=ID&id=REQUEST_ID |
| Open collection request and observations | GET /api/request?collection=ID&id=REQUEST_ID |
| Open source-collection progress | GET /api/collection?id=ID&offset=&limit= |
| Reopen latest retained request | GET /api/request?connection=ID&id=REQUEST_ID |
| Inspect complete capture | GET /api/capture?id=ID |
| Compare captures | GET /api/diff?before=ID&after=ID |
| Compare collections | GET /api/diff?kind=collection&before=ID&after=ID |
| Save connection | POST /api/connections |
| Capture source | POST /api/capture |
| Save a collection plan | POST /api/collections |
| Run or resume a collection | POST /api/collection-run |
| Pause after retaining current source | POST /api/collection-pause |
| Save assigned review | POST /api/reviews |
| Download original or delivery | GET /api/export?kind=source\|csv\|json\|report\|workspace&capture=ID |
| Download complete collection delivery | GET /api/export?kind=csv\|json\|report&collection=ID |
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

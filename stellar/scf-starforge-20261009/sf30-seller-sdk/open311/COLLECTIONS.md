# Source collections and municipal operations

A source collection runs one saved, explicit selection by creation time or a provider's declared update time. It traverses date windows or the provider's numbered pages, keeps every returned body, consolidates repeated request identities, preserves changed source versions, and carries the full operation into another private workspace.

Use the same browser desk, CLI, merchant provider and SQLite workspace as single-capture operations. An existing single-capture desk reopens directly. A saved collection binds its original endpoint and jurisdiction before the first network request.

## Operate a complete collection

In the browser, open **Source collections**, select a saved civic connection, and enter a name and explicit start and end. Choose **Date basis** and **Source traversal**, then the provider's filters and interval policy. Save the plan, inspect its original members, and run it. An updated-time collection can keep an additional fixed creation-date filter; the form shows both ranges before submission.

The queue shows consolidated requests from every retained window, including the capped parents. Selecting a case exposes its original capture, distinct source versions, every occurrence and current internal review. A review binds to the exact source hash and capture displayed when it was prepared. The source status remains the provider's original value.

Use the member window view to inspect cap hits, refined children, source errors, acquisition times and original response receipts. Each saved member still supports the original source download, capture detail and comparison workflow. Export a collection report or complete JSON for analysis; export the whole workspace for continued operation at another desk.

## Provider semantics and chosen policy

The [GeoReport v2 specification](https://wiki.open311.org/GeoReport_v2/#get-service-requests) defines request selection by requested_datetime, a maximum span of 90 days per query and a default response ceiling of 1,000. A service_request_id selection overrides the other query parameters. The default created-time plan requires explicit start_date and end_date. Updated-time plans require the provider's declared updated_after and updated_before fields. A collection rejects request-ID selectors; the collector owns page numbering from the first page.

Provider implementations differ:

| Provider property | Helsinki public feedback | FixMyStreet public search |
| --- | --- | --- |
| Response ceiling | 200 first returned responses in the published description | At most 1,000, with max_requests constrained by discovery |
| Boundary comparison | Exact inclusivity is unspecified in the public description | start_date inclusive; end_date exclusive |
| Native status | READY and PROCESSING | Preserve the response's own status |
| Date filters | Creation-time start/end; separate updated_after/updated_before extensions | Creation-time start/end, ordered by requested_datetime |
| Public population | Permissioned, separately reviewed public feedback | The population selected by the public server and filters |

Sources: [Helsinki API description, October 2025](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf), especially pages 3, 6 and 7; [FixMyStreet Open311 documentation](https://www.fixmystreet.com/open311). Helsinki's “90 days / 200 first responses” description leaves the precise retention and comparison behavior unstated. Its example second-resolution timestamps do not establish a universal server precision. The [W3C date/time profile](https://www.w3.org/TR/NOTE-datetime) allows different timestamp precisions.

The collection policy is a saved operator selection:

| Field | Meaning | Default |
| --- | --- | --- |
| maxWindowDays | Maximum initial request window, whole days, from 1 to 90 | 90 |
| queryQuantumMs | Representable timestamp quantum used for new split boundaries | 1,000 |
| minimumWindowMs | Smallest permitted child interval; a positive multiple of the quantum | Same as the quantum |
| boundaryOverlapMs | Overlap between neighboring windows; zero or a multiple of the quantum, smaller than half the maximum initial window | Same as the quantum |

For a documented inclusive-start/exclusive-end source, choose boundaryOverlapMs: 0 when that matches the intended provider profile. For a provider with undocumented comparators, the default gives adjacent requests one quantum of overlap. Preserve this as a selected policy in the report.

Every child is smaller than its parent and remains inside the provider's maximum query span. The original outside endpoints retain their exact input strings; generated boundaries use UTC ISO timestamps for their exact instants. The planner chooses representable interior boundaries and retains the chosen policy with the collection.

## Created or updated periods and numbered source pages

A saved policy may select `timeBasis: "created"` or `"updated"`, and `strategy: "windows"` or `"pages"`. Missing values mean created time and window refinement. The normalizer leaves those default fields absent from legacy plans and summaries, so receiving and reopening an unchanged earlier workspace preserves its original identity.

Created-time traversal uses `start_date` and `end_date`. Updated-time traversal uses `updated_after` and `updated_before`; an additional creation range remains a fixed filter on every source request. In the browser, **Additional source-date filter** shows that second range. Both timestamps must be present together. Copying a saved plan restores its exact basis, strategy, filters, response-size field and timestamp precision.

The [BOS:311 API addendum](https://311.boston.gov/open311/docs) declares numbered `page` and `per_page` requests, with at most 300 rows per page. Its creation and update date ranges are each limited to 90 days. The default rate is ten calls per minute; its profile spaces requests by 6000 milliseconds and follows source retry instructions. A configured key can use the Bearer header. Boston's optional public notes carry their own source timestamps and descriptions.

Use the complete connection and query selections in [BOSTON.md](./BOSTON.md). In a page plan, the collector creates an original member with `page: 1` for each initial interval. A full response becomes `PAGED`, retains its original capture, and names one child with the same date bounds and next page number. A short response becomes `CAPTURED` and finishes that sequence. A repeated identical full response is retained as `LIMITED` with `REPEATED_SOURCE_PAGE`; its original body, query, attempt and preceding pages remain inspectable.

The source-member table shows the page number, exact date bounds, returned count and cap, attempts, continuation, and source problem. The collection's `counts.pagedWindows` records full pages with a saved successor and is present only for page traversal. The consolidated worklist still groups exact request identities while keeping distinct changed source editions. Page order is acquisition order; it does not replace each record's original requested and updated timestamps.

For an explicit updated-time page plan, its policy has this form:

```json
{
  "timeBasis": "updated",
  "strategy": "pages",
  "maxWindowDays": 90,
  "queryQuantumMs": 1000,
  "minimumWindowMs": 1000,
  "boundaryOverlapMs": 1000
}
```

The accompanying query supplies the fixed `updated_after` and `updated_before` values and the provider-native response size. **Save and run** retains that complete original selection before the first source call. Pause, exact-command recovery, source-version-linked review, collection export and full workspace receiving use the same operations as a window collection.

## Cap refinement and complete originals

A response with at least the effective declared response ceiling is potentially truncated. The collection retains that complete original response first, then subdivides its interval. Its parent remains visible in both the member inventory and consolidated observation history.

For an interval [a, b], the planner selects a representable m and requests left [a, m + overlap] and right [m, b]. Both child intervals must shrink and satisfy the selected minimum. With zero overlap this is a shared boundary. With the default one-second quantum/overlap it preserves a whole second around a boundary whose comparator semantics are unspecified.

The runner does not advance from the last returned record. Multiple requests can share its timestamp, and a cap can hide other records with that same time. If a capped interval cannot split further at the selected precision and minimum, its state becomes LIMITED with problem RESPONSE_CAP_AT_SELECTED_PRECISION. The complete original body and exact unresolved interval remain available.

A provider-specific response-limit parameter can be declared in connection.responseLimitParameter, for example max_requests. The same parameter must appear in queryExtensions. The effective limit is the smaller of the configured responseLimit and any explicitly selected, positive provider limit. Window traversal refines a response at that limit. Page traversal requires an explicitly paginating connection and starts at page 1; every full page is retained with its successor. The original response-size parameter stays part of each query.

A below-cap leaf completes the traversal of that query. Source publication rules, filtering and capture time still determine the population observed. The summary records out-of-window occurrences and missing or invalid requested timestamps. Those original rows remain in review. The collection comparison permits absence differences only for equal fixed scopes with resolved caps and no such date anomalies.

## Preserve cases and changing source versions

Identity uses the configured connection and exact service_request_id. Keep service codes, case, null values and arbitrary source fields unchanged. Helsinki feedback created through another channel can have no Open311 service code; source collections retain that unclassified population.

Each original source object has a SHA-256. Repeated identical objects retain every occurrence. Different objects remain separate versions even when their updated_datetime values are equal. The displayed request is the latest observed edition within the collection, ordered by capture time and then capture ID for a deterministic tie break. The export exposes both the chosen capture and all alternate versions.

The internal review attaches to one original object hash and capture. A later observed source change marks that review as needing attention while preserving its assignment, notes, due date and complete history. Reviewing an earlier version is explicit: select its capture and matching source SHA-256.

Refreshing an older creation-time collection can reveal updated versions of its members. Updates to older requests outside that creation-time range require a separately selected query that includes them. Helsinki's update extensions are retained when explicitly chosen. A proposed updates interface in another implementation is not treated as an available endpoint without its own declared support.

## CLI workflow

From a repository checkout, set the source command and private workspace paths:

~~~sh
OPEN311_CLI="/absolute/repository/stellar/scf-starforge-20261009/sf30-seller-sdk/open311/cli.mjs"
OPEN311_WORKSPACE="/absolute/private/municipal-desk"
~~~

The installed command is also available as **starforge open311**. The remaining arguments match the source CLI.

Save the supplied examples/helsinki.connection.json profile with connection-put. Its connection ID is helsinki-public. The complete [example plan](examples/helsinki.collection.json) can be saved with collection-create or copied to choose another period:

~~~json
{
  "connectionId": "helsinki-public",
  "name": "Helsinki published feedback, October 1–12",
  "query": {
    "start_date": "2026-10-01T00:00:00Z",
    "end_date": "2026-10-12T00:00:00Z",
    "extensions": true
  },
  "policy": {
    "maxWindowDays": 90,
    "queryQuantumMs": 1000,
    "minimumWindowMs": 1000,
    "boundaryOverlapMs": 1000
  }
}
~~~

Inspect the actual generated queries and credential-redacted URLs without a source request:

~~~sh
node "$OPEN311_CLI" collection-plan \
  --workspace "$OPEN311_WORKSPACE" --file /absolute/private/collection.json
~~~

Save the plan:

~~~sh
node "$OPEN311_CLI" collection-create \
  --workspace "$OPEN311_WORKSPACE" --file /absolute/private/collection.json \
  --request-id helsinki-october-create-01
~~~

Read the returned result.collection.id and result.revision. Use that saved collection ID to run it:

~~~sh
node "$OPEN311_CLI" collection-run \
  --workspace "$OPEN311_WORKSPACE" --id COLLECTION_ID \
  --request-id helsinki-october-run-01 --expected-revision OBSERVED_REVISION
~~~

Mutation commands print their request ID and original expected revision before submission. Preserve that intent with the input file. If the response is uncertain, repeat exactly the original command and values. The saved operation either resumes or returns its original result.

Inspect and operate the consolidated result:

~~~sh
node "$OPEN311_CLI" collection-info \
  --workspace "$OPEN311_WORKSPACE" --id COLLECTION_ID --offset 0 --limit 100

node "$OPEN311_CLI" requests \
  --workspace "$OPEN311_WORKSPACE" --collection COLLECTION_ID \
  --changed-only true --sort requested --order desc --limit 100

node "$OPEN311_CLI" request \
  --workspace "$OPEN311_WORKSPACE" --collection COLLECTION_ID --id SOURCE_REQUEST_ID

node "$OPEN311_CLI" review-put \
  --workspace "$OPEN311_WORKSPACE" --connection helsinki-public --id SOURCE_REQUEST_ID \
  --capture ORIGINAL_CAPTURE_ID --source-sha256 ORIGINAL_OBJECT_SHA256 \
  --file /absolute/private/review.json --request-id helsinki-review-01
~~~

The review file has the same fields as a single-capture desk, for example status, assignee, note and dueDate. Source status filters use the native value. Internal status filters use new, assigned, in_progress or done; --assignee is an exact internal assignment match.

## Pause, retry and recover

A collection-run call remains active through its windows. From a second CLI process or the browser's independent pause panel, read the latest workspace state and submit collection-pause with a separate request ID and that revision:

~~~sh
node "$OPEN311_CLI" state --workspace "$OPEN311_WORKSPACE"
node "$OPEN311_CLI" collection-pause \
  --workspace "$OPEN311_WORKSPACE" --id COLLECTION_ID \
  --request-id helsinki-october-pause-01 --expected-revision LATEST_REVISION
~~~

The in-flight original response is retained before the run pauses. Capture commits can advance the revision between observation and pause submission. A revision conflict admits no replacement intent; inspect the new state and deliberately prepare another pause request. The original run intent stays available.

A settled PAUSED or INTERRUPTED collection can continue with a new run request ID at the current revision. Failed source attempts remain in its node history; retry uses another child capture request ID and preserves the previous source response or error. If the provider sent Retry-After, the saved resumeAt exposes that time and the runner honors it before another run.

After a process interruption, recover the original unfinished run with its same requestId, expectedRevision and collectionId. The operation view exposes the original intent. An operation whose original process still owns it reports OPERATION_RUNNING; a competing new run points to the saved original run rather than replacing it. The same database supports progress reads and review commits while source requests are outside the SQLite transaction.

## Complete exports and receiving

~~~sh
node "$OPEN311_CLI" export \
  --workspace "$OPEN311_WORKSPACE" --collection COLLECTION_ID --kind json \
  --out /absolute/new/collection.json

node "$OPEN311_CLI" export \
  --workspace "$OPEN311_WORKSPACE" --collection COLLECTION_ID --kind csv \
  --out /absolute/new/collection.csv

node "$OPEN311_CLI" export \
  --workspace "$OPEN311_WORKSPACE" --collection COLLECTION_ID --kind report \
  --out /absolute/new/collection.html

node "$OPEN311_CLI" export \
  --workspace "$OPEN311_WORKSPACE" --capture ORIGINAL_CAPTURE_ID --kind source \
  --out /absolute/new/original-window.json

node "$OPEN311_CLI" export \
  --workspace "$OPEN311_WORKSPACE" --kind workspace \
  --out /absolute/new/municipal-workspace.json

node "$OPEN311_CLI" receive \
  --workspace /absolute/new/receiving-desk --file /absolute/new/municipal-workspace.json \
  --request-id municipal-receive-01
~~~

Output files are created exclusively. Source export reproduces the exact retained body bytes. Collection JSON includes the complete member source package; CSV includes selected editions and internal review fields; the print report includes coverage, full requests, changed original versions, all intervals and source credit.

The editable workspace export contains every plan, member response, operation and review. A workspace with saved collections uses commons.open311.workspace-export.v2, which prevents an earlier receiver from silently omitting those plans. A workspace containing only the original single-capture workflow retains the v1 envelope. This edition receives both. Receive into a new empty private workspace, then open it with the same CLI, browser or installed Applications entry.

Finish, pause or recover admitted source operations before exporting the entire editable workspace. The receiver verifies every planned and refined interval, original member query, response bytes, capture/attempt joins, plan source identity and operation history. It also accepts legacy v1 bundles that contain no collection inventory.

## Stable analysis envelope

The complete collection JSON has this shape:

~~~text
{
  schema: "commons.open311.collection-export.v1",
  workspaceId, revision,
  collection,
  summary,
  requests,
  observations,
  originals,
  sourceOperations
}
~~~

| Field | Complete content |
| --- | --- |
| collection | Saved plan, original connection and attribution, requested/effective query, chosen policy, all node states and attempts |
| summary | State, all progress/coverage counts, capResolved, acquisition time range and interpretation |
| requests | Latest observed request edition, original source/hash, captureId, observationCount, versionCount and full internal review/history |
| observations | Per request identity: selectedCaptureId, every occurrence and all distinct source versions |
| originals | Every member capture, original parsed value, canonical rows, receipt and complete base64 original response bytes/hash/length |
| sourceOperations | Every original source attempt with its retained successful result or failure |

An occurrence records captureId, windowId, capturedAt, sourceSha256, sourceResponseSha256, windowPosition, requestedAt and updatedAt. A version contains sourceSha256, item and its occurrences. This lets a reporting workbench reproduce its selected source editions and preserve the original source population and acquisition intervals.

Collections use the original provider attribution stored in the connection. The supplied Helsinki profile credits the City of Helsinki / Helsingin kaupunginkanslia and links the [HRI catalogue](https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta) and [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/).

## HTTP API joins

| Operation | Route and selection |
| --- | --- |
| Save plan | POST /api/collections with requestId, expectedRevision, connectionId, name, query, policy |
| Run or recover | POST /api/collection-run with requestId, expectedRevision, collectionId |
| Request pause | POST /api/collection-pause with its own requestId, expectedRevision, collectionId |
| Inspect windows | GET /api/collection?id=ID&offset=0&limit=100 |
| Consolidated queue | GET /api/requests?collection=ID with existing source filters and changedOnly/reviewStatus/assignee |
| Case and all versions | GET /api/request?collection=ID&id=SOURCE_ID |
| Version-bound review | POST /api/reviews with existing fields plus captureId and expectedSourceSha256 |
| Compare collections | GET /api/diff?kind=collection&before=ID&after=ID |
| Collection files | GET /api/export?collection=ID&kind=json, csv or report |
| Exact window body | Existing GET /api/export?capture=ID&kind=source |
| Full receiving | Existing workspace export and POST /api/receive |

Saved collection summaries are included in GET /api/state. The member view is paged and exposes nextOffset. A selection uses one capture or collection; the case endpoint additionally permits an original connection selection. All mutations preserve the existing workspace revision and request-ID contract.

## Merchant tools and typed client

The installed open311-workspaces provider uses the same SQLite workspace and original retained-file helpers. It owns its concurrency so a separate pause, progress read or version-bound review can run during a collection acquisition.

| Tool | Purpose |
| --- | --- |
| merchant_open311_collection_create | Save the immutable source plan |
| merchant_open311_collection_run | Run, resume or recover its original operation |
| merchant_open311_collection_pause | Save a separate pause intent at the latest observed revision |
| merchant_open311_collection_info | Page the full member inventory at one revision |
| merchant_open311_records, kind collections | Page saved collection summaries |
| merchant_open311_requests / request | Select a collection queue or complete version history |
| merchant_open311_review_put | Pin the displayed captureId and expectedSourceSha256 |
| merchant_open311_file_read | Deliver complete collection JSON, CSV, report or whole workspace in retained chunks |

The existing typed client adds createCollection, runCollection, pauseCollection and collectionInfo. For example:

~~~js
const observed = await client.status();
const saved = await client.createCollection({
  requestId: "helsinki-plan-01",
  expectedRevision: observed.revision,
  connectionId: "helsinki-public",
  name: "October public feedback",
  query: {
    start_date: "2026-10-01T00:00:00Z",
    end_date: "2026-10-12T00:00:00Z",
    extensions: true
  }
});
const finished = await client.runCollection({
  requestId: "helsinki-run-01",
  expectedRevision: saved.revision,
  collectionId: saved.collection.id
});
const current = await client.status();
const file = await client.downloadFile({
  kind: "json",
  collection: saved.collection.id,
  expectedRevision: current.revision
});
~~~

The returned file contains bytes, byte count and its SHA-256. Retained continuation preserves the complete selection, expectedSha256 and byte offset. Read original source bodies with kind: "source" and their individual capture IDs. Collection comparisons use kind: "comparison", comparisonKind: "collection", before and after.

The source entrypoint exports normalizeCollectionPlan, collectionNodeQuery, splitCollectionWindow and describeRequests for exact planning before acquisition. Type declarations cover the complete plan, window states, source occurrences, collection projection, review and delivery shapes.

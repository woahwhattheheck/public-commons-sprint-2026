# Municipal request and work-order follow-through

This workbench gives an operations team one saved place to reconcile municipal requests with work-order records, review the relationship between them, assign follow-up, approve actions and deliver the complete editable history. It retains the original source files and each saved interpretation. The browser, CLI and merchant tools operate the same private SQLite directory.

A source request can progress through its own status vocabulary while a linked order follows another system. The workbench keeps both original statuses visible beside the team's internal assignment and action approval. An original reference becomes a relationship candidate only through a named field mapping. A supervisor can also find an order and review the relationship explicitly.

The installed **open311-follow-through** selection includes municipal collection, service reporting, GIS handoff and this follow-through desk. See [INSTALL.md](INSTALL.md) for the complete merchant package and Applications entry, [WORKSPACE.md](WORKSPACE.md) for the browser, [MCP.md](MCP.md) for host-selected files and the typed client, and [SOURCE_FORMATS.md](SOURCE_FORMATS.md) for source and interchange semantics.

## Operate a complete source-to-dispatch workflow

1. Inspect and import the original request file. Import the original order file as a separate source series when available. Source inspection exposes real field names, aliases, declared types, capture URLs, page limits and complete original downloads.
2. Save an explicit profile: business identities, original reference fields, statuses, work-required flags, dates, coordinate interpretation and optional relationship candidate rules.
3. Build a named operating edition from those exact sources and profile revision. A request-only edition supports intake and follow-up while an order source is being acquired.
4. Search requests and orders, inspect source discrepancies, and confirm or reject selected relationships against both original source versions.
5. Assign work, set an internal due time, add the action and its explanation, and choose the related orders. Approve the action with a named reviewer.
6. Export an editable reviewer file when another operator should propose assignments or relationship decisions. Import the returned file, inspect its exact source and preimage conflicts, and accept or reject selected proposals.
7. Select current approved work and save a dispatch with explicit receiving-system column names. Download complete JSON, reversible CSV, GeoJSON or the printable operating report.
8. Export the complete workspace. Receive it into an empty private desk and continue its source, review, assignment and dispatch history.

The browser retains an interrupted action's original request ID and input. It retrieves an existing saved result or retries that exact intent. Source inspections and downloads are available independently of a pending mutation.

## Start directly from source

Direct modules use Node.js 22.13 or newer with built-in SQLite. The installed merchant runtime uses Node.js 22.16 or newer and the maintained package preparation described in INSTALL.md.

From the repository checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/cli.mjs \
  init --workspace /absolute/private/follow-through

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/cli.mjs \
  serve --workspace /absolute/private/follow-through --host 127.0.0.1 --port 0
~~~

Open the private URL in the compact LISTENING record. The original workspace ID and saved-directory binding identify the desk. Its database is open311-follow-through.sqlite.

All examples below use the installed command name. Through the prepared runtime, prefix it with:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/private/municipal-runtime --
~~~

### Inspect and import actual source files

~~~sh
open311-follow-through inspect-source \
  --file /absolute/handover/request-source.json \
  --metadata /absolute/handover/request-layer.json

open311-follow-through import \
  --workspace /absolute/private/follow-through \
  --file /absolute/handover/request-source.json \
  --metadata /absolute/handover/request-layer.json \
  --role requests --series municipal-requests \
  --name "Original municipal requests" \
  --observed-at 2026-10-12T20:00:00Z \
  --request-id request-source-intake-001 --expected-revision 0
~~~

Use the original acquisition time for observed-at and the complete supplied files. If a retained ArcGIS packet contains several eligible datasets, inspection returns selection_required and availableCaptures. Select its intended original pages using --capture-ids FIRST_ID,SECOND_ID. The saved source retains the whole original packet, all capture bodies and the explicit page selection.

Import work orders with role orders and a distinct source series. An ArcGIS error response remains a source_error record with its complete original file. It can be inspected and handed over; choose a successful dataset when building an order-backed edition.

Supported inputs are ArcGIS feature responses or retained source packets, GeoJSON FeatureCollections, CSV, JSON record arrays, complete Open311 collection exports and service reports. Use --kind csv for a CSV whose filename does not end in .csv.

### Save a profile and operating edition

The included examples/manatee-request-profile.json is an explicit starting profile for the original Manatee QAlert fields. It maps QSCEND_ID as the request identity, retains CW_REQUEST as a reference, keeps WONEEDED separate from STATUS, preserves source coordinate declarations and configures no automatic order relationship. Review its mappings against the chosen source before using it for another provider.

~~~sh
open311-follow-through profile --workspace /absolute/private/follow-through \
  --file /absolute/config/request-profile.json \
  --request-id municipal-profile-001 --expected-revision 1
~~~

A saved profile is addressed by id@revision. Profile revisions are immutable; a changed interpretation is a new revision. Source field choices are checked against the selected original schema before building.

A request-only definition has this shape:

~~~json
{
  "name": "Municipal follow-up at the selected source edition",
  "seriesId": "municipal-follow-up",
  "profileId": "municipal-profile@1",
  "requestSourceId": "REQUEST_SOURCE_ID",
  "orderSourceId": null,
  "asOf": "2026-10-12T20:00:00Z",
  "commentary": "Selected original files and operating review period."
}
~~~

Use the actual source and profile IDs returned by the prior commands. Set orderSourceId to the saved order source when selecting both systems. The asOf instant drives the explicitly selected stale-age and internal due-date comparisons.

~~~sh
open311-follow-through build --workspace /absolute/private/follow-through \
  --file /absolute/config/operating-edition.json \
  --request-id municipal-edition-001 --expected-revision 2

open311-follow-through requests --workspace /absolute/private/follow-through \
  --edition EDITION_ID --q "street" --offset 0 --limit 100

open311-follow-through orders --workspace /absolute/private/follow-through \
  --edition EDITION_ID --q "ORDER_REFERENCE" --offset 0 --limit 100
~~~

### Review a relationship and assign work

A relationship decision contains editionId, key, sourceSha256, orderKey, orderSha256, decision confirm or reject, reviewer and note. The request and order detail supply the exact keys and versions. Save the complete decision JSON with the link command.

Internal work accepts:

| Field | Meaning |
| --- | --- |
| status | new, assigned, in_progress, done or dismissed |
| assignee / priority | Named operating owner and low, normal, high or urgent |
| dueAt | Explicit timestamp with UTC or numeric offset; null for no internal due time |
| note | Internal case note |
| action | review, contact, inspect, create_work_order, update_work_order, reconcile or none |
| actionNote | The intended follow-up |
| targetOrderKeys | Explicit related order selection |
| approval / reviewer | draft, approved or rejected, with a named reviewer for a decision |
| location | Original-source interpretation, named WGS84/Web Mercator interpretation or a named per-record manual point |

The full work input also includes editionId, key and sourceSha256. An approved order update needs a current confirmed relationship to each selected order. A later source edition preserves the earlier decision and makes a changed source or order visible for renewed review.

~~~sh
open311-follow-through link --workspace /absolute/private/follow-through \
  --file /absolute/config/relationship-decision.json \
  --request-id relationship-001 --expected-revision 3

open311-follow-through work --workspace /absolute/private/follow-through \
  --file /absolute/config/assigned-work.json \
  --request-id work-001 --expected-revision 4

open311-follow-through work-queue --workspace /absolute/private/follow-through \
  --edition EDITION_ID --approval approved --limit 100
~~~

The approved queue contains current source-bound actions whose work is still open. Unchanged work can carry forward to a later operating edition in the same series. Done or dismissed work remains in history and is excluded from a new dispatch.

### Compare source editions and receive a review

~~~sh
open311-follow-through changes --workspace /absolute/private/follow-through \
  --before BEFORE_EDITION_ID --after AFTER_EDITION_ID \
  --entity requests --limit 100

open311-follow-through changes --workspace /absolute/private/follow-through \
  --before BEFORE_EDITION_ID --after AFTER_EDITION_ID \
  --entity orders --limit 100

open311-follow-through export --workspace /absolute/private/follow-through \
  --kind review --edition EDITION_ID \
  --out /absolute/handover/operator-review.json

open311-follow-through review-import --workspace /absolute/private/follow-through \
  --file /absolute/handover/operator-review-return.json \
  --request-id review-intake-001 --expected-revision CURRENT_REVISION
~~~

Changes identify exact source fields and geometry. An ArcGIS hash-derived object ID can change between query representations even when mapped order facts agree; the comparison labels changes confined to those declared source metadata fields. Original hashes and records remain available. An absent record means it was not observed in the selected later files.

A returned review contains proposed changes against a saved edition and original work or relationship preimages. The operator can select a later edition of the same series, inspect its source and history conflicts, and decide a subset:

~~~json
{
  "returnId": "RETURN_ID",
  "targetEditionId": "TARGET_EDITION_ID",
  "accept": ["PROPOSAL_ID"],
  "reject": [],
  "reviewer": "Operations supervisor",
  "note": "Accept the selected source-linked assignment."
}
~~~

Save that selection using review-apply. Later decisions can process the remaining proposals. Accepted relationships are applied before accepted work from the same decision.

### Dispatch and deliver the editable workspace

A dispatch definition selects name, editionId, explicit current workIds, optional columns and note. A column is {name,source,field}, with source request, order or work. The default columns cover the case, selected order IDs, original status, assignment, internal due time, action and reviewer.

~~~sh
open311-follow-through dispatch --workspace /absolute/private/follow-through \
  --file /absolute/config/dispatch-selection.json \
  --request-id dispatch-001 --expected-revision CURRENT_REVISION

open311-follow-through export --workspace /absolute/private/follow-through \
  --kind dispatch-csv --dispatch DISPATCH_ID \
  --out /absolute/handover/reviewed-follow-up.csv

open311-follow-through export --workspace /absolute/private/follow-through \
  --kind workspace --out /absolute/handover/complete-follow-through.json

open311-follow-through receive --workspace /absolute/private/received-follow-through \
  --file /absolute/handover/complete-follow-through.json \
  --request-id receive-001 --expected-revision 0
~~~

The complete package retains original files, profile revisions, request/order editions, assignments, relationship decisions, returned reviewer files, partial decisions, dispatches and successful operation history. Receiving preserves the workspace identity and adds its original-file descriptor and receiving operation. Reopening an unchanged desk produces the same export bytes.

## Source and transport APIs

The public index exports source inspection/import, profile and edition normalization, relationship/work/reviewer/dispatch functions, the durable workspace and local server. Adjacent .d.mts declarations describe the complete objects.

openWorkspace(directory) returns state(), operation(), inspectSource(), importSource(), putProfile(), build(), putLink(), putWork(), importReview(), applyReview(), putDispatch(), all paged/detail reads, exportFile(), receive() and close(). Mutations take a stable requestId and the observed expectedRevision.

The server supplies /api/state, /api/source, /api/source-rows, /api/profile, /api/edition, /api/requests, /api/orders, /api/request, /api/changes, /api/work, /api/work-queue, /api/return, /api/dispatch, /api/operation and /api/export. POST routes mirror the source, profile, build, link, work, reviewer, dispatch and receiving actions. Successful responses are {ok:true,value}; errors contain a code, message and optional details.

The original source files and all work histories are available through full exports. Request, order, change and worklist pages stay separate from compact state summaries. One source edition accepts at most 100,000 original rows and 128 MiB of original input; a complete received package accepts at most 256 MiB.

## Provider references

Manatee's original QAlert and WorkOrderView schema is published at [Qscend_Requests/MapServer](https://www.mymanatee.org/gispw/rest/services/311/Qscend_Requests/MapServer). Relationship fields, source status and work-required flags must be interpreted through the saved profile. The original source responses and their coordinate declarations remain attached to the imported edition.

The Douglas–Omaha original stormwater order service is [Sewer_Stormwater_Costs/MapServer/0](https://dcgis.org/server/rest/services/Cityworks/Sewer_Stormwater_Costs/MapServer/0). Its published order identity, date strings and individual cost fields are retained without adding a currency or inventing a request link.

[ArcGIS layer metadata](https://developers.arcgis.com/rest/services-reference/enterprise/layer-table/) and [MapServer queries](https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/) define the published schema and query controls. [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946) defines standard GeoJSON coordinate order and null geometry.

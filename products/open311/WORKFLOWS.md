# Municipal workflows and source formats

The complete open311-service-configuration package contains six operating applications. Each application keeps its own SQLite workspace and original operation history. Complete exports carry a selected source edition from one application into the next; the recipient chooses the intended file, profile and source interpretation.

Use [OPERATING.md](OPERATING.md) to install the selected archive and open a desk. Use [RECEIVING.md](RECEIVING.md) to move a complete editable workspace to another operator. This guide describes the work inside each desk and the exact files that connect them.

## Choose the application for the work

| Application in Applications | Command | Complete operating outcome |
| --- | --- | --- |
| Open311 service operations | open311 | Official catalog and request capture; complete collections across source windows or pages; source-linked internal review; original files and collection exports |
| Open311 service performance | open311-reporting | Saved reporting periods, source cutoffs, mappings and target calendars; request drilldown, management commentary, period comparison and reviewer returns |
| Open311 GIS handoff | open311-gis | Source-linked map and table handoffs, editable GeoPackage/GeoJSON/CSV, analyst returns, selected review decisions and mapped GIS dispatch |
| Open311 request/work-order follow-through | open311-follow-through | Original request and work-order editions, explicit relationships, assignments, discrepancy review, approved follow-up work and selected dispatch |
| Open311 field work and crew returns | open311-field-desk | Original approved dispatch, named crews and visits, portable crew editor, partial field returns, supervisor decisions and destination update packages |
| Municipal service configuration | open311-service-configuration | Agency categories, roles, groups, staffing and routing; complete-register previews, resident message wording, explicit deployed baselines and reviewed implementation releases |

A collection can go directly to reporting or GIS. A request/work-order operation can start from its own original municipal source files. A field operation starts from a selected approved Follow-through dispatch. Choose the route that matches the operator's actual task.

## Files that connect applications

| Produced or retained file | Receiving application and action | Source and decision context retained |
| --- | --- | --- |
| Collector export kind json with --collection ID; schema commons.open311.collection-export.v1 | Reporting: import. GIS: inspect-source, then import. | Saved plan, source connection and attribution, all original windows/pages, selected requests, alternate source versions, observations, coverage and review history |
| Reporting export kind json with --report ID; schema commons.open311.reporting-workspace.v1 | GIS: inspect-source, choose the intended report ID, then import with --report ID | Complete original collections, report/profile editions, calculation choices and the selected report's exact request editions |
| Original municipal JSON, GeoJSON, CSV or an original ArcGIS source packet with metadata | Follow-through: inspect-source, select captures when needed, import as requests or orders, then save a mapping profile and build an edition | Complete original file, explicit source role/series, schema and typed fields, selected source captures, original rows and observation time |
| GIS export kind geojson | Follow-through: import as an original GeoJSON source with an explicit mapping profile | Original feature objects, source columns and analyst values in that file; the complete GIS workspace separately carries the GIS review history |
| Follow-through export kind dispatch-json; schema commons.open311.follow-through-dispatch.v1 | Field Desk: inspect-source and import | Selected current approved actions, exact request/order versions, relationship and approval references, geometry and receiving column mappings |
| Complete Follow-through workspace; schema commons.open311.follow-through-workspace.v1 | Field Desk: inspect-source, choose a dispatch, import with --dispatch ID | Complete request/order originals and retained operating history, together with the selected dispatch |
| Follow-through dispatch JSON, with rowsPointer /rows | Service configuration: source-import plus an explicit follow_through_dispatch_v1 source profile | Original dispatch rows, source request status and separately approved local work |
| Field Desk export kind update-json; schema commons.open311.field-destination-update.v1, with rowsPointer /items | Service configuration: source-import plus an explicit field_destination_update_v1 source profile | Original source row, visit/crew and approval references, destination action, exact resource values and attachments |
| Original Open311 request response array, with rowsPointer "" | Service configuration: source-import plus an explicit open311_georeport_v2 source profile | Exact response bytes and row-relative mappings for source case ID, status, notes, category, dates and other selected values |
| An application's complete workspace export | The same application's receive command in a new empty directory | All retained original files, configuration and source editions, saved work, returned files, decisions and operation history |

Keep the containing file intact when selecting a report, dispatch, capture or row array. The file hash identifies the complete incoming bytes; the selected ID or JSON Pointer identifies the part used for that operating task. A CSV, printable report or selected dispatch is useful for its named job. Continued work in the originating application uses its complete workspace export.

## Collect complete municipal observations

Open Open311 service operations and save a named official source connection. The connection records the endpoint, jurisdiction, provider capabilities, response limit, declared query extensions and attribution. A connection with retained captures or saved plans keeps its original source identity; use a new connection ID for another endpoint or jurisdiction.

For a catalog or one known case, use the existing capture controls. For an operating population, create a Source collection:

1. Select the original connection, an explicit fixed date range and the source filters.
2. Choose Created or Updated time basis according to the provider's declared fields. Updated feeds select requests changed in that interval; those requests may have been created earlier.
3. Choose window traversal, or page traversal for a paginating source. Save and run retains the original command before acquisition.
4. Inspect the member table while the collection runs. Every response and failed source attempt remains attached to its original query.
5. If a window reaches its response cap, the collector retains that parent and refines the interval at the configured query precision. Unsplittable saturated windows remain visible. Page traversal retains every original page and completes on a short page; repeated capped page content remains an explicit source limitation.
6. Search the consolidated request worklist, inspect original versions and save internal reviews against the selected source version.
7. Export the complete collection JSON for another application and the entire workspace for a continuing collector handover.

The selected request edition is deterministic across overlapping captures. Identical source versions retain their occurrence references; changed original objects remain separate versions even if their provider update times are equal. Source disappearance within a different or saturated query window does not establish completion.

The complete collection envelope contains collection, summary, requests, observations, originals and sourceOperations. In particular, originals includes the full original response bytes, receipt, parsed value and normalized rows for every member. The [collection guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/COLLECTIONS.md) defines the window, page, coverage and recovery contracts; [BOSTON.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/BOSTON.md) describes its declared paginating provider profile.

Example complete collection transfer from an installed package:

~~~sh
npx --no-install starforge open311 export \
  --workspace /absolute/private/municipal/collection \
  --collection COLLECTION_ID --kind json \
  --out /absolute/private/handoff/municipal-collection.json

npx --no-install starforge open311-reporting import \
  --workspace /absolute/private/municipal/reporting \
  --file /absolute/private/handoff/municipal-collection.json \
  --request-id collection-to-reporting-001 \
  --expected-revision CURRENT_REPORTING_REVISION
~~~

Initialize the reporting desk with its init command first. Use the actual returned source ID in the saved reporting definition.

## Build and review service performance reports

The reporting desk imports complete collection exports. Save a named profile with exact source status meanings, service or agency mappings, local reporting groups, calendars and target policies. These are explicit reporting choices. The original native status and source notes remain inspectable.

Create a report definition with the selected sources and profile edition, an explicit creation period, an observation cutoff and a display timezone. Choose the target basis: a published source expected date, an interpreted internal review due date, or a named policy due date. Review the displayed coverage, unobserved requests and unassessed targets before using the totals.

Calendar editions retain their timezone, weekly intervals and date overrides. Named working-time targets save the resolved intervals used by the report. Repeated local clock times need an explicit earlier/later choice; missing local times need a valid calendar override. A later profile or calendar is a new report input rather than a rewrite of an existing report.

The report separates original source status, case-closure timestamp/notes, internal review, mapped group and target state. Where the selected provider contract defines a closed request's update timestamp as closure time, duration describes source case closure. A literal closure disposition remains visible in the detail and exports.

Download management HTML and CSV for readers, full report JSON for source-linked receiving, or the reviewer template. A returned reviewer file names its exact base report and source version for each request comment. Select the changes to incorporate and, when the series has advanced, choose the intended current report. The successor retains the original return and reviewer history.

~~~sh
npx --no-install starforge open311-reporting export \
  --workspace /absolute/private/municipal/reporting \
  --report REPORT_ID --kind json \
  --out /absolute/private/handoff/municipal-report.json

npx --no-install starforge open311-gis inspect-source \
  --file /absolute/private/handoff/municipal-report.json

npx --no-install starforge open311-gis import \
  --workspace /absolute/private/municipal/gis \
  --file /absolute/private/handoff/municipal-report.json \
  --report REPORT_ID \
  --request-id report-to-gis-001 \
  --expected-revision CURRENT_GIS_REVISION
~~~

The reporting JSON file carries the complete reporting source closure with a selected report. Reporting's whole-workspace receiving keeps a new recipient workspace identity and archives the original operating history. Its [source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/README.md) and [source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting/SOURCE_CONTRACT.md) describe the profile, dates and receiving semantics.

## Exchange GIS work and review analyst changes

Import one or more complete collection/report files into the GIS desk. Build a named handoff from the intended source IDs, filters and operating defaults. Its map and worklist show a page of the saved selection; exports carry the complete handoff.

The desk exports GeoPackage, GeoJSON, reversible CSV, JSON and printable HTML. Original municipal attributes and source-version hashes travel with the feature. A missing or invalid source position remains NULL. Valid GeoJSON Points use longitude, latitude; projected x/y remains original source context unless an explicit coordinate interpretation produces a valid geographic point.

Give the analyst the complete handoff file. Editable values include location, assigned team, asset/work-order reference, priority, action, due date and analyst note. Keep the handoff, feature and source-version identities. A return can contain only part of the original handoff, and its complete file is retained.

After import, inspect the proposed changes against their original handoff and the chosen current target. Accept or reject individual proposals, with reviewer and note. Existing decisions remain visible; later source changes or already changed analyst fields require explicit conflict handling. Build a dispatch from the selected approved features and receiving-system column mappings.

A GeoPackage preserves original imported source files, handoff metadata and coverage in registered attribute tables. The original file's complete feature identities remain available after an analyst editor changes its ordinary local row identifiers. The [format guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/FORMATS.md) describes these interoperability rules and the CSV text encoding.

## Follow requests through work-order decisions

The Follow-through desk keeps requests and orders as distinct source roles. Inspect each original packet or file, choose the intended endpoint/layer captures and save its observation time and source series. Source errors remain retained source records; a request-only edition can proceed while an order source is unavailable.

Save an explicit profile for business identity, status, timestamps, relationship candidates and coordinates. An original relationship-like field is a source value until its meaning is established by the selected mapping and review. For example, the names CW_REQUEST and WORKORDERID do not themselves define the same identifier.

Build the operating edition from selected request and optional order sources. Search requests and the independent order register. Review an automatic relationship candidate or manually choose an order; save the relationship decision and original version references. Assign work, due time and an action note against the exact selected request/order editions.

Compare later editions by requests or orders. Source metadata such as a declared hash-derived ArcGIS object ID remains in the original object and its hash while business comparisons use the configured original identity and semantic fields. A metadata-only difference stays distinguishable from changed cost, date or status.

Receive reviewer JSON against its original work and edition, then select the individual decisions. Approved, still-current work can carry forward into a later same-series edition when the original request and selected order hashes are unchanged. A current approved open action is eligible for a new selected dispatch; completed or dismissed work remains historical.

Export complete dispatch JSON, reversible CSV, GeoJSON or the printable report. The dispatch retains its selected action count, original request/order objects, approvals, geometry and receiving-system column mappings. The complete workspace carries all source files, profile editions, relationship reviews, assignments and returned decisions.

~~~sh
npx --no-install starforge open311-follow-through export \
  --workspace /absolute/private/municipal/follow-through \
  --kind dispatch-json --dispatch DISPATCH_ID \
  --out /absolute/private/handoff/approved-dispatch.json

npx --no-install starforge open311-field-desk inspect-source \
  --input /absolute/private/handoff/approved-dispatch.json

npx --no-install starforge open311-field-desk import \
  --workspace /absolute/private/municipal/field \
  --input /absolute/private/handoff/approved-dispatch.json \
  --name "Approved municipal field work" \
  --request-id dispatch-to-field-001 \
  --expected-revision CURRENT_FIELD_REVISION
~~~

For a complete Follow-through workspace containing several dispatches, pass --dispatch with the intended ID returned by inspection. The [source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/follow-through/README.md) provides complete mapping, linkage, assignment and dispatch definitions.

## Plan field visits and reconcile crew returns

Field Desk imports the approved dispatch or a selected dispatch from a complete Follow-through workspace. Its source retains the exact originating work and approval edition, original request and order versions, relationship decisions and dispatch definition.

Create a named crew and visits for the intended source actions. A visit has its original source binding, crew, instructions, schedule and operating values. Attach source context or field files as complete original bytes. Attachment identity follows the byte hash; filename/content type remains retained context.

Create the crew package for the selected visits and download its complete JSON and portable HTML. The HTML contains the original package and supports editing without a server. The crew can record selected visit changes, notes, files and exact labor/material/equipment quantities, then download a return JSON. A partial return leaves unselected visits available for later work.

Import the complete returned file. Review its base package, changed visit fields, source/assignment changes and conflicts. Select each proposal to accept or reject, with an explicit current target where needed. An accepted proposal and its supervisor decision remain retained; accepting a later changed visit creates a new current version.

Resource values are decimal strings. Units and currency remain declared values. Keep a source quantity or cost's precision; a source with no declared currency has no implied currency. A visit can be complete while the external source request still has its original status.

Review the exact current visit versions, then select an explicit destination and actions for an update package. Its update-json, update-csv, update-geojson and update-report forms preserve the original source row, crew/visit edition, approval references, exact resource values and attachments. A request_closure item expresses the reviewed destination action. External request status changes require a destination result.

The complete editable workspace also carries every crew package, original return file, partial decision, attachment and update. The [Field Desk guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/WORKSPACE.md) gives the full operator procedure, and its [types](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/field-desk/index.d.mts) define the saved file shapes.

## Configure the service and prepare implementation

Service configuration can start with an original Open311 request array, a Follow-through dispatch, a Field Desk destination update or another explicitly mapped original JSON register. First inspect the file and save the exact row-array pointer. An empty rowsPointer selects a top-level array; /rows selects dispatch rows; /items selects destination update items.

Save a complete agency profile covering departments, role/group permission declarations, staff, categories, source profiles, routing rules, message templates and rollout phases. A source profile maps each semantic field using a JSON Pointer relative to the selected original row or an explicit literal. Null, missing, empty and typed values remain distinct.

Name the profile/version and original source for a complete-register preview. Review every unmatched, invalid or ambiguous row. Routes resolve declared categories and exact selectors; multiple applicable routes remain visible for an explicit choice. Per-record overrides carry an operator and reason. Public-map decisions distinguish show, hide, default and unresolved values.

Resident message wording can provide an explicit assignee name, completion note and progress summary. Missing required template values remain visible. Rendered messages retain their original template, bound source values, wording choices and PREVIEW delivery state. Source closure notes keep their literal disposition; proposed routing or a reviewed local action does not rewrite that disposition.

When comparing a proposed rollout to a deployed configuration, select an explicit saved baseline profile/version and name its declarer and note. The preview retains that exact baseline. A previous local draft becomes a deployed baseline only through this operator declaration.

Review the complete preview and save a named implementation release. It contains the exact proposed profile, original source, preview, baseline, application order, remaining rows, reviewer and note. Its state is PREPARED_FOR_APPLICATION. Download its complete JSON and printable handover, then export the full editable workspace for the receiving operator to continue the same profile history.

Example original source intake:

~~~sh
npx --no-install starforge open311-service-configuration source-inspect \
  --input /absolute/private/handoff/approved-dispatch.json

npx --no-install starforge open311-service-configuration source-import \
  --workspace /absolute/private/municipal/service-configuration \
  --input /absolute/private/handoff/approved-dispatch.json \
  --name "Selected approved dispatch" \
  --rows-pointer /rows \
  --request-id dispatch-to-service-001 \
  --revision CURRENT_SERVICE_REVISION
~~~

The source profile's own rowsPointer and mappings must match the selected original shape. For a Field Desk update, select /items and the explicit field_destination_update_v1 profile. The [complete source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/open311/service-configuration/SOURCE_CONTRACT.md) defines the supported mapping fields, stage semantics, permission declarations, calendars and template bindings.

## Keep the operating history usable

For every saved write, retain its request ID, original expected revision and complete original input until its result is known. Inspect the saved operation before repeating a write whose response was lost. Repeat the same intended action with those original values; prepare a different action with a new request ID after reading current state.

Paged source, work, version and review views expose their total or continuation. Keep the selected source/edition/revision while paging. Page selection in a browser is an operator view; an export names its own complete saved selection. For merchant file reads, retain the complete selection, file hash and completed offset across a reconnect.

When transferring work, deliver the full editable workspace plus the selected ordinary outputs the recipient needs: originals, reports, analyst files, dispatches, crew editor or implementation package. Preserve each application's source attribution and complete operation history. [RECEIVING.md](RECEIVING.md) lists the exact six workspace schemas, commands and identity behavior.

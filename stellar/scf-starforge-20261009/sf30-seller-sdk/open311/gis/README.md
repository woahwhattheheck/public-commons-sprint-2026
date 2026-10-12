# Open311 GIS handoff and reviewed dispatch

The GIS desk carries a complete municipal source selection through a practical analyst workflow: import an original collection or service report, prepare a named map and table handoff, exchange editable GIS files, inspect returned proposals, save review decisions, and deliver a mapped dispatch package. The browser, CLI, typed SDK and installed merchant tools use the same saved workspace.

The installed **open311-gis** selection includes municipal source operations, service-performance reporting and this GIS desk. See [INSTALL.md](INSTALL.md) for packaging and Applications, [WORKSPACE.md](WORKSPACE.md) for the complete browser workflow, [FORMATS.md](FORMATS.md) for GIS and CSV interoperability, and [MCP.md](MCP.md) for the installed merchant tools.

## Source intake and identity

Import either a complete **commons.open311.collection-export.v1** file or a complete **commons.open311.reporting-workspace.v1** package. A reporting JSON export includes its original source closure; choose the saved report when the file contains several reports. The importer checks the original collection/report relationships and keeps the exact UTF-8 file, its hash, the selected original request editions, capture times, source coverage and attribution.

Each feature key derives from the exact frozen endpoint, jurisdiction and service_request_id. A local GeoPackage fid is an ordinary integer row identifier. Source-version hashes include arbitrary original fields, including nested provider extensions. Source status, case-closure notes and internal source review remain visible beside the GIS analyst fields.

A handoff can combine several imported collections and reports. For each feature identity, the latest observed source edition wins, followed by deterministic source-hash/capture/source-ID ordering for a time tie. All original candidate versions remain inspectable from the retained input files. This selection describes the observations present in the imported sources; the captured source window, provider cap, update-feed population and unresolved intervals remain in its coverage.

## Start a desk

Direct modules require Node.js 22.13 or newer. The complete installed merchant runtime requires Node.js 22.16 or newer.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs init \
  --workspace /absolute/private/municipal-gis

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs serve \
  --workspace /absolute/private/municipal-gis --host 127.0.0.1 --port 0
~~~

Open the private URL printed in the compact startup JSON. The selected directory contains open311-gis.sqlite. Source files, analyst uploads, immutable handoff editions, review decisions, dispatches and operation recovery are committed in SQLite transactions. State and head reads use compact saved summaries, so reopening the workbench avoids parsing every historical source body.

In an installed package, use **starforge open311-gis** with the same arguments. Merchant Applications offers **Open311 GIS handoff** and verifies the selected directory, original workspace identity and running server instance.

## Create a complete handoff

Inspect and import the original source:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs inspect-source \
  --file /absolute/handover/municipal-collection.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs import \
  --workspace /absolute/private/municipal-gis \
  --file /absolute/handover/municipal-collection.json \
  --request-id gis-source-001 --expected-revision 0
~~~

For a report package, add --report with an ID returned by inspect-source. Keep the source ID returned by import. A handoff definition selects that ID and explicit operating defaults:

~~~json
{
  "name": "Municipal GIS allocation",
  "sourceIds": ["SOURCE_ID_FROM_IMPORT"],
  "filters": {
    "q": "",
    "statuses": [],
    "serviceCodes": [],
    "geometry": "any"
  },
  "defaults": {
    "assignedTeam": "",
    "assetId": "",
    "workOrderId": "",
    "priority": "",
    "action": "review",
    "dueDate": "",
    "note": ""
  }
}
~~~

Save that definition through the browser or as a JSON file, then run:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs handoff \
  --workspace /absolute/private/municipal-gis \
  --file /absolute/handover/gis-definition.json \
  --request-id gis-handoff-001 --expected-revision 1
~~~

The returned handoff ID selects complete exports:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs export \
  --workspace /absolute/private/municipal-gis \
  --handoff HANDOFF_ID --kind gpkg \
  --out /absolute/handover/municipal-analyst.gpkg
~~~

The same selection supports geojson, csv, json and html. The browser map and table show a searchable page, while each export contains the complete saved handoff. The GeoPackage also includes the original imported source files, handoff metadata and coverage as registered attribute tables.

## Analyst edits and returned files

The editable fields are geometry, assigned_team, asset_id, work_order_id, priority, action, due_date and analyst_note. Geometry is an RFC 7946 WGS84 Point or NULL. Action is review, dispatch, defer or dismiss. Due dates use YYYY-MM-DD or an empty value.

Open the GeoPackage's open311_features layer in the GIS editor, inspect the retained source columns and add the allocation or location changes. Keep feature_key, handoff_id, handoff_sha256 and source_sha256, along with the other source columns. Save the edited file and import it against its original handoff:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs return \
  --workspace /absolute/private/municipal-gis \
  --handoff HANDOFF_ID --analyst "Municipal GIS analyst" \
  --file /absolute/handover/municipal-analyst-return.gpkg \
  --request-id gis-return-001 --expected-revision CURRENT_REVISION
~~~

GeoJSON, CSV and analyst JSON follow the same flow. The return retains every original byte and shows proposed editable-field changes, unknown or duplicate feature keys, source-column changes, invalid geometry, unchanged rows and missing keys. A missing returned row remains a visible missing entry; historical source records remain in the saved handoff.

Inspect a return with return-show --id RETURN_ID or the browser. A review selection explicitly names the current target handoff, reviewer and individual proposal IDs:

~~~json
{
  "returnId": "RETURN_ID",
  "handoffId": "CURRENT_HANDOFF_ID",
  "reviewer": "Municipal service supervisor",
  "note": "Assignment and location reviewed",
  "accept": ["CHANGE_ID"],
  "reject": []
}
~~~

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs decision \
  --workspace /absolute/private/municipal-gis \
  --file /absolute/handover/gis-decision.json \
  --request-id gis-decision-001 --expected-revision CURRENT_REVISION
~~~

The action saves a decision and a new immutable handoff edition. Accepted proposals must still match their original source version; competing analyst changes produce per-field conflicts with the old, current and proposed values. Other accepted fields can be reviewed in a separate explicit selection. Already decided proposals retain their reviewer and time.

To reverse an accepted analyst change, export the current handoff, edit the desired fields, return that file and save a new review decision. Original proposals and decisions stay available.

## Refresh the original source selection

Import a newer complete source collection or report, then create a handoff with predecessorId set to the current handoff in the same series. Choose the desired source IDs and filters.

An unchanged original source hash carries its accepted analyst fields, geometry and last decision forward. A changed original source version starts with the new handoff defaults and original geometry, records its previous source hash and appears as changed source. This keeps the source refresh and the supervisor's GIS decisions distinguishable. Earlier handoffs, source versions and return files remain available.

## Prepare reviewed dispatch

Dispatch selects rows whose action is dispatch and which have an accepted analyst decision. The definition contains a name, saved handoff ID, actual destination label, optional note and optional row keys. Omit keys to include all reviewed dispatch rows.

~~~json
{
  "name": "Reviewed municipal allocation",
  "handoffId": "REVIEWED_HANDOFF_ID",
  "destination": "Municipal work-order intake",
  "note": "Reviewed allocation for the selected source edition",
  "columns": [
    { "name": "external_case_id", "field": "serviceRequestId" },
    { "name": "responsible_team", "field": "assignedTeam" },
    { "name": "asset_reference", "field": "assetId" },
    { "name": "work_order_reference", "field": "workOrderId" },
    { "name": "longitude", "field": "longitude" },
    { "name": "latitude", "field": "latitude" },
    { "name": "dispatch_note", "field": "note" }
  ]
}
~~~

Save the file with dispatch --file DEFINITION.json and the same revision/request controls. Export its returned dispatch ID with --dispatch ID and kind csv, gpkg, geojson, json or html. The four identity columns are retained in mapped CSV, along with its declared reversible cell encoding. Destination column names are explicit operator mappings. The output remains a saved deliverable associated with the selected handoff, source versions and accepted decisions.

## Complete receiving and recovery

Export kind workspace without an item selection. This file contains the complete GIS source files, historical handoffs, original analyst uploads, decisions, dispatches, received histories and original operation inputs/results.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs export \
  --workspace /absolute/private/municipal-gis --kind workspace \
  --out /absolute/handover/municipal-gis-complete.json

node stellar/scf-starforge-20261009/sf30-seller-sdk/open311/gis/cli.mjs receive \
  --workspace /absolute/private/municipal-gis-received \
  --file /absolute/handover/municipal-gis-complete.json \
  --request-id gis-receive-001 --expected-revision 0
~~~

Receiving checks the original source, file comparisons, accepted decisions, handoff lineage and dispatch derivation before the transaction commits. Each receiving operation stores the exact incoming file hash/byte count and sealed package hash as a compact descriptor; the imported original records and municipal/analyst files transfer once, avoiding recursive package nesting on subsequent handovers. It preserves the original workspace identity and history, then appends the receiving action and revision. Open the receiving directory in the browser or Applications and continue editing its current handoff.

Every mutation uses a stable requestId and an observed expectedRevision. The CLI can create a request ID and read the current revision when those options are omitted; explicit values make automation and recovery clearer. After an uncertain response, query operation --request-id ID and repeat the original action. A new request ID names a new intended action.

Source and analyst imports are limited to 128 MiB; full workspace packages and exports are limited to 256 MiB. A handoff supports 100,000 selected identities. Complete immutable data stays in the workspace and complete exports, while browser and merchant lists are paged. GeoPackage preparation needs writable space in the selected private directory.

## Primary format and provider references

- [OGC GeoPackage 1.4.0](https://www.geopackage.org/spec140/index.html): SQLite header, core tables, SRS declarations and standard binary geometry.
- [RFC 7946](https://www.rfc-editor.org/rfc/rfc7946.html): WGS84 GeoJSON longitude/latitude and nullable geometry.
- [QGIS editing documentation](https://docs.qgis.org/3.44/en/docs/user_manual/working_with_vector/editing_geometry_attributes.html): ordinary geometry and attribute editing.
- [Connected Bits](https://connectedbits.com/): municipal CRM, GIS, asset and work-order integrations and supervisor map/list workflows.
- [BOS:311 Open311 access](https://311.boston.gov/open311) and [provider documentation](https://311.boston.gov/open311/docs): original municipal source access and vendor extensions.

Source attribution from each imported connection remains in the GIS files, full receiving package and printable report.

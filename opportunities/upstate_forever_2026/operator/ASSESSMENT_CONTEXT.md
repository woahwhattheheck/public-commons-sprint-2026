# Assessment geographic context and parcel associations

This desk connects retained assessment records, original watershed geography and
original parcel studies. It creates two saved products: a source-bound assessment
context edition, and an independent parcel geographic-association result.

Needs expert review: interpreting an assessment listing and its relationship to
land-management decisions requires the original assessment scope, status and
geographic relationship.

## Geographic meaning

A context polygon describes where selected original assessment records are
associated. The source role is ASSESSMENT_GEOGRAPHIC_CONTEXT. Parcel results
measure the overlap between this context and original parcels inside the original
study reporting boundary.

Original assessment watershed labels and computed station/polygon memberships
remain separate. The operator chooses which relationship constructs the context.
The default is the original published watershed label. Each original row retains
both relationships, its original field values and its source reference.

A row whose two associations are resolved can agree or differ. If either
association is unresolved, the comparison is null and the explicit status records
published-only, computed-only or neither-resolved. A missing comparison is never
counted as agreement.

These products report geographic context. A station inventory cannot designate
every location in its watershed as impaired or establish a parcel's hydrologic
contribution. The association job is independent of published impairment criteria,
source-profile substitution, concentrations and annual modeled loads. It does
not populate sources.impairments or call the parcel-criteria scoring engine.
Existing impairment source selections and scores remain authoritative for their
separate workflow.

A parcel without a selected context intersection means exactly that. It is not
a negative impairment finding or proof of complete assessment coverage.

## Operator workflow

The maintained extension registry discovers these six files:

- model/assessment_context.py
- operator/assessment_context.py
- operator/extensions/assessment-context.json
- operator/web/assessment_context.mjs
- operator/web/assessment_context.css
- operator/ASSESSMENT_CONTEXT.md

Restart the maintained operator after source installation. Open **Assessment
context**.

1. Select a completed station-geography edition, its original assessment table,
   and an original watershed source retained by that edition.
2. Select exact original causes, impaired uses, counties or assessment editions.
   An empty filter includes all original values. For another inventory, use
   **Original field bindings** to choose the actual column names.
3. Choose the published-watershed or computed-membership relationship. The
   original assessment file SHA locks the known 2026 draft's title, status,
   vintage and public reference. The context title is independently editable.
4. Prepare the context through the original operator task queue. Inspect its
   map, original rows, source details, unresolved locations, multiple memberships,
   association differences and original edition/cause/use groups.
5. Select an existing original parcel study and choose **Prepare parcel
   associations**. This queues an independent geographic intersection job.
6. Inspect original parcel IDs, reporting area, union context overlap area and
   fraction, boundary-only contacts, original attributes and linked assessment
   rows. Search the complete result or download the filtered parcel CSV.
7. Reopen either saved product from its edition selector. Download complete
   JSON, GeoJSON, CSV, HTML and ZIP exports. Both context and parcel packages have
   their own receiving controls in the same desk.

Operations retain their original queue IDs. Closing and reopening the desk does
not replace a pending operation. The client keeps the current source selection,
edition and filtered view in the browser session, while saved product records
and source inputs remain in Workspace.

## Source editions and draft status

The exact original Upper Savannah assessment extraction is 14,033 bytes with SHA256:

```text
545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f
```

Its source identity locks the backend and browser to:

- Title: South Carolina 2026 draft integrated assessment.
- Status: draft.
- Vintage: 2026.
- Public reference: https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110

The original extraction has 101 rows across 87 station IDs before filtering,
from physical PDF pages 67–71. The lock applies only to this original file hash.

Other inventories can bind original per-row assessment_edition, assessment_title,
assessment_status, assessment_vintage and assessment_reference fields. The field
selectors accept actual original column names. Exact matching names are suggested
when present; different names are selected explicitly. Maintained station-assessment
inventories additionally recognize publisher_huc12/huc12, cause_code/cause_raw/cause,
use/impaired_use, source_vintage, publication_status and source_uri. These exact
column-name defaults follow the current source producer. If the station edition
already carries assessment_records, their original record ID, edition source ID
and original publisher SHA remain attached. Group identities include that source
identity, evidence kind, assessment period and status date. Every per-row value
remains in the canonical result and source details. Empty original values remain
empty. Fields not supplied by the source use the explicitly selected inventory
metadata, whose scope remains visible.

Rows are identified by their retained source reference and original row number.
The same station and cause in two editions remain two original records. Aggregate
groups include each row's assessment metadata, edition, cause and impaired use.
Whole-study and polygon station counts are distinct IDs, while original assessment
row counts retain all editions. Polygon properties carry inventory labels and
the full assessment_groups_json; an inventory label does not replace the
per-record editions.

## Saved context selection

Use identifiers returned by catalog and options, not example placeholders:

```json
{
  "title": "Selected assessment geographic context",
  "station_geography_id": "ACTUAL_SAVED_EDITION_ID",
  "table": {
    "collection_id": "ACTUAL_ORIGINAL_COLLECTION_ID",
    "source_id": "ACTUAL_ASSESSMENT_SOURCE_ID"
  },
  "watershed_source": {
    "collection_id": "ACTUAL_ORIGINAL_COLLECTION_ID",
    "source_id": "ACTUAL_WATERSHED_SOURCE_ID"
  },
  "fields": {
    "watershed": "huc12",
    "cause": "cause",
    "use": "impaired_use",
    "county": "county"
  },
  "filters": {"causes": ["TN"], "uses": [], "counties": [], "editions": []},
  "relationship_basis": "published_watershed",
  "assessment": {
    "title": "South Carolina 2026 draft integrated assessment",
    "status": "draft",
    "vintage": "2026",
    "reference": "https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110"
  }
}
```

Each table must already be an original site_tables selection in the station
edition. Each watershed source must already be selected there. Exact source
SHA256 values and the station edition bind the context selection. A source,
location choice, filter or association change receives a separate edition.

A row associated with more than one original polygon remains linked to each.
Regional distinct-station totals therefore cannot be reconstructed by summing
per-polygon counts. Unmatched rows remain in the row export even when their
selected association supplies no polygon.

## Parcel calculations and original identity

The job uses the maintained conservation._geometry_inputs function and the
saved original parcel study. This preserves the existing source selection,
native parcel identity, reporting mask and suitable metric analysis CRS.

The saved result distinguishes:

- Full original parcel area.
- Original parcel area clipped to the reporting boundary.
- Union area of all selected context polygon intersections within that clipped
  parcel, divided by the clipped parcel area.
- Individual parcel/context relationships, each with its original watershed
  reference, station IDs, assessment row numbers, overlap area and fraction.
- Positive-area overlap, boundary-only contact and no selected intersection.

Overlapping context polygons are unioned within each parcel before its area and
fraction are calculated. Original parcels remain independent; their areas must
not be summed as a non-overlapping regional land-area estimate. Boundary-only
contact has zero overlap area and remains a separate relationship. Original
parcel IDs, labels, attributes, geometry corrections and source array positions
remain in JSON/CSV; the map-ready GeoJSON contains reporting-clipped geometry and
original attributes in an explicit JSON field.

Neither assessment causes nor station proximity substitute for hydrologic routing.
The saved parcel product retains its independent score_effect statement and the
original study selection.

## Complete exports and portable receiving

A context edition includes:

- context.json and context.geojson.
- assessment-rows.csv and watershed-context.csv.
- selection.json, geographic-context-binding.json and sources.json.
- OPEN_ASSESSMENT_CONTEXT.html.
- The complete original station-geography ZIP.
- package.json and assessment-context.zip.

The source manifest uses ordinary upstate.sources/v1 and retains the original
station study archive as a companion. All original station coordinate sources,
native polygon geometry/CRS, feature identities and assessment bytes travel in it.

A parcel association includes:

- parcel-context.json, parcel-context.geojson and parcel-context.csv.
- parcel-context-relationships.csv.
- OPEN_PARCEL_CONTEXT.html.
- The complete assessment-context ZIP.
- Original parcel study JSON, source bodies, companions and source manifests.
- The original reporting-boundary source, or retained native grid reporting
  boundary plus its original binding.
- package.json and parcel-context.zip.

Every package inventories all its members with byte lengths and SHA256. Receivers
reject unsafe paths, duplicate names, non-file members, changed content and
inventory mismatches. Nested original files are retained even when their names
coincide with contribution-owned top-level metadata.

The context receiver imports original station sources using the maintained
station receiver, resolves the same source IDs and original hashes, and rebuilds
the editable context with destination collection IDs.

The parcel receiver retains the complete original result and archive, receives
its original context, imports the original parcel/reporting sources, and records
the destination source collection mapping. It reopens the original association
without rerunning or changing its calculations. Its original study ID remains
an explicit provenance reference. To calculate a new association, select a
parcel study actually present in the destination Workspace. Native model runs
are not recreated by receiving a geographic-association result.

CSV exports escape formula-like text for spreadsheet display. Canonical JSON,
original source fields and original files retain exact values. Whole-Workspace
portable backup also retains these saved products. The extension's registered
verify_workspace hook checks both context and parcel editions.

## CLI and API

From the current application root:

```sh
python -m model.assessment_context --workspace ACTUAL_WORKSPACE catalog
python -m model.assessment_context --workspace ACTUAL_WORKSPACE options ACTUAL_STATION_EDITION_ID
python -m model.assessment_context --workspace ACTUAL_WORKSPACE build selection.json
python -m model.assessment_context --workspace ACTUAL_WORKSPACE inspect ACTUAL_CONTEXT_ID
python -m model.assessment_context --workspace ACTUAL_WORKSPACE parcels ACTUAL_CONTEXT_ID ACTUAL_PARCEL_STUDY_ID
python -m model.assessment_context --workspace ACTUAL_WORKSPACE inspect-parcels ACTUAL_PARCEL_CONTEXT_ID
python -m model.assessment_context --workspace RECEIVING_WORKSPACE receive assessment-context.zip
python -m model.assessment_context --workspace RECEIVING_WORKSPACE receive-parcels parcel-context.zip
```

The Workspace must already exist. The maintained Workspace constructor can
create a source-study Workspace when needed; receive the actual original
station study before building its context.

Public functions: catalog, options, build, inspect, parcel_associations,
inspect_parcels, receive, receive_parcels and verify_workspace. Every function
takes the Workspace as its first argument. Build takes the selection dictionary;
parcel_associations takes the context ID and original parcel study ID.

Queue actions:

- assessment.context.build: selection.
- assessment.context.receive: original upload_id.
- assessment.context.parcels: context_id and study_id.
- assessment.context.receive_parcels: original upload_id.

The maintained operator owns authentication, task state, operation IDs, retries,
upload receiving and file-download tickets.

## Focused native acceptance

Use the completed actual station edition and its original assessment inventory.
Select original cause/use values; prepare and inspect both geographic
associations. Confirm source status, original row identities and any edition
differences. Export and receive the context into another Workspace.

With an actual original parcel study, calculate the independent associations,
inspect a positive-area overlap and any real boundary/no-intersection cases
present, and compare reported fractions against the retained geometry. Export
the complete parcel package and reopen it through receive-parcels. Compare
original parcel IDs, row links, relationship areas and source hashes. Reopen
the saved editions in the maintained operator. This acceptance belongs to the
same original source operation; no alternate artificial study is required.

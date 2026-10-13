# Assessment geographic context

This workflow prepares an explicit geographic context source from a completed
original station-geography edition. It joins retained assessment records to
retained watershed polygons, retains the two distinct association methods, and
makes the result usable in the existing parcel-criteria operation.

Needs expert review: interpreting an assessment listing and its relationship to
land-management decisions requires the original assessment scope, status and
geographic relationship.

## What the resulting source means

A selected polygon identifies geographic context for selected assessment
records. Its attributes include the original assessment title, vintage, draft or
effective status, cause codes, impaired uses and distinct station counts.

The source does not turn a station assessment into a whole-polygon impairment
designation. A parcel intersecting it has a geographic association with those
records. It does not acquire a measured concentration, a modeled annual load or
an inferred upstream contribution.

The context retains both:

- The original watershed value recorded in each assessment row, matched exactly
  to the selected original polygon identifier.
- The station geography edition's computed point/polygon memberships, including
  boundary and overlapping memberships and unresolved station locations.

The operator explicitly chooses which association supplies the context polygons.
The default is the original assessment watershed label. Both associations remain
in every JSON/CSV record, so differences remain inspectable.

Absence of a selected station-assessment association remains unknown coverage.
The derived source supplies no complete negative impairment-coverage mask.

## Open the operator desk

A current application includes these six additive files:

- model/assessment_context.py
- operator/assessment_context.py
- operator/extensions/assessment-context.json
- operator/web/assessment_context.mjs
- operator/web/assessment_context.css
- operator/ASSESSMENT_CONTEXT.md

The maintained extension registry discovers the descriptor. Restart the original
operator after receiving the source. Open **Assessment context** from its
navigation. Existing station-geography and parcel-criteria modules remain the
producers and consumers.

1. Select a completed original station study, its assessment inventory and its
   retained watershed source.
2. Select original cause, impaired-use or county values. Leaving a filter empty
   includes all original values. Field bindings are available for other retained
   assessment tables.
3. Retain the assessment title, status, vintage and public reference. The known
   original 2026 draft assessment CSV resolves those fields from its exact
   retained body identity.
4. Choose the geographic association and prepare the context through the normal
   operator queue.
5. Inspect station and assessment counts, unmatched and multiple associations,
   differences between published and computed membership, original row fields,
   and the polygon map.
6. Select a saved original parcel study and prepare its criteria using this exact
   geographic relation. Existing criteria preparation supplies other retained
   sources and preserves its ordinary checkpoint/resume behavior.
7. Download the complete context ZIP. Receive it in another Workspace from the
   same desk, or use the CLI below.

All context geometry derives from the existing station edition's complete
WGS84 watershed GeoJSON. Original native geometry, CRS, feature identity,
attributes, station coordinates and assessment bytes travel in the accompanying
original station-geography ZIP.

## Saved selection

The selection contains:

~~~json
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
  "filters": {"causes": ["TN"], "uses": [], "counties": []},
  "relationship_basis": "published_watershed",
  "assessment": {
    "title": "South Carolina 2026 draft integrated assessment",
    "status": "draft",
    "vintage": "2026",
    "reference": "https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110"
  }
}
~~~

Use actual identifiers returned by the catalog and options operations. All
filters use exact original strings; cause codes are not expanded or reclassified.
The saved selection binds the table's original SHA256. A different source,
station location choice, geographic edition, filter or relationship receives a
separate context edition.

A source row associated with multiple original polygons remains represented in
each polygon's context. Whole-study station totals count distinct station IDs.
Per-polygon station counts must not be summed to create a regional station count.
Every original assessment row is retained once in the row export, including rows
whose chosen association does not resolve to a selected polygon.

## Native model and CLI

From the current application root:

~~~sh
python -m model.assessment_context --workspace ACTUAL_WORKSPACE catalog
python -m model.assessment_context --workspace ACTUAL_WORKSPACE options ACTUAL_STATION_EDITION_ID
python -m model.assessment_context --workspace ACTUAL_WORKSPACE build selection.json
python -m model.assessment_context --workspace ACTUAL_WORKSPACE inspect ACTUAL_CONTEXT_ID
python -m model.assessment_context --workspace ACTUAL_WORKSPACE criteria ACTUAL_CONTEXT_ID ACTUAL_PARCEL_STUDY_ID
python -m model.assessment_context --workspace RECEIVING_WORKSPACE receive assessment-context.zip
~~~

The original Workspace must exist. Its maintained constructor can create a new
source-study Workspace when required; import or receive the actual station study
before preparing assessment context.

Public model functions are catalog(workspace), options(workspace, geography_id),
build(workspace, selection), inspect(workspace, context_id),
prepare_parcel_criteria(workspace, context_id, study_id), and receive(workspace,
archive_path). The criteria helper accepts optional existing source overrides and
settings. It rejects a conflicting preselected impairment association.

The queue uses assessment.context.build with {selection},
assessment.context.receive with the original upload_id, and
assessment.context.criteria with context_id and study_id. The original queue owns
operation IDs, retries, task state and authenticated file downloads.

## Parcel binding

The generated source has role ASSESSMENT_GEOGRAPHIC_CONTEXT and remains an
explicit selection. It is not automatically substituted for another impairment
source. The returned parcel_criteria_binding contains the actual imported
source_collection_id, source_id, native context_id field, exact assessment
reference and original filter scope, and a written geographic relation.

The existing criteria API receives:

~~~python
from model import assessment_context
result = assessment_context.prepare_parcel_criteria(
    workspace, original_context_id, original_parcel_study_id
)
~~~

The source joins the existing sources.impairments slot. That consumer already
retains the source's declared relation and reference with its geographic
association. Its ordinary FW presence and published scoring logic remain with
the parcel engine. No coverage mask is supplied for negative association, so
unobserved assessment associations remain unknown.

## Complete outputs and portable receiving

Each retained edition includes context.geojson, context.json, the original-row
and watershed CSVs, source manifest, explicit parcel binding, readable HTML,
selection, complete inventory and assessment-context.zip. The source manifest
uses the ordinary upstate.sources/v1 importer and retains the original station
study archive as a companion.

The package receiver verifies every member and its complete inventory, receives
the original station-geography archive through its maintained receiver, resolves
the same original source IDs and body hashes in the destination, and rebuilds
the editable context there. Source collection IDs may change naturally. Source
feature identities and the original assessment rows remain retained.

CSV exports escape formula-like text for spreadsheet display. Canonical JSON and
original source bytes preserve exact original values.

## Current source basis

The implementation uses the maintained station-geography inspect/receive
interfaces and current source_tools.parcel_criteria.prepare contract. The
original assessment is the South Carolina draft 2026 source above, physical
PDF pages67–71 for the retained Upper Savannah extraction. The current original
inventory has101 rows across87 station IDs before filtering.

One actual operating journey should use the completed original87-station
edition, select its original TN or ECOLI records, prepare the context, inspect
published/computed association differences, export its complete archive, receive
into a second Workspace and prepare criteria for an actual retained parcel
study where available. Compare original row numbers and values, native polygon
references and both geographic associations through the receiving step.

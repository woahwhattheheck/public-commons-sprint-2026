# Assessment geographic context and parcel associations

This desk connects retained assessment records, original watershed geography and
original parcel studies. It creates two saved products: a source-bound assessment
context edition, and an independent parcel geographic-association result.

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

The maintained extension registry discovers these seven files:

- model/assessment_context.py
- model/assessment_report_context.py
- operator/assessment_context.py
- operator/extensions/assessment-context.json
- operator/web/assessment_context.mjs
- operator/web/assessment_context.css
- operator/ASSESSMENT_CONTEXT.md

Restart the maintained operator after source installation. Open **Assessment
context**.

1. Select a completed station-geography edition and an original watershed source
   retained by that edition. The desk initially selects every retained assessment
   inventory. Keep all three inventories for the 164-station / 293-record study,
   or select an explicit subset.
2. Select exact original causes, uses, support values, counties or assessment
   editions. An empty filter includes all original values. All filter conditions
   match the same original record. A literal combined use such as `AL, REC`
   remains one source value. Each selected inventory has its own original field
   bindings and source metadata. Missing support remains unknown and can be
   selected explicitly as an unreported original field.
3. Choose the published-watershed or computed-membership relationship. The
   original assessment file SHA locks the known 2026 draft's title, status,
   vintage and public reference. Other inventories retain their original manifest
   title, publication status, vintage and reference whenever provided; original
   row bindings preserve their more specific edition metadata. The context title
   remains independently editable.
4. Prepare the context through the original operator task queue. Inspect its
   map, original rows, source details, unresolved locations, multiple memberships,
   association differences and original edition/cause/use groups.
5. Select an existing original parcel study and choose **Prepare parcel
   associations**. This queues an independent geographic intersection job.
6. Inspect original parcel IDs, reporting area, union context overlap area and
   fraction, boundary-only contacts, original attributes and linked assessment
   rows. Search the complete result or download the filtered parcel CSV.
7. Reopen either saved product from its edition selector or completed task's
   **Open assessment context result** button. Use **Use this saved selection for
   a new context** to restore every original inventory, binding and filter. Download complete
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
identity, evidence kind, assessment period and status date. Authoritative native producer publication status, source vintage and original
source URI take precedence when supplied; explicit original-field bindings
serve inventories without those producer values. The exact known draft retains
its canonical 2026 edition label, while the original source-vintage description
remains in native_assessment. Every per-row value remains in the canonical result
and source details. Empty original values remain
empty. Fields not supplied by the source use the explicitly selected inventory
metadata, whose scope remains visible.

Rows retain their original row number and a stable `assessment_row_id` derived
from the original inventory body SHA256 and source position. Destination Workspace
collection IDs do not enter that identity. A row number repeated in another
inventory cannot collapse a record, polygon membership or parcel association.
The same station and cause in two editions remain two original records. Aggregate
groups include each row's assessment metadata, edition, cause, use and original
support. Each group also retains its exact stable row IDs.
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

The single-inventory selection above remains accepted for existing callers.
New saved selections carry an `inventories` array, each member containing the
original `table` reference, `fields`, `assessment` metadata and original body
SHA256. The top-level relationship and filters apply to the selected original
rows together. The operator constructs this selection directly from the retained
study options, so no source references need to be typed by hand.

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
  reference, station IDs, stable assessment row IDs, original row numbers,
  overlap area and fraction.
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
station receiver, resolves every selected inventory and watershed by the same source IDs and
original hashes, and rebuilds
the editable context with destination collection IDs. Its package retains an
ordered inventory-source identity list. The receiver preserves the old single
inventory package format as well as the current multi-inventory format. Stable
assessment row IDs remain identical after rebinding.

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


## Complete all-editions study

The maintained prepared-study catalogue retains three separate choices: the
2026 draft inventory (101 rows at 87 stations), the two published inventories
(192 rows at 159 stations), and their union (293 rows at 164 stations). The union
keeps the five draft-only stations; it does not relabel draft rows as published.

Open the saved 164-station study in this desk and leave its three inventories
selected. The source rows retain the published 2024 listing, July 28, 2026 TMDL
attainment status and 2026 draft inventory as separate original sources.
Geographic context follows the selected relationship, while both original
published and computed polygon associations remain exported.

Support belongs to the original cause, use and edition. For example, a station
may retain a BIO / AL assessment and a fully supported ECOLI / REC record from
another edition. Selecting ECOLI and fully_supported must match one record; it
cannot combine the cause from one record with support from another. An inventory
without a use_support field retains an unreported value. Published source
publication_status and per-record use_support are separate concepts.

Complete CSV and JSON exports include assessment_row_id, the original row number,
cause, use, support, edition metadata, publisher record ID, original inventory
reference and untouched original fields. Watershed and parcel products carry
assessment_row_ids alongside their original row-number displays. Distinct row
counts use those stable identities across inventories.

### One native receiving journey

Use the existing source operation and actual saved 164-station edition:

1. Open Assessment context; select the study and its three original inventories.
2. Build all editions, then inspect the actual summary, original groups and map.
3. Restore the saved selection, choose an original cause/use/support/edition
   combination and build a separate saved context.
4. Export the complete all-editions ZIP and receive it in the existing receiving
   Workspace. Compare each assessment_row_id, original record and geographic
   association before and after rebinding.
5. If an actual parcel study is retained, calculate its independent associations
   and compare linked row IDs and overlap values after portable receiving.
6. Reopen both results from their completed tasks after leaving the desk.

The expected 293-row inventory total describes the full unfiltered source study.
A context with fewer rows must retain its exact filter and inventory selection;
the result is never padded with missing records.

The saved report and operator show each original edition reference as its own source link. A context spanning multiple original references uses its stable `urn:upstate:assessment-context:<build_id>` as the derived source URI and preserves the individual references in `metadata.original_source_references`.

## Send a saved context to the existing scientific and client report

Open the exact saved assessment context. Under **Scientific and client report**, select **Use saved assessment context in report**. The original task queue retains the operation. After it completes, **Open scientific report** opens the existing ordered scientific composer with this exact retained source. Review the source order, title and contact, preview the report, then use the composer’s normal generation and download controls. This source-only report can be published from the completed assessment or parcel context without selecting a regional model run.

To retain an existing map delivery’s native runs, map settings and previously selected scientific studies, choose that saved delivery before preparing the context. **Open Maps and delivery** opens its original full selection. **Open scientific report** passes that selection’s ordered scientific source choices into the composer, where the existing draft order and nonempty title/contact remain under the operator’s control. The two buttons use the same original completed report-source task.

The same controls appear below an opened parcel association. **Use saved parcel and assessment context in report** includes its exact original context, parcel study, reporting boundary, parcel attributes, relationship rows and complete packages. A received parcel association keeps its original context identity and the destination context binding separately. Its retained values can be reported directly without recalculating them.

The report source always uses the saved edition. Temporary table searches or map selections do not silently narrow the saved scientific selection. To publish a narrower cause/use/support/edition cohort, use the saved selection to prepare that context first.

The report preserves each original edition/status/reference and each cause/use/support group, both publisher and computed watershed relationships, and the independent parcel geographic association. It keeps unresolved comparisons distinct from disagreements. It carries original body hashes, array pointers or CSV positions, source dictionaries and packages beside the report. Parcel areas use the saved metric CRS and union within each reporting-clipped parcel; overlapping source parcels remain independent. The report source is geographic assessment context and leaves the delivery's original scientific model inputs, concentrations, loads and scoring unchanged.

The prepared document is imported through the maintained `upstate.sources/v1` intake. Its recipe uses the current `upstate.observed-report/v1` collector, which supports ordered scientific sources. Every package member is copied and checked before import; the recipe and source manifest refer to that common retained root. Report collection and Workspace archive/restore therefore retain the original files through the existing transport.

### Native preparation and receiving

From the original application, with actual saved IDs:

```bash
python -B -m model.assessment_report_context \
  --workspace "$WORKSPACE" \
  --context-id "$SAVED_CONTEXT_ID" \
  --parcel-id "$SAVED_PARCEL_ASSOCIATION_ID" \
  --delivery-id "$SAVED_DELIVERY_ID"
```

Omit `--parcel-id` for assessment context alone. Omit `--delivery-id` for a new report selection. `--prepare-only` writes the complete recipe, source manifest and retained companion files without importing them; it cannot be combined with a selected delivery.

The result includes the original context/parcel IDs, immutable report operation ID, manifest and recipe descriptors, native source collection/document IDs, exact observed-context binding and `delivery_selection`. Pass its source choices to `host.openScientificReport({workspace_key, sources, title})` for the standalone scientific composer, or pass the full selection to the existing delivery form or maintained delivery API. Its ordered source list preserves previously selected studies and adds this exact document once; the delivery binds the resulting full selection before generating its normal reports.

Native operator action:

```json
{
  "action": "assessment.context.report",
  "payload": {
    "context_id": "ACTUAL_SAVED_CONTEXT_ID",
    "parcel_id": "ACTUAL_SAVED_PARCEL_ASSOCIATION_ID",
    "delivery_id": "ACTUAL_SAVED_DELIVERY_ID"
  }
}
```

The optional parcel and delivery IDs may be omitted. The action uses the original supervised queue and upload/download permissions. Its completed task includes direct links to the recipe, manifest and complete context/parcel ZIPs. The desk and global task list open the scientific composer or Maps and delivery only in the task's original Workspace. The descriptor declares `openScientificReport` and `openDelivery`; install this client with the maintained host that exposes both capabilities. The shared source composer validates the actual collection/document choices and keeps its preview and original-source checks. Before changing any source file, the station-family installer checks the installed app callback and both maintained composer modules, and records their source hashes in its receipt. An older application must receive the maintained Scientific reports implementation before this client is installed.

For a focused receiving check, use the same actual saved context, prepare and import its report source, bind and collect it through `model.observed_context`, and verify every delivered companion against the original source member descriptor. Archive/restore the current Workspace through its normal operation and reopen the same saved source and delivery. Preserve actual context, parcel, collection, document, report and receiving IDs in the existing operation receipt.


### Complete component installation

The station installer composes its owned source with the original WBD producer's selected component inventory. Every selected original response, input and source companion is included and checked before any file changes. The WBD context module remains available when opening the existing station studies; its dated boundary association preserves each selected point's original datum and coordinates.

The additive assessment scientific-report component declaration names the existing composer runtime files directly. Their implementation stays with the maintained Scientific reports producer. This explicit source membership avoids a dependency cycle with the broader observed-context data component and keeps ordinary station and assessment selections usable without introducing unrelated source datasets.


### NLDI station source extension

The station installer composes the original WBD catalogue with its maintained `observed-station-wbd-nldi-197` extension before selecting files. The extension contributes the original NLDI point file and all 13 original WBD responses, retaining 197 coordinate-specific context rows and both gauge-coordinate variants. The existing component fragment reader validates the declaration; all selected source members and declared hashes are checked before any application file changes. Geographic source context remains separate from the assessment cause and use inventory.


### Geographic context and assessment inventories

Saved observed-station studies retain their original WBD point and watershed tables. Assessment context displays these under **Geographic source context**, with the source title, vintage, row count, original link and retained identity. These tables remain part of the saved station study and portable source package. They do not supply assessment cause, use, support or publication records.

The assessment selector uses the producer’s explicit geographic source type to keep those tables out of automatic inventory selection. The backend applies the same distinction before normalizing selected fields and extracting original records, including manually supplied selections. Untyped custom assessment tables remain available with their original field mappings. Existing 87-, 159- and 164-station assessment inventories preserve all original 293 edition-specific records.

When a saved observed-station study contains geographic context only, choose a saved assessment study or use **Open Station geography** to prepare the assessment study from its original sources. Saved assessment results and their report, parcel and portable receiving controls remain available below the form.

The complete standalone installation also retains the current native assessment review provider, client and guide, so the maintained station desk can accept its original source-bound station selection without a missing module or browser asset.

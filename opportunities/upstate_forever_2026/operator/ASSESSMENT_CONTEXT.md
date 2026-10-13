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

To retain an existing map delivery’s native runs, map settings and previously selected scientific studies, choose that saved delivery before preparing the context. **Open Maps and delivery** opens its original full selection. **Open scientific report** restores that selection’s exact ordered scientific source choices and prepared title in the composer, retaining the operator’s contact details. It replaces the previous composer draft’s source selection. The two buttons use the same original completed report-source task.

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

The result includes the original context/parcel IDs, immutable report operation ID, manifest and recipe descriptors, native source collection/document IDs, exact observed-context binding and `delivery_selection`. Pass its source choices to `host.openScientificReport({workspace_key, sources, title, selection_mode: 'replace'})` for the standalone scientific composer, or pass the full selection to the existing delivery form or maintained delivery API. Its ordered source list preserves previously selected studies and adds this exact document once; the delivery binds the resulting full selection before generating its normal reports.

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

The optional parcel and delivery IDs may be omitted. The action uses the original supervised queue and upload/download permissions. Its completed task includes direct links to the recipe, manifest and complete context/parcel ZIPs. The desk and global task list open the scientific composer or Maps and delivery only in the task's original Workspace. The descriptor declares `openScientificReport` and `openDelivery`; install this client with the maintained host that exposes both capabilities. The shared source composer validates the actual collection/document choices and keeps its preview and original-source checks. Before changing any source file, the station-family installer checks the installed app callback and Sources bridge together with the exact staged composer, and records the staged and original destination hashes in its receipt. The family installs the updated composer in the same pass, upgrading an existing composer without the prepared-selection mode while preserving backups and concurrent-source checks.

For a focused receiving check, use the same actual saved context, prepare and import its report source, bind and collect it through `model.observed_context`, and verify every delivered companion against the original source member descriptor. Archive/restore the current Workspace through its normal operation and reopen the same saved source and delivery. Preserve actual context, parcel, collection, document, report and receiving IDs in the existing operation receipt.


### Complete component installation

The station installer composes its owned source with the original WBD producer's selected component inventory. Every selected original response, input and source companion is included and checked before any file changes. The WBD context module remains available when opening the existing station studies; its dated boundary association preserves each selected point's original datum and coordinates.

The additive assessment scientific-report component declaration names the existing composer runtime files directly. Their implementation stays with the maintained Scientific reports producer. This explicit source membership avoids a dependency cycle with the broader observed-context data component and keeps ordinary station and assessment selections usable without introducing unrelated source datasets.


### NLDI station source extension

The station installer composes the original WBD catalogue with its maintained `observed-station-wbd-nldi-197` extension before selecting files. The extension contributes the original NLDI point file and all 13 original WBD responses, retaining 197 coordinate-specific context rows and both gauge-coordinate variants. The existing component fragment reader validates the declaration; all selected source members and declared hashes are checked before any application file changes. Geographic source context remains separate from the assessment cause and use inventory.


### Geographic context and assessment inventories

Saved observed-station studies retain their original WBD point and watershed tables. Assessment context displays these under **Geographic source context**, with the source title, vintage, row count, original link and retained identity. These tables remain part of the saved station study and portable source package. They do not supply assessment cause, use, support or publication records.

The assessment selector uses the producer’s explicit geographic source type to keep those tables out of automatic inventory selection. The backend applies the same distinction before normalizing selected fields and extracting original records, including manually supplied selections. Untyped custom assessment tables remain available with their original field mappings. Existing 87-, 159- and 164-station assessment inventories preserve all original 293 edition-specific records.

Opening **Use saved study in assessment context** always adopts that exact saved study in its original Workspace. When an observed-station study contains geographic context only, its original geographic sources are displayed and the assessment build action stays disabled. Choose a saved assessment study or use **Open Station geography** to prepare the assessment study from its original sources. Saved assessment results and their report, parcel and portable receiving controls remain available below the form.

The complete standalone installation also retains the current native assessment review provider, client and guide, so the maintained station desk can accept its original source-bound station selection without a missing module or browser asset.


### Open the exact prepared scientific source selection

**Open scientific report** restores the prepared report's complete source list in its saved reading order and sets its prepared title. It replaces the current composer draft's source selection; the same operator's contact details remain available. Ordinary additions from Sources continue to append a selected study to the existing draft. Pending report operations must complete or be recovered before either action changes a selection.

This family includes and installs the maintained Scientific reports composer with its `replace-v1` prepared-source contract in `operator/web/source_report_editions.mjs`. Before any writes, the station installer checks the exact staged composer together with the existing complete application's callback and Sources bridge. It preserves the original destination bytes in the installation receipt and rechecks them before replacement. An existing composer without the new selection mode upgrades in this same installation; backups and concurrent-source checks apply to the composer as to every changed family member.


### Read the original watershed comparison in reports and exports

The saved context compares the publisher's original assessment watershed label with station point/polygon memberships in the **selected original watershed source**. The operator and prepared scientific report show that source explicitly. The computed column displays retained native watershed IDs and each interior/boundary relationship. Repeated native IDs in the same source retain their native feature labels, so separate original polygons remain distinguishable. Memberships in other source layers remain in the original row details and full exports.

Scientific reports include record-level agreement, difference and unresolved counts. A station with multiple causes or source editions contributes multiple original assessment records; these counts are not station counts. The original 164-station selection retains 293 records, 77 publisher-selected watersheds or 78 computed-selected watersheds, and six differing assessment relationships in the original native build. Unresolved relationships are counted separately from differences. Preserve the original source edition, cause, use and support when reading any row.

The operator's filtered CSV now carries the compared source reference, readable computed watershed IDs, complete compared memberships, all original computed memberships and original row/source dictionaries. It follows the same current table search and selected polygon, while report preparation continues to use the full saved context. No native polygon ID or original attribute is replaced with a display label.

Report context edition 1.1.0 uses these human-readable scientific sections. Preparing an existing saved context produces a new immutable report-source edition; prior 1.0.0 report sources remain available. This changes report presentation and filtered exports while preserving the saved station/context editions and native geometries.

In the existing populated receiving course, open both publisher and computed selections and inspect their actual HTML/PDF and filtered CSV. Read a differing original record such as the July 2026 RS-06190 record alongside its separate 2024 cause/use record. Confirm the compared-source caption and original watershed labels are readable at screenshare and narrow widths, inspect the actual rendered pixels, operate CSV/source downloads, and reopen the same scientific report and selected Study. Retain complete original source attachments and each independent receiving identity.

Within each assessment report, edition and cause/use tables follow the saved inventory selection order. The native assessment-group dictionaries keep their original IDs and contents; presentation ordering follows their stable original row IDs. Ordered scientific studies from an existing delivery retain their separate requested reading order in the report composer.


### Prepare a current report after an application upgrade

Preparing a saved assessment or parcel context reads the current report edition
from the operator before submitting its original queue action. That edition is
part of the request identity. After a report formatter update, the same saved
context can therefore produce the current report while earlier completed tasks,
source editions and downloads remain available.

The context's **Open scientific report** controls show the completed preparation
for the current report edition and selected saved delivery. Open an earlier report
explicitly from its original task to retain that report's source selection and
title. Changing the source edition keeps the original contact details and exact
ordered delivery sources.

The catalogue returns `report_version`; new `assessment.context.report`
payloads include that exact value. The provider rejects an explicitly different
version before writing a report source, so a page loaded before an upgrade can
reload its controls. Retained legacy tasks without this field remain readable
and resumable. The result's existing `version` identifies its report source;
station and assessment context IDs remain unchanged.

The context desk shows the latest 15 assessment operations in the operator's original newest-first order. Earlier retained operations remain accessible through the complete Operations panel.

### Original watershed maps in scientific reports

The saved assessment report source now includes native vector maps in the existing
Scientific Reports HTML and PDF. The original selected watershed source supplies
the geometry; the longitude/latitude context display is not used as projected
metre data. The original 217-HUC source uses its retained EPSG:3857 coordinates.

The overview shows the complete retained watershed source in light gray and the
saved context selection with black outlines. The all-editions publisher selection
contains77 polygons; the computed-membership selection contains78. Both retain
the original293 assessment records and all164 stations. These are the saved
relationship selections, not new geographic calculations or water-quality ranks.

A separate comparison figure shows up to six distinct differing station/polygon
relationships per page. Gray polygons represent publisher watershed associations;
black outlines represent saved station memberships. Numbered labels use a
cartographic point inside the first computed polygon, **not a station location**.
A station with multiple original assessment records retains every edition,
cause, use, support and source reference in the map metadata. Pagination never
drops a differing relationship. Unresolved comparisons remain explicit in
metadata and report tables and do not become mapped geographic disagreements.

The shared `scientific_map_figures` renderer draws original native XY geometry,
multipart polygons and holes without reprojection or simplification. The scale
bar and north arrow describe the projected grid. In EPSG:3857, grid metres are
not a corrected ground-distance or area measurement. Figure shading carries
source/relationship roles rather than concentrations, load estimates, ecological
condition or conservation priority.

Each prepared source retains its raw native watershed body directly under
`maps/original-source/`, with its actual path, byte count and SHA256 bound to
the figure layers and report inputs. Complete source companions remain in
`context/original-station-geography.zip`. The generated
`maps/assessment-map-figures.json` retains all drawn native geometry, exact
source feature identities and renderer specifications;
`maps/assessment-map-context.json` retains the selected polygon IDs, every
differing original record, source CRS and any native geometry-reader operations.
The ordinary source downloads include both files and every complete SVG.

Report source1.2 advances the presentation edition while preserving the saved
station and assessment editions. Its immutable identity binds the exact map
producer and both shared scientific renderer files. The complete preparation
and actual browser course bind those same three file hashes. Use a fresh
preparation output after implementation changes; the existing study/context
models retain and reopen their prior immutable results.

Generic contexts whose original source uses geographic coordinates or projected
feet continue to prepare their original report and source attachments. They
record the explicit native-map availability explanation rather than silently
reprojecting or treating those coordinates as metres. The original217 source
is fully supported.

In the existing receiving course, open the exact original and independently
received report, inspect the grayscale overview, all comparison pages, complete
legend text, polygon holes, native CRS/grid scale and all actual SVG downloads.
At screenshare and narrow widths, operate the saved report/source controls and
reopen its complete exported project. Read RS-06190 and the other original
differing relationships beside their edition-specific records; preserve the
separate original/received source identities. Fix any unreadable or clipped
outgoing map in the maintained source before presentation.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->

## Reopen an assessment through a saved scientific report

Scientific Reports retains the ordered source selection and the complete original
assessment and station packages. Export the completed scientific report as a
selected Study and receive that Study in the destination Workspace. In
**Received Studies**, open the retained report and its **Assessment context and
original station geography** section.

For a newly captured Study whose editable editions were present in the producing
Workspace, **Open saved assessment context** opens that exact context.
**Open Station geography** opens its exact original station edition. When the
source includes parcel associations, **Open saved parcel associations** opens
the matching context and parcel edition together. The source collection, source
ID, body SHA256 and original project/context IDs remain visible beside the
original maps, report files and complete source packages.

Older report-only Studies and report sources imported from another project still
retain their original source bytes. Their **Receive editable assessment** action
uses the existing serial operator queue to receive those complete native packages
and register editable Station and Assessment records in the current Workspace.
The completed task opens the actual returned context and optional parcel IDs.
Its mapping records the source project and original context, station and parcel
IDs beside their receiving Workspace counterparts. A parcel package that was
already received elsewhere keeps its own original package context identity;
receiving follows that package's native context and verifies the selected
original assessment records and geographic relationship.

This operation reuses the original ZIPs and native receiving methods. It preserves
the original report edition, map inputs, original assessment dictionaries and
source body hashes. The selected source's record filter, publisher/computed
watershed relationship, station selection and selected geometry remain attached
to the reopened context. Reopening an earlier Study does not add new dependencies
to that Study's historical capture. Its source-only view can be adopted explicitly
without rendering another original report or repeating its export.

**Open this report source only** replaces the current composer selection with
that exact source. **Add to current report** appends it through the maintained
composer while keeping the existing ordered choices. The completed report's
original files remain downloadable from the receiving view.

The queued action is `assessment.context.adopt_source`. It requires the exact
`source_collection_id`, `source_id` and `source_body_sha256`. The task retains
its source binding, original/receiving ID mapping and the original archive hashes.
Repeated use of the same source resumes the saved receiving result; original
assessment rows are identified by their source body SHA and original row/pointer,
including distinct records across assessment editions.

Inspect the actual outgoing report maps and attachments in the receiving
Workspace, open the Station and Assessment desks at desktop and narrow widths,
and reopen the same saved Study after the operator restarts. The existing
assessment receiving browser course exercises this route alongside the report
downloads.

Current owner direction is [CURRENT_OWNER_DIRECTION.md](../CURRENT_OWNER_DIRECTION.md),
version **2026-10-13.3**. Keep this receiving route within the existing scientific
case and its actual original source scope. For the prepared Upper Savannah
assessment studies, the retained publisher-HUC selection remains 192 published
records; its all-editions context retains those records plus 101 draft records.
Other saved source selections reopen under their own original filters and IDs.
